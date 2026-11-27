import type { Adb } from "@yume-chan/adb";
import { makeAutoObservable, runInAction } from "mobx";
import { connection } from "./connection";
import { shell } from "./privilege";

export type LogLevel = "V" | "D" | "I" | "W" | "E" | "F";
export const LEVEL_ORDER: LogLevel[] = ["V", "D", "I", "W", "E", "F"];
export const LEVEL_RANK: Record<string, number> = {
    V: 0,
    D: 1,
    I: 2,
    W: 3,
    E: 4,
    F: 5,
    A: 6, // Assert
    S: 7, // Silent
};

export interface LogLine {
    id: number;
    /** 原始整行 */
    raw: string;
    level: LogLevel | "A";
    pid: number;
    tid: number;
    tag: string;
    message: string;
    time: string;
}

/** 日志格式（logcat -v <x>） */
export const LOGCAT_FORMATS = [
    { key: "threadtime", text: "threadtime（日期 时间 PID TID 等级 标签）" },
    { key: "time", text: "time（日期 时间 等级 标签 PID: 内容）" },
    { key: "brief", text: "brief（等级/标签 PID: 内容）" },
    { key: "process", text: "process（等级 PID: 内容）" },
    { key: "tag", text: "tag（等级/标签: 内容）" },
    { key: "thread", text: "thread（等级 标签 PID TID: 内容）" },
    { key: "raw", text: "raw（仅内容）" },
    { key: "long", text: "long（完整信息多行）" },
] as const;

/** 日志缓冲区 */
export const LOGCAT_BUFFERS = [
    { key: "", text: "默认（main）" },
    { key: "main,system,crash", text: "main + system + crash" },
    { key: "all", text: "all（全部，含 radio/events）" },
    { key: "system", text: "system" },
    { key: "radio", text: "radio" },
    { key: "events", text: "events" },
    { key: "crash", text: "crash" },
] as const;

const MAX_DISPLAY = 5000; // 仅渲染上限，不影响采集与落盘
const FLUSH_INTERVAL = 400; // ms
const FLUSH_BYTES = 512 * 1024;
const FILE_LIMIT = 20 * 1024 * 1024; // 20MB 分片

/** 一行 threadtime 形如：01-02 03:04:05.678  1234  5678 D Tag: message */
const THREADTIME_RE =
    /^(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFAS])\s+(.*?):\s?(.*)$/;
/** time 格式：01-02 03:04:05.678  D/Tag( 1234): message （部分设备带 PID） */
const TIME_RE =
    /^(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d+)\s+([VDIWEFAS])\/([^(]+)\(\s*(\d+)\):\s?(.*)$/;
/** brief 格式：D/Tag( 1234): message 或 D/Tag: message */
const BRIEF_RE = /^([VDIWEFAS])\/([^(]+)\(\s*(\d+)\):\s?(.*)$/;
const BRIEF_RE2 = /^([VDIWEFAS])\/([^:]+):\s?(.*)$/;
/** process 格式：D( 1234) message */
const PROCESS_RE = /^([VDIWEFAS])\(\s*(\d+)\)\s?(.*)$/;

/**
 * 解析一行日志。**健壮优先** —— 兼容 threadtime / time / brief / process 等格式。
 * 关键修复：旧实现只在「等级字母紧跟 ( 或 /」时才识别，
 * 导致默认的 `-v time` 格式（等级后是空格）全部被误判为 V 而隐藏。
 */
export function parseLogLine(raw: string): {
    level: LogLevel | "A";
    pid: number;
    tid: number;
    tag: string;
    message: string;
    time: string;
} {
    let m = THREADTIME_RE.exec(raw);
    if (m) {
        return {
            level: m[5] as LogLevel,
            pid: Number(m[3]),
            tid: Number(m[4]),
            tag: m[6]!.trim(),
            message: m[7] ?? "",
            time: `${m[1]} ${m[2]}`,
        };
    }
    m = TIME_RE.exec(raw);
    if (m) {
        return {
            level: m[3] as LogLevel,
            pid: Number(m[5]),
            tid: 0,
            tag: m[4]!.trim(),
            message: m[6] ?? "",
            time: `${m[1]} ${m[2]}`,
        };
    }
    m = BRIEF_RE.exec(raw);
    if (m) {
        return {
            level: m[1] as LogLevel,
            pid: Number(m[3]),
            tid: 0,
            tag: m[2]!.trim(),
            message: m[4] ?? "",
            time: "",
        };
    }
    m = PROCESS_RE.exec(raw);
    if (m) {
        return {
            level: m[1] as LogLevel,
            pid: Number(m[2]),
            tid: 0,
            tag: "",
            message: m[3] ?? "",
            time: "",
        };
    }
    m = BRIEF_RE2.exec(raw);
    if (m) {
        return {
            level: m[1] as LogLevel,
            pid: 0,
            tid: 0,
            tag: m[2]!.trim(),
            message: m[3] ?? "",
            time: "",
        };
    }
    // 兜底：整行作为 message，等级视为 V（可通过关键字过滤找到）
    return { level: "V", pid: 0, tid: 0, tag: "", message: raw, time: "" };
}

/** 应用信息 */
export interface AppInfo {
    package: string;
    pid: number;
}

/**
 * 日志文件写入器：按 20MB 分片写入用户选择的本地文件夹。
 * 未选择文件夹时不启用落盘，仅保存在内存。
 */
class LogFileWriter {
    private dir: FileSystemDirectoryHandle | undefined;
    private file: FileSystemFileHandle | undefined;
    private writable: FileSystemWritableFileStream | undefined;
    private pending: string[] = [];
    private pendingBytes = 0;
    private currentBytes = 0;
    private part = 0;
    private sessionName = "";
    private timer: ReturnType<typeof setInterval> | undefined;

    get enabled(): boolean {
        return !!this.dir;
    }

    get baseName(): string {
        return this.sessionName;
    }

    async chooseDirectory(): Promise<string | undefined> {
        const picker = (
            window as unknown as {
                showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
            }
        ).showDirectoryPicker;
        if (!picker) {
            throw new Error(
                "当前浏览器不支持选择文件夹（需 Chrome/Edge 桌面版）。可继续仅用浏览器内存缓存。",
            );
        }
        this.dir = await picker.call(window);
        return this.dir.name;
    }

    clearDirectory() {
        this.dir = undefined;
    }

    async start() {
        this.part = 0;
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        this.sessionName = `logcat-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(
            d.getDate(),
        )}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        if (this.dir) {
            await this.openPart();
        }
        this.timer = setInterval(() => {
            void this.flush();
        }, FLUSH_INTERVAL);
    }

    private async openPart() {
        if (!this.dir) return;
        const name =
            this.part === 0
                ? `${this.sessionName}.txt`
                : `${this.sessionName}.part${this.part}.txt`;
        this.file = await this.dir.getFileHandle(name, { create: true });
        this.writable = await this.file.createWritable();
        this.currentBytes = 0;
    }

    private async rollIfNeeded() {
        if (this.currentBytes >= FILE_LIMIT) {
            await this.closeFile();
            this.part += 1;
            await this.openPart();
        }
    }

    private async closeFile() {
        if (this.writable) {
            try {
                await this.writable.close();
            } catch {
                /* ignore */
            }
            this.writable = undefined;
        }
    }

    /** 追加一批行（内存缓冲） */
    push(lines: string[]) {
        if (!this.dir || lines.length === 0) return;
        this.pending.push(...lines);
        for (const l of lines) this.pendingBytes += l.length + 1;
        if (this.pendingBytes >= FLUSH_BYTES) void this.flush();
    }

    private flushing = false;
    async flush() {
        if (!this.dir || !this.writable || this.flushing || this.pending.length === 0) {
            return;
        }
        this.flushing = true;
        try {
            const text = this.pending.join("\n") + "\n";
            this.pending = [];
            this.pendingBytes = 0;
            await this.writable.write(text);
            this.currentBytes += text.length;
            await this.rollIfNeeded();
        } catch {
            /* 写盘失败不影响采集 */
        } finally {
            this.flushing = false;
        }
    }

    async stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        await this.flush();
        await this.closeFile();
        this.pending = [];
        this.pendingBytes = 0;
    }
}

class LogcatStore {
    lines: LogLine[] = [];
    /** 采集到的总行数（不受渲染上限影响） */
    total = 0;
    running = false;
    error: string | undefined = undefined;

    // ---- 过滤条件（相互关联） ----
    enabledLevels: Record<string, boolean> = {
        V: false,
        D: true,
        I: true,
        W: true,
        E: true,
        F: true,
    };
    keyword = "";
    tagFilter = "";
    /** 选中的应用包名（空 = 不过滤） */
    packageFilter = "";

    // ---- 格式与缓冲 ----
    format = "threadtime";
    buffer = "";

    // ---- 应用识别 ----
    apps: AppInfo[] = [];
    loadingApps = false;

    // ---- 落盘 ----
    writer = new LogFileWriter();
    dirName: string | undefined = undefined;

    // ---- 时间限制 ----
    /** 自动停止分钟数（0 = 不限制） */
    autoStopMinutes = 0;

    private abort: AbortController | undefined;
    private idSeq = 0;
    private bufferText = "";
    private autoStopTimer: ReturnType<typeof setTimeout> | undefined;

    constructor() {
        // writer 内含文件句柄，不能交给 MobX 代理。
        // 其余私有字段用 makeAutoObservable 默认行为即可（不参与视图渲染）。
        makeAutoObservable(this, { writer: false }, { autoBind: true });
    }

    get displayLines(): LogLine[] {
        // 只渲染尾部若干行（性能），但采集与落盘不受此限制
        const n = this.lines.length;
        return n > MAX_DISPLAY ? this.lines.slice(n - MAX_DISPLAY) : this.lines;
    }

    get hiddenByDisplayCap(): number {
        return Math.max(0, this.lines.length - MAX_DISPLAY);
    }

    /** 判断一行是否通过所有过滤条件 */
    private pass(line: LogLine): boolean {
        if (!this.enabledLevels[line.level]) return false;
        if (this.packageFilter) {
            const app = this.apps.find((a) => a.package === this.packageFilter);
            // 应用 PID 已知时按 PID 精确过滤；未知时退化为按进程名匹配
            if (app && app.pid) {
                if (line.pid !== app.pid && !line.raw.includes(this.packageFilter)) {
                    return false;
                }
            } else if (!line.raw.includes(this.packageFilter)) {
                return false;
            }
        }
        if (this.tagFilter && !line.tag.toLowerCase().includes(this.tagFilter.toLowerCase())) {
            return false;
        }
        if (this.keyword) {
            if (!line.raw.toLowerCase().includes(this.keyword.toLowerCase())) return false;
        }
        return true;
    }

    /** 经过过滤的可见行 */
    get filtered(): LogLine[] {
        return this.displayLines.filter((l) => this.pass(l));
    }

    /** 过滤后的总条数（全量，不只渲染部分） */
    get filteredTotal(): number {
        return this.lines.filter((l) => this.pass(l)).length;
    }

    setLevel(level: string, on: boolean) {
        this.enabledLevels = { ...this.enabledLevels, [level]: on };
    }

    setAllLevels(on: boolean) {
        const next: Record<string, boolean> = {};
        for (const l of LEVEL_ORDER) next[l] = on;
        this.enabledLevels = next;
    }

    async chooseLogDirectory() {
        try {
            const name = await this.writer.chooseDirectory();
            runInAction(() => {
                this.dirName = name;
                this.error = undefined;
            });
        } catch (e) {
            runInAction(() => {
                this.error = e instanceof Error ? e.message : String(e);
            });
        }
    }

    clearLogDirectory() {
        this.dirName = undefined;
        this.writer.clearDirectory();
    }

    /** 列出设备上的应用（第三方 + 系统带界面）及其 PID */
    async loadApps() {
        const adb = connection.adb;
        if (!adb) return;
        runInAction(() => {
            this.loadingApps = true;
        });
        try {
            const out = await shell(adb, "pm list packages");
            const pkgs = out
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l.startsWith("package:"))
                .map((l) => l.slice("package:".length).trim())
                .filter(Boolean);

            // 读取当前进程列表，映射 PID
            let pidMap = new Map<string, number>();
            try {
                const ps = await shell(adb, "ps -A -o PID,NAME");
                for (const line of ps.split("\n")) {
                    const m = line.trim().match(/^(\d+)\s+(.+)$/);
                    if (m) {
                        const pid = Number(m[1]);
                        const name = m[2]!.trim();
                        if (!pidMap.has(name)) pidMap.set(name, pid);
                    }
                }
            } catch {
                /* 老设备无 ps -A，忽略 */
            }

            const apps: AppInfo[] = pkgs
                .map((packageName) => ({
                    package: packageName,
                    pid: pidMap.get(packageName) ?? 0,
                }))
                .sort((a, b) => a.package.localeCompare(b.package));

            runInAction(() => {
                this.apps = apps;
                this.loadingApps = false;
            });
        } catch (e) {
            runInAction(() => {
                this.loadingApps = false;
                this.error = e instanceof Error ? e.message : String(e);
            });
        }
    }

    /** 重新解析选中应用的 PID（应用可能刚启动） */
    async refreshFilterPid() {
        const adb = connection.adb;
        if (!adb || !this.packageFilter) return;
        try {
            const out = await shell(adb, `pidof ${this.packageFilter}`);
            const pid = Number(out.trim().split(/\s+/)[0]) || 0;
            runInAction(() => {
                const app = this.apps.find((a) => a.package === this.packageFilter);
                if (app) app.pid = pid;
            });
        } catch {
            /* ignore */
        }
    }

    /** 构造 logcat 命令：**不在设备端做等级过滤**，全量拉取后前端过滤 */
    private buildCommand(): string {
        const parts = ["logcat", "-v", this.format];
        if (this.buffer) parts.push("-b", this.buffer);
        return parts.join(" ");
    }

    async start() {
        const adb = connection.adb;
        if (!adb || this.running) return;

        runInAction(() => {
            this.running = true;
            this.error = undefined;
            this.lines = [];
            this.total = 0;
            this.bufferText = "";
        });

        this.abort = new AbortController();
        await this.writer.start();

        // 自动停止计时
        if (this.autoStopMinutes > 0) {
            this.autoStopTimer = setTimeout(
                () => void this.stop(),
                this.autoStopMinutes * 60 * 1000,
            );
        }

        const cmd = this.buildCommand();
        try {
            // 用 shell 协议执行，确保参数正确传递
            const session = await adb.subprocess.noneProtocol.pty(cmd);

            await (session.output as unknown as ReadableStream<Uint8Array>)
                .pipeTo(
                    new WritableStream<Uint8Array>({
                        write: (chunk) => this.onChunk(chunk),
                    }),
                    { signal: this.abort.signal },
                )
                .catch(() => {
                    /* aborted */
                });
        } catch (e) {
            runInAction(() => {
                this.error = e instanceof Error ? e.message : String(e);
            });
        } finally {
            if (this.running) {
                void this.stop();
            }
        }
    }

    private onChunk(chunk: Uint8Array) {
        this.bufferText += new TextDecoder().decode(chunk, { stream: true });
        const rawLines: string[] = [];
        let idx: number;
        while ((idx = this.bufferText.indexOf("\n")) >= 0) {
            const line = this.bufferText.slice(0, idx);
            this.bufferText = this.bufferText.slice(idx + 1);
            if (line.trim()) rawLines.push(line);
        }
        if (rawLines.length === 0) return;

        const parsed: LogLine[] = [];
        for (const raw of rawLines) {
            const p = parseLogLine(raw);
            parsed.push({
                id: this.idSeq++,
                raw,
                level: p.level,
                pid: p.pid,
                tid: p.tid,
                tag: p.tag,
                message: p.message,
                time: p.time,
            });
        }

        // 落盘：全量写入文件（不做等级过滤，保证完整性）
        this.writer.push(rawLines);

        runInAction(() => {
            this.total += parsed.length;
            this.lines.push(...parsed);
        });
    }

    async stop() {
        this.abort?.abort();
        this.abort = undefined;
        if (this.autoStopTimer) {
            clearTimeout(this.autoStopTimer);
            this.autoStopTimer = undefined;
        }
        await this.writer.stop();
        runInAction(() => {
            this.running = false;
        });
    }

    /** 清空设备端缓冲区（logcat -c） */
    async clearDeviceBuffer() {
        const adb = connection.adb;
        if (!adb) return;
        try {
            await adb.subprocess.noneProtocol.pty("logcat -c");
        } catch (e) {
            runInAction(() => {
                this.error = e instanceof Error ? e.message : String(e);
            });
        }
        runInAction(() => {
            this.lines = [];
            this.total = 0;
        });
    }

    /** 导出当前过滤结果为文本（下载） */
    exportText(): string {
        return this.lines
            .filter((l) => this.pass(l))
            .map((l) => l.raw)
            .join("\n");
    }
}

export const logcat = new LogcatStore();

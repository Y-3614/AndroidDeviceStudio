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

/**
 * 内存中保留的最大行数（**环形缓冲**）。
 *
 * 这是「打印日志导致电脑卡顿」的关键修复之一：
 * 旧实现 lines 无上限增长，日志跑几分钟就有几十万行常驻内存，
 * 加上每个 chunk 都触发一次全量 MobX 通知与重新渲染，必然卡死。
 * 现在内存中只保留最近 N 行；**完整日志通过「选择文件夹落盘」获得**。
 */
const MAX_MEMORY_LINES = 8000;
/** 仅渲染上限（DOM 节点数），进一步低于内存上限以保证滚动流畅 */
const MAX_DISPLAY = 1500;
/** 批量刷新间隔：把高频 chunk 合并成一次 UI 更新，避免每个分片都 re-render */
const VIEW_FLUSH_INTERVAL = 300; // ms
const FLUSH_BYTES = 256 * 1024;
const FILE_LIMIT = 20 * 1024 * 1024; // 20MB 分片
/**
 * 真实提交到磁盘的间隔。
 *
 * ⚠️ 关键：File System Access API 的 `createWritable()` 写入的是**临时 swap 文件**，
 * 只有 `close()` 时才把内容真正替换进目标文件。
 * 旧实现只在 20MB 分片或 stop() 时才 close →
 * 采集过程中在文件管理器里**根本看不到文件**（用户反馈的「没有 log」）。
 * 现在改为：保持句柄常开，每隔 COMMIT_INTERVAL 主动「写一批 → close 提交 → 重新打开」，
 * 于是文件一采集就存在，并随时间持续增长。
 */
const COMMIT_INTERVAL = 3000; // ms

/** UTF-8 编码器：seek 需要字节偏移，不能用字符串长度（中文是多字节） */
const UTF8 = new TextEncoder();

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
 *
 * ⚠️ 落盘原理（踩过的坑）：
 * File System Access API 的 `createWritable()` 写入的是**临时 swap 文件**，
 * 调用 `close()` 才会把它原子替换进目标文件。
 * 因此若只在「20MB 分片」或「停止采集」时才 close，
 * 采集过程中文件在磁盘上**根本不存在** —— 这就是用户反馈「没有 log」的原因。
 * 现在改为每 COMMIT_INTERVAL 主动提交一次（写 → close → 以 keepExistingData 重开并 seek 到末尾）。
 */
class LogFileWriter {
    private dir: FileSystemDirectoryHandle | undefined;
    private file: FileSystemFileHandle | undefined;
    private writable: FileSystemWritableFileStream | undefined;
    private pending: string[] = [];
    private pendingBytes = 0;
    /** 当前分片已写入字节数 */
    private currentBytes = 0;
    /** 本次会话累计写入字节数（跨分片） */
    private totalBytes = 0;
    private part = 0;
    private sessionName = "";
    private timer: ReturnType<typeof setInterval> | undefined;
    private flushing = false;
    private lastError: string | undefined;
    /** 上次提交时的分片字节数（用于避免空提交） */
    private lastCommittedBytes = -1;

    get enabled(): boolean {
        return !!this.dir;
    }

    get baseName(): string {
        return this.sessionName;
    }

    /** 本次会话累计写入磁盘的字节数（用于 UI 显示大小） */
    get bytesWritten(): number {
        return this.totalBytes;
    }

    /** 当前分片序号（0 起） */
    get partIndex(): number {
        return this.part;
    }

    /** 最近一次写盘错误（用于 UI 提示） */
    get error(): string | undefined {
        return this.lastError;
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
        const handle = await picker.call(window);
        // 立即验证写权限：部分浏览器选择后仍需授权
        const anyHandle = handle as unknown as {
            queryPermission?: (d: { mode: string }) => Promise<string>;
            requestPermission?: (d: { mode: string }) => Promise<string>;
        };
        if (anyHandle.queryPermission) {
            let state = await anyHandle.queryPermission({ mode: "readwrite" });
            if (state !== "granted" && anyHandle.requestPermission) {
                state = await anyHandle.requestPermission({ mode: "readwrite" });
            }
            if (state !== "granted") {
                throw new Error("未获得文件夹写入权限，请重新选择并点击「允许」。");
            }
        }
        this.dir = handle;
        return this.dir.name;
    }

    clearDirectory() {
        this.dir = undefined;
    }

    async start() {
        this.part = 0;
        this.totalBytes = 0;
        this.currentBytes = 0;
        this.lastCommittedBytes = -1;
        this.lastError = undefined;
        this.pending = [];
        this.pendingBytes = 0;
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        this.sessionName = `logcat-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(
            d.getDate(),
        )}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        if (this.dir) {
            try {
                await this.openPart();
                // 立刻创建一个空文件并提交，保证目录里马上能看到
                await this.commit();
            } catch (e) {
                this.lastError = e instanceof Error ? e.message : String(e);
            }
        }
        this.timer = setInterval(() => {
            void this.tick();
        }, COMMIT_INTERVAL);
    }

    private partName(part: number): string {
        return part === 0
            ? `${this.sessionName}.txt`
            : `${this.sessionName}.part${part}.txt`;
    }

    /** 打开当前分片的可写流（保留已有内容，游标定位到末尾） */
    private async openPart() {
        if (!this.dir) return;
        this.file = await this.dir.getFileHandle(this.partName(this.part), {
            create: true,
        });
        this.writable = await this.file.createWritable({
            keepExistingData: true,
        });
        // 游标移到末尾，后续 write 即追加
        if (this.currentBytes > 0) {
            await this.writable.seek(this.currentBytes);
        }
    }

    private async closeFile() {
        if (this.writable) {
            try {
                // close() 才真正把 swap 文件提交到磁盘
                await this.writable.close();
            } catch (e) {
                this.lastError = e instanceof Error ? e.message : String(e);
            }
            this.writable = undefined;
        }
    }

    /** 定时任务：写盘 + 提交，保证磁盘上文件持续增长 */
    private async tick() {
        await this.flush();
        // 只有在真的有新数据写入时才提交（close + 重开），避免空转复制文件
        if (this.currentBytes !== this.lastCommittedBytes) {
            await this.commit();
            this.lastCommittedBytes = this.currentBytes;
        }
        await this.rollIfNeeded();
    }

    /** 追加一批行（进入内存缓冲） */
    push(lines: string[]) {
        if (!this.dir || lines.length === 0) return;
        this.pending.push(...lines);
        for (const l of lines) this.pendingBytes += l.length + 1;
        if (this.pendingBytes >= FLUSH_BYTES) {
            // 大流量时立即写 + 提交，避免内存堆积
            void this.tick();
        }
    }

    /** 把缓冲写进 swap 文件（尚未提交到磁盘） */
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
            const n = UTF8.encode(text).byteLength;
            this.currentBytes += n;
            this.totalBytes += n;
        } catch (e) {
            this.lastError = e instanceof Error ? e.message : String(e);
        } finally {
            this.flushing = false;
        }
    }

    /** close() 提交到磁盘，然后以追加模式重新打开 */
    private async commit() {
        if (!this.writable) return;
        // 还有未写的缓冲，先写掉再提交
        if (this.pending.length > 0) {
            await this.flush();
        }
        await this.closeFile();
        try {
            await this.openPart();
        } catch (e) {
            this.lastError = e instanceof Error ? e.message : String(e);
        }
    }

    private async rollIfNeeded() {
        if (this.currentBytes < FILE_LIMIT) return;
        await this.closeFile();
        this.part += 1;
        this.currentBytes = 0;
        this.lastCommittedBytes = 0;
        try {
            await this.openPart();
            await this.commit();
        } catch (e) {
            this.lastError = e instanceof Error ? e.message : String(e);
        }
    }

    async stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        await this.flush();
        // 停止时必须 close，把最后一批数据真正落盘
        await this.closeFile();
        this.pending = [];
        this.pendingBytes = 0;
    }
}

class LogcatStore {
    /** 内存中的日志（环形缓冲，最多 MAX_MEMORY_LINES 行） */
    lines: LogLine[] = [];
    /** 采集到的总行数（不受内存与渲染上限影响） */
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
    /** 已写入磁盘的字节数（由节流定时器同步，用于 UI 显示大小） */
    logBytes = 0;
    /** 当前分片序号（0 起） */
    logPart = 0;
    /** 落盘错误（若有） */
    logError: string | undefined = undefined;

    // ---- 时间限制 ----
    /** 自动停止分钟数（0 = 不限制） */
    autoStopMinutes = 0;

    // 以下为内部实现字段（在 makeAutoObservable 中显式声明为非响应式）
    abort: AbortController | undefined;
    idSeq = 0;
    bufferText = "";

    autoStopTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * UI 刷新节流：把高频到达的日志先放进 pending，按固定间隔批量提交，
     * 避免每个网络分片都触发一次 MobX 通知 + React 重渲染（卡顿主因之一）。
     */
    pending: LogLine[] = [];
    viewTimer: ReturnType<typeof setInterval> | undefined;

    constructor() {
        // writer 内含文件句柄，不能交给 MobX 代理。
        makeAutoObservable(
            this,
            {
                writer: false,
                pending: false,
                viewTimer: false,
                abort: false,
                idSeq: false,
                bufferText: false,
                autoStopTimer: false,
            },
            { autoBind: true },
        );
    }

    /** 内存中被环形缓冲丢弃的行数 */
    get droppedFromMemory(): number {
        return Math.max(0, this.total - this.lines.length);
    }

    get displayLines(): LogLine[] {
        // 只渲染尾部若干行（性能），采集与落盘不受此限制
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
        this.pending = [];

        this.abort = new AbortController();
        // 启动 UI 节流刷新（关键：避免每个分片都触发重渲染造成卡顿）
        this.startViewTimer();
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

        // 先进入 pending，由节流定时器批量提交（连同 total 一起在 action 中更新）
        this.pending.push(...parsed);
    }

    /**
     * 把 pending 中的日志批量并入可视列表。
     *
     * 这里做三件保命的事：
     * 1. 一次 runInAction 提交整批，避免逐行触发响应式更新；
     * 2. 环形缓冲：超出 MAX_MEMORY_LINES 时从头部截断，内存恒定；
     * 3. 只在有内容时更新，避免空转。
     */
    private commitPending() {
        // 顺便把落盘进度同步给 UI（大小 / 分片 / 错误）
        const w = this.writer;
        const nextBytes = w.bytesWritten;
        const nextPart = w.partIndex;
        const nextErr = w.error;
        if (
            nextBytes !== this.logBytes ||
            nextPart !== this.logPart ||
            nextErr !== this.logError
        ) {
            runInAction(() => {
                this.logBytes = nextBytes;
                this.logPart = nextPart;
                this.logError = nextErr;
            });
        }
        if (this.pending.length === 0) return;
        const batch = this.pending;
        this.pending = [];
        runInAction(() => {
            const next = this.lines.concat(batch);
            if (next.length > MAX_MEMORY_LINES) {
                this.lines = next.slice(next.length - MAX_MEMORY_LINES);
            } else {
                this.lines = next;
            }
            // total 表示「累计采集行数」，即使内存里已截断也照常累加
            this.total += batch.length;
        });
    }

    /** 启动 UI 节流刷新定时器 */
    private startViewTimer() {
        this.stopViewTimer();
        this.viewTimer = setInterval(() => this.commitPending(), VIEW_FLUSH_INTERVAL);
    }

    private stopViewTimer() {
        if (this.viewTimer) {
            clearInterval(this.viewTimer);
            this.viewTimer = undefined;
        }
        // 收尾时把剩余日志刷出去
        this.commitPending();
    }

    async stop() {
        this.abort?.abort();
        this.abort = undefined;
        // 先停掉节流并刷出剩余日志，再关闭文件
        this.stopViewTimer();
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

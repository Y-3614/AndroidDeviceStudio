import type { Adb } from "@yume-chan/adb";
import { makeAutoObservable, runInAction } from "mobx";
import { connection } from "./connection";
import { saveBlob } from "./file-stream";
import { fs } from "./fs";
import { shell } from "./privilege";

/**
 * TEST 脚本 store。
 *
 * 把原先散落在 .bat / .sh 里的常用测试流程固化成可配置、可一键执行的按钮：
 *  - 日志拉取（**每次新建「年月日_时分秒」子文件夹**，与 01_pull_log.bat 一致）
 *  - 日志清理（相当于 02_rm_device_log_file.bat）
 *  - Monkey 稳定性测试（包名与参数可改，含自检）
 *  - 蓝牙 HCI 日志（开启 / 导出 / 删除）
 *  - CPU 与内存占用监控（间隔可调，可导出选目录）
 *  - 应用管理（列出 / 启动 / 进详情 / 强停 / 导出包名 txt）
 *
 * 参考脚本来源：`犀重智能座舱域控制器/d.monkey与内存的Adb命令测试脚本`
 */

/** 把字符串写成 sh 安全的单引号形式（用于命令里嵌路径/包名） */
function q(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** 生成本地文件夹名：YYYY-MM-DD_HH-MM-SS（与 01_pull_log.bat 的 %a% 对应） */
export function timestampName(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return (
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
        `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
    );
}

const LS_KEY = "ads.testscript.config.v2";

/** 默认日志拉取路径（来自 01_pull_log.bat） */
const DEFAULT_PULL_PATHS = [
    "/data/yx_log",
    "/data/sde",
    "/data/sdrv_logs",
    "/data/kernel_log",
    "/data/anr",
    "/data/tombstones",
    "/sdcard/yaxon",
    "/cluster_config",
    "/sdcard/yx_log",
    "/data/yaxon",
].join("\n");

/** 默认清理路径（来自 02_rm_device_log_file.bat） */
const DEFAULT_CLEAN_PATHS = [
    "/data/yx_log/",
    "/data/sde/",
    "/data/sdrv_logs/",
    "/data/kernel_log/",
    "/data/anr/",
    "/data/tombstones",
    "/sdcard/yaxon",
    "/cluster_config/",
    "/sdcard/yx_log/",
    "/data/yaxon",
].join("\n");

/** 默认 Monkey 包名（来自 monkey-test.bat / shell_cmd.sh） */
const DEFAULT_MONKEY_PACKAGES = [
    "com.yaxon.misc_service",
    "com.yaxon.launcher",
    "com.yaxon.eq_service",
    "com.yaxon.fota",
    "com.yaxon.hvac",
    "com.yaxon.pki",
    "com.yaxon.camera",
    "com.yaxon.datacenter_service",
    "com.yaxon.setting",
    "com.yaxon.music",
    "com.yaxon.radio",
    "com.yaxon.video",
    "com.yaxon.voice",
    "com.yaxon.bluetooth",
    "com.yaxon.superstructure",
    "com.txznet.txz",
    "com.title.mapautosdk",
].join("\n");

const DEFAULT_MONKEY_ARGS =
    "--ignore-timeouts --ignore-security-exceptions --ignore-crashes " +
    "--kill-process-after-error --monitor-native-crashes " +
    "--pct-trackball 0 --pct-nav 0 --pct-majornav 10 --pct-anyevent 10 " +
    "--pct-syskeys 0 --pct-touch 40 --pct-motion 30 --pct-appswitch 10 " +
    "--pct-flip 0 -v -v -v";

/** HCI 日志目录（来自蓝牙脚本） */
export const HCI_LOG_DIR = "/data/misc/bluetooth/logs";

export interface ScriptLogEntry {
    time: string;
    text: string;
    kind: "info" | "ok" | "err";
}

export type AppFilter = "all" | "third" | "system";

/** 某个操作的进度信息 */
export interface ProgressBar {
    percent: number;
    text: string;
    done: boolean;
    ok?: boolean;
}

class TestScriptStore {
    // ---- 日志拉取 ----
    /** 拉取路径列表（每行一个，可改） */
    pullPaths = DEFAULT_PULL_PATHS;
    /** 清理路径列表（每行一个，可改） */
    cleanPaths = DEFAULT_CLEAN_PATHS;
    pulling = false;
    pullProgress = "";
    /** 最近一次拉取创建的本地子文件夹名（用于 UI 提示） */
    lastPullFolder = "";

    // ---- Monkey ----
    monkeyPackages = DEFAULT_MONKEY_PACKAGES;
    monkeyArgs = DEFAULT_MONKEY_ARGS;
    monkeyThrottle = 500;
    monkeyEvents = 1200000;
    monkeyRunning = false;
    /** 执行方式：前台（实时日志） / 后台（写设备文件） */
    monkeyMode: "fg" | "bg" = "fg";
    /** 自检结果文本 */
    monkeyCheck = "";
    /** Monkey 实时日志（原始行） */
    monkeyLiveLog: string[] = [];
    /** Monkey 是否已结束（用于结果反馈） */
    monkeyFinished = false;
    /** 设备端 monkey 日志文件路径（后台模式） */
    monkeyLogFile = "";
    /** 前台执行时的会话句柄（用于停止） */
    monkeyAbort: { kill: () => Promise<void> | void } | undefined = undefined;
    /** 是否由用户主动停止（用于退出码判断） */
    monkeyStoppedByUser = false;

    // ---- 蓝牙 HCI ----
    hciExportProgress = "";

    // ---- CPU/内存监控 ----
    monitorIntervalSec = 10;
    monitoring = false;
    cpuSample?: string;
    memSample?: string;
    /** 历史采样（用于绘制实时曲线）；每点含时间戳与 CPU/内存值 */
    cpuHistory: number[] = [];
    memHistory: number[] = [];
    /** 每次采样的时间标签（与 history 对齐） */
    sampleTimes: string[] = [];
    /** 监控日志行（用于导出） */
    monitorLog: string[] = [];
    /** 上次采样时间 */
    lastSampleAt = "";
    /** 采集开始时间（用于计算时长） */
    monitorStartedAt = 0;
    /** 内存泄露检测结果 */
    leakResult:
        | {
              level: "none" | "slight" | "likely";
              startMem: number;
              endMem: number;
              growth: number;
              growthPerMin: number;
              r2: number;
              detail: string;
          }
        | undefined = undefined;
    /** 各操作的进度信息（0-100 + 描述 + 完成状态） */
    progress: Record<string, ProgressBar> = {};

    // ---- 应用管理 ----
    apps: { package: string; pid: number; system: boolean }[] = [];
    loadingApps = false;
    /** 应用过滤：全部 / 仅第三方 / 仅系统（默认仅第三方） */
    appFilter: AppFilter = "third";
    selectedPackage = "";
    launchForceStop = false;

    // ---- 输出日志 ----
    output: ScriptLogEntry[] = [];

    /** 监控定时器句柄 */
    monitorTimer: ReturnType<typeof setInterval> | undefined;

    constructor() {
        makeAutoObservable(
            this,
            {
                // 会话句柄与定时器不参与响应式
                monkeyAbort: false,
                monitorTimer: false,
            },
            { autoBind: true },
        );
        this.load();
    }

    /* ---------------- 持久化 ---------------- */
    private load() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return;
            const c = JSON.parse(raw) as Partial<TestScriptStore>;
            if (typeof c.pullPaths === "string") this.pullPaths = c.pullPaths;
            if (typeof c.cleanPaths === "string") this.cleanPaths = c.cleanPaths;
            if (typeof c.monkeyPackages === "string") this.monkeyPackages = c.monkeyPackages;
            if (typeof c.monkeyArgs === "string") this.monkeyArgs = c.monkeyArgs;
            if (typeof c.monkeyThrottle === "number") this.monkeyThrottle = c.monkeyThrottle;
            if (typeof c.monkeyEvents === "number") this.monkeyEvents = c.monkeyEvents;
            if (typeof c.monitorIntervalSec === "number")
                this.monitorIntervalSec = c.monitorIntervalSec;
            if (c.appFilter === "all" || c.appFilter === "third" || c.appFilter === "system")
                this.appFilter = c.appFilter;
        } catch {
            /* 配置损坏则用默认值 */
        }
    }

    save() {
        try {
            localStorage.setItem(
                LS_KEY,
                JSON.stringify({
                    pullPaths: this.pullPaths,
                    cleanPaths: this.cleanPaths,
                    monkeyPackages: this.monkeyPackages,
                    monkeyArgs: this.monkeyArgs,
                    monkeyThrottle: this.monkeyThrottle,
                    monkeyEvents: this.monkeyEvents,
                    monitorIntervalSec: this.monitorIntervalSec,
                    appFilter: this.appFilter,
                }),
            );
            this.append("配置已保存到浏览器", "ok");
        } catch (e) {
            this.append(`保存失败：${(e as Error).message}`, "err");
        }
    }

    resetDefaults() {
        this.pullPaths = DEFAULT_PULL_PATHS;
        this.cleanPaths = DEFAULT_CLEAN_PATHS;
        this.monkeyPackages = DEFAULT_MONKEY_PACKAGES;
        this.monkeyArgs = DEFAULT_MONKEY_ARGS;
        this.monkeyThrottle = 500;
        this.monkeyEvents = 1200000;
        this.monitorIntervalSec = 10;
        this.appFilter = "third";
        this.save();
    }

    /* ---------------- 输出 ---------------- */
    append(text: string, kind: ScriptLogEntry["kind"] = "info") {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        runInAction(() => {
            this.output = [...this.output.slice(-499), { time, text, kind }];
        });
    }

    clearOutput() {
        this.output = [];
    }

    /* ---------------- 进度反馈 ---------------- */

    /** 设置某个操作的进度（0-100） */
    setProgress(
        key: string,
        percent: number,
        text: string,
        done = false,
        ok?: boolean,
    ) {
        runInAction(() => {
            this.progress = {
                ...this.progress,
                [key]: { percent: Math.max(0, Math.min(100, percent)), text, done, ok },
            };
        });
    }

    /** 清除某个操作的进度 */
    clearProgress(key: string) {
        runInAction(() => {
            const next = { ...this.progress };
            delete next[key];
            this.progress = next;
        });
    }

    /** 读取某个操作的进度 */
    getProgress(key: string) {
        return this.progress[key];
    }

    private get adb(): Adb | undefined {
        return connection.adb;
    }

    /** 执行命令并把输出记录到日志 */
    private async exec(command: string, label?: string): Promise<string> {
        const adb = this.adb;
        if (!adb) throw new Error("未连接设备");
        if (label) this.append(`$ ${label}`);
        else this.append(`$ ${command}`);
        const out = await shell(adb, command);
        if (out.trim()) this.append(out.trim());
        return out;
    }

    /* ================= 日志清理 ================= */

    /** 清空设备日志缓冲区 */
    async clearDeviceLog() {
        try {
            await this.exec("logcat -c", "清空 logcat 缓冲");
            this.append("设备日志缓冲已清空", "ok");
        } catch (e) {
            this.append(`清空失败：${(e as Error).message}`, "err");
        }
    }

    /** 删除设备上的历史日志文件（来自 02_rm_device_log_file.bat，带进度） */
    async removeDeviceLogs() {
        const paths = this.cleanPaths
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
        if (paths.length === 0) {
            this.append("清理路径为空", "err");
            return;
        }
        const key = "cleanProgress";
        this.setProgress(key, 0, `准备清理 ${paths.length} 个路径…`);
        let done = 0;
        try {
            for (const p of paths) {
                await this.exec(`rm -rf ${q(p)}`, `删除 ${p}`);
                done++;
                this.setProgress(
                    key,
                    Math.round((done / paths.length) * 100),
                    `已清理 ${done}/${paths.length}：${p}`,
                );
            }
            this.setProgress(key, 100, `已完成（${paths.length} 个路径）`, true, true);
            this.append("设备日志目录已清理", "ok");
            setTimeout(() => this.clearProgress(key), 4000);
        } catch (e) {
            this.setProgress(
                key,
                100,
                `失败（已清理 ${done}/${paths.length}）：${(e as Error).message}`,
                true,
                false,
            );
            this.append(`清理失败：${(e as Error).message}`, "err");
            setTimeout(() => this.clearProgress(key), 6000);
        }
    }

    /* ================= 日志拉取到电脑 ================= */

    /**
     * 拉取设备日志目录到本地。
     *
     * ⚠️ 与 01_pull_log.bat 行为对齐：传入目录句柄时，
     * **先在其中新建一个「年月日_时分秒」子文件夹**，再把所有日志拉进该子文件夹，
     * 避免多轮拉取的文件混在同一层目录里。
     *
     * @param dirHandle 用户选择的本地文件夹；不传则返回打包的 zip 供下载
     */
    async pullLogs(
        dirHandle?: FileSystemDirectoryHandle,
    ): Promise<{ name: string; blob: Blob }[]> {
        const adb = this.adb;
        if (!adb) throw new Error("未连接设备");
        const paths = this.pullPaths
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
        if (paths.length === 0) throw new Error("拉取路径为空");

        runInAction(() => {
            this.pulling = true;
            this.pullProgress = "";
            this.lastPullFolder = "";
        });
        const key = "pullProgress";
        this.setProgress(key, 2, `准备拉取 ${paths.length} 个路径…`);

        let target: FileSystemDirectoryHandle | undefined = dirHandle;
        let folderLabel = "";
        try {
            // 新建时间戳子文件夹
            if (dirHandle) {
                const stamp = timestampName();
                target = await dirHandle.getDirectoryHandle(stamp, { create: true });
                folderLabel = `${dirHandle.name}/${stamp}`;
                runInAction(() => {
                    this.lastPullFolder = folderLabel;
                });
                this.append(`已新建本地文件夹：${folderLabel}`, "ok");
            }

            const results: { name: string; blob: Blob }[] = [];
            let done = 0;
            for (const p of paths) {
                try {
                    runInAction(() => {
                        this.pullProgress = `正在拉取 ${p} …`;
                    });
                    this.setProgress(
                        key,
                        Math.round((done / paths.length) * 100),
                        `正在拉取 ${p} …（${done + 1}/${paths.length}）`,
                    );
                    this.append(`拉取 ${p} …`);
                    const { blob, name } = await fs.pullPath(p, (stage) => {
                        runInAction(() => {
                            this.pullProgress = `正在拉取 ${stage}`;
                        });
                    });
                    if (blob.size === 0) {
                        this.append("  ↳ 跳过（空或不存在）");
                        done++;
                        this.setProgress(
                            key,
                            Math.round((done / paths.length) * 100),
                            `已跳过空目录（${done}/${paths.length}）`,
                        );
                        continue;
                    }
                    if (target) {
                        const handle = await target.getFileHandle(name, {
                            create: true,
                        });
                        const w = await handle.createWritable();
                        await w.write(blob);
                        await w.close();
                        this.append(
                            `  ↳ 已保存：${folderLabel || dirHandle!.name}/${name}（${(
                                blob.size /
                                1024 /
                                1024
                            ).toFixed(2)} MB）`,
                            "ok",
                        );
                    } else {
                        results.push({ name, blob });
                        this.append(
                            `  ↳ 已打包：${name}（${(blob.size / 1024 / 1024).toFixed(2)} MB）`,
                            "ok",
                        );
                    }
                    done++;
                    this.setProgress(
                        key,
                        Math.round((done / paths.length) * 100),
                        `已完成 ${done}/${paths.length}`,
                    );
                } catch (e) {
                    done++;
                    this.append(`  ↳ ${p} 拉取失败：${(e as Error).message}`, "err");
                }
            }
            this.setProgress(
                key,
                100,
                `已完成（${paths.length} 个路径，成功 ${results.length} 个打包）`,
                true,
                true,
            );
            setTimeout(() => this.clearProgress(key), 4000);
            runInAction(() => {
                this.pullProgress = "";
            });
            return results;
        } finally {
            runInAction(() => {
                this.pulling = false;
            });
        }
    }

    /* ================= Monkey ================= */

    /** 生成 monkey 命令（供预览与执行） */
    buildMonkeyCommand(): string {
        const pkgs = this.monkeyPackages
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((p) => `-p ${p}`)
            .join(" ");
        return (
            `monkey ${pkgs} ${this.monkeyArgs} --throttle ${this.monkeyThrottle} ` +
            `${this.monkeyEvents}`
        );
    }

    /**
     * Monkey 自检：确认设备已连接、monkey 命令存在、后台执行能力可用。
     * 「点击无反应」通常是因为设备未就绪或 monkey 不存在 —— 先给出明确结论。
     */
    async selfCheckMonkey(): Promise<boolean> {
        const adb = this.adb;
        if (!adb) {
            runInAction(() => {
                this.monkeyCheck = "未连接设备";
            });
            this.append("自检：未连接设备", "err");
            return false;
        }
        const lines: string[] = [];
        let ok = true;
        // ① monkey 是否存在
        try {
            const which = (await shell(adb, "which monkey || command -v monkey")).trim();
            if (which) lines.push(`✓ monkey 可用：${which}`);
            else {
                lines.push("✗ 未找到 monkey 命令");
                ok = false;
            }
        } catch (e) {
            lines.push(`✗ monkey 探测失败：${(e as Error).message}`);
            ok = false;
        }
        // ② 后台执行（sh + &）是否可用
        try {
            const out = (
                await shell(adb, "sh -c 'echo ads_selfcheck_ok &' && sleep 0.2 && echo done")
            ).trim();
            if (/ads_selfcheck_ok|done/.test(out)) lines.push("✓ 后台执行通道可用");
            else lines.push(`⚠ 后台执行返回异常：${out || "(空)"}`);
        } catch (e) {
            lines.push(`✗ 后台执行通道不可用：${(e as Error).message}`);
            ok = false;
        }
        // ③ 落盘目录可写
        try {
            await shell(adb, "mkdir -p /sdcard/yx_log");
            lines.push("✓ /sdcard/yx_log 可写");
        } catch (e) {
            lines.push(`⚠ /sdcard/yx_log 不可写：${(e as Error).message}`);
        }
        // ④ 包名是否存在于设备
        const pkgs = this.monkeyPackages
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
        if (pkgs.length) {
            try {
                const listed = await shell(adb, "pm list packages");
                const present = pkgs.filter((p) => listed.includes(`package:${p}`));
                lines.push(
                    `• 目标包 ${pkgs.length} 个，设备上找到 ${present.length} 个` +
                        (present.length < pkgs.length ? "（缺失的会被 monkey 忽略）" : ""),
                );
            } catch {
                /* ignore */
            }
        }
        runInAction(() => {
            this.monkeyCheck = lines.join("\n");
        });
        for (const l of lines) this.append(`自检 ${l}`, l.startsWith("✗") ? "err" : "info");
        return ok;
    }

    /**
     * 执行 monkey 测试。
     *
     * 两种模式：
     *  - **前台（fg）**：用 shell 协议 pty 运行 `monkey`，**实时读取 stdout**
     *    逐行追加到「Monkey 实时日志」，可保存/下载。
     *  - **后台（bg）**：`monkey > 设备文件 2>&1 &`，不阻塞界面，
     *    日志落在设备 /sdcard/yx_log/ 下，可稍后拉取。
     */
    async runMonkey() {
        const adb = this.adb;
        if (!adb) {
            this.append("Monkey 启动失败：未连接设备", "err");
            return;
        }
        if (this.monkeyRunning) return;
        const cmd = this.buildMonkeyCommand();

        runInAction(() => {
            this.monkeyRunning = true;
            this.monkeyFinished = false;
            this.monkeyLiveLog = [`$ ${cmd}`, ""];
        });

        if (this.monkeyMode === "bg") {
            await this.runMonkeyBackground(adb, cmd);
        } else {
            await this.runMonkeyForeground(adb, cmd);
        }
    }

    /** 前台执行：流式读取 monkey 输出 */
    private async runMonkeyForeground(adb: Adb, cmd: string) {
        try {
            // shell 协议 pty：命令以 { command: [cmd] } 传入，保留参数原样
            const svc = adb.subprocess.shellProtocol;
            const session =
                svc && svc.isSupported
                    ? await svc.pty({ command: [cmd] })
                    : await adb.subprocess.noneProtocol.pty(cmd);
            this.monkeyAbort = session as unknown as {
                kill: () => Promise<void> | void;
            };
            this.append("Monkey 已启动（前台，实时输出）", "ok");

            const reader = (
                session.output as unknown as ReadableStream<Uint8Array>
            ).getReader();
            const decoder = new TextDecoder();
            let buf = "";
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                let idx: number;
                const fresh: string[] = [];
                while ((idx = buf.indexOf("\n")) >= 0) {
                    fresh.push(buf.slice(0, idx));
                    buf = buf.slice(idx + 1);
                }
                if (fresh.length) {
                    runInAction(() => {
                        // 环形保留最近 4000 行，避免卡顿
                        const next = this.monkeyLiveLog.concat(fresh);
                        this.monkeyLiveLog =
                            next.length > 4000 ? next.slice(next.length - 4000) : next;
                    });
                }
            }
            // 收尾：刷出残留
            if (buf) {
                runInAction(() => {
                    this.monkeyLiveLog = [...this.monkeyLiveLog, buf];
                });
            }
            let code = 0;
            try {
                code = Number(await session.exited) || 0;
            } catch {
                code = this.monkeyStoppedByUser ? 130 : 0;
            }
            this.append(
                `Monkey 已结束（退出码 ${code}）`,
                code === 0 ? "ok" : "info",
            );
        } catch (e) {
            this.append(`Monkey 执行异常：${(e as Error).message}`, "err");
        } finally {
            this.monkeyAbort = undefined;
            runInAction(() => {
                this.monkeyRunning = false;
                this.monkeyFinished = true;
            });
        }
    }

    /** 后台执行：写设备文件，不阻塞 */
    private async runMonkeyBackground(adb: Adb, cmd: string) {
        try {
            const dir = "/sdcard/yx_log";
            await shell(adb, `mkdir -p ${dir}`).catch(() => "");
            const logName = `monkey_${timestampName().replace(/[-:]/g, "")}.log`;
            const full = `${dir}/${logName}`;
            const wrapped = `${cmd} > ${full} 2>&1 &`;
            this.monkeyLogFile = full;
            void adb.subprocess.noneProtocol.pty(`sh -c ${q(wrapped)}`).catch(() => {
                /* 后台任务，忽略流结束 */
            });
            this.append(`Monkey 已在设备后台启动，日志：${full}`, "ok");
            // 2 秒后确认进程确实起来了
            setTimeout(() => void this.verifyMonkeyRunning(), 2500);
            runInAction(() => {
                this.monkeyRunning = false;
                this.monkeyFinished = true;
            });
        } catch (e) {
            this.append(`Monkey 启动失败：${(e as Error).message}`, "err");
            runInAction(() => {
                this.monkeyRunning = false;
                this.monkeyFinished = true;
            });
        }
    }

    /** 确认 monkey 进程是否已在设备上运行 */
    private async verifyMonkeyRunning() {
        const adb = this.adb;
        if (!adb) return;
        try {
            const out = await shell(adb, "ps -A -o NAME | grep -c monkey");
            const n = Number(out.trim().split("\n").pop()) || 0;
            if (n > 0) this.append("✓ 已确认 monkey 进程在设备上运行", "ok");
            else
                this.append(
                    "⚠ 未检测到 monkey 进程，请检查包名是否存在于设备上（可先点「自检」）",
                    "err",
                );
        } catch {
            /* 老设备可能不支持 ps -A，忽略 */
        }
    }

    /** 停止 Monkey：前台会 kill 掉设备端进程 */
    async stopMonkey() {
        this.monkeyStoppedByUser = true;
        if (this.monkeyAbort) {
            try {
                await this.monkeyAbort.kill();
            } catch {
                /* ignore */
            }
            this.monkeyAbort = undefined;
        }
        runInAction(() => {
            this.monkeyRunning = false;
            this.monkeyFinished = true;
        });
        this.append("已停止 Monkey（若为前台模式，设备端进程已终止）");
    }

    /** 强杀设备上的 monkey 进程 */
    async killMonkey() {
        try {
            await this.exec("pkill -f monkey || killall monkey", "结束 monkey 进程");
            runInAction(() => {
                this.monkeyRunning = false;
                this.monkeyFinished = true;
            });
            this.append("已尝试结束设备上的 monkey 进程", "ok");
        } catch (e) {
            this.append(`结束失败：${(e as Error).message}`, "err");
        }
    }

    /** 保存 Monkey 实时日志到本地文件夹 */
    async saveMonkeyLog(dirHandle?: FileSystemDirectoryHandle): Promise<boolean> {
        if (this.monkeyLiveLog.length === 0) {
            this.append("暂无 Monkey 日志可保存，请先运行", "err");
            return false;
        }
        const text = this.monkeyLiveLog.join("\n");
        const blob = new Blob([text + "\n"], { type: "text/plain;charset=utf-8" });
        const name = `monkey_${timestampName().replace(/[-:]/g, "")}.log`;
        try {
            if (dirHandle) {
                const handle = await dirHandle.getFileHandle(name, { create: true });
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                this.append(`Monkey 日志已保存到 ${dirHandle.name}/${name}`, "ok");
            } else {
                saveBlob(blob, name);
                this.append(`Monkey 日志已下载：${name}`, "ok");
            }
            return true;
        } catch (e) {
            this.append(`保存失败：${(e as Error).message}`, "err");
            return false;
        }
    }

    /** 清空 Monkey 实时日志 */
    clearMonkeyLog() {
        this.monkeyLiveLog = [];
        this.monkeyFinished = false;
    }

    /* ================= 蓝牙 HCI ================= */

    /** 开启 HCI 日志（来自蓝牙开启hci.bat） */
    async enableHci() {
        try {
            await this.exec(
                "setprop persist.bluetooth.btsnoopenable true",
                "开启蓝牙 HCI 日志开关",
            );
            this.append("HCI 日志开关已开启（需重启蓝牙或设备生效）", "ok");
        } catch (e) {
            this.append(`开启失败：${(e as Error).message}`, "err");
        }
    }

    /** 导出 HCI 日志到本地（带进度） */
    async exportHci(dirHandle?: FileSystemDirectoryHandle) {
        const key = "hciExport";
        try {
            this.setProgress(key, 5, "正在读取 HCI 日志…");
            runInAction(() => {
                this.hciExportProgress = "正在读取 HCI 日志 …";
            });
            const { blob, name } = await fs.pullPath(HCI_LOG_DIR, (stage) => {
                runInAction(() => {
                    this.hciExportProgress = `正在拉取 ${stage}`;
                });
                this.setProgress(key, 45, `正在拉取 ${stage}`);
            });
            if (blob.size === 0) {
                this.setProgress(key, 100, "日志为空或不存在", true, false);
                this.append("HCI 日志为空或不存在", "err");
                setTimeout(() => this.clearProgress(key), 5000);
                return;
            }
            this.setProgress(key, 80, "正在写入文件…");
            if (dirHandle) {
                const handle = await dirHandle.getFileHandle(name, { create: true });
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                this.setProgress(key, 100, `已保存 ${dirHandle.name}/${name}`, true, true);
                this.append(`HCI 日志已保存到 ${dirHandle.name}/${name}`, "ok");
            } else {
                saveBlob(blob, name);
                this.setProgress(key, 100, `已下载 ${name}`, true, true);
                this.append(`HCI 日志已下载：${name}`, "ok");
            }
            setTimeout(() => this.clearProgress(key), 4000);
        } catch (e) {
            this.setProgress(key, 100, `失败：${(e as Error).message}`, true, false);
            this.append(`导出失败：${(e as Error).message}`, "err");
            setTimeout(() => this.clearProgress(key), 6000);
        } finally {
            runInAction(() => {
                this.hciExportProgress = "";
            });
        }
    }

    /** 删除 HCI 日志（带反馈） */
    async removeHci() {
        const key = "hciRemove";
        try {
            this.setProgress(key, 30, "正在删除…");
            await this.exec(`rm -rf ${q(HCI_LOG_DIR + "/")}`, "删除 HCI 日志");
            this.setProgress(key, 100, "已删除", true, true);
            this.append("HCI 日志已删除", "ok");
            setTimeout(() => this.clearProgress(key), 4000);
        } catch (e) {
            this.setProgress(key, 100, `失败：${(e as Error).message}`, true, false);
            this.append(`删除失败：${(e as Error).message}`, "err");
            setTimeout(() => this.clearProgress(key), 6000);
        }
    }

    /* ================= CPU / 内存监控 ================= */

    /** 当前采样点数量（用于 UI） */
    get monitorSampleCount(): number {
        return this.cpuHistory.length;
    }

    /** 已采集时长（秒） */
    get monitorDurationSec(): number {
        if (!this.monitorStartedAt) return 0;
        return Math.floor((Date.now() - this.monitorStartedAt) / 1000);
    }

    /**
     * 采样一次 CPU 与内存占用。
     *
     * ⚠️ 关键：必须取**设备真实系统数据**：
     *  - CPU：`/proc/stat` 两次采样求差（比 dumpsys cpuinfo 更准且通用），
     *         同时保留 `dumpsys cpuinfo` 的 TOTAL 作为参考。
     *  - 内存：`/proc/meminfo` 的 MemTotal / MemAvailable，
     *         占用 = (Total - Available) / Total。
     */
    async sampleOnce() {
        const adb = this.adb;
        if (!adb) throw new Error("未连接设备");
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const stamp = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
            now.getSeconds(),
        )}`;

        // ---- CPU：用 /proc/stat 两次差值计算（真实系统占用） ----
        let cpuVal: number | null = null;
        try {
            const readStat = async () => {
                const s = await shell(adb, "cat /proc/stat | head -1");
                const nums = s
                    .trim()
                    .replace(/^cpu\s+/, "")
                    .split(/\s+/)
                    .map(Number);
                const total = nums.reduce((a, b) => a + (isNaN(b) ? 0 : b), 0);
                const idle = (nums[3] || 0) + (nums[4] || 0);
                return { total, idle };
            };
            const a = await readStat();
            await new Promise((r) => setTimeout(r, 300));
            const b = await readStat();
            const dt = b.total - a.total;
            const di = b.idle - a.idle;
            if (dt > 0) cpuVal = Number((((dt - di) / dt) * 100).toFixed(1));
        } catch {
            /* 退化到 dumpsys */
        }
        if (cpuVal === null) {
            try {
                const cpu = await shell(adb, "dumpsys cpuinfo");
                const total = cpu.match(/([\d.]+)%\s+TOTAL/i);
                if (total) cpuVal = Number(total[1]);
                runInAction(() => {
                    this.cpuSample = cpu.split("\n").slice(0, 6).join("\n");
                });
            } catch (e) {
                this.append(`CPU 采样失败：${(e as Error).message}`, "err");
            }
        } else {
            runInAction(() => {
                this.cpuSample = `CPU 总占用：${cpuVal}%（/proc/stat 实时计算）`;
            });
        }

        // ---- 内存：/proc/meminfo（真实系统占用） ----
        let memVal: number | null = null;
        let memText = "";
        try {
            const mem = await shell(adb, "cat /proc/meminfo");
            const pick = (key: string) => {
                const m = mem.match(new RegExp(`^${key}:\\s*(\\d+)`, "m"));
                return m ? Number(m[1]) : 0;
            };
            const total = pick("MemTotal");
            const avail = pick("MemAvailable") || pick("MemFree");
            const free = pick("MemFree");
            const buffCache = pick("Buffers") + pick("Cached");
            if (total > 0) {
                const used = total - avail;
                memVal = Number(((used / total) * 100).toFixed(1));
                const mb = (kb: number) => (kb / 1024).toFixed(0);
                memText =
                    `MemTotal: ${mb(total)} MB\n` +
                    `MemAvailable: ${mb(avail)} MB\n` +
                    `MemFree: ${mb(free)} MB\n` +
                    `Buffers+Cached: ${mb(buffCache)} MB\n` +
                    `已用: ${mb(used)} MB（${memVal}%）`;
            }
        } catch (e) {
            this.append(`内存采样失败：${(e as Error).message}`, "err");
        }
        // 退化：dumpsys meminfo（注意真机数字带千位逗号，如 "7,285,016K"，需先去掉逗号）
        if (memVal === null) {
            try {
                const mem = await shell(adb, "dumpsys meminfo");
                const num = (re: RegExp) => {
                    const m = mem.match(re);
                    if (!m) return 0;
                    return Number(m[1]!.replace(/,/g, "")) || 0;
                };
                const totalKb = num(/Total RAM:\s*([\d,]+)/i);
                // Used RAM 比 Free RAM 更直接：已用/总量
                const usedKb = num(/Used RAM:\s*([\d,]+)/i);
                const freeKb = num(/Free RAM:\s*([\d,]+)/i);
                const denom = totalKb;
                const numerator = usedKb || totalKb - freeKb;
                if (denom > 0 && numerator > 0) {
                    memVal = Number(((numerator / denom) * 100).toFixed(1));
                    memText = mem.split("\n").slice(0, 7).join("\n");
                }
            } catch {
                /* ignore */
            }
        }

        runInAction(() => {
            this.lastSampleAt = stamp;
            this.memSample = memText;
            const MAXP = 3600; // 最多保留 1 小时（10s 一点）
            if (cpuVal !== null) {
                this.cpuHistory = [...this.cpuHistory, cpuVal].slice(-MAXP);
            }
            if (memVal !== null) {
                this.memHistory = [...this.memHistory, memVal].slice(-MAXP);
            }
            this.sampleTimes = [...this.sampleTimes, stamp].slice(-MAXP);
            this.monitorLog = [
                ...this.monitorLog.slice(-4999),
                `${stamp},${cpuVal ?? ""},${memVal ?? ""}`,
            ];
        });
    }

    async startMonitor() {
        if (this.monitoring) return;
        runInAction(() => {
            this.monitoring = true;
            this.cpuHistory = [];
            this.memHistory = [];
            this.sampleTimes = [];
            this.monitorLog = [];
            this.leakResult = undefined;
            this.monitorStartedAt = Date.now();
        });
        this.append(`开始监控（间隔 ${this.monitorIntervalSec}s，采集设备真实数据）`, "ok");
        await this.sampleOnce().catch(() => "");
        this.monitorTimer = setInterval(
            () => void this.sampleOnce(),
            Math.max(2, this.monitorIntervalSec) * 1000,
        );
    }

    stopMonitor() {
        if (this.monitorTimer) {
            clearInterval(this.monitorTimer);
            this.monitorTimer = undefined;
        }
        runInAction(() => {
            this.monitoring = false;
        });
        this.append(`已停止监控，共采集 ${this.cpuHistory.length} 个点`);
    }

    /**
     * 内存泄露检测：对整个采集时段的内存序列做**线性回归**，
     * 用斜率（每分钟增长 %）+ R² 判定是否存在持续增长（泄露特征）。
     */
    detectLeak() {
        const ys = this.memHistory;
        const n = ys.length;
        if (n < 5) {
            runInAction(() => {
                this.leakResult = undefined;
            });
            this.append("采样点不足，至少需要 5 个点才能检测内存泄露", "err");
            return;
        }
        const xs = ys.map((_, i) => i);
        const meanX = xs.reduce((a, b) => a + b, 0) / n;
        const meanY = ys.reduce((a, b) => a + b, 0) / n;
        let num = 0;
        let den = 0;
        for (let i = 0; i < n; i++) {
            num += (xs[i]! - meanX) * (ys[i]! - meanY);
            den += (xs[i]! - meanX) ** 2;
        }
        const slope = den === 0 ? 0 : num / den; // 每采样点增长 %
        let ssRes = 0;
        let ssTot = 0;
        for (let i = 0; i < n; i++) {
            const pred = meanY + slope * (xs[i]! - meanX);
            ssRes += (ys[i]! - pred) ** 2;
            ssTot += (ys[i]! - meanY) ** 2;
        }
        const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
        const stepSec = Math.max(2, this.monitorIntervalSec);
        const growthPerMin = slope * (60 / stepSec); // %/分钟
        const growth = ys[n - 1]! - ys[0]!;

        // 判定：持续上升 + 拟合良好 → 疑似泄露
        let level: "none" | "slight" | "likely" = "none";
        if (slope > 0 && r2 > 0.6) {
            if (growthPerMin >= 0.8) level = "likely";
            else if (growthPerMin >= 0.2) level = "slight";
        } else if (growthPerMin >= 1.5) {
            level = "likely";
        }

        const detail = [
            `采样点：${n} 个（约 ${(n * stepSec) / 60} 分钟）`,
            `起始内存占用：${ys[0]!.toFixed(1)}%`,
            `结束内存占用：${ys[n - 1]!.toFixed(1)}%`,
            `总增长：${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`,
            `增长速率：${growthPerMin >= 0 ? "+" : ""}${growthPerMin.toFixed(2)}%/分钟`,
            `线性拟合 R²：${r2.toFixed(3)}（越接近 1 表示越接近持续线性增长）`,
        ].join("\n");

        runInAction(() => {
            this.leakResult = {
                level,
                startMem: ys[0]!,
                endMem: ys[n - 1]!,
                growth,
                growthPerMin,
                r2,
                detail,
            };
        });
        const label =
            level === "likely"
                ? "疑似内存泄露"
                : level === "slight"
                  ? "轻微内存增长"
                  : "未发现明显内存泄露";
        this.append(
            `内存泄露检测完成：${label}（增长 ${growth >= 0 ? "+" : ""}${growth.toFixed(
                1,
            )}%，${growthPerMin.toFixed(2)}%/分钟，R²=${r2.toFixed(2)}）`,
            level === "likely" ? "err" : level === "slight" ? "info" : "ok",
        );
    }

    /** 导出监控记录到本地文件夹（CSV，带进度反馈） */
    async exportMonitor(dirHandle?: FileSystemDirectoryHandle): Promise<boolean> {
        if (this.monitorLog.length === 0) {
            this.append("暂无监控数据可导出，请先开始监控", "err");
            return false;
        }
        const key = "monitorExport";
        this.setProgress(key, 5, "准备数据…");
        try {
            const header = "时间,CPU占用%,内存占用%";
            const text = [header, ...this.monitorLog].join("\n");
            const blob = new Blob(["\ufeff" + text], {
                type: "text/csv;charset=utf-8",
            });
            const name = `monitor_${timestampName().replace(/[-:]/g, "")}.csv`;
            this.setProgress(key, 40, "写入文件…");
            if (dirHandle) {
                const handle = await dirHandle.getFileHandle(name, { create: true });
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                this.setProgress(key, 100, `已保存 ${dirHandle.name}/${name}`, true, true);
                this.append(`监控记录已保存到 ${dirHandle.name}/${name}`, "ok");
            } else {
                saveBlob(blob, name);
                this.setProgress(key, 100, `已下载 ${name}`, true, true);
                this.append(`监控记录已下载：${name}`, "ok");
            }
            setTimeout(() => this.clearProgress(key), 4000);
            return true;
        } catch (e) {
            this.setProgress(key, 100, `失败：${(e as Error).message}`, true, false);
            this.append(`导出失败：${(e as Error).message}`, "err");
            setTimeout(() => this.clearProgress(key), 5000);
            return false;
        }
    }

    /* ================= 应用管理 ================= */

    /** 列出设备上的应用包名（按当前过滤模式） */
    async loadApps(filter: AppFilter = this.appFilter) {
        const adb = this.adb;
        if (!adb) return;
        runInAction(() => {
            this.loadingApps = true;
            this.appFilter = filter;
        });
        try {
            const flag = filter === "all" ? "" : "-3";
            const out = await shell(adb, `pm list packages ${flag}`.trim());
            let pkgs = out
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l.startsWith("package:"))
                .map((l) => l.slice("package:".length).trim())
                .filter(Boolean);

            // 系统列表：单独取，用于标记与「仅系统」过滤
            let systemSet = new Set<string>();
            try {
                const sysOut = await shell(adb, "pm list packages -s");
                systemSet = new Set(
                    sysOut
                        .split("\n")
                        .map((l) => l.trim())
                        .filter((l) => l.startsWith("package:"))
                        .map((l) => l.slice(8).trim()),
                );
            } catch {
                /* ignore */
            }

            if (filter === "system") {
                pkgs = [...systemSet];
            }
            pkgs = pkgs.sort();

            // 读取 PID
            const pidMap = new Map<string, number>();
            try {
                const ps = await shell(adb, "ps -A -o PID,NAME");
                for (const line of ps.split("\n")) {
                    const m = line.trim().match(/^(\d+)\s+(.+)$/);
                    if (m && !pidMap.has(m[2]!.trim())) {
                        pidMap.set(m[2]!.trim(), Number(m[1]));
                    }
                }
            } catch {
                /* 老设备无 ps -A */
            }

            runInAction(() => {
                this.apps = pkgs.map((p) => ({
                    package: p,
                    pid: pidMap.get(p) ?? 0,
                    system: systemSet.has(p),
                }));
                this.loadingApps = false;
            });
            const label =
                filter === "all" ? "全部应用" : filter === "system" ? "系统应用" : "仅第三方";
            this.append(`已列出 ${pkgs.length} 个应用（${label}）`, "ok");
        } catch (e) {
            runInAction(() => {
                this.loadingApps = false;
            });
            this.append(`列出应用失败：${(e as Error).message}`, "err");
        }
    }

    /** 启动应用 */
    async launchApp(pkg: string) {
        if (!pkg) return;
        try {
            if (this.launchForceStop) {
                await this.exec(`am force-stop ${pkg}`, `强制停止 ${pkg}`);
            }
            const out = await this.exec(
                `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`,
                `启动 ${pkg}`,
            );
            if (/\bEvents injected: 1\b/i.test(out) || !/No activities found/i.test(out)) {
                this.append(`已启动 ${pkg}`, "ok");
            } else {
                this.append(`未找到 ${pkg} 的启动入口`, "err");
            }
        } catch (e) {
            this.append(`启动失败：${(e as Error).message}`, "err");
        }
    }

    /**
     * 打开（启动）应用 —— 与「启动应用」的区别：本方法优先用
     * `am start` 直接拉起 Launcher Activity（更接近"打开应用"），
     * 失败时退回 `monkey -c LAUNCHER 1`（无需知道 Activity 名）。
     */
    async openApp(pkg: string) {
        if (!pkg) return;
        const adb = this.adb;
        if (!adb) {
            this.append("打开失败：未连接设备", "err");
            return;
        }
        try {
            this.append(`$ 打开应用 ${pkg}`);
            // ① 解析 Launcher Activity
            let activity = "";
            try {
                const resolved = await shell(
                    adb,
                    `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${pkg}`,
                );
                const lines = resolved
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean);
                const last = lines[lines.length - 1] || "";
                if (last.includes("/")) activity = last;
            } catch {
                /* 老设备可能无 cmd package resolve-activity */
            }
            let out = "";
            if (activity) {
                out = await this.exec(
                    `am start -n ${activity}`,
                    `am start -n ${activity}`,
                );
            } else {
                out = await this.exec(
                    `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`,
                    `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`,
                );
            }
            if (
                /\bEvents injected: 1\b/i.test(out) ||
                /Starting:\s*Intent/i.test(out) ||
                !/No activities found|Error/i.test(out)
            ) {
                this.append(`已打开应用 ${pkg}`, "ok");
            } else {
                this.append(`打开 ${pkg} 失败：未找到启动入口`, "err");
            }
        } catch (e) {
            this.append(`打开失败：${(e as Error).message}`, "err");
        }
    }

    /** 强制停止应用 */
    async forceStopApp(pkg: string) {
        if (!pkg) return;
        try {
            await this.exec(`am force-stop ${pkg}`, `强制停止 ${pkg}`);
            this.append(`已强制停止 ${pkg}`, "ok");
        } catch (e) {
            this.append(`强制停止失败：${(e as Error).message}`, "err");
        }
    }

    /** 把当前应用包名列表导出为 txt（带进度反馈） */
    async exportAppList(dirHandle?: FileSystemDirectoryHandle): Promise<boolean> {
        if (this.apps.length === 0) {
            this.append("应用列表为空，请先「列出应用」", "err");
            return false;
        }
        const key = "appListExport";
        this.setProgress(key, 30, "正在生成清单…");
        const text = this.apps.map((a) => a.package).join("\n");
        const blob = new Blob([text + "\n"], { type: "text/plain;charset=utf-8" });
        const name = `packages_${timestampName().replace(/[-:]/g, "")}.txt`;
        try {
            if (dirHandle) {
                const handle = await dirHandle.getFileHandle(name, { create: true });
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                this.setProgress(key, 100, `已保存 ${dirHandle.name}/${name}`, true, true);
                this.append(`包名清单已保存到 ${dirHandle.name}/${name}`, "ok");
            } else {
                saveBlob(blob, name);
                this.setProgress(key, 100, `已下载 ${name}`, true, true);
                this.append(`包名清单已下载：${name}`, "ok");
            }
            setTimeout(() => this.clearProgress(key), 4000);
            return true;
        } catch (e) {
            this.setProgress(key, 100, `失败：${(e as Error).message}`, true, false);
            this.append(`导出失败：${(e as Error).message}`, "err");
            setTimeout(() => this.clearProgress(key), 6000);
            return false;
        }
    }
}

export const testScript = new TestScriptStore();

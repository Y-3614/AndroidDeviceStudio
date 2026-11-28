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

/** 把 canvas 的 dataURL 转成 Blob（用于导出曲线图 PNG） */
function dataUrlToBlob(dataUrl: string): Blob {
    const [head, body] = dataUrl.split(",");
    const mime = /:(.*?);/.exec(head ?? "")?.[1] ?? "image/png";
    const bin = atob(body ?? "");
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
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

/** 单个进程的占用（用于「谁拉高了整体占用」的明细） */
export interface TopProc {
    /** 进程名（多为包名） */
    name: string;
    /** 数值：CPU 为 %；内存为占用 MB */
    value: number;
    /** pid */
    pid?: number;
    /** 内存模式下的百分比 */
    percent?: number;
}

/** 一次完整的采样记录（含总量 + Top 明细），用于导出与报告 */
export interface MonitorSample {
    /** 采样时刻 HH:MM:SS */
    time: string;
    /** 整体 CPU 占用 % */
    cpu: number | null;
    /** 整体内存占用 % */
    mem: number | null;
    /** 内存已用 MB / 总量 MB */
    memUsedMb: number;
    memTotalMb: number;
    /** 该时刻 CPU 占用 Top 进程 */
    topCpu: TopProc[];
    /** 该时刻内存占用 Top 进程 */
    topMem: TopProc[];
}

/** 内存泄露「Bug 单」 */
export interface LeakBug {
    /** 标题 */
    title: string;
    /** 严重程度 */
    severity: "严重" | "一般" | "轻微";
    /** 判定结论级别 */
    level: "likely" | "slight" | "none";
    /** 问题现象描述 */
    phenomenon: string;
    /** 复现步骤 */
    steps: string[];
    /** 数据证据 */
    evidence: string[];
    /** 判定依据 */
    basis: string;
    /** 影响范围 */
    impact: string;
    /** 建议排查方向 */
    suggestion: string;
    /** 增长速率 %/分钟 */
    growthPerMin: number;
    /** 总增长 % */
    growth: number;
    /** 拟合度 R² */
    r2: number;
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
    /** 是否将实时日志直写到本地文件夹（不占浏览器内存） */
    monkeySinkDir: FileSystemDirectoryHandle | undefined = undefined;
    /** 直写落盘的文件名 */
    monkeySinkName = "";
    /** 已落盘行数 */
    monkeySinkLines = 0;
    /** 落盘写入串行闸门 */
    private monkeySinkQueue: Promise<void> = Promise.resolve();
    /** 落盘用文件可写流 */
    private monkeySinkWriter: FileSystemWritableFileStream | undefined = undefined;

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
    /** 完整采样记录（含 Top 明细），用于导出与报告 */
    samples: MonitorSample[] = [];
    /** 最近一次采样的 Top 明细（UI 展示） */
    lastTopCpu: TopProc[] = [];
    lastTopMem: TopProc[] = [];
    /** 内存已用 / 总量（MB） */
    memUsedMb = 0;
    memTotalMb = 0;
    /** 上次采样时间 */
    lastSampleAt = "";
    /** 采集开始时间（用于计算时长） */
    monitorStartedAt = 0;
    /** 采样调度锚点（改间隔时重置，使新间隔立即生效） */
    monitorAnchorAt = 0;
    /** 计时器（每秒刷新已采集时长） */
    monitorTick = 0;
    monitorTickTimer: ReturnType<typeof setInterval> | undefined = undefined;
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
    /** 内存泄露 Bug 单列表 */
    leakBugs: LeakBug[] = [];
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

    /** 监控采样定时器句柄（setTimeout，按绝对时间锚定调度） */
    monitorTimer: ReturnType<typeof setTimeout> | undefined;

    constructor() {
        makeAutoObservable(
            this,
            {
                // 会话句柄与定时器不参与响应式
                monkeyAbort: false,
                monitorTimer: false,
                monitorTickTimer: false,
                monkeySinkDir: false,
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

    /** 前台执行：流式读取 monkey 输出（支持直写本地文件夹 + 限流渲染） */
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
            this.append(
                this.monkeySinkDir
                    ? `Monkey 已启动（前台，日志实时写入本地文件夹 ${this.monkeySinkName}）`
                    : "Monkey 已启动（前台，实时输出）",
                "ok",
            );

            const reader = (
                session.output as unknown as ReadableStream<Uint8Array>
            ).getReader();
            const decoder = new TextDecoder();
            let buf = "";
            // 待渲染缓冲：限流追加到界面，避免高频 setState 造成卡顿
            let pending: string[] = [];
            let lastFlush = 0;
            const FLUSH_MS = 400; // 每 400ms 刷新一次界面
            const flush = (force = false) => {
                const now = Date.now();
                if (!force && now - lastFlush < FLUSH_MS) return;
                if (pending.length === 0) return;
                lastFlush = now;
                const batch = pending;
                pending = [];
                runInAction(() => {
                    // 界面只保留最近 1500 行（完整日志在落盘文件里）
                    const MAXUI = 1500;
                    const next = this.monkeyLiveLog.concat(batch);
                    this.monkeyLiveLog =
                        next.length > MAXUI ? next.slice(next.length - MAXUI) : next;
                });
            };

            const feed = (lines: string[]) => {
                if (lines.length === 0) return;
                // 有本地落盘目录时，直接写盘（不占浏览器内存）
                if (this.monkeySinkDir) {
                    this.sinkWrite(lines.join("\n") + "\n");
                }
                pending.push(...lines);
                flush();
            };

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
                feed(fresh);
            }
            if (buf) feed([buf]);
            flush(true);

            let code = 0;
            try {
                code = Number(await session.exited) || 0;
            } catch {
                code = this.monkeyStoppedByUser ? 130 : 0;
            }
            this.append(
                `Monkey 已结束（退出码 ${code}）` +
                    (this.monkeySinkDir
                        ? `，完整日志已写入 ${this.monkeySinkDir.name}/${this.monkeySinkName}（${this.monkeySinkLines} 行）`
                        : ""),
                code === 0 ? "ok" : "info",
            );
        } catch (e) {
            this.append(`Monkey 执行异常：${(e as Error).message}`, "err");
        } finally {
            await this.closeMonkeySink();
            this.monkeyAbort = undefined;
            runInAction(() => {
                this.monkeyRunning = false;
                this.monkeyFinished = true;
            });
        }
    }

    /** 选择/取消「直写本地文件夹」 */
    async pickMonkeySink(dirHandle?: FileSystemDirectoryHandle) {
        if (!dirHandle) {
            runInAction(() => {
                this.monkeySinkDir = undefined;
                this.monkeySinkName = "";
                this.monkeySinkLines = 0;
            });
            this.append("已关闭「直写本地文件夹」，改为在页面显示日志");
            return;
        }
        try {
            const name = `monkey_${timestampName().replace(/[-:]/g, "")}.log`;
            const handle = await dirHandle.getFileHandle(name, { create: true });
            const writer = await handle.createWritable();
            runInAction(() => {
                this.monkeySinkDir = dirHandle;
                this.monkeySinkName = name;
                this.monkeySinkLines = 0;
            });
            this.monkeySinkWriter = writer;
            this.append(
                `已启用直写：Monkey 日志将实时写入 ${dirHandle.name}/${name}（不占浏览器内存）`,
                "ok",
            );
        } catch (e) {
            this.append(`启用直写失败：${(e as Error).message}`, "err");
        }
    }

    /** 串行写盘，避免并发写导致文件损坏 */
    private sinkWrite(text: string) {
        const w = this.monkeySinkWriter;
        if (!w) return;
        const lines = text.split("\n").filter((l) => l.length > 0).length;
        this.monkeySinkQueue = this.monkeySinkQueue
            .then(() => w.write(text))
            .then(() => {
                runInAction(() => {
                    this.monkeySinkLines += lines;
                });
            })
            .catch(() => {
                /* 忽略单次写失败 */
            });
    }

    /** 关闭直写流（提交文件） */
    private async closeMonkeySink() {
        const w = this.monkeySinkWriter;
        this.monkeySinkWriter = undefined;
        if (!w) return;
        try {
            await this.monkeySinkQueue;
            await w.close();
        } catch {
            /* ignore */
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
            runInAction(() => {
                this.monkeyLogFile = full;
            });
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

    /** 读取设备端 Monkey 后台日志的大小与行数，用于界面展示 */
    async refreshMonkeyDeviceLogInfo(): Promise<string> {
        const adb = this.adb;
        if (!adb || !this.monkeyLogFile) return "";
        try {
            const out = await shell(
                adb,
                `if [ -f ${q(this.monkeyLogFile)} ]; then wc -l < ${q(
                    this.monkeyLogFile,
                )}; else echo "__NOFILE__"; fi`,
            );
            const t = out.trim();
            if (t.includes("__NOFILE__")) return "（设备上暂无该文件）";
            return `已写入 ${t} 行`;
        } catch {
            return "";
        }
    }

    /** 从设备导出 Monkey 后台日志到本地文件夹 / 下载（带进度） */
    async exportMonkeyDeviceLog(dirHandle?: FileSystemDirectoryHandle) {
        const adb = this.adb;
        if (!adb) {
            this.append("导出失败：未连接设备", "err");
            return;
        }
        if (!this.monkeyLogFile) {
            this.append("暂无后台日志路径（请先用「后台」方式运行 Monkey）", "err");
            return;
        }
        const key = "monkeyDeviceLog";
        try {
            this.setProgress(key, 5, "正在检查设备端日志…");
            const exists = await shell(
                adb,
                `if [ -f ${q(this.monkeyLogFile)} ]; then echo yes; else echo no; fi`,
            );
            if (!exists.includes("yes")) {
                this.setProgress(
                    key,
                    100,
                    "设备上暂无该日志文件（后台任务可能尚未产生输出）",
                    true,
                    false,
                );
                this.append("设备上暂无该日志文件", "err");
                setTimeout(() => this.clearProgress(key), 5000);
                return;
            }
            this.setProgress(key, 40, "正在从设备拉取…");
            const { blob, name } = await fs.pullPath(this.monkeyLogFile, (stage) => {
                this.setProgress(key, 60, `正在拉取 ${stage}`);
            });
            if (blob.size === 0) {
                this.setProgress(key, 100, "日志为空", true, false);
                setTimeout(() => this.clearProgress(key), 5000);
                return;
            }
            this.setProgress(key, 85, "正在写入文件…");
            const outName = name || `monkey_${timestampName().replace(/[-:]/g, "")}.log`;
            if (dirHandle) {
                const handle = await dirHandle.getFileHandle(outName, { create: true });
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                this.setProgress(
                    key,
                    100,
                    `已保存 ${dirHandle.name}/${outName}`,
                    true,
                    true,
                );
                this.append(`设备端 Monkey 日志已导出到 ${dirHandle.name}/${outName}`, "ok");
            } else {
                saveBlob(blob, outName);
                this.setProgress(key, 100, `已下载 ${outName}`, true, true);
                this.append(`设备端 Monkey 日志已下载：${outName}`, "ok");
            }
            setTimeout(() => this.clearProgress(key), 4000);
        } catch (e) {
            this.setProgress(key, 100, `失败：${(e as Error).message}`, true, false);
            this.append(`导出失败：${(e as Error).message}`, "err");
            setTimeout(() => this.clearProgress(key), 6000);
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

    /** 已采集时长（秒）；读取 monitorTick 以建立响应式依赖，计时实时刷新 */
    get monitorDurationSec(): number {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        this.monitorTick; // 触发依赖
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

        // ---- CPU Top 进程：dumpsys cpuinfo（哪些进程拉高了占用） ----
        let cpuTop: TopProc[] = [];
        try {
            const cpu = await shell(adb, "dumpsys cpuinfo");
            const parsed: TopProc[] = [];
            for (const line of cpu.split("\n")) {
                // 形如: "  86% 2684/logd: 86% user + 0.3% kernel ..."
                const m = line.match(/^\s*([\d.]+)%\s+(\d+)\/(\S+?):/);
                if (m) parsed.push({ value: Number(m[1]), pid: Number(m[2]), name: m[3]! });
            }
            parsed.sort((a, b) => b.value - a.value);
            cpuTop = parsed.slice(0, 15);
            if (cpuVal === null) {
                const total = cpu.match(/([\d.]+)%\s+TOTAL/i);
                if (total) cpuVal = Number(total[1]);
            }
            runInAction(() => {
                this.cpuSample =
                    `CPU 总占用：${cpuVal ?? "?"}%` +
                    (cpuTop.length
                        ? `\n占用最高的进程：\n${cpuTop
                              .slice(0, 6)
                              .map((p) => `  ${p.value}%  ${p.name}`)
                              .join("\n")}`
                        : "");
            });
        } catch (e) {
            this.append(`CPU 采样失败：${(e as Error).message}`, "err");
        }

        // ---- 内存：/proc/meminfo（真实系统占用） ----
        let memVal: number | null = null;
        let memText = "";
        let memUsedMb = 0;
        let memTotalMb = 0;
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
                memUsedMb = Number((used / 1024).toFixed(0));
                memTotalMb = Number((total / 1024).toFixed(0));
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

        // ---- 内存 Top 进程：dumpsys meminfo（Total PSS by process） ----
        let memTop: TopProc[] = [];
        try {
            const mem = await shell(adb, "dumpsys meminfo");
            const lines = mem.split("\n");
            let start = -1;
            for (let i = 0; i < lines.length; i++) {
                if (/Total PSS by process:/.test(lines[i]!)) {
                    start = i;
                    break;
                }
            }
            if (start >= 0) {
                const parsed: TopProc[] = [];
                for (let i = start + 1; i < Math.min(lines.length, start + 80); i++) {
                    const line = lines[i]!;
                    // 形如: "    148,991K: system (pid 3265)"
                    const m = line.match(/^\s*([\d,]+)K:\s+(\S+)\s+\(pid (\d+)/);
                    if (m) {
                        const mb = Number(m[1]!.replace(/,/g, "")) / 1024;
                        parsed.push({
                            name: m[2]!,
                            pid: Number(m[3]),
                            value: Number(mb.toFixed(1)),
                            percent: memTotalMb
                                ? Number(((mb / memTotalMb) * 100).toFixed(1))
                                : undefined,
                        });
                    } else if (parsed.length > 0 && !/^\s*$/.test(line.trim())) {
                        // 段落结束（出现非进程行）
                        if (!/^\s/.test(line)) break;
                    }
                }
                parsed.sort((a, b) => b.value - a.value);
                memTop = parsed.slice(0, 15);
            }

            // 退化：若 memVal 仍为空，用 dumpsys meminfo 汇总（注意千位逗号）
            if (memVal === null) {
                const num = (re: RegExp) => {
                    const m = mem.match(re);
                    if (!m) return 0;
                    return Number(m[1]!.replace(/,/g, "")) || 0;
                };
                const totalKb = num(/Total RAM:\s*([\d,]+)/i);
                const usedKb = num(/Used RAM:\s*([\d,]+)/i);
                const freeKb = num(/Free RAM:\s*([\d,]+)/i);
                const numerator = usedKb || totalKb - freeKb;
                if (totalKb > 0 && numerator > 0) {
                    memVal = Number(((numerator / totalKb) * 100).toFixed(1));
                    memUsedMb = Number((numerator / 1024).toFixed(0));
                    memTotalMb = Number((totalKb / 1024).toFixed(0));
                    memText = mem.split("\n").slice(0, 7).join("\n");
                }
            }
        } catch {
            /* ignore */
        }

        runInAction(() => {
            this.lastSampleAt = stamp;
            this.memSample = memText;
            this.lastTopCpu = cpuTop;
            this.lastTopMem = memTop;
            this.memUsedMb = memUsedMb;
            this.memTotalMb = memTotalMb;
            const MAXP = 3600; // 最多保留 1 小时（10s 一点）
            if (cpuVal !== null) {
                this.cpuHistory = [...this.cpuHistory, cpuVal].slice(-MAXP);
            }
            if (memVal !== null) {
                this.memHistory = [...this.memHistory, memVal].slice(-MAXP);
            }
            this.sampleTimes = [...this.sampleTimes, stamp].slice(-MAXP);
            this.samples = [
                ...this.samples.slice(-4999),
                {
                    time: stamp,
                    cpu: cpuVal,
                    mem: memVal,
                    memUsedMb,
                    memTotalMb,
                    topCpu: cpuTop,
                    topMem: memTop,
                },
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
            this.samples = [];
            this.lastTopCpu = [];
            this.lastTopMem = [];
            this.leakResult = undefined;
            this.leakBugs = [];
            this.monitorStartedAt = Date.now();
            this.monitorAnchorAt = Date.now();
            this.monitorTick = 0;
        });
        this.append(
            `开始监控（间隔 ${this.monitorIntervalSec}s，采集设备真实数据 + Top 进程明细）`,
            "ok",
        );
        await this.sampleOnce().catch(() => "");
        this.scheduleNextSample();
        // 每秒刷新「已采集时长」计时显示
        this.monitorTickTimer = setInterval(() => {
            runInAction(() => {
                this.monitorTick = Math.floor((Date.now() - this.monitorStartedAt) / 1000);
            });
        }, 1000);
    }

    /** 设置采样间隔；若正在监控，立即按新间隔重新调度（当次生效） */
    setMonitorInterval(sec: number) {
        const v = Math.max(2, Math.floor(sec) || 10);
        runInAction(() => {
            this.monitorIntervalSec = v;
        });
        if (this.monitoring) {
            if (this.monitorTimer) {
                clearTimeout(this.monitorTimer);
                this.monitorTimer = undefined;
            }
            // 以「此刻」为新调度锚点（不重置已采集时长），保证新间隔立刻生效
            runInAction(() => {
                this.monitorAnchorAt = Date.now();
            });
            this.scheduleNextSample();
            this.append(`采样间隔已改为 ${v}s，立即生效`);
        }
    }

    /**
     * 按「绝对时间锚定」调度下一次采样。
     *
     * 用 setInterval 的话，采样本身的耗时（约 0.5~1s）会叠加到间隔上，
     * 导致实际间隔 = 设定值 + 采样耗时。这里改为按起始时间计算下一个整数刻度，
     * 保证**实际间隔严格等于设定值**。
     */
    private scheduleNextSample() {
        if (!this.monitoring) return;
        const intervalMs = Math.max(2, this.monitorIntervalSec) * 1000;
        const anchor = this.monitorAnchorAt || this.monitorStartedAt || Date.now();
        const elapsed = Date.now() - anchor;
        // 下一个应采样的绝对时刻（相对锚点的整数倍刻度）
        const nextTick = (Math.floor(elapsed / intervalMs) + 1) * intervalMs;
        const delay = Math.max(0, nextTick - elapsed);
        this.monitorTimer = setTimeout(() => {
            void this.sampleOnce()
                .catch(() => "")
                .finally(() => this.scheduleNextSample());
        }, delay);
    }

    stopMonitor() {
        if (this.monitorTimer) {
            clearTimeout(this.monitorTimer);
            this.monitorTimer = undefined;
        }
        if (this.monitorTickTimer) {
            clearInterval(this.monitorTickTimer);
            this.monitorTickTimer = undefined;
        }
        runInAction(() => {
            this.monitoring = false;
        });
        this.append(
            `已停止监控，共采集 ${this.cpuHistory.length} 个点，耗时 ${this.formatDuration(
                this.monitorDurationSec,
            )}`,
        );
    }

    /** 把秒格式化为「X分XX秒」 */
    formatDuration(sec: number): string {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}分${String(s).padStart(2, "0")}秒`;
    }

    /** 监控数据的统计：最小 / 平均 / 峰值 */
    get monitorStats(): {
        cpu: { min: number; avg: number; max: number };
        mem: { min: number; avg: number; max: number };
    } | null {
        const calc = (arr: number[]) => {
            if (arr.length === 0) return { min: 0, avg: 0, max: 0 };
            const min = Math.min(...arr);
            const max = Math.max(...arr);
            const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
            return {
                min: Number(min.toFixed(1)),
                avg: Number(avg.toFixed(1)),
                max: Number(max.toFixed(1)),
            };
        };
        if (this.cpuHistory.length === 0 && this.memHistory.length === 0) return null;
        return { cpu: calc(this.cpuHistory), mem: calc(this.memHistory) };
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
            this.leakBugs = this.buildLeakBugs(level, ys, growth, growthPerMin, r2, stepSec);
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
            )}%，${growthPerMin.toFixed(2)}%/分钟，R²=${r2.toFixed(2)}）` +
                (this.leakBugs.length ? `，已生成 ${this.leakBugs.length} 份问题单` : ""),
            level === "likely" ? "err" : level === "slight" ? "info" : "ok",
        );
    }

    /**
     * 依据检测结果生成「提 bug 单」格式的详细问题描述。
     *
     * 判定为 none 时不产生问题单；slight / likely 各生成一条，
     * 并在内存 Top 里找出增长最可疑的进程作为「嫌疑对象」写进单里。
     */
    private buildLeakBugs(
        level: "none" | "slight" | "likely",
        ys: number[],
        growth: number,
        growthPerMin: number,
        r2: number,
        stepSec: number,
    ): LeakBug[] {
        if (level === "none") return [];
        const n = ys.length;
        const durationMin = Number(((n * stepSec) / 60).toFixed(1));
        const severity: LeakBug["severity"] =
            level === "likely" ? "严重" : "一般";

        // 找出内存 Top 里占用最大的进程作为嫌疑对象
        const suspect = this.lastTopMem[0];
        const suspectLine = suspect
            ? `${suspect.name}（${suspect.value} MB${
                  suspect.percent !== undefined ? ` / ${suspect.percent}%` : ""
              }）`
            : "（本次采样未捕获到进程明细，建议重新采集）";

        // 关键数据点（起点 / 中点 / 终点）
        const points = [0, Math.floor(n / 2), n - 1]
            .filter((i, idx, a) => a.indexOf(i) === idx)
            .map((i) => `${this.sampleTimes[i] ?? `第 ${i + 1} 点`}：${ys[i]!.toFixed(1)}%`)
            .join("；");

        const title =
            level === "likely"
                ? `【内存泄露】系统内存占用在 ${durationMin} 分钟内持续增长 +${growth.toFixed(
                      1,
                  )}%（${growthPerMin.toFixed(2)}%/分钟），疑似存在内存泄露`
                : `【内存轻微增长】系统内存占用在 ${durationMin} 分钟内缓慢上升 +${growth.toFixed(
                      1,
                  )}%（${growthPerMin.toFixed(2)}%/分钟），建议持续观察`;

        const phenomenon =
            `在 ${durationMin} 分钟的采集时段内，设备整体内存占用率从 ${ys[0]!.toFixed(
                1,
            )}% 上升至 ${ys[n - 1]!.toFixed(1)}%，累计增长 ${growth.toFixed(
                1,
            )} 个百分点，平均每分钟增长 ${growthPerMin.toFixed(2)}%。` +
            `线性拟合度 R²=${r2.toFixed(
                3,
            )}（越接近 1 表示越接近稳定线性增长，即典型的泄露特征）。` +
            `当前内存占用最高的进程为 ${suspectLine}。`;

        const steps = [
            "连接设备，进入「TEST 脚本」页；",
            `设置采样间隔 ${stepSec} 秒，点击「开始监控」，持续采集不少于 ${durationMin} 分钟；`,
            "监控期间按正常业务流程操作被测应用（反复打开/退出、切换页面等）；",
            "点击「检测内存泄露」查看内存增长趋势与判定结果；",
            "如需进一步定位，可对比「内存占用 Top 进程」列表在各时刻的排名变化。",
        ];

        const evidence = [
            `采样点数：${n} 个（间隔 ${stepSec}s，共 ${durationMin} 分钟）`,
            `内存占用变化：${ys[0]!.toFixed(1)}% → ${ys[n - 1]!.toFixed(1)}%`,
            `关键时点：${points}`,
            `总增长：+${growth.toFixed(1)}%`,
            `增长速率：+${growthPerMin.toFixed(2)}%/分钟`,
            `线性拟合度 R²：${r2.toFixed(3)}`,
            `内存占用最高进程：${suspectLine}`,
        ];

        const basis =
            `判定规则：对采集时段的内存序列做线性回归，当斜率为正且 R² > 0.6 时，` +
            `若每分钟增长 ≥ 0.8% 判为「疑似泄露」（严重），≥ 0.2% 判为「轻微增长」（一般）。` +
            `本次斜率对应 +${growthPerMin.toFixed(2)}%/分钟，R²=${r2.toFixed(
                3,
            )}，故判定为「${
                level === "likely" ? "疑似内存泄露" : "轻微内存增长"
            }」。`;

        const impact =
            level === "likely"
                ? "内存持续增长会导致系统可用内存不断下降，长时间运行可能引发卡顿、应用被系统回收（LMK）、甚至系统重启，影响整车稳定性与用户体验。"
                : "内存缓慢上升，短期影响不明显，但若在长时间压力测试中持续累积，可能出现可用内存下降，需要关注是否收敛。";

        const suggestion =
            `① 优先排查内存占用最高的进程 ${suspect?.name ?? "(见 Top 列表)"}，` +
            `用 \`dumpsys meminfo ${suspect?.name ?? "<包名>"}\` 查看其 Heap / PSS 明细；` +
            `② 反复进出被测页面，观察该进程 PSS 是否只增不减（典型的 Activity/Context 泄漏）；` +
            `③ 结合「日志 Logcat」抓取 GC 日志与 \`Low on memory\` 告警；` +
            `④ 如涉及 native 内存，可用 \`dumpsys meminfo --local\` 或 malloc debug 进一步定位；` +
            `⑤ 复测时固定相同的操作路径与时长，便于对比验证修复效果。`;

        return [
            {
                title,
                severity,
                level: level as "likely" | "slight",
                phenomenon,
                steps,
                evidence,
                basis,
                impact,
                suggestion,
                growthPerMin,
                growth,
                r2,
            },
        ];
    }

    /** 导出内存泄露问题单为文本（可保存到本地文件夹 / 下载） */
    async exportLeakBugs(dirHandle?: FileSystemDirectoryHandle): Promise<boolean> {
        if (this.leakBugs.length === 0) {
            this.append("暂无内存泄露问题单，请先点「检测内存泄露」", "err");
            return false;
        }
        const key = "leakExport";
        this.setProgress(key, 30, "正在生成问题单…");
        try {
            const blocks = this.leakBugs.map((b, i) => {
                return [
                    `========================================`,
                    `缺陷 ${i + 1}：${b.title}`,
                    `========================================`,
                    `【严重程度】${b.severity}`,
                    ``,
                    `【问题现象】`,
                    b.phenomenon,
                    ``,
                    `【复现步骤】`,
                    ...b.steps.map((s, idx) => `${idx + 1}. ${s}`),
                    ``,
                    `【数据证据】`,
                    ...b.evidence.map((e) => `· ${e}`),
                    ``,
                    `【判定依据】`,
                    b.basis,
                    ``,
                    `【影响范围】`,
                    b.impact,
                    ``,
                    `【建议排查方向】`,
                    b.suggestion,
                    ``,
                ].join("\n");
            });
            const header = [
                `内存泄露检测报告`,
                `生成时间：${new Date().toLocaleString()}`,
                `设备：${connection.selectedDeviceName ?? ""} ${
                    connection.selectedSerial ?? ""
                }`,
                `采集时长：${this.formatDuration(this.monitorDurationSec)}，采样间隔 ${this.monitorIntervalSec}s`,
                ``,
            ].join("\n");
            const text = header + "\n" + blocks.join("\n");
            const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
            const name = `leak-report_${timestampName().replace(/[-:]/g, "")}.txt`;
            this.setProgress(key, 80, "写入文件…");
            if (dirHandle) {
                const handle = await dirHandle.getFileHandle(name, { create: true });
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                this.setProgress(key, 100, `已保存 ${dirHandle.name}/${name}`, true, true);
                this.append(`内存泄露问题单已保存到 ${dirHandle.name}/${name}`, "ok");
            } else {
                saveBlob(blob, name);
                this.setProgress(key, 100, `已下载 ${name}`, true, true);
                this.append(`内存泄露问题单已下载：${name}`, "ok");
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

    /** 导出监控记录到本地文件夹（CSV 明细 + 曲线图 PNG + 汇总统计） */
    async exportMonitor(dirHandle?: FileSystemDirectoryHandle): Promise<boolean> {
        if (this.samples.length === 0) {
            this.append("暂无监控数据可导出，请先开始监控", "err");
            return false;
        }
        const key = "monitorExport";
        this.setProgress(key, 5, "准备数据…");
        try {
            const stamp = timestampName().replace(/[-:]/g, "");
            const base = `monitor_${stamp}`;
            const stats = this.monitorStats;

            // ① 汇总统计头部 + 逐条明细
            const header = [
                "# CPU / 内存监控记录",
                `# 设备：${connection.selectedDeviceName ?? ""} ${
                    connection.selectedSerial ?? ""
                }`,
                `# 采集时长：${this.formatDuration(this.monitorDurationSec)}，采样间隔 ${
                    this.monitorIntervalSec
                }s，采样点数：${this.samples.length}`,
                stats
                    ? `# CPU%  最小 ${stats.cpu.min} / 平均 ${stats.cpu.avg} / 峰值 ${stats.cpu.max}`
                    : "# CPU%  无数据",
                stats
                    ? `# 内存% 最小 ${stats.mem.min} / 平均 ${stats.mem.avg} / 峰值 ${stats.mem.max}`
                    : "# 内存% 无数据",
                "",
                "时间,CPU占用%,内存占用%,内存已用MB,内存总量MB,CPU占用Top进程,内存占用Top进程",
            ];
            const rows = this.samples.map((s) => {
                const topCpu = s.topCpu
                    .slice(0, 5)
                    .map((p) => `${p.name}:${p.value}%`)
                    .join(" | ");
                const topMem = s.topMem
                    .slice(0, 5)
                    .map((p) => `${p.name}:${p.value}MB`)
                    .join(" | ");
                return `${s.time},${s.cpu ?? ""},${s.mem ?? ""},${s.memUsedMb},${
                    s.memTotalMb
                },"${topCpu}","${topMem}"`;
            });
            const csv = [header.join("\n"), ...rows].join("\n");
            const csvBlob = new Blob(["\ufeff" + csv], {
                type: "text/csv;charset=utf-8",
            });

            // ② 曲线图 PNG
            const png = this.renderMonitorChart();

            this.setProgress(key, 50, "写入文件…");
            const writeOne = async (
                dir: FileSystemDirectoryHandle | undefined,
                name: string,
                blob: Blob,
            ) => {
                if (dir) {
                    const handle = await dir.getFileHandle(name, { create: true });
                    const w = await handle.createWritable();
                    await w.write(blob);
                    await w.close();
                } else {
                    saveBlob(blob, name);
                }
            };
            await writeOne(dirHandle, `${base}.csv`, csvBlob);
            if (png) {
                this.setProgress(key, 80, "写入曲线图…");
                await writeOne(dirHandle, `${base}.png`, png);
            }
            this.setProgress(
                key,
                100,
                dirHandle
                    ? `已保存到 ${dirHandle.name}/（${base}.csv${png ? " + .png" : ""}）`
                    : `已下载 ${base}.csv${png ? " + .png" : ""}`,
                true,
                true,
            );
            this.append(
                `监控记录已导出${dirHandle ? "到 " + dirHandle.name : ""}：${base}.csv${
                    png ? " + 曲线图 .png" : ""
                }`,
                "ok",
            );
            setTimeout(() => this.clearProgress(key), 4000);
            return true;
        } catch (e) {
            this.setProgress(key, 100, `失败：${(e as Error).message}`, true, false);
            this.append(`导出失败：${(e as Error).message}`, "err");
            setTimeout(() => this.clearProgress(key), 5000);
            return false;
        }
    }

    /** 把当前曲线渲染为 PNG（用于导出时附带曲线图） */
    private renderMonitorChart(): Blob | null {
        try {
            const W = 900;
            const H = 360;
            const canvas = document.createElement("canvas");
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, W, H);
            ctx.font = "12px Consolas, monospace";

            const drawSeries = (
                data: number[],
                color: string,
                label: string,
                padTop: number,
                plotH: number,
            ) => {
                const padL = 50;
                const padR = 20;
                const plotW = W - padL - padR;
                const top = padTop;
                // 网格
                ctx.strokeStyle = "#edebe9";
                ctx.fillStyle = "#a19f9d";
                for (let i = 0; i <= 4; i++) {
                    const y = top + (plotH * i) / 4;
                    ctx.beginPath();
                    ctx.moveTo(padL, y);
                    ctx.lineTo(W - padR, y);
                    ctx.stroke();
                    ctx.fillText(`${100 - i * 25}%`, 8, y + 4);
                }
                if (data.length === 0) return;
                const max = 100;
                const xAt = (i: number) =>
                    padL + (plotW * i) / Math.max(1, data.length - 1);
                const yAt = (v: number) => top + plotH * (1 - v / max);
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                data.forEach((v, i) => {
                    const x = xAt(i);
                    const y = yAt(v);
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.stroke();
                // 峰值标注
                const maxV = Math.max(...data);
                const maxI = data.indexOf(maxV);
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(xAt(maxI), yAt(maxV), 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#a4262c";
                ctx.fillText(
                    `峰值 ${maxV.toFixed(1)}%`,
                    Math.min(xAt(maxI) + 6, W - 80),
                    yAt(maxV) - 6,
                );
                // 标题
                ctx.fillStyle = color;
                ctx.font = "bold 14px Consolas, monospace";
                ctx.fillText(label, padL, top - 10);
                ctx.font = "12px Consolas, monospace";
            };

            drawSeries(this.cpuHistory, "#d13438", "CPU 占用（实时）", 40, 120);
            drawSeries(this.memHistory, "#0078d4", "内存占用（实时）", 210, 120);

            // 底部统计
            const st = this.monitorStats;
            ctx.fillStyle = "#323130";
            ctx.fillText(
                `采集时长 ${this.formatDuration(this.monitorDurationSec)} · 采样间隔 ${
                    this.monitorIntervalSec
                }s · 采样点 ${this.samples.length}`,
                50,
                350,
            );
            if (st) {
                ctx.fillText(
                    `CPU  最小 ${st.cpu.min}% / 平均 ${st.cpu.avg}% / 峰值 ${st.cpu.max}%   |   内存  最小 ${st.mem.min}% / 平均 ${st.mem.avg}% / 峰值 ${st.mem.max}%`,
                    50,
                    350 + 0.001,
                );
            }
            return dataUrlToBlob(canvas.toDataURL("image/png"));
        } catch {
            return null;
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

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
    /** 自检结果文本 */
    monkeyCheck = "";

    // ---- 蓝牙 HCI ----
    hciExportProgress = "";

    // ---- CPU/内存监控 ----
    monitorIntervalSec = 10;
    monitoring = false;
    cpuSample?: string;
    memSample?: string;
    /** 历史采样（用于绘制趋势，仅保留最近 N 条） */
    cpuHistory: number[] = [];
    memHistory: number[] = [];
    /** 监控日志行（用于导出） */
    monitorLog: string[] = [];
    /** 上次采样时间 */
    lastSampleAt = "";

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
        makeAutoObservable(this, {}, { autoBind: true });
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

    /** 删除设备上的历史日志文件（来自 02_rm_device_log_file.bat） */
    async removeDeviceLogs() {
        const paths = this.cleanPaths
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
        if (paths.length === 0) {
            this.append("清理路径为空", "err");
            return;
        }
        try {
            for (const p of paths) {
                await this.exec(`rm -rf ${q(p)}`, `删除 ${p}`);
            }
            this.append("设备日志目录已清理", "ok");
        } catch (e) {
            this.append(`清理失败：${(e as Error).message}`, "err");
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
            for (const p of paths) {
                try {
                    runInAction(() => {
                        this.pullProgress = `正在拉取 ${p} …`;
                    });
                    this.append(`拉取 ${p} …`);
                    const { blob, name } = await fs.pullPath(p, (stage) => {
                        runInAction(() => {
                            this.pullProgress = `正在拉取 ${stage}`;
                        });
                    });
                    if (blob.size === 0) {
                        this.append("  ↳ 跳过（空或不存在）");
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
                } catch (e) {
                    this.append(`  ↳ ${p} 拉取失败：${(e as Error).message}`, "err");
                }
            }
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

    /** 后台执行 monkey 测试（结果写入设备 /sdcard/yx_log） */
    async runMonkey() {
        const adb = this.adb;
        if (!adb) {
            this.append("Monkey 启动失败：未连接设备", "err");
            return;
        }
        if (this.monkeyRunning) return;
        const cmd = this.buildMonkeyCommand();
        this.append("$ (后台) " + cmd);
        try {
            const dir = "/sdcard/yx_log";
            await shell(adb, `mkdir -p ${dir}`).catch(() => "");
            const logName = `monkey_${timestampName().replace(/[-:]/g, "")}.log`;
            const wrapped = `${cmd} > ${dir}/${logName} 2>&1 &`;
            // 后台执行并立即返回；不等待命令结束
            void adb.subprocess.noneProtocol
                .pty(`sh -c ${q(wrapped)}`)
                .catch(() => {
                    /* 后台任务，忽略流结束 */
                });
            runInAction(() => {
                this.monkeyRunning = true;
            });
            this.append(`Monkey 已在设备后台启动，日志：${dir}/${logName}`, "ok");
            // 2 秒后确认进程确实起来了（自检兼容）
            setTimeout(() => {
                void this.verifyMonkeyRunning();
            }, 2500);
        } catch (e) {
            this.append(`Monkey 启动失败：${(e as Error).message}`, "err");
            runInAction(() => {
                this.monkeyRunning = false;
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
            else this.append("⚠ 未检测到 monkey 进程，请检查包名是否存在于设备上（可先点「自检」）", "err");
        } catch {
            /* 老设备可能不支持 ps -A，忽略 */
        }
    }

    stopMonkey() {
        runInAction(() => {
            this.monkeyRunning = false;
        });
        this.append("已停止本地记录（设备端 monkey 需 kill 或重启终止）");
    }

    /** 强杀设备上的 monkey 进程 */
    async killMonkey() {
        try {
            await this.exec("pkill -f monkey || killall monkey", "结束 monkey 进程");
            runInAction(() => {
                this.monkeyRunning = false;
            });
            this.append("已尝试结束设备上的 monkey 进程", "ok");
        } catch (e) {
            this.append(`结束失败：${(e as Error).message}`, "err");
        }
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

    /** 导出 HCI 日志到本地 */
    async exportHci(dirHandle?: FileSystemDirectoryHandle) {
        try {
            runInAction(() => {
                this.hciExportProgress = "正在读取 HCI 日志 …";
            });
            const { blob, name } = await fs.pullPath(HCI_LOG_DIR, (stage) => {
                runInAction(() => {
                    this.hciExportProgress = `正在拉取 ${stage}`;
                });
            });
            if (blob.size === 0) {
                this.append("HCI 日志为空或不存在", "err");
                return;
            }
            if (dirHandle) {
                const handle = await dirHandle.getFileHandle(name, { create: true });
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                this.append(`HCI 日志已保存到 ${dirHandle.name}/${name}`, "ok");
            } else {
                saveBlob(blob, name);
                this.append(`HCI 日志已下载：${name}`, "ok");
            }
        } catch (e) {
            this.append(`导出失败：${(e as Error).message}`, "err");
        } finally {
            runInAction(() => {
                this.hciExportProgress = "";
            });
        }
    }

    /** 删除 HCI 日志 */
    async removeHci() {
        try {
            await this.exec(`rm -rf ${q(HCI_LOG_DIR + "/")}`, "删除 HCI 日志");
            this.append("HCI 日志已删除", "ok");
        } catch (e) {
            this.append(`删除失败：${(e as Error).message}`, "err");
        }
    }

    /* ================= CPU / 内存监控 ================= */

    /** 采样一次 CPU 与内存占用 */
    async sampleOnce() {
        const adb = this.adb;
        if (!adb) throw new Error("未连接设备");
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const stamp =
            `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
            `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        // CPU
        try {
            const cpu = await shell(adb, "dumpsys cpuinfo");
            const lines = cpu.split("\n").filter((l) => l.trim());
            const text = lines.slice(0, 6).join("\n");
            const total = cpu.match(/([\d.]+)%\s+TOTAL/i);
            const cpuVal = total ? Number(total[1]) : null;
            runInAction(() => {
                this.cpuSample = text;
                if (cpuVal !== null) {
                    this.cpuHistory = [...this.cpuHistory.slice(-59), cpuVal];
                }
            });
        } catch (e) {
            this.append(`CPU 采样失败：${(e as Error).message}`, "err");
        }
        // 内存
        try {
            const mem = await shell(adb, "dumpsys meminfo");
            const want = ["Total RAM", "Free RAM", "Used RAM", "Lost RAM", "ZRAM"];
            const lines = mem
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => want.some((w) => l.startsWith(w)));
            const text = lines.join("\n");
            const totalKb = mem.match(/Total RAM:\s*(\d+)/i);
            const freeKb = mem.match(/Free RAM:\s*(\d+)/i);
            let memVal: number | null = null;
            if (totalKb && freeKb) {
                memVal =
                    ((Number(totalKb[1]) - Number(freeKb[1])) / Number(totalKb[1])) * 100;
            }
            runInAction(() => {
                this.memSample = text || mem.split("\n").slice(0, 5).join("\n");
                if (memVal !== null) {
                    this.memHistory = [
                        ...this.memHistory.slice(-59),
                        Number(memVal.toFixed(1)),
                    ];
                }
            });
        } catch (e) {
            this.append(`内存采样失败：${(e as Error).message}`, "err");
        }

        // 记录到监控日志（用于导出）
        runInAction(() => {
            this.lastSampleAt = stamp;
            const c = this.cpuHistory.length
                ? this.cpuHistory[this.cpuHistory.length - 1]
                : "";
            const m = this.memHistory.length
                ? this.memHistory[this.memHistory.length - 1]
                : "";
            this.monitorLog = [
                ...this.monitorLog.slice(-4999),
                `${stamp}\tCPU%\t${c}\tMEM%\t${m}`,
            ];
        });
    }

    async startMonitor() {
        if (this.monitoring) return;
        runInAction(() => {
            this.monitoring = true;
            this.cpuHistory = [];
            this.memHistory = [];
            this.monitorLog = [];
        });
        this.append(`开始监控（间隔 ${this.monitorIntervalSec}s）`, "ok");
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
        this.append("已停止监控");
    }

    /** 导出监控记录到本地文件夹（CSV） */
    async exportMonitor(dirHandle?: FileSystemDirectoryHandle): Promise<boolean> {
        if (this.monitorLog.length === 0) {
            this.append("暂无监控数据可导出，请先开始监控", "err");
            return false;
        }
        const header = "时间\tCPU占用%\t内存占用%";
        const body = this.monitorLog.map((l) => l.replace(/\tCPU%\t/, "\t").replace(/\tMEM%\t/, "\t"));
        const text = [header, ...body].join("\n");
        const blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" });
        const name = `monitor_${timestampName().replace(/[-:]/g, "")}.csv`;
        try {
            if (dirHandle) {
                const handle = await dirHandle.getFileHandle(name, { create: true });
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                this.append(`监控记录已保存到 ${dirHandle.name}/${name}`, "ok");
            } else {
                saveBlob(blob, name);
                this.append(`监控记录已下载：${name}`, "ok");
            }
            return true;
        } catch (e) {
            this.append(`导出失败：${(e as Error).message}`, "err");
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

    /** 进入应用详情界面（系统设置里的该应用页面） */
    async openAppInfo(pkg: string) {
        if (!pkg) return;
        try {
            await this.exec(
                `am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:${pkg}`,
                `进入 ${pkg} 应用界面`,
            );
            this.append(`已打开 ${pkg} 的应用详情界面`, "ok");
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

    /** 把当前应用包名列表导出为 txt */
    async exportAppList(dirHandle?: FileSystemDirectoryHandle): Promise<boolean> {
        if (this.apps.length === 0) {
            this.append("应用列表为空，请先「列出应用」", "err");
            return false;
        }
        const text = this.apps.map((a) => a.package).join("\n");
        const blob = new Blob([text + "\n"], { type: "text/plain;charset=utf-8" });
        const name = `packages_${timestampName().replace(/[-:]/g, "")}.txt`;
        try {
            if (dirHandle) {
                const handle = await dirHandle.getFileHandle(name, { create: true });
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                this.append(`包名清单已保存到 ${dirHandle.name}/${name}`, "ok");
            } else {
                saveBlob(blob, name);
                this.append(`包名清单已下载：${name}`, "ok");
            }
            return true;
        } catch (e) {
            this.append(`导出失败：${(e as Error).message}`, "err");
            return false;
        }
    }
}

export const testScript = new TestScriptStore();

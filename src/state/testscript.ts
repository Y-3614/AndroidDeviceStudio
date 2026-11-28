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
 *  - 日志采集与拉取（含后台命令可改、日志清空）
 *  - Monkey 稳定性测试（包名与参数可改）
 *  - 蓝牙 HCI 日志（开启 / 导出 / 删除）
 *  - CPU 与内存占用监控（间隔可调）
 *  - 应用管理（列出包名 / 启动 / 强制停止）
 *
 * 参考脚本来源：`犀重智能座舱域控制器/d.monkey与内存的Adb命令测试脚本`
 */

/** 把字符串写成 sh 安全的单引号形式（用于命令里嵌路径/包名） */
function q(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
}

const LS_KEY = "ads.testscript.config.v1";

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
    "/data/yaxon",
].join("\n");

/** 默认 Monkey 包名（来自 shell_cmd.sh 的 monkey 行） */
const DEFAULT_MONKEY_PACKAGES = [
    "com.yaxon.music",
    "com.yaxon.radio",
    "com.yaxon.video",
    "com.yaxon.voice",
    "com.yaxon.bluetooth",
    "com.yaxon.superstructure",
    "com.txznet.txz",
    "com.yaxon.launcher",
    "com.title.mapautosdk",
    "com.yaxon.hvac",
    "com.yaxon.setting",
    "com.yaxon.dvr",
    "com.yaxon.pki",
    "com.yaxon.tboxservice",
    "com.yaxon.mcu_service",
    "com.carota.seazon",
].join("\n");

const DEFAULT_MONKEY_ARGS =
    "--ignore-timeouts --ignore-security-exceptions --ignore-crashes " +
    "--kill-process-after-error --monitor-native-crashes " +
    "--pct-trackball 0 --pct-nav 0 --pct-majornav 10 --pct-anyevent 10 " +
    "--pct-syskeys 0 --pct-touch 40 --pct-motion 30 --pct-appswitch 10 " +
    "--pct-flip 0 -v -v -v --throttle 500";

/** HCI 日志目录（来自蓝牙脚本） */
export const HCI_LOG_DIR = "/data/misc/bluetooth/logs";

export interface ScriptLogEntry {
    time: string;
    text: string;
    kind: "info" | "ok" | "err";
}

class TestScriptStore {
    // ---- 日志采集 ----
    /** 后台 logcat 命令（可改） */
    logcatCommand = "logcat -v time";
    /** 拉取路径列表（每行一个，可改） */
    pullPaths = DEFAULT_PULL_PATHS;
    /** 清理路径列表（每行一个，可改） */
    cleanPaths = DEFAULT_CLEAN_PATHS;
    logRunning = false;
    pulling = false;
    pullProgress = "";

    // ---- Monkey ----
    monkeyPackages = DEFAULT_MONKEY_PACKAGES;
    monkeyArgs = DEFAULT_MONKEY_ARGS;
    monkeyThrottle = 500;
    monkeyEvents = 1200000;
    monkeyRunning = false;

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

    // ---- 应用管理 ----
    apps: { package: string; pid: number; system: boolean }[] = [];
    loadingApps = false;
    includeSystemApps = false;
    selectedPackage = "";
    launchForceStop = false;

    // ---- 输出日志 ----
    output: ScriptLogEntry[] = [];

    /** 监控定时器句柄（@observable，不影响渲染语义） */
    monitorTimer: ReturnType<typeof setInterval> | undefined;

    constructor() {
        makeAutoObservable(this, {}, { autoBind: true });
        this.load();
    }

    /* ---------------- 持久化：让用户改过的配置下次还在 ---------------- */
    private load() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return;
            const c = JSON.parse(raw) as Partial<TestScriptStore>;
            if (typeof c.logcatCommand === "string") this.logcatCommand = c.logcatCommand;
            if (typeof c.pullPaths === "string") this.pullPaths = c.pullPaths;
            if (typeof c.cleanPaths === "string") this.cleanPaths = c.cleanPaths;
            if (typeof c.monkeyPackages === "string") this.monkeyPackages = c.monkeyPackages;
            if (typeof c.monkeyArgs === "string") this.monkeyArgs = c.monkeyArgs;
            if (typeof c.monkeyThrottle === "number") this.monkeyThrottle = c.monkeyThrottle;
            if (typeof c.monkeyEvents === "number") this.monkeyEvents = c.monkeyEvents;
            if (typeof c.monitorIntervalSec === "number")
                this.monitorIntervalSec = c.monitorIntervalSec;
        } catch {
            /* 配置损坏则用默认值 */
        }
    }

    save() {
        try {
            localStorage.setItem(
                LS_KEY,
                JSON.stringify({
                    logcatCommand: this.logcatCommand,
                    pullPaths: this.pullPaths,
                    cleanPaths: this.cleanPaths,
                    monkeyPackages: this.monkeyPackages,
                    monkeyArgs: this.monkeyArgs,
                    monkeyThrottle: this.monkeyThrottle,
                    monkeyEvents: this.monkeyEvents,
                    monitorIntervalSec: this.monitorIntervalSec,
                }),
            );
            this.append("配置已保存到浏览器", "ok");
        } catch (e) {
            this.append(`保存失败：${(e as Error).message}`, "err");
        }
    }

    resetDefaults() {
        this.logcatCommand = "logcat -v time";
        this.pullPaths = DEFAULT_PULL_PATHS;
        this.cleanPaths = DEFAULT_CLEAN_PATHS;
        this.monkeyPackages = DEFAULT_MONKEY_PACKAGES;
        this.monkeyArgs = DEFAULT_MONKEY_ARGS;
        this.monkeyThrottle = 500;
        this.monkeyEvents = 1200000;
        this.monitorIntervalSec = 10;
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

    /* ================= 日志采集 ================= */

    /** 后台开始采集日志（写入设备 /sdcard/yx_log） */
    async startLogcat() {
        const adb = this.adb;
        if (!adb || this.logRunning) return;
        try {
            const dir = "/sdcard/yx_log";
            await this.exec(`mkdir -p ${dir}`);
            // 后台执行：nohup 形式，脱离当前会话
            const cmd = `${this.logcatCommand} > ${dir}/logcat_$(date +%Y%m%d-%H%M%S).log 2>&1 &`;
            this.append(`$ (后台) ${cmd}`);
            // 用 pty 执行并立即返回，不等待输出结束
            void adb.subprocess.noneProtocol.pty(`sh -c ${q(cmd)}`).catch(() => {
                /* 后台任务，忽略结束 */
            });
            runInAction(() => {
                this.logRunning = true;
            });
            this.append("日志采集已在设备后台启动", "ok");
        } catch (e) {
            this.append(`启动失败：${(e as Error).message}`, "err");
        }
    }

    stopLogcat() {
        runInAction(() => {
            this.logRunning = false;
        });
        this.append("已停止本地记录的采集状态（设备端后台进程会继续，可用「清空日志」或重启终止）");
    }

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
        });
        const results: { name: string; blob: Blob }[] = [];
        try {
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
                        this.append(`  ↳ 跳过（空或不存在）`);
                        continue;
                    }
                    if (dirHandle) {
                        const handle = await dirHandle.getFileHandle(name, {
                            create: true,
                        });
                        const w = await handle.createWritable();
                        await w.write(blob);
                        await w.close();
                        this.append(
                            `  ↳ 已保存到本地：${dirHandle.name}/${name}（${(
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
            `${this.monkeyEvents} --bugreport 12000000`
        );
    }

    /** 后台执行 monkey 测试 */
    async runMonkey() {
        const adb = this.adb;
        if (!adb || this.monkeyRunning) return;
        const cmd = this.buildMonkeyCommand();
        try {
            this.append("$ (后台) " + cmd);
            const dir = "/sdcard/yx_log";
            await this.exec(`mkdir -p ${dir}`).catch(() => "");
            const wrapped = `${cmd} > ${dir}/monkey_$(date +%Y%m%d-%H%M%S).log 2>&1 &`;
            void adb.subprocess.noneProtocol
                .pty(`sh -c ${q(wrapped)}`)
                .catch(() => {
                    /* 后台任务 */
                });
            runInAction(() => {
                this.monkeyRunning = true;
            });
            this.append("Monkey 测试已在设备后台启动", "ok");
        } catch (e) {
            this.append(`Monkey 启动失败：${(e as Error).message}`, "err");
        }
    }

    stopMonkey() {
        runInAction(() => {
            this.monkeyRunning = false;
        });
        this.append("已停止本地记录（设备端 monkey 需 kill 或重启终止）");
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
        // CPU：取 dumpsys cpuinfo 的汇总行
        try {
            const cpu = await shell(adb, "dumpsys cpuinfo");
            const lines = cpu.split("\n").filter((l) => l.trim());
            // 取最前面的若干行（含总计）
            const text = lines.slice(0, 6).join("\n");
            const total = cpu.match(/([\d.]+)%\s+TOTAL/i);
            runInAction(() => {
                this.cpuSample = text;
                if (total) {
                    this.cpuHistory = [
                        ...this.cpuHistory.slice(-59),
                        Number(total[1]),
                    ];
                }
            });
        } catch (e) {
            this.append(`CPU 采样失败：${(e as Error).message}`, "err");
        }
        // 内存：取 meminfo 的关键项
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
            runInAction(() => {
                this.memSample = text || mem.split("\n").slice(0, 5).join("\n");
                if (totalKb && freeKb) {
                    const used =
                        ((Number(totalKb[1]) - Number(freeKb[1])) /
                            Number(totalKb[1])) *
                        100;
                    this.memHistory = [...this.memHistory.slice(-59), Number(used.toFixed(1))];
                }
            });
        } catch (e) {
            this.append(`内存采样失败：${(e as Error).message}`, "err");
        }
    }

    async startMonitor() {
        if (this.monitoring) return;
        runInAction(() => {
            this.monitoring = true;
            this.cpuHistory = [];
            this.memHistory = [];
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

    /* ================= 应用管理 ================= */

    /** 列出设备上所有应用包名（可选择是否含系统应用） */
    async loadApps(includeSystem = this.includeSystemApps) {
        const adb = this.adb;
        if (!adb) return;
        runInAction(() => {
            this.loadingApps = true;
        });
        try {
            const flag = includeSystem ? "" : "-3";
            const out = await shell(adb, `pm list packages ${flag}`.trim());
            const pkgs = out
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l.startsWith("package:"))
                .map((l) => l.slice("package:".length).trim())
                .filter(Boolean)
                .sort();

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
                    system: false,
                }));
                this.includeSystemApps = includeSystem;
                this.loadingApps = false;
            });
            this.append(
                `已列出 ${pkgs.length} 个应用${includeSystem ? "（含系统应用）" : "（仅第三方）"}`,
                "ok",
            );
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
}

export const testScript = new TestScriptStore();

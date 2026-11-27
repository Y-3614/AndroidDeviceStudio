import type { Adb } from "@yume-chan/adb";
import { makeAutoObservable, runInAction } from "mobx";

/**
 * 提权级别
 * - none:    普通 adbd 权限
 * - su:      设备有 su/magisk，通过 shell + su -c 提权
 * - adbRoot: adb root 成功，adbd 以 root 运行
 */
export type PrivilegeLevel = "unknown" | "none" | "su" | "adbRoot";

export type RemountState = "unknown" | "readonly" | "writable" | "unsupported";

interface AdbWithService extends Adb {
    createSocketAndWait(service: string): Promise<string>;
}

/**
 * 通过 shell 协议执行命令并返回 stdout 文本。
 *
 * ⚠️ 关键：命令必须以**单元素数组**形式传入，绝不能传字符串！
 * 库内部对字符串会先调用 `splitCommand()` 把引号剥掉再 `join(" ")` 拼回，
 * 于是 `su -c 'ls -la /data'` 会变成 `su -c ls -la /data`，
 * 设备端 `su` 收到裸 `-c` 后不认识，报 `su: invalid uid/gid '-c'`。
 * 传数组 `[command]` 则原样拼接，引号完整保留。
 */
export async function shell(adb: Adb, command: string): Promise<string> {
    const svc = adb.subprocess.shellProtocol;
    // ShellV2 是 Android 7+ 才有的能力，老设备必须降级
    if (svc && svc.isSupported) {
        const result = await svc.spawnWaitText([command]);
        if (result.exitCode !== 0 && !result.stdout) {
            throw new Error(
                (result.stderr || `命令退出码 ${result.exitCode}`).trim(),
            );
        }
        // 有输出时也把 stderr 的权限类错误暴露出来
        if (!result.stdout && result.stderr.trim()) {
            throw new Error(result.stderr.trim());
        }
        return result.stdout;
    }
    // 老设备无 ShellV2：退回 exec，命令整体作为一个参数交给 sh -c
    const result = await adb.subprocess.noneProtocol.spawnWaitText([
        "sh",
        "-c",
        command,
    ]);
    return result;
}

/** 执行 shell 命令并返回原始字节结果 */
export async function shellRaw(adb: Adb, command: string): Promise<Uint8Array> {
    const svc = adb.subprocess.shellProtocol;
    if (svc && svc.isSupported) {
        const result = await svc.spawnWait([command]);
        return result.stdout;
    }
    return adb.subprocess.noneProtocol.spawnWait(["sh", "-c", command]);
}

/** 以 root 身份执行命令（仅在需要 su 通道时使用） */
export async function suShell(adb: Adb, command: string): Promise<string> {
    return shell(adb, `su -c ${q(command)}`);
}

/** shell 参数安全转义 */
export function q(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** 带超时的探测，避免设备无响应时界面卡死 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} 超时`)), ms),
        ),
    ]);
}

class PrivilegeStore {
    level: PrivilegeLevel = "unknown";
    /** 用户是否手动强制关闭提权（调试用） */
    manuallyDisabled = false;
    remountState: RemountState = "unknown";
    verityDisabled: boolean | undefined = undefined;
    sdkVersion = 0;

    operating = false;
    /** 正在探测中 */
    probing = false;
    lastMessage: string | undefined = undefined;
    error: string | undefined = undefined;

    constructor() {
        makeAutoObservable(this);
    }

    get effective(): boolean {
        if (this.manuallyDisabled) return false;
        return this.level === "su" || this.level === "adbRoot";
    }

    get levelLabel(): string {
        switch (this.level) {
            case "adbRoot":
                return "adb root";
            case "su":
                return "su";
            case "none":
                return "普通权限";
            default:
                return "未探测";
        }
    }

    reset() {
        runInAction(() => {
            this.level = "unknown";
            this.remountState = "unknown";
            this.verityDisabled = undefined;
            this.sdkVersion = 0;
            this.lastMessage = undefined;
            this.error = undefined;
            this.probing = false;
            this.operating = false;
        });
    }

    setManuallyDisabled(value: boolean) {
        this.manuallyDisabled = value;
    }

    /**
     * 被动探测当前权限（**绝不自动执行 adb root**）。
     *
     * `adb root` 会导致 adbd 重启、当前 USB 连接断开，
     * 因此不能在连接后自动执行，必须由用户手动点击。
     */
    async probe(adb: Adb) {
        runInAction(() => {
            this.error = undefined;
            this.level = "unknown";
            this.probing = true;
        });

        try {
            try {
                const sdk = await withTimeout(
                    adb.getProp("ro.build.version.sdk"),
                    4000,
                    "getProp",
                );
                runInAction(() => {
                    this.sdkVersion = Number(sdk.trim()) || 0;
                });
            } catch {
                /* ignore */
            }

            if (await this.checkIdRoot(adb)) {
                runInAction(() => {
                    this.level = "adbRoot";
                    this.lastMessage = "adbd 当前以 root 运行";
                });
                await this.detectRemount(adb);
                return;
            }

            if (await this.checkSu(adb)) {
                runInAction(() => {
                    this.level = "su";
                    this.lastMessage = "检测到 su，已启用提权通道";
                });
                await this.detectRemount(adb);
                return;
            }

            runInAction(() => {
                this.level = "none";
                this.lastMessage =
                    "当前为普通权限。如需访问 /data 等目录，可在「权限与挂载」手动执行 adb root";
            });
            await this.detectRemount(adb);
        } finally {
            runInAction(() => {
                this.probing = false;
            });
        }
    }

    private async checkIdRoot(adb: Adb): Promise<boolean> {
        try {
            const out = await withTimeout(shell(adb, "id"), 4000, "id");
            return /uid=0\(root\)/.test(out);
        } catch {
            return false;
        }
    }

    private async checkSu(adb: Adb): Promise<boolean> {
        try {
            const out = await withTimeout(shell(adb, "su -c id"), 6000, "su");
            return /uid=0\(root\)/.test(out);
        } catch {
            return false;
        }
    }

    /**
     * 执行 adb root。
     * 成功后 adbd 会重启、当前连接断开，需要重新连接才能生效。
     * 返回 true 表示 adbd 已重启，需要重连。
     */
    async doRoot(adb: Adb): Promise<boolean> {
        runInAction(() => {
            this.operating = true;
            this.error = undefined;
            this.lastMessage = undefined;
        });
        try {
            const output = await withTimeout(
                (adb as AdbWithService).createSocketAndWait("root:"),
                15000,
                "adb root",
            );
            if (/already running as root|restarting adbd as root/i.test(output)) {
                const already = /already running as root/i.test(output);
                runInAction(() => {
                    this.level = "adbRoot";
                    this.lastMessage = already
                        ? "adbd 已以 root 运行"
                        : "adb root 成功，adbd 已重启 —— 请点击「重新连接」恢复连接";
                });
                return !already;
            }
            runInAction(() => {
                this.error = output.trim() || "adb root 失败";
            });
            return false;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            runInAction(() => {
                this.error = message;
            });
            return false;
        } finally {
            runInAction(() => {
                this.operating = false;
            });
        }
    }

    /** adb unroot。同样会导致 adbd 重启、连接断开。 */
    async doUnroot(adb: Adb): Promise<boolean> {
        runInAction(() => {
            this.operating = true;
            this.error = undefined;
        });
        try {
            const output = await withTimeout(
                (adb as AdbWithService).createSocketAndWait("unroot:"),
                15000,
                "adb unroot",
            );
            runInAction(() => {
                this.level = "none";
                this.remountState = "readonly";
                this.lastMessage = /restarting adbd as non-root/i.test(output)
                    ? "已切换回普通权限，adbd 已重启 —— 请点击「重新连接」"
                    : output.trim() || "已切换回普通权限";
            });
            return true;
        } catch (e: unknown) {
            runInAction(() => {
                this.error = e instanceof Error ? e.message : String(e);
            });
            return false;
        } finally {
            runInAction(() => {
                this.operating = false;
            });
        }
    }

    /** adb remount —— 需 root 成功之后 */
    async doRemount(adb: Adb) {
        runInAction(() => {
            this.operating = true;
            this.error = undefined;
        });
        try {
            const output = await withTimeout(
                (adb as AdbWithService).createSocketAndWait("remount:"),
                20000,
                "adb remount",
            );
            const ok = /remount succeeded|succeeded/i.test(output);
            runInAction(() => {
                this.lastMessage = output.trim();
                this.remountState = ok ? "writable" : "readonly";
                if (!ok) this.error = output.trim() || "remount 失败";
            });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            runInAction(() => {
                this.error = message;
                this.remountState = "readonly";
            });
        } finally {
            runInAction(() => {
                this.operating = false;
            });
        }
    }

    /** disable-verity（Android 10+ 分区可写前置步骤，通常需重启生效） */
    async doDisableVerity(adb: Adb) {
        runInAction(() => {
            this.operating = true;
            this.error = undefined;
        });
        try {
            const text = (
                await withTimeout(
                    shell(adb, "disable-verity"),
                    15000,
                    "disable-verity",
                )
            ).trim();
            runInAction(() => {
                this.verityDisabled = true;
                this.lastMessage = text || "disable-verity 已执行，请重启设备";
            });
        } catch (e: unknown) {
            runInAction(() => {
                this.error = e instanceof Error ? e.message : String(e);
            });
        } finally {
            runInAction(() => {
                this.operating = false;
            });
        }
    }

    /** 探测分区挂载状态 */
    async detectRemount(adb: Adb) {
        try {
            const out = await withTimeout(shell(adb, "mount"), 6000, "mount");
            const lines = out.split("\n");
            const line =
                lines.find((l) => /\s\/\s/.test(l)) ??
                lines.find((l) => /\s\/system\s/.test(l));
            if (line) {
                const writable = /\brw[,\s)]/.test(line);
                runInAction(() => {
                    this.remountState = writable ? "writable" : "readonly";
                });
            } else {
                runInAction(() => {
                    this.remountState = "unknown";
                });
            }
        } catch {
            runInAction(() => {
                this.remountState = "unknown";
            });
        }
    }
}

export const privilege = new PrivilegeStore();

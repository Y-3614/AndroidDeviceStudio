import { Adb, AdbDaemonTransport, ADB_DEFAULT_AUTHENTICATORS } from "@yume-chan/adb";
import type { AdbDaemonDevice } from "@yume-chan/adb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import {
    AdbDaemonWebUsbDeviceManager,
    type AdbDaemonWebUsbDevice,
} from "@yume-chan/adb-daemon-webusb";
import { makeAutoObservable, runInAction } from "mobx";
import { privilege } from "./privilege";

export type ConnectionStatus =
    | "disconnected"
    | "connecting"
    | "authenticating"
    | "connected";

/**
 * 把 WebUSB / ADB 的英文报错映射成可读中文，并给出处置建议。
 *
 * 最常见的坑：设备被本机的 adb server（或其他程序）占用，
 * Chrome 会抛 "The device is already in use" / "Access denied"，
 * 解决办法是在本地命令行执行 `adb kill-server` 后重试。
 */
export function localizeConnectionError(message: string): string {
    const m = message.toLowerCase();

    if (/already in use|already open|in use by another|being used|resource busy/.test(m)) {
        return [
            "该 USB 设备已被占用，通常是本机的 adb server 抢先占用了设备。",
            "请在本机命令行（终端 / CMD / PowerShell）执行：",
            "    adb kill-server",
            "然后回到本页面重新点击「连接」。",
        ].join("\n");
    }
    if (/access denied|permission denied|not permitted|securityerror/.test(m)) {
        return [
            "访问被拒绝，可能是设备未授权或已被其他程序独占。",
            "请先在本机命令行执行 `adb kill-server`，然后在设备上确认 USB 调试授权，再重试。",
        ].join("\n");
    }
    if (/no device selected|user cancelled|no device/.test(m)) {
        return "没有选择设备（授权框被取消）。请点击「添加设备」并重新选择。";
    }
    if (/timeout|timed out/.test(m)) {
        return [
            "连接超时。请检查：",
            "① 设备已开启 USB 调试；② 换一根支持数据传输的线；③ 本机命令行执行 `adb kill-server` 后重试。",
        ].join("\n");
    }
    if (/networkerror|failed to fetch|disconnected/.test(m)) {
        return "连接中断（设备可能已重启 adbd 或断开）。请重新点击「连接」。";
    }
    if (/webusb/.test(m)) {
        return "当前浏览器不支持 WebUSB，请使用最新版 Chrome 或 Edge。";
    }
    return message;
}

/** 凭据存储单例：密钥持久化在 localStorage，避免每次都弹出授权 */
const credentialStore = new AdbWebCredentialStore("adb-studio");

class ConnectionStore {
    status: ConnectionStatus = "disconnected";
    adb: Adb | undefined = undefined;
    /** 已通过浏览器授权的设备列表 */
    devices: AdbDaemonDevice[] = [];
    selectedSerial: string | undefined = undefined;
    error: string | undefined = undefined;
    webUsbSupported = true;

    constructor() {
        makeAutoObservable(this, {
            adb: false,
        });
    }

    get isConnected() {
        return this.status === "connected" && !!this.adb;
    }

    get selectedDeviceName(): string | undefined {
        return this.devices.find((d) => d.serial === this.selectedSerial)?.name;
    }

    checkSupport() {
        const supported = !!AdbDaemonWebUsbDeviceManager.BROWSER;
        runInAction(() => {
            this.webUsbSupported = supported;
        });
        return supported;
    }

    async refreshDevices() {
        const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
        if (!manager) return [];
        const devices = await manager.getDevices();
        runInAction(() => {
            this.devices = devices;
            if (devices.length && !this.selectedSerial) {
                this.selectedSerial = devices[0]!.serial;
            }
            if (
                this.selectedSerial &&
                !devices.some((d) => d.serial === this.selectedSerial)
            ) {
                this.selectedSerial = devices[0]?.serial;
            }
        });
        return devices;
    }

    /** 弹出 WebUSB 授权框，请求用户选择设备 */
    async requestDevice() {
        const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
        if (!manager) throw new Error("当前浏览器不支持 WebUSB");
        const device = await manager.requestDevice();
        if (device) {
            runInAction(() => {
                this.selectedSerial = device.serial;
            });
        }
        await this.refreshDevices();
        return device;
    }

    setSelected(serial: string | undefined) {
        this.selectedSerial = serial;
    }

    /** 连接并完成 ADB 认证握手 */
    async connect(): Promise<Adb> {
        const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
        if (!manager) {
            throw new Error("当前浏览器不支持 WebUSB，请使用 Chrome 或 Edge");
        }

        let target = this.devices.find((d) => d.serial === this.selectedSerial);
        if (!target) {
            const list = await this.refreshDevices();
            target =
                list.find((d) => d.serial === this.selectedSerial) ?? list[0];
        }
        if (!target) {
            throw new Error("没有可用设备，请先点「添加」授权一个 USB 设备");
        }

        runInAction(() => {
            this.status = "connecting";
            this.error = undefined;
        });

        try {
            const connection = await (target as AdbDaemonWebUsbDevice).connect();

            runInAction(() => {
                this.status = "authenticating";
            });

            const transport = await AdbDaemonTransport.authenticate({
                serial: target.serial,
                connection,
                credentialStore,
                authenticators: ADB_DEFAULT_AUTHENTICATORS,
            });

            const adb = new Adb(transport);

            runInAction(() => {
                this.adb = adb;
                this.status = "connected";
            });

            // 监听连接断开（例如 adbd 重启、拔线），及时更新界面状态
            transport.disconnected
                .then(() => {
                    runInAction(() => {
                        if (this.adb === adb) {
                            this.status = "disconnected";
                            this.adb = undefined;
                            this.error = "连接已断开（设备可能已重启 adbd 或拔出）";
                        }
                    });
                })
                .catch(() => {
                    /* ignore */
                });
            // 连接后只做「被动探测」权限级别，绝不自动执行 adb root
            privilege.probe(adb).catch(() => {
                /* 探测失败不影响连接 */
            });

            return adb;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            runInAction(() => {
                this.status = "disconnected";
                this.adb = undefined;
                this.error = localizeConnectionError(message);
            });
            throw e;
        }
    }

    async disconnect() {
        const adb = this.adb;
        runInAction(() => {
            this.adb = undefined;
            this.status = "disconnected";
        });
        privilege.reset();
        if (adb) {
            try {
                await adb.close();
            } catch {
                /* ignore */
            }
        }
    }
}

export const connection = new ConnectionStore();

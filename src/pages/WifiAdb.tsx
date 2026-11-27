import {
    DefaultButton,
    MessageBar,
    MessageBarType,
    PrimaryButton,
    Separator,
    Stack,
    TextField,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";
import { shell } from "../state/privilege";

/** 一条可复制的命令 */
const cmdStyle = {
    background: "#1e1e1e",
    color: "#d4d4d4",
    padding: "8px 10px",
    borderRadius: 4,
    fontSize: 12.5,
    margin: 0,
    fontFamily: "Consolas, Menlo, monospace",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
};

export const WifiAdbPage = observer(function WifiAdbPage() {
    const t = i18n.t;
    const zh = i18n.lang === "zh";
    const adb = connection.adb;
    const [busy, setBusy] = useState<string | undefined>();
    const [message, setMessage] = useState<string | undefined>();
    const [error, setError] = useState<string | undefined>();
    const [wifiPort, setWifiPort] = useState("5555");
    const [wifiIp, setWifiIp] = useState<string | undefined>();
    const [tcpipDone, setTcpipDone] = useState(false);

    const run = async (label: string, fn: () => Promise<unknown>) => {
        setBusy(label);
        setError(undefined);
        setMessage(undefined);
        try {
            await fn();
            setMessage(`${label} ✓`);
        } catch (e) {
            setError(`${label}：${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setBusy(undefined);
        }
    };

    /**
     * 读取设备 WiFi IP。
     *
     * 依次尝试多种命令，因为不同 Android 版本 / 厂商 ROM 的可用命令不同：
     *  - `ip route`          最通用，取 src 后面的地址
     *  - `ip addr show wlan0` 直接解析 inet 行
     *  - `getprop`           读 DHCP 属性（部分 ROM 有效）
     *  - `ifconfig wlan0`    老设备
     */
    const readIp = async () => {
        if (!adb) return;
        const attempts: { cmd: string; parse: (s: string) => string | undefined }[] = [
            {
                cmd: "ip route",
                parse: (s) => s.match(/src\s+(\d+\.\d+\.\d+\.\d+)/)?.[1],
            },
            {
                cmd: "ip addr show wlan0",
                parse: (s) =>
                    s.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/)?.[1],
            },
            {
                cmd: "getprop | grep -i dhcp",
                parse: (s) =>
                    s.match(/ipaddress\]?:\s*\[?(\d+\.\d+\.\d+\.\d+)/i)?.[1],
            },
            {
                cmd: "ifconfig wlan0",
                parse: (s) => s.match(/inet addr:(\d+\.\d+\.\d+\.\d+)/)?.[1],
            },
        ];
        let found: string | undefined;
        for (const a of attempts) {
            try {
                const out = await shell(adb, a.cmd);
                const ip = a.parse(out);
                if (ip && ip !== "127.0.0.1") {
                    found = ip;
                    break;
                }
            } catch {
                /* 换下一条命令 */
            }
        }
        if (!found) {
            throw new Error(
                zh
                    ? "未能读取到 WiFi IP。请确认设备已连接 WiFi（不是仅插网线）。"
                    : "Could not read the WiFi IP. Make sure the device is joined to a WiFi network.",
            );
        }
        setWifiIp(found);
    };

    const deviceAddr = wifiIp ? `${wifiIp}:${wifiPort}` : "";

    const copy = (text: string) => {
        void navigator.clipboard?.writeText(text);
    };

    if (!adb) {
        return (
            <Stack
                styles={{
                    root: {
                        padding: 16,
                        height: "100%",
                        minHeight: 0,
                        overflowY: "auto",
                        boxSizing: "border-box",
                    },
                }}
            >
                <MessageBar>{t.waiting}</MessageBar>
            </Stack>
        );
    }

    return (
        <Stack
            styles={{
                root: {
                    padding: 16,
                    gap: 12,
                    height: "100%",
                    minHeight: 0,
                    boxSizing: "border-box",
                    overflowY: "auto",
                    overflowX: "hidden",
                },
            }}
        >
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
                {t.wifiAdbTitle}
            </h2>

            {message && (
                <MessageBar messageBarType={MessageBarType.success}>
                    {message}
                </MessageBar>
            )}
            {error && (
                <MessageBar messageBarType={MessageBarType.error} isMultiline>
                    {error}
                </MessageBar>
            )}

            <MessageBar messageBarType={MessageBarType.info} isMultiline>
                {t.wifiAdbHint}
            </MessageBar>

            <Separator />

            {/* 第 1 步：先用 USB 连上，并读取 IP（必须在开 tcpip 之前） */}
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                {t.wifiStep1}
            </h3>
            <p style={{ margin: 0, color: "#605e5c", fontSize: 12.5 }}>
                {zh
                    ? "保持 USB 连接。先读 IP —— 因为下一步「开启 TCPIP」会让设备端的 adbd 重启，USB 会立刻断开。"
                    : "Keep USB connected. Read the IP first — the next step (Enable TCPIP) restarts adbd and the USB link will drop immediately."}
            </p>
            <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="end" wrap>
                <DefaultButton
                    text={t.readIp}
                    iconProps={{ iconName: "Globe" }}
                    disabled={!!busy}
                    onClick={() =>
                        run(t.readIp, async () => {
                            await readIp();
                        })
                    }
                />
                {wifiIp && (
                    <TextField
                        value={wifiIp}
                        readOnly
                        styles={{ root: { width: 170 } }}
                    />
                )}
            </Stack>

            <Separator />

            {/* 第 2 步：开启 TCPIP */}
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                {t.wifiStep2}
            </h3>
            <p style={{ margin: 0, color: "#605e5c", fontSize: 12.5 }}>
                {zh
                    ? "执行后设备会开始监听该端口，adbd 重启、USB 断开属正常现象。"
                    : "The device starts listening on this port. adbd restarts and USB drops — that is expected."}
            </p>
            <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="end" wrap>
                <TextField
                    label={t.wifiPort}
                    value={wifiPort}
                    onChange={(_, v) => setWifiPort(v ?? "5555")}
                    styles={{ root: { width: 130 } }}
                />
                <PrimaryButton
                    text={t.enableTcpip}
                    iconProps={{ iconName: "NetworkTower" }}
                    disabled={!!busy}
                    onClick={() =>
                        run(t.enableTcpip, async () => {
                            await adb.createSocketAndWait(`tcpip:${wifiPort}`);
                            setTcpipDone(true);
                        })
                    }
                />
            </Stack>

            {tcpipDone && (
                <MessageBar messageBarType={MessageBarType.warning} isMultiline>
                    {zh
                        ? `已切换为 TCP 模式（端口 ${wifiPort}），USB 连接现在已断开。接下来请在本机命令行执行第 3 步的连接命令。`
                        : `Switched to TCP mode (port ${wifiPort}); the USB link is now down. Next, run the connect command from Step 3 on your computer.`}
                </MessageBar>
            )}

            {deviceAddr && (
                <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="center">
                    <TextField
                        label={t.deviceIp}
                        value={deviceAddr}
                        readOnly
                        styles={{ root: { maxWidth: 300 } }}
                    />
                    <DefaultButton
                        text={t.copy}
                        iconProps={{ iconName: "Copy" }}
                        onClick={() => copy(deviceAddr)}
                        styles={{ root: { marginTop: 22 } }}
                    />
                </Stack>
            )}

            <Separator />

            {/* 第 3 步：本机命令行连接（含详细教程） */}
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                {t.wifiStep3}
            </h3>
            <MessageBar messageBarType={MessageBarType.warning} isMultiline>
                {t.wifiConnectHint}
            </MessageBar>

            {/* —— 详细教程 —— */}
            <div
                style={{
                    background: "#faf9f8",
                    border: "1px solid #edebe9",
                    borderRadius: 6,
                    padding: 14,
                    lineHeight: 1.8,
                    fontSize: 13,
                    color: "#323130",
                }}
            >
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    {zh
                        ? "详细教程：从零开始用 WiFi 连上设备"
                        : "Step-by-step: connect over WiFi from scratch"}
                </div>

                {zh ? (
                    <>
                        <p style={{ margin: "0 0 6px" }}>
                            <b>① 准备电脑端 adb 工具。</b>
                            电脑上需要能用 <code>adb</code> 命令。Windows 用户可下载
                            Google 官方 <i>platform-tools</i>，解压后把目录加入 PATH；
                            或者直接在该目录里用「命令提示符 / PowerShell」执行下面的命令。
                        </p>

                        <p style={{ margin: "8px 0 4px" }}>
                            <b>② 确认手机与电脑在同一个 WiFi 网段。</b>
                            常见错误就是手机连了 5G 频段、电脑连了 2.4G，或手机走了移动数据。
                            请查手机「设置 → WLAN」里的 IP，应当和电脑的 IP 前三段一致
                            （如都是 <code>192.168.1.x</code>）。
                        </p>

                        <p style={{ margin: "8px 0 4px" }}>
                            <b>③ 在本机命令行执行连接命令</b>（把 IP 换成上面第 1 步读到的地址）：
                        </p>
                        <pre style={cmdStyle}>{`adb connect ${deviceAddr || "<设备IP>:5555"}`}</pre>
                        <Stack
                            horizontal
                            tokens={{ childrenGap: 8 }}
                            styles={{ root: { marginTop: 6 } }}
                        >
                            <DefaultButton
                                text={t.copy}
                                iconProps={{ iconName: "Copy" }}
                                onClick={() =>
                                    copy(`adb connect ${deviceAddr || "<IP>:5555"}`)
                                }
                                styles={{ root: { minWidth: 0 } }}
                            />
                        </Stack>
                        <p style={{ margin: "8px 0 4px" }}>
                            成功时会提示 <code>connected to
                            {" "}{deviceAddr || "IP:5555"}</code>。可用下面命令确认设备已在列表里：
                        </p>
                        <pre style={cmdStyle}>{`adb devices`}</pre>

                        <p style={{ margin: "8px 0 4px" }}>
                            <b>④ 想恢复 USB 连接？</b> 执行：
                        </p>
                        <pre style={cmdStyle}>{`adb usb`}</pre>

                        <p style={{ margin: "10px 0 6px", fontWeight: 600 }}>
                            常见问题
                        </p>
                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                            <li>
                                <b>提示 unable to connect / 连接被拒绝：</b>
                                多为 IP 写错、端口不对，或设备不在同一网段。
                                确认第 1 步读到的是 <i>WLAN</i> 的地址，不是热点或移动网络的地址。
                            </li>
                            <li>
                                <b>提示 device offline：</b>
                                先 <code>adb kill-server</code>，再重新 <code>adb connect</code>。
                                必要时在手机上撤销 USB 调试授权后重新授权。
                            </li>
                            <li>
                                <b>手机重启或用数据线插过电脑后失效：</b>
                                WiFi ADB 通常会失效，需要重新用 USB 走一遍第 1、2 步。
                            </li>
                            <li>
                                <b>为什么不能在这个网页里直接连？</b>
                                浏览器出于安全策略禁止网页建立任意 TCP 连接，
                                WebUSB 只支持 USB 通道，所以 WiFi 的最后一步必须在你的电脑上完成。
                            </li>
                        </ul>
                    </>
                ) : (
                    <>
                        <p style={{ margin: "0 0 6px" }}>
                            <b>① Install adb on your computer.</b> You need the
                            <code> adb</code> command locally. On Windows, download
                            Google's <i>platform-tools</i>, extract it and add the
                            folder to PATH, or run the commands below from a
                            terminal inside that folder.
                        </p>
                        <p style={{ margin: "8px 0 4px" }}>
                            <b>② Make sure phone and computer share the same WiFi.</b>
                            A very common mistake: the phone is on 5GHz while the
                            computer is on 2.4GHz, or the phone fell back to mobile
                            data. The first three octets of both IPs should match
                            (e.g. both <code>192.168.1.x</code>).
                        </p>
                        <p style={{ margin: "8px 0 4px" }}>
                            <b>③ Run the connect command</b> (replace the IP with
                            the one read in Step 1):
                        </p>
                        <pre style={cmdStyle}>{`adb connect ${deviceAddr || "<IP>:5555"}`}</pre>
                        <Stack
                            horizontal
                            tokens={{ childrenGap: 8 }}
                            styles={{ root: { marginTop: 6 } }}
                        >
                            <DefaultButton
                                text={t.copy}
                                iconProps={{ iconName: "Copy" }}
                                onClick={() =>
                                    copy(`adb connect ${deviceAddr || "<IP>:5555"}`)
                                }
                                styles={{ root: { minWidth: 0 } }}
                            />
                        </Stack>
                        <p style={{ margin: "8px 0 4px" }}>
                            On success you will see{" "}
                            <code>connected to {deviceAddr || "IP:5555"}</code>.
                            Verify with:
                        </p>
                        <pre style={cmdStyle}>{`adb devices`}</pre>
                        <p style={{ margin: "8px 0 4px" }}>
                            <b>④ To switch back to USB:</b>
                        </p>
                        <pre style={cmdStyle}>{`adb usb`}</pre>
                        <p style={{ margin: "10px 0 6px", fontWeight: 600 }}>
                            Troubleshooting
                        </p>
                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                            <li>
                                <b>unable to connect / refused:</b> wrong IP or
                                port, or different network. Make sure the IP is the
                                one from <i>WLAN</i>, not a hotspot or mobile data.
                            </li>
                            <li>
                                <b>device offline:</b> run <code>adb kill-server</code>,
                                then <code>adb connect</code> again; re-authorize USB
                                debugging if needed.
                            </li>
                            <li>
                                <b>Stops working after reboot or plugging USB:</b>
                                WiFi ADB usually resets — repeat Steps 1 and 2 over USB.
                            </li>
                            <li>
                                <b>Why can't the webpage connect directly?</b>
                                Browsers forbid opening arbitrary TCP connections;
                                WebUSB only covers the USB path, so the final WiFi
                                step must run on your computer.
                            </li>
                        </ul>
                    </>
                )}
            </div>
        </Stack>
    );
});

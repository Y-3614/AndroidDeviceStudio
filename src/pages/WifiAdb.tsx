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

export const WifiAdbPage = observer(function WifiAdbPage() {
    const t = i18n.t;
    const adb = connection.adb;
    const [busy, setBusy] = useState<string | undefined>();
    const [message, setMessage] = useState<string | undefined>();
    const [error, setError] = useState<string | undefined>();
    const [wifiPort, setWifiPort] = useState("5555");
    const [wifiIp, setWifiIp] = useState<string | undefined>();

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

    /** 读取设备 WiFi IP */
    const readIp = async () => {
        if (!adb) return;
        const out = await shell(adb, "ip route");
        // 形如 "192.168.1.5 dev wlan0 ..."
        const m = out.match(/src\s+(\d+\.\d+\.\d+\.\d+)/);
        setWifiIp(m?.[1]);
    };

    if (!adb) {
        return (
            <Stack styles={{ root: { padding: 16 } }}>
                <MessageBar>{t.waiting}</MessageBar>
            </Stack>
        );
    }

    return (
        <Stack styles={{ root: { padding: 16, gap: 12, overflow: "auto" } }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
                {t.wifiAdbTitle}
            </h2>

            {message && (
                <MessageBar messageBarType={MessageBarType.success}>{message}</MessageBar>
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

            {/* 第 1 步：开启 TCPIP */}
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                {t.wifiStep1}
            </h3>
            <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="end" wrap>
                <TextField
                    label={t.wifiPort}
                    value={wifiPort}
                    onChange={(_, v) => setWifiPort(v ?? "5555")}
                    styles={{ root: { width: 120 } }}
                />
                <PrimaryButton
                    text={t.enableTcpip}
                    iconProps={{ iconName: "NetworkTower" }}
                    disabled={!!busy}
                    onClick={() =>
                        run(t.enableTcpip, () =>
                            adb.createSocketAndWait(`tcpip:${wifiPort}`),
                        )
                    }
                />
            </Stack>

            <Separator />

            {/* 第 2 步：读取 IP */}
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                {t.wifiStep2}
            </h3>
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
            </Stack>

            {wifiIp && (
                <TextField
                    label={t.deviceIp}
                    value={`${wifiIp}:${wifiPort}`}
                    readOnly
                    styles={{ root: { maxWidth: 280 } }}
                    onRenderSuffix={() => (
                        <DefaultButton
                            text={t.copy}
                            onClick={() =>
                                navigator.clipboard.writeText(
                                    `${wifiIp}:${wifiPort}`,
                                )
                            }
                            styles={{ root: { minWidth: 0 } }}
                        />
                    )}
                />
            )}

            <Separator />

            {/* 第 3 步：本机连接 */}
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                {t.wifiStep3}
            </h3>
            <MessageBar messageBarType={MessageBarType.warning} isMultiline>
                {t.wifiConnectHint}
            </MessageBar>
        </Stack>
    );
});

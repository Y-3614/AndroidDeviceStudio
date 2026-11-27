import {
    DefaultButton,
    Dropdown,
    Icon,
    MessageBar,
    MessageBarType,
    PrimaryButton,
    Spinner,
    Stack,
    StackItem,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";

const dropdownStyles = {
    root: { width: "100%" },
    dropdown: { width: "100%" },
};

export const Connect = observer(function Connect() {
    const t = i18n.t;
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const supported = connection.checkSupport();
        if (supported) {
            connection.refreshDevices();
        }
    }, []);

    if (!connection.webUsbSupported) {
        return (
            <div style={{ padding: 8 }}>
                <MessageBar messageBarType={MessageBarType.warning}>
                    {t.webusbUnsupported}
                </MessageBar>
            </div>
        );
    }

    const options = connection.devices.map((d) => ({
        key: d.serial,
        // 显示 serial（型号名放括号里），与官方 demo 一致
        text: d.name ? `${d.serial} (${d.name})` : d.serial,
    }));

    const handleConnect = async () => {
        setBusy(true);
        try {
            await connection.connect();
        } catch {
            /* 错误已在 store 中记录 */
        } finally {
            setBusy(false);
        }
    };

    const handleAdd = async () => {
        setBusy(true);
        try {
            await connection.requestDevice();
        } catch {
            /* ignore */
        } finally {
            setBusy(false);
        }
    };

    const statusText = {
        disconnected: t.ready,
        connecting: t.connecting,
        authenticating: t.authenticating,
        connected: t.connected,
    }[connection.status];

    return (
        <Stack
            styles={{
                root: { padding: "0 0 8px 8px", gap: 8, flexShrink: 0 },
            }}
        >
            <Dropdown
                label={t.availableDevices}
                placeholder={t.noAvailableDevices}
                styles={dropdownStyles}
                disabled={connection.isConnected || busy}
                options={options}
                selectedKey={connection.selectedSerial}
                onChange={(_, option) =>
                    connection.setSelected(option?.key as string | undefined)
                }
                onFocus={() => connection.refreshDevices()}
            />

            <Stack horizontal tokens={{ childrenGap: 8 }}>
                {connection.isConnected ? (
                    <DefaultButton
                        iconProps={{ iconName: "PlugDisconnected" }}
                        text={t.disconnect}
                        onClick={() => connection.disconnect()}
                        styles={{ root: { flexGrow: 1 } }}
                    />
                ) : (
                    <PrimaryButton
                        iconProps={{ iconName: "PlugConnected" }}
                        text={t.connect}
                        disabled={busy || connection.devices.length === 0}
                        onClick={handleConnect}
                        styles={{ root: { flexGrow: 1, minWidth: 80 } }}
                    />
                )}

                <PrimaryButton
                    iconProps={{ iconName: "Add" }}
                    text={t.add}
                    disabled={busy}
                    onClick={handleAdd}
                    styles={{ root: { minWidth: 80 } }}
                />
            </Stack>

            {busy && (
                <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
                    <Spinner size={1} />
                    <span style={{ fontSize: 12, color: "#605e5c" }}>
                        {statusText}
                    </span>
                </Stack>
            )}

            {connection.error && (
                <MessageBar
                    messageBarType={MessageBarType.error}
                    isMultiline
                    onDismiss={() => (connection.error = undefined)}
                >
                    {connection.error}
                </MessageBar>
            )}
        </Stack>
    );
});

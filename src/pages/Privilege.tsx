import {
    DefaultButton,
    MessageBar,
    MessageBarType,
    PrimaryButton,
    Separator,
    Spinner,
    Stack,
    Toggle,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";
import { privilege } from "../state/privilege";

/** 重新连接（adb root / unroot 后 adbd 重启，必须重连） */
async function reconnect() {
    try {
        await connection.disconnect();
    } catch {
        /* ignore */
    }
    // adbd 重启需要一点时间，稍等再连，避免握手失败
    await new Promise((r) => setTimeout(r, 1500));
    try {
        await connection.connect();
    } catch {
        /* 错误已记录在 store */
    }
}

export const PrivilegePage = observer(function PrivilegePage() {
    const t = i18n.t;
    const adb = connection.adb;

    /** 点 adb root：成功后自动重连，让 root 权限立刻生效 */
    const onRoot = async () => {
        if (!adb) return;
        const needReconnect = await privilege.doRoot(adb);
        if (needReconnect) {
            await reconnect();
            // 重连后重新探测权限级别
            if (connection.adb) {
                await privilege.probe(connection.adb);
            }
        }
    };

    const levelText = {
        unknown: t.privUnknown,
        none: t.privNone,
        su: t.privSu,
        adbRoot: t.privAdbRoot,
    }[privilege.level];

    const levelColor =
        privilege.level === "adbRoot"
            ? "#107c10"
            : privilege.level === "su"
              ? "#0078d4"
              : privilege.level === "none"
                ? "#a19f9d"
                : "#605e5c";

    const mountText = {
        unknown: t.mountUnknown,
        readonly: t.mountReadonly,
        writable: t.mountWritable,
        unsupported: t.mountUnknown,
    }[privilege.remountState];

    const canRemount = privilege.level === "adbRoot" || privilege.level === "su";

    return (
        <Stack styles={{ root: { padding: 16, gap: 12, overflow: "auto" } }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
                {t.privilegeTitle}
            </h2>

            {!adb && (
                <Stack tokens={{ childrenGap: 8 }}>
                    <MessageBar messageBarType={MessageBarType.warning}>
                        {connection.error ? connection.error : t.waiting}
                    </MessageBar>
                    {privilege.lastMessage && (
                        <MessageBar messageBarType={MessageBarType.info}>
                            {privilege.lastMessage}
                        </MessageBar>
                    )}
                    <DefaultButton
                        iconProps={{ iconName: "Refresh" }}
                        text={t.reconnect}
                        onClick={reconnect}
                    />
                </Stack>
            )}

            {adb && (
                <>
                    <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
                        <span style={{ fontWeight: 600 }}>{t.currentStatus}：</span>
                        <span style={{ color: levelColor, fontWeight: 600 }}>
                            {levelText}
                        </span>
                        {privilege.operating && <Spinner size={1} />}
                    </Stack>

                    {privilege.lastMessage && (
                        <MessageBar>{privilege.lastMessage}</MessageBar>
                    )}
                    {privilege.error && (
                        <MessageBar messageBarType={MessageBarType.warning}>
                            {privilege.error}
                        </MessageBar>
                    )}

                    <Separator />

                    <Stack horizontal tokens={{ childrenGap: 8 }} wrap>
                        <PrimaryButton
                            text={t.adbRoot}
                            iconProps={{ iconName: "Shield" }}
                            disabled={privilege.operating}
                            onClick={onRoot}
                        />
                        <DefaultButton
                            text={t.adbUnroot}
                            iconProps={{ iconName: "Shield" }}
                            disabled={privilege.operating}
                            onClick={async () => {
                                const needReconnect =
                                    await privilege.doUnroot(adb);
                                if (needReconnect) await reconnect();
                            }}
                        />
                        <DefaultButton
                            iconProps={{ iconName: "Refresh" }}
                            text={t.reconnect}
                            onClick={reconnect}
                        />
                        <DefaultButton
                            text={t.reprobe}
                            iconProps={{ iconName: "Search" }}
                            disabled={privilege.probing}
                            onClick={() => privilege.probe(adb)}
                        />
                    </Stack>

                    <Stack horizontal tokens={{ childrenGap: 8 }} wrap>
                        <DefaultButton
                            text={t.adbRemount}
                            iconProps={{ iconName: "HardDrive" }}
                            disabled={privilege.operating || !canRemount}
                            title={canRemount ? undefined : t.rootHint}
                            onClick={() => privilege.doRemount(adb)}
                        />
                        <DefaultButton
                            text={t.disableVerity}
                            iconProps={{ iconName: "Lock" }}
                            disabled={privilege.operating || !canRemount}
                            title={canRemount ? undefined : t.rootHint}
                            onClick={() => privilege.doDisableVerity(adb)}
                        />
                    </Stack>

                    <MessageBar messageBarType={MessageBarType.info} isMultiline>
                        {t.rootRestartHint}
                    </MessageBar>

                    <Stack horizontal tokens={{ childrenGap: 8 }}>
                        <span>{t.mountState}：</span>
                        <span style={{ fontWeight: 600 }}>{mountText}</span>
                    </Stack>

                    <MessageBar messageBarType={MessageBarType.info}>
                        {t.verityHint}
                    </MessageBar>

                    <Separator />

                    <Toggle
                        label={t.forceDisable}
                        onText="On"
                        offText="Off"
                        checked={privilege.manuallyDisabled}
                        onChange={(_, checked) =>
                            privilege.setManuallyDisabled(!!checked)
                        }
                    />
                    <span style={{ fontSize: 12, color: "#605e5c" }}>
                        {t.forceDisableHint}
                    </span>
                </>
            )}
        </Stack>
    );
});

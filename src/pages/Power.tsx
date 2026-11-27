import {
    DefaultButton,
    MessageBar,
    MessageBarType,
    PrimaryButton,
    Separator,
    Stack,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";
import { shell } from "../state/privilege";

export const PowerPage = observer(function PowerPage() {
    const t = i18n.t;
    const adb = connection.adb;
    const [busy, setBusy] = useState<string | undefined>();
    const [message, setMessage] = useState<string | undefined>();
    const [error, setError] = useState<string | undefined>();

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

    const sh = (cmd: string) => {
        if (!adb) return Promise.resolve("");
        return shell(adb, cmd);
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
                {t.powerTitle}
            </h2>

            {message && <MessageBar messageBarType={MessageBarType.success}>{message}</MessageBar>}
            {error && (
                <MessageBar messageBarType={MessageBarType.error} isMultiline>
                    {error}
                </MessageBar>
            )}

            {/* 重启 / 关机 */}
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                {t.powerGroupReboot}
            </h3>
            <Stack horizontal tokens={{ childrenGap: 8 }} wrap>
                <PrimaryButton
                    text={t.reboot}
                    iconProps={{ iconName: "Refresh" }}
                    disabled={!!busy}
                    onClick={() => run(t.reboot, () => adb.power.reboot())}
                />
                <DefaultButton
                    text={t.rebootRecovery}
                    iconProps={{ iconName: "Repair" }}
                    disabled={!!busy}
                    onClick={() => run(t.rebootRecovery, () => adb.power.recovery())}
                />
                <DefaultButton
                    text={t.rebootBootloader}
                    iconProps={{ iconName: "DeveloperTools" }}
                    disabled={!!busy}
                    onClick={() =>
                        run(t.rebootBootloader, () => adb.power.bootloader())
                    }
                />
                <DefaultButton
                    text={t.powerOff}
                    iconProps={{ iconName: "PowerButton" }}
                    disabled={!!busy}
                    onClick={() => run(t.powerOff, () => sh("reboot -p"))}
                />
            </Stack>

            <Separator />

            {/* 屏幕控制 */}
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                {t.powerGroupScreen}
            </h3>
            <Stack horizontal tokens={{ childrenGap: 8 }} wrap>
                <DefaultButton
                    text={t.screenOff}
                    iconProps={{ iconName: "CircleRing" }}
                    disabled={!!busy}
                    onClick={() => run(t.screenOff, () => sh("input keyevent 223"))}
                />
                <DefaultButton
                    text={t.screenOn}
                    iconProps={{ iconName: "Lightbulb" }}
                    disabled={!!busy}
                    onClick={() => run(t.screenOn, () => sh("input keyevent 224"))}
                />
                <DefaultButton
                    text={t.lockScreen}
                    iconProps={{ iconName: "Lock" }}
                    disabled={!!busy}
                    onClick={() => run(t.lockScreen, () => sh("input keyevent 26"))}
                />
                <DefaultButton
                    text={t.powerDialog}
                    iconProps={{ iconName: "More" }}
                    disabled={!!busy}
                    onClick={() =>
                        run(t.powerDialog, () =>
                            sh("input keyevent --longpress 26"),
                        )
                    }
                />
            </Stack>

            <MessageBar messageBarType={MessageBarType.info} isMultiline>
                {t.powerRebootHint}
            </MessageBar>
        </Stack>
    );
});

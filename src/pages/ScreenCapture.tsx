import { DefaultButton, MessageBar, Stack } from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { connection } from "../state/connection";
import { framebufferToPng } from "../state/framebuffer";
import { i18n } from "../state/i18n";
import { saveBlob } from "../state/file-stream";

export const ScreenCapturePage = observer(function ScreenCapturePage() {
    const t = i18n.t;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const [preview, setPreview] = useState<string | undefined>();

    const capture = async () => {
        const adb = connection.adb;
        if (!adb) return;
        setBusy(true);
        setError(undefined);
        try {
            const fb = await adb.framebuffer();
            const blob = await framebufferToPng(fb);
            setPreview(URL.createObjectURL(blob));
            saveBlob(blob, `screenshot-${Date.now()}.png`);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(/forbidden/i.test(msg) ? t.screenshotForbidden : msg);
        } finally {
            setBusy(false);
        }
    };

    if (!connection.isConnected) {
        return (
            <Stack styles={{ root: { padding: 16 } }}>
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
            <DefaultButton
                text={t.captureScreenshot}
                iconProps={{ iconName: "Camera" }}
                disabled={busy}
                onClick={capture}
            />
            {error && <MessageBar messageBarType={1 /* error */}>{error}</MessageBar>}
            {preview && (
                <img
                    src={preview}
                    alt="screenshot"
                    style={{ maxWidth: "100%", border: "1px solid #edebe9" }}
                />
            )}
        </Stack>
    );
});

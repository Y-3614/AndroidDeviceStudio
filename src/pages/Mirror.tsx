import {
    DefaultButton,
    MessageBar,
    MessageBarType,
    Spinner,
    SpinnerSize,
    Stack,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { connection } from "../state/connection";
import { drawFramebuffer } from "../state/framebuffer";
import { i18n } from "../state/i18n";
import { saveBlob } from "../state/file-stream";

/**
 * 投屏页面（基于 framebuffer 连续抓帧）。
 *
 * 说明：真正高帧率的 scrcpy 镜像需要推送 scrcpy-server 到设备并用 WebCodecs 解码，
 * 对设备和浏览器要求较高。这里采用**通用可用**的方案：循环调用 adb.framebuffer()
 * 抓帧渲染到 canvas（已修正 RGBA 颜色解析），任何设备都能用；
 * 同时提供录制（把画面编码为 WebM）与常用导航/电源键。
 */
export const MirrorPage = observer(function MirrorPage() {
    const t = i18n.t;
    const [running, setRunning] = useState(false);
    const [recording, setRecording] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const [fps, setFps] = useState(0);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const stopRef = useRef<(() => void) | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);

    // 离开页面时停止
    useEffect(() => {
        return () => stopRef.current?.();
    }, []);

    const startMirror = async () => {
        const adb = connection.adb;
        const canvas = canvasRef.current;
        if (!adb || !canvas || running) return;
        setRunning(true);
        setError(undefined);
        let frames = 0;
        let last = Date.now();
        let stop = false;
        stopRef.current = () => {
            stop = true;
        };

        const loop = async () => {
            while (!stop && connection.isConnected) {
                try {
                    const fb = await adb.framebuffer();
                    drawFramebuffer(canvas, fb);
                    frames++;
                    const now = Date.now();
                    if (now - last >= 1000) {
                        setFps(Math.round((frames * 1000) / (now - last)));
                        frames = 0;
                        last = now;
                    }
                } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                    break;
                }
                // 抓帧间隔，避免把 USB 带宽打满
                await new Promise((r) => setTimeout(r, 60));
            }
            setRunning(false);
        };
        void loop();
    };

    const stopMirror = () => {
        stopRef.current?.();
        setRunning(false);
    };

    const toggleRecord = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (!recording) {
            try {
                const stream = canvas.captureStream(15);
                const chunks: Blob[] = [];
                const recorder = new MediaRecorder(stream, {
                    mimeType: "video/webm",
                });
                recorder.ondataavailable = (e) => {
                    if (e.data.size) chunks.push(e.data);
                };
                recorder.onstop = () => {
                    saveBlob(
                        new Blob(chunks, { type: "video/webm" }),
                        `record-${Date.now()}.webm`,
                    );
                };
                recorder.start();
                recorderRef.current = recorder;
                setRecording(true);
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            }
        } else {
            recorderRef.current?.stop();
            setRecording(false);
        }
    };

    /** 发送按键 / 导航键 */
    const sendKey = async (key: string) => {
        const adb = connection.adb;
        if (!adb) return;
        try {
            await adb.subprocess.noneProtocol.spawnWaitText([
                "input",
                "keyevent",
                key,
            ]);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    if (!connection.isConnected) {
        return (
            <Stack styles={{ root: { padding: 16 } }}>
                <MessageBar>{t.waiting}</MessageBar>
            </Stack>
        );
    }

    const navButtons: { key: string; label: string; icon: string }[] = [
        { key: "KEYCODE_BACK", label: t.navBack, icon: "Back" },
        { key: "KEYCODE_HOME", label: t.navHome, icon: "Home" },
        { key: "KEYCODE_APP_SWITCH", label: t.navRecents, icon: "Switch" },
        { key: "KEYCODE_VOLUME_UP", label: t.volUp, icon: "Volume3" },
        { key: "KEYCODE_VOLUME_DOWN", label: t.volDown, icon: "Volume0" },
        { key: "KEYCODE_POWER", label: t.powerKey, icon: "PowerButton" },
        { key: "KEYCODE_WAKEUP", label: t.wakeUp, icon: "Lightbulb" },
        { key: "KEYCODE_SLEEP", label: t.sleep, icon: "CircleRing" },
    ];

    return (
        <Stack styles={{ root: { padding: 16, gap: 10, height: "100%" } }}>
            <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="center" wrap>
                {running ? (
                    <DefaultButton
                        text={t.mirrorStop}
                        iconProps={{ iconName: "Stop" }}
                        onClick={stopMirror}
                    />
                ) : (
                    <DefaultButton
                        text={t.mirrorStart}
                        iconProps={{ iconName: "Play" }}
                        onClick={startMirror}
                    />
                )}
                <DefaultButton
                    text={recording ? t.recordStop : t.recordStart}
                    iconProps={{ iconName: "Video" }}
                    onClick={toggleRecord}
                    disabled={!running}
                />
                {running && <Spinner size={SpinnerSize.small} />}
                <span style={{ color: "#605e5c", fontSize: 12 }}>{fps} fps</span>
            </Stack>

            <Stack horizontal tokens={{ childrenGap: 6 }} wrap>
                {navButtons.map((b) => (
                    <DefaultButton
                        key={b.key}
                        text={b.label}
                        iconProps={{ iconName: b.icon }}
                        onClick={() => sendKey(b.key)}
                        styles={{ root: { minWidth: 0 } }}
                    />
                ))}
            </Stack>

            {error && (
                <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>
            )}

            <div
                style={{
                    flexGrow: 1,
                    minHeight: 0,
                    overflow: "auto",
                    background: "#323130",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "flex-start",
                }}
            >
                <canvas ref={canvasRef} style={{ maxWidth: "100%", maxHeight: "100%" }} />
            </div>
        </Stack>
    );
});

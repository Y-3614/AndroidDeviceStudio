import {
    DefaultButton,
    MessageBar,
    MessageBarType,
    Slider,
    Spinner,
    SpinnerSize,
    Stack,
    Toggle,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { connection } from "../state/connection";
import { drawFramebuffer } from "../state/framebuffer";
import { i18n } from "../state/i18n";
import { saveBlob } from "../state/file-stream";
import { shell } from "../state/privilege";

/**
 * 投屏页面（基于 framebuffer 连续抓帧）。
 *
 * 说明：真正高帧率的 scrcpy 镜像需要推送 scrcpy-server 到设备并用 WebCodecs 解码，
 * 对设备和浏览器要求较高。这里采用**通用可用**的方案：循环调用 adb.framebuffer()
 * 抓帧渲染到 canvas（已修正 RGBA 颜色解析），任何设备都能用；
 * 同时提供**触摸操作（点击/滑动/长按）**、录制与常用导航/电源键。
 */
export const MirrorPage = observer(function MirrorPage() {
    const t = i18n.t;
    const [running, setRunning] = useState(false);
    const [recording, setRecording] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const [fps, setFps] = useState(0);
    const [touchEnabled, setTouchEnabled] = useState(true);
    const [intervalMs, setIntervalMs] = useState(60);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const stopRef = useRef<(() => void) | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const intervalRef = useRef(intervalMs);
    intervalRef.current = intervalMs;

    // 离开页面时停止
    useEffect(() => {
        return () => stopRef.current?.();
    }, []);

    /** 把画布上的坐标换算成设备真实坐标（画布可能被 CSS 缩放） */
    const toDevice = (
        e: React.PointerEvent<HTMLCanvasElement>,
    ): { x: number; y: number } | null => {
        const canvas = canvasRef.current;
        if (!canvas || !canvas.width || !canvas.height) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const x = Math.round(
            ((e.clientX - rect.left) / rect.width) * canvas.width,
        );
        const y = Math.round(
            ((e.clientY - rect.top) / rect.height) * canvas.height,
        );
        return {
            x: Math.max(0, Math.min(canvas.width - 1, x)),
            y: Math.max(0, Math.min(canvas.height - 1, y)),
        };
    };

    /** 发送 input 命令（数字参数，无引号问题） */
    const run = async (command: string) => {
        const adb = connection.adb;
        if (!adb) return;
        try {
            await shell(adb, command);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    /* ---------- 触摸手势 ---------- */
    const gestureRef = useRef<{
        startX: number;
        startY: number;
        startTime: number;
        moved: boolean;
        pointerId: number;
    } | null>(null);

    const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!touchEnabled || !running) return;
        const p = toDevice(e);
        if (!p) return;
        (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
        gestureRef.current = {
            startX: p.x,
            startY: p.y,
            startTime: Date.now(),
            moved: false,
            pointerId: e.pointerId,
        };
    };

    const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const g = gestureRef.current;
        if (!g || e.pointerId !== g.pointerId) return;
        const p = toDevice(e);
        if (!p) return;
        const dx = p.x - g.startX;
        const dy = p.y - g.startY;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) g.moved = true;
    };

    const onPointerUp = async (e: React.PointerEvent<HTMLCanvasElement>) => {
        const g = gestureRef.current;
        gestureRef.current = null;
        if (!g || e.pointerId !== g.pointerId) return;
        const p = toDevice(e) ?? { x: g.startX, y: g.startY };
        const duration = Date.now() - g.startTime;

        if (!g.moved) {
            if (duration >= 600) {
                // 长按：起点=终点 + 长时长
                await run(
                    `input swipe ${g.startX} ${g.startY} ${g.startX} ${g.startY} ${Math.min(
                        Math.max(duration, 700),
                        3000,
                    )}`,
                );
            } else {
                await run(`input tap ${p.x} ${p.y}`);
            }
            return;
        }

        // 滑动：使用起点与终点，时长为实际手势耗时（给个下限保证有效）
        const dt = Math.min(Math.max(duration, 100), 2000);
        await run(`input swipe ${g.startX} ${g.startY} ${p.x} ${p.y} ${dt}`);
    };

    const startMirror = async () => {
        const canvas = canvasRef.current;
        if (!connection.adb || !canvas || running) return;
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
                const adb = connection.adb;
                if (!adb) break;
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
                await new Promise((r) => setTimeout(r, intervalRef.current));
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
        await run(`input keyevent ${key}`);
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
                <Toggle
                    label={t.mirrorTouch}
                    inlineLabel
                    checked={touchEnabled}
                    onChange={(_, c) => setTouchEnabled(!!c)}
                />
                {running && <Spinner size={SpinnerSize.small} />}
                <span style={{ color: "#605e5c", fontSize: 12 }}>{fps} fps</span>
                <div style={{ width: 170 }}>
                    <Slider
                        label={t.mirrorInterval}
                        min={30}
                        max={300}
                        step={10}
                        value={intervalMs}
                        showValue
                        onChange={(v) => setIntervalMs(Number(v))}
                    />
                </div>
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

            <MessageBar messageBarType={MessageBarType.info}>
                {t.mirrorTouchHint}
            </MessageBar>

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
                <canvas
                    ref={canvasRef}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => {
                        gestureRef.current = null;
                    }}
                    onContextMenu={(e) => {
                        // 右键 = 返回键，方便操作
                        e.preventDefault();
                        if (touchEnabled && running) void sendKey("KEYCODE_BACK");
                    }}
                    style={{
                        maxWidth: "100%",
                        maxHeight: "100%",
                        cursor: touchEnabled && running ? "crosshair" : "default",
                        touchAction: "none",
                    }}
                />
            </div>
        </Stack>
    );
});

import {
    DefaultButton,
    Dropdown,
    MessageBar,
    MessageBarType,
    Spinner,
    SpinnerSize,
    Stack,
    Toggle,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { AdbScrcpyClient, AdbScrcpyOptionsLatest } from "@yume-chan/adb-scrcpy";
import {
    AndroidAvcLevel,
    AndroidAvcProfile,
    AndroidMotionEventAction,
    AndroidMotionEventButton,
    ScrcpyCodecOptions,
    ScrcpyPointerId,
} from "@yume-chan/scrcpy";
import { WebCodecsVideoDecoder } from "@yume-chan/scrcpy-decoder-webcodecs";
import { BitmapVideoFrameRenderer } from "@yume-chan/scrcpy-decoder-webcodecs";
import { TinyH264Decoder } from "@yume-chan/scrcpy-decoder-tinyh264";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";
import { saveBlob } from "../state/file-stream";
import { shell } from "../state/privilege";
import { createH264Recorder, type H264Recorder } from "../state/recorder";
import {
    fetchScrcpyServer,
    SCRCPY_SERVER_PATH,
} from "../state/scrcpy-server";

/**
 * 投屏页面（基于 scrcpy 实时 H.264 流 + WebCodecs 硬解）。
 *
 * 为什么不再用 framebuffer 抓帧：
 * 抓帧方案每帧都要全画幅传输并重新编码，链路延迟高（数百毫秒起）、帧率低（5~15fps）。
 * scrcpy 方案由设备端直接编码 H.264 流，浏览器用 WebCodecs 硬解，
 * 延迟可降到几十毫秒、帧率可达 30fps。
 *
 * 触摸操作直接走 scrcpy 控制通道（injectTouch），比 `adb shell input` 低延迟得多。
 */
export const MirrorPage = observer(function MirrorPage() {
    const t = i18n.t;
    const [running, setRunning] = useState(false);
    const [recording, setRecording] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const [status, setStatus] = useState<string>("");
    const [fps, setFps] = useState(0);
    const [touchEnabled, setTouchEnabled] = useState(true);
    const [recordSeconds, setRecordSeconds] = useState(0);
    /**
     * 解码器：默认 tinyh264（软件解码，与官方 demo 一致，兼容性最好）。
     * WebCodecs 是硬件解码，性能好但在部分设备（尤其车机）上会静默黑屏。
     */
    const [decoderKind, setDecoderKind] = useState<"tinyh264" | "webcodecs">(
        "tinyh264",
    );

    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const controllerRef = useRef<{
        injectTouch(message: {
            action: number;
            pointerId: bigint;
            pointerX: number;
            pointerY: number;
            videoWidth: number;
            videoHeight: number;
            pressure: number;
            actionButton: number;
            buttons: number;
        }): Promise<void>;
    } | null>(null);
    const decoderRef = useRef<{ dispose(): void } | null>(null);
    const clientRef = useRef<AdbScrcpyClient<AdbScrcpyOptionsLatest<true>> | null>(
        null,
    );
    const stopRef = useRef<(() => void) | null>(null);
    const recorderRef = useRef<H264Recorder | null>(null);
    const recTimerRef = useRef<ReturnType<typeof setInterval> | undefined>();
    const gestureRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        moved: boolean;
        lastX: number;
        lastY: number;
        startTime: number;
    } | null>(null);

    // 离开页面时彻底清理
    useEffect(() => {
        return () => {
            stopRef.current?.();
        };
    }, []);

    /** 把浏览器坐标换算为设备视频坐标 */
    const toVideo = (
        clientX: number,
        clientY: number,
    ): { x: number; y: number } | null => {
        const canvas = canvasRef.current;
        if (!canvas || !canvas.width || !canvas.height) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const x = ((clientX - rect.left) / rect.width) * canvas.width;
        const y = ((clientY - rect.top) / rect.height) * canvas.height;
        return {
            x: Math.max(0, Math.min(canvas.width - 1, x)),
            y: Math.max(0, Math.min(canvas.height - 1, y)),
        };
    };

    /** 通过 scrcpy 控制通道注入触摸事件（低延迟） */
    const inject = (
        action: number,
        x: number,
        y: number,
        pressure: number,
    ) => {
        const controller = controllerRef.current;
        const canvas = canvasRef.current;
        if (!controller || !canvas) return;
        void controller
            .injectTouch({
                action,
                pointerId: ScrcpyPointerId.Finger,
                pointerX: x,
                pointerY: y,
                videoWidth: canvas.width,
                videoHeight: canvas.height,
                pressure,
                actionButton:
                    action === AndroidMotionEventAction.Up
                        ? AndroidMotionEventButton.None
                        : AndroidMotionEventButton.Primary,
                buttons:
                    action === AndroidMotionEventAction.Up
                        ? AndroidMotionEventButton.None
                        : AndroidMotionEventButton.Primary,
            })
            .catch(() => {
                /* 连接已结束 */
            });
    };

    const attachTouch = (canvas: HTMLCanvasElement) => {
        canvas.style.touchAction = "none";
        canvas.style.cursor = "crosshair";

        const down = (e: PointerEvent) => {
            if (!touchEnabledRef.current) return;
            const p = toVideo(e.clientX, e.clientY);
            if (!p) return;
            e.preventDefault();
            canvas.setPointerCapture?.(e.pointerId);
            gestureRef.current = {
                pointerId: e.pointerId,
                startX: p.x,
                startY: p.y,
                moved: false,
                lastX: p.x,
                lastY: p.y,
                startTime: Date.now(),
            };
            inject(AndroidMotionEventAction.Down, p.x, p.y, 1);
        };

        const move = (e: PointerEvent) => {
            const g = gestureRef.current;
            if (!g || e.pointerId !== g.pointerId) return;
            const p = toVideo(e.clientX, e.clientY);
            if (!p) return;
            if (Math.abs(p.x - g.startX) > 4 || Math.abs(p.y - g.startY) > 4) {
                g.moved = true;
            }
            // 位移超过阈值才发送，减少控制通道压力
            if (
                Math.abs(p.x - g.lastX) >= 2 ||
                Math.abs(p.y - g.lastY) >= 2
            ) {
                g.lastX = p.x;
                g.lastY = p.y;
                inject(AndroidMotionEventAction.Move, p.x, p.y, 1);
            }
        };

        const up = (e: PointerEvent) => {
            const g = gestureRef.current;
            if (!g || e.pointerId !== g.pointerId) return;
            gestureRef.current = null;
            const p = toVideo(e.clientX, e.clientY) ?? {
                x: g.lastX,
                y: g.lastY,
            };
            inject(AndroidMotionEventAction.Up, p.x, p.y, 0);
        };

        canvas.addEventListener("pointerdown", down);
        canvas.addEventListener("pointermove", move);
        canvas.addEventListener("pointerup", up);
        canvas.addEventListener("pointercancel", () => {
            gestureRef.current = null;
        });
        canvas.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            if (touchEnabledRef.current) void sendKey("KEYCODE_BACK");
        });
    };

    // 触摸开关需要在事件回调里读取最新值
    const touchEnabledRef = useRef(touchEnabled);
    touchEnabledRef.current = touchEnabled;

    const startMirror = async () => {
        const adb = connection.adb;
        const container = containerRef.current;
        if (!adb || !container || running) return;
        setRunning(true);
        setError(undefined);
        setFps(0);
        const stopFns: (() => void)[] = [];
        stopRef.current = () => {
            for (const fn of stopFns) fn();
        };

        try {
            // 1) 推送 scrcpy 服务端
            setStatus(t.mirrorPushServer);
            const serverBytes = await fetchScrcpyServer();
            await AdbScrcpyClient.pushServer(
                adb,
                new ReadableStream<Uint8Array>({
                    start(c) {
                        c.enqueue(serverBytes);
                        c.close();
                    },
                }) as never,
                SCRCPY_SERVER_PATH,
            );

            // 2) 启动 scrcpy 服务端进程
            setStatus(t.mirrorStarting);
            /**
             * ⚠️ 关键：必须显式限定编码参数，否则黑屏。
             *
             * TinyH264（软解，兼容性最好）**只支持 Baseline profile / Level 4**。
             * 若让设备自由选择，Android 默认常用 High profile，
             * 软解拿到不认识的 SPS 会静默不出帧 → 画面全黑且无报错。
             * 因此这里按所选解码器的能力，显式要求设备用 Baseline 编码。
             */
            const codecOptions = new ScrcpyCodecOptions();
            if (decoderKind === "tinyh264") {
                codecOptions.options.profile = AndroidAvcProfile.Baseline;
                codecOptions.options.level = AndroidAvcLevel.Level4;
            }
            const options = new AdbScrcpyOptionsLatest({
                videoCodec: "h264",
                maxSize: 1280,
                maxFps: 30,
                videoBitRate: 4000000,
                audio: false,
                control: true,
                sendFrameMeta: true,
                videoCodecOptions: codecOptions,
            });
            const client = await AdbScrcpyClient.start(
                adb,
                SCRCPY_SERVER_PATH,
                options,
            );
            clientRef.current = client;
            stopFns.push(() => {
                void client.close().catch(() => {
                    /* ignore */
                });
            });

            // 消费 stdout，避免阻塞
            void client.output
                .pipeTo(
                    new WritableStream<string>({
                        write() {
                            /* 忽略服务端日志 */
                        },
                    }) as never,
                )
                .catch(() => {
                    /* ignore */
                });

            // 3) 视频流 + 解码器
            const video = await client.videoStream;
            if (!video) {
                throw new Error("视频流不可用（设备可能不支持或被占用）");
            }
            const codec = video.metadata.codec;

            let decoder: {
                writable: WritableStream<unknown>;
                dispose(): void;
            };
            let canvas: HTMLCanvasElement;

            // ⚠️ 解码器选择（黑屏问题的关键）：
            // 官方 demo 唯一的解码器是 TinyH264（纯软件解码）。
            // WebCodecs 走的是浏览器硬件解码，在车机这类设备返回的 H.264 上
            // 很容易静默失败（configure 成功但不出帧）→ 画面全黑且无报错。
            // 因此默认用 TinyH264，仅在用户显式选择时才用 WebCodecs。
            if (decoderKind === "webcodecs" && WebCodecsVideoDecoder.isSupported) {
                canvas = document.createElement("canvas");
                const renderer = new BitmapVideoFrameRenderer(canvas);
                const dec = new WebCodecsVideoDecoder({ codec, renderer });
                decoder = dec as unknown as typeof decoder;
            } else {
                const dec = new TinyH264Decoder();
                canvas = dec.renderer as HTMLCanvasElement;
                decoder = dec as unknown as typeof decoder;
            }
            decoderRef.current = decoder;
            canvasRef.current = canvas;
            canvas.style.maxWidth = "100%";
            canvas.style.maxHeight = "100%";
            canvas.style.display = "block";
            canvas.style.margin = "0 auto";
            attachTouch(canvas);

            // 清空容器并挂载画布（必须在开始解码前完成，否则渲染无处可去）
            while (container.firstChild) container.removeChild(container.firstChild);
            container.appendChild(canvas);

            stopFns.push(() => {
                try {
                    decoder.dispose();
                } catch {
                    /* ignore */
                }
            });

            // 获取控制通道写入器（触摸注入用）
            const controller = client.controller;
            if (controller) {
                controllerRef.current = {
                    injectTouch: (m) =>
                        controller.injectTouch(m as never),
                };
            }

            // 尺寸变化时刷新
            video.sizeChanged(({ width, height }) => {
                setStatus(`${width}×${height}`);
            });
            setStatus(`${video.width}×${video.height}`);

            // 4) 把视频包喂给解码器（同时录制）
            const writer = (
                decoder.writable as unknown as WritableStream<unknown>
            ).getWriter();
            const reader = video.stream.getReader();
            let stopped = false;
            stopFns.push(() => {
                stopped = true;
                void reader.cancel().catch(() => {
                    /* ignore */
                });
            });

            let frames = 0;
            let last = Date.now();
            void (async () => {
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done || stopped) break;
                        recorderRef.current?.addPacket(
                            value as never,
                        );
                        await writer.write(value);
                        frames++;
                        const now = Date.now();
                        if (now - last >= 1000) {
                            setFps(Math.round((frames * 1000) / (now - last)));
                            frames = 0;
                            last = now;
                        }
                    }
                } catch (e) {
                    if (!stopped) {
                        setError(e instanceof Error ? e.message : String(e));
                    }
                } finally {
                    setRunning(false);
                    setStatus("");
                }
            })();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setRunning(false);
            setStatus("");
            stopRef.current?.();
        }
    };

    const stopMirror = () => {
        if (recording) void stopRecord();
        stopRef.current?.();
        stopRef.current = null;
        setRunning(false);
        setStatus("");
    };

    const stopRecord = async () => {
        const rec = recorderRef.current;
        recorderRef.current = null;
        setRecording(false);
        if (recTimerRef.current) clearInterval(recTimerRef.current);
        if (!rec) return;
        try {
            const { blob, filename } = rec.finish();
            if (blob.size > 0) saveBlob(blob, filename);
            else setError("录制内容为空：可能未捕获到关键帧，请稍后重试");
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    const toggleRecord = () => {
        if (!recording) {
            const canvas = canvasRef.current;
            const w = canvas?.width || 0;
            const h = canvas?.height || 0;
            recorderRef.current = createH264Recorder(w, h);
            setRecording(true);
            setRecordSeconds(0);
            recTimerRef.current = setInterval(
                () => setRecordSeconds((s) => s + 1),
                1000,
            );
        } else {
            void stopRecord();
        }
    };

    const sendKey = async (key: string) => {
        const adb = connection.adb;
        if (!adb) return;
        try {
            await shell(adb, `input keyevent ${key}`);
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
        <Stack
            styles={{
                root: { padding: 16, gap: 10, height: "100%", boxSizing: "border-box" },
            }}
        >
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
                {recording && (
                    <span style={{ color: "#d13438", fontSize: 12 }}>
                        ● {t.recording} {recordSeconds}s
                    </span>
                )}
                <Toggle
                    label={t.mirrorTouch}
                    inlineLabel
                    checked={touchEnabled}
                    onChange={(_, c) => setTouchEnabled(!!c)}
                />
                <Dropdown
                    selectedKey={decoderKind}
                    options={[
                        { key: "tinyh264", text: t.decoderSoft },
                        { key: "webcodecs", text: t.decoderHard },
                    ]}
                    onChange={(_, o) =>
                        setDecoderKind(
                            (o?.key as "tinyh264" | "webcodecs") ?? "tinyh264",
                        )
                    }
                    styles={{ root: { width: 180 } }}
                    disabled={running}
                />
                {running && <Spinner size={SpinnerSize.small} />}
                <span style={{ color: "#605e5c", fontSize: 12 }}>
                    {status} {running ? `${fps} fps` : ""}
                </span>
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
                <MessageBar messageBarType={MessageBarType.error}>
                    {error}
                </MessageBar>
            )}

            <MessageBar messageBarType={MessageBarType.info}>
                {t.mirrorTouchHint}
            </MessageBar>

            <div
                ref={containerRef}
                style={{
                    flexGrow: 1,
                    minHeight: 0,
                    overflow: "auto",
                    background: "#323130",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "flex-start",
                }}
            />
        </Stack>
    );
});

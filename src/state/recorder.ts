import fixWebmDuration from "fix-webm-duration";

/**
 * 屏幕录制工具。
 *
 * 背景（这是「录制的 webm 打不开」的根因）：
 * `MediaRecorder` 在**实时（live）录制**模式下产出的 WebM 文件
 * **不写入 duration（时长）元数据** —— 它认为流是无限长的。
 * 播放器读到没有时长的 WebM，就会判定为「文件损坏」而拒绝打开
 * （你看到的「文件系统错误 -2147416359」属于 Shell 侧的打开失败）。
 *
 * 解决：
 * 1. 优先用 **MP4**（若浏览器支持 `video/mp4`）—— 兼容性最好，Windows 直接能播；
 * 2. 若只能产出 WebM，则在停止后用 `fix-webm-duration` 回填真实时长。
 */

/** 探测浏览器支持的录制格式，优先 MP4 */
export function pickMimeType(): { mimeType: string; ext: string } {
    const candidates: { mimeType: string; ext: string }[] = [
        // H.264/MP4：Windows 资源管理器/照片应用可直接播放
        { mimeType: "video/mp4;codecs=avc1.42E01E", ext: "mp4" },
        { mimeType: "video/mp4;codecs=h264", ext: "mp4" },
        { mimeType: "video/mp4", ext: "mp4" },
        // WebM 兜底（停止后会回填时长）
        { mimeType: "video/webm;codecs=vp9", ext: "webm" },
        { mimeType: "video/webm;codecs=vp8", ext: "webm" },
        { mimeType: "video/webm", ext: "webm" },
    ];
    const supported =
        typeof MediaRecorder !== "undefined" &&
        typeof MediaRecorder.isTypeSupported === "function";
    if (supported) {
        for (const c of candidates) {
            if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
        }
    }
    return { mimeType: "", ext: "webm" };
}

export interface ScreenRecorder {
    /** 停止并返回已修好的 Blob 与建议文件名 */
    stop(): Promise<{ blob: Blob; filename: string }>;
    /** 已录制时长（毫秒） */
    elapsed(): number;
}

/**
 * 开始录制一个 canvas 的画面。
 *
 * @param canvas   要录制的画布
 * @param fps      帧率
 * @param onTick   每秒回调一次，用于 UI 显示录制时长
 */
export function startScreenRecording(
    canvas: HTMLCanvasElement,
    fps = 15,
    onTick?: (seconds: number) => void,
): ScreenRecorder {
    const stream = canvas.captureStream(fps);
    const { mimeType, ext } = pickMimeType();

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
    );

    const startedAt = Date.now();
    let tickTimer: ReturnType<typeof setInterval> | undefined;

    recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
    };

    // 分片写入，避免长时间录制时内存里只有一个大 Blob 才落盘
    recorder.start(1000);

    if (onTick) {
        tickTimer = setInterval(() => {
            onTick(Math.floor((Date.now() - startedAt) / 1000));
        }, 1000);
    }

    const stop = () =>
        new Promise<{ blob: Blob; filename: string }>((resolve, reject) => {
            const finish = async () => {
                if (tickTimer) clearInterval(tickTimer);
                try {
                    stream.getTracks().forEach((t) => t.stop());
                } catch {
                    /* ignore */
                }
                const durationMs = Date.now() - startedAt;
                const rawType = recorder.mimeType || mimeType || "video/webm";
                let blob = new Blob(chunks, { type: rawType });

                // 关键修复：WebM 缺 duration，必须回填，否则播放器判定损坏
                if (/webm/i.test(rawType)) {
                    try {
                        blob = await fixWebmDuration(blob, durationMs, {
                            logger: false,
                        });
                    } catch {
                        /* 回填失败也照常给出文件，用户至少能拿到内容 */
                    }
                    // 无论回填成功与否，扩展名必须是 .webm
                    return resolve({
                        blob,
                        filename: `record-${stamp()}.webm`,
                    });
                }

                resolve({ blob, filename: `record-${stamp()}.${ext}` });
            };

            recorder.onstop = () => {
                void finish();
            };
            recorder.onerror = (e) => {
                if (tickTimer) clearInterval(tickTimer);
                reject(
                    (e as unknown as { error?: Error }).error ??
                        new Error("录制失败"),
                );
            };
            try {
                if (recorder.state !== "inactive") recorder.stop();
                else void finish();
            } catch (e) {
                reject(e as Error);
            }
        });

    return {
        stop,
        elapsed: () => Date.now() - startedAt,
    };
}

/** 形如 20261127-183045，便于按时间归档 */
function stamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return (
        `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
        `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
}

import type { AdbFrameBuffer } from "@yume-chan/adb";

/**
 * 把 adb.framebuffer() 返回的原始像素转成 ImageData。
 *
 * 关键：framebuffer 返回的 `data` 已经是 **RGBA8888**（每像素 4 字节，
 * 顺序正是 R,G,B,A），可以直接喂给 ImageData —— 官方 demo 就是这么做的。
 * 注意 `data` 的底层 buffer 可能带额外偏移，必须切片后再构造，否则会错位。
 */
export function framebufferToImageData(fb: AdbFrameBuffer): ImageData {
    const raw = fb.data as unknown as Uint8Array;
    // 复制一份，规避 SharedArrayBuffer / byteOffset 问题
    const expected = fb.width * fb.height * 4;
    const bytes = new Uint8ClampedArray(expected);
    // 若 bpp 不是 32，退回按 offset 解析（极少数设备）
    const bpp = fb.bpp || 32;
    if (bpp === 32) {
        bytes.set(raw.subarray(0, expected));
    } else {
        const bytesPerPixel = bpp / 8;
        const get = (offset: number, length: number, i: number): number => {
            const start = i * bytesPerPixel + offset / 8;
            if (length === 8) return raw[start] ?? 0;
            if (length === 5) {
                const lo = raw[start] ?? 0;
                const hi = raw[start + 1] ?? 0;
                return (((hi << 8) | lo) >> 0) & 0x1f;
            }
            if (length === 6) {
                const lo = raw[start] ?? 0;
                const hi = raw[start + 1] ?? 0;
                return (((hi << 8) | lo) >> 0) & 0x3f;
            }
            return 0;
        };
        for (let i = 0; i < fb.width * fb.height; i++) {
            const p = i * 4;
            bytes[p] =
                fb.red_length === 8
                    ? get(fb.red_offset, 8, i)
                    : get(fb.red_offset, fb.red_length, i) * (255 / 31);
            bytes[p + 1] =
                fb.green_length === 8
                    ? get(fb.green_offset, 8, i)
                    : get(fb.green_offset, fb.green_length, i) * (255 / 63);
            bytes[p + 2] =
                fb.blue_length === 8
                    ? get(fb.blue_offset, 8, i)
                    : get(fb.blue_offset, fb.blue_length, i) * (255 / 31);
            bytes[p + 3] = fb.alpha_length ? get(fb.alpha_offset, 8, i) : 255;
        }
    }
    return new ImageData(bytes, fb.width, fb.height);
}

/** 把 framebuffer 画到 canvas */
export function drawFramebuffer(
    canvas: HTMLCanvasElement,
    fb: AdbFrameBuffer,
): void {
    if (canvas.width !== fb.width) canvas.width = fb.width;
    if (canvas.height !== fb.height) canvas.height = fb.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(framebufferToImageData(fb), 0, 0);
}

/** framebuffer → PNG Blob */
export function framebufferToPng(fb: AdbFrameBuffer): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = fb.width;
    canvas.height = fb.height;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(framebufferToImageData(fb), 0, 0);
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("生成 PNG 失败"))),
            "image/png",
        );
    });
}

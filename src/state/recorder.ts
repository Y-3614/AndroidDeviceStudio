import type { ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import {
    annexBSplitNalu,
    h264ParseConfiguration,
    h264SearchConfiguration,
} from "@yume-chan/scrcpy";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { saveBlob } from "./file-stream";

/**
 * 把 scrcpy 的 H.264 原始流封装为**标准 MP4**（非分片）。
 *
 * 这是「录制视频打不开」的根治方案。
 *
 * 为什么换掉 MediaRecorder：
 * 浏览器 `MediaRecorder` 产出的是**分片（fragmented）MP4/WebM**，缺少完整索引
 * （moov 的 sample table），Windows 资源管理器 / 照片应用会判定为损坏，
 * 报「文件系统错误 -2147416359」。
 * 这里改用 `mp4-muxer` 手工封装：写 avcC 解码器配置 + AVCC 长度前缀的 NALU
 * + 时间戳，产出**常规 MP4**，兼容性最好、进度条可拖动。
 *
 * ⚠️ 关键点（踩过的坑）：
 * `mp4-muxer` 在 `finalize()` 生成 stsd 时，会无条件读取
 * `track.info.decoderConfig.colorSpace`。如果从未通过 `meta.decoderConfig`
 * 传入解码器配置，`decoderConfig` 为 null → 抛
 * "Cannot read properties of null (reading 'colorSpace')"。
 * 因此**必须在写入首帧时附带 `meta.decoderConfig`**（含 `description` = avcC、
 * `codec` 字符串）。
 */

interface PacketLike {
    type?: string;
    data: Uint8Array;
    keyframe?: boolean;
    pts?: number | bigint;
}

/** Annex-B 流 → AVCC 格式（每个 NALU 前加 4 字节大端长度），MP4 要求这种格式 */
function annexBToAvcc(data: Uint8Array): Uint8Array {
    const units: Uint8Array[] = [];
    let total = 0;
    for (const unit of annexBSplitNalu(data)) {
        units.push(unit);
        total += unit.byteLength + 4;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const nalu of units) {
        out[offset] = (nalu.byteLength >>> 24) & 0xff;
        out[offset + 1] = (nalu.byteLength >>> 16) & 0xff;
        out[offset + 2] = (nalu.byteLength >>> 8) & 0xff;
        out[offset + 3] = nalu.byteLength & 0xff;
        out.set(nalu, offset + 4);
        offset += 4 + nalu.byteLength;
    }
    return out;
}

/** 从 SPS/PPS 构造 avcC（AVCDecoderConfigurationRecord） */
function buildAvcC(sps: Uint8Array, pps: Uint8Array): Uint8Array {
    const buf = new Uint8Array(11 + sps.byteLength + pps.byteLength);
    buf[0] = 1; // configurationVersion
    buf[1] = sps[1] ?? 0; // AVCProfileIndication
    buf[2] = sps[2] ?? 0; // profile_compatibility
    buf[3] = sps[3] ?? 0; // AVCLevelIndication
    buf[4] = 0xff; // 6 bits reserved + lengthSizeMinusOne = 3 → 4 字节长度前缀
    buf[5] = 0xe1; // 3 bits reserved + numOfSPS = 1
    buf[6] = (sps.byteLength >>> 8) & 0xff;
    buf[7] = sps.byteLength & 0xff;
    buf.set(sps, 8);
    let i = 8 + sps.byteLength;
    buf[i++] = 1; // numOfPPS = 1
    buf[i++] = (pps.byteLength >>> 8) & 0xff;
    buf[i++] = pps.byteLength & 0xff;
    buf.set(pps, i);
    return buf;
}

/** 用 SPS/PPS 拼出 RFC 6381 的 codec 字符串，如 avc1.42001E */
function codecString(sps: Uint8Array): string {
    const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
    return `avc1.${hex(sps[1] ?? 0x42)}${hex(sps[2] ?? 0)}${hex(sps[3] ?? 0x1e)}`;
}

export interface H264Recorder {
    addPacket(packet: ScrcpyMediaStreamPacket): void;
    /** 完成封装并返回可下载的文件 */
    finish(): { blob: Blob; filename: string };
    readonly frameCount: number;
}

/**
 * 创建 MP4 录制器。
 *
 * @param width  初始宽度（来自 scrcpy metadata，配置包解析出真实值后会更新）
 * @param height 初始高度
 */
export function createH264Recorder(
    width: number,
    height: number,
): H264Recorder {
    let muxer: Muxer<ArrayBufferTarget> | undefined;
    let avcC: Uint8Array | undefined;
    let codec = "avc1.42E01E";
    let firstPts: number | undefined;
    let lastTs = 0;
    let frames = 0;

    /** 是否已经把 decoderConfig 交给 muxer（只需一次） */
    let descWritten = false;

    let w = width || 1280;
    let h = height || 720;

    // 等待 avcC 期间先缓存（首帧通常是关键帧）
    const buffered: PacketLike[] = [];

    const writeFrame = (p: PacketLike) => {
        if (!muxer) {
            buffered.push(p);
            return;
        }
        // pts 单位是微秒（scrcpy/MP4 都用 µs）
        const rawPts = p.pts === undefined ? undefined : Number(p.pts);
        if (rawPts !== undefined && firstPts === undefined) firstPts = rawPts;
        const ts =
            rawPts !== undefined && firstPts !== undefined
                ? Math.max(0, rawPts - firstPts)
                : lastTs + 33333;
        lastTs = ts;

        muxer.addVideoChunkRaw(
            annexBToAvcc(p.data),
            p.keyframe ? "key" : "delta",
            ts,
            33333,
            // 首个样本必须带上解码器配置，否则 finalize 时 decoderConfig 为 null 崩溃
            !descWritten && avcC
                ? {
                      decoderConfig: {
                          codec,
                          description: avcC,
                          codedWidth: w,
                          codedHeight: h,
                      },
                  }
                : undefined,
        );
        descWritten = true;
        frames++;
    };

    const ensureMuxer = () => {
        if (muxer || !avcC) return;
        muxer = new Muxer({
            target: new ArrayBufferTarget(),
            // 非分片常规 MP4，兼容性最好（Windows/手机/剪辑软件均可播）
            fastStart: "in-memory",
            video: { codec: "avc", width: w, height: h, frameRate: 30 },
        });
        const pending = buffered.splice(0, buffered.length);
        for (const p of pending) writeFrame(p);
    };

    return {
        get frameCount() {
            return frames;
        },
        addPacket(packet: ScrcpyMediaStreamPacket) {
            const p = packet as unknown as PacketLike;
            if (p.type === "configuration") {
                // 配置包：构造 avcC，并校正真实分辨率
                try {
                    const { sequenceParameterSet, pictureParameterSet } =
                        h264SearchConfiguration(p.data);
                    avcC = buildAvcC(
                        sequenceParameterSet,
                        pictureParameterSet,
                    );
                    codec = codecString(sequenceParameterSet);
                } catch {
                    /* 无 SPS/PPS 时无法封装，等待下一块配置 */
                }
                try {
                    const cfg = h264ParseConfiguration(p.data);
                    if (cfg.croppedWidth) w = cfg.croppedWidth;
                    if (cfg.croppedHeight) h = cfg.croppedHeight;
                } catch {
                    /* 用兜底尺寸 */
                }
                ensureMuxer();
                return;
            }
            // 视频帧
            if (!muxer) {
                buffered.push(p);
                if (buffered.length > 120) buffered.shift();
                return;
            }
            writeFrame(p);
        },
        finish() {
            const now = new Date();
            const pad = (n: number) => String(n).padStart(2, "0");
            const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
                now.getDate(),
            )}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

            if (!muxer) {
                // 没收到任何可封装数据（缺 SPS/PPS 或关键帧）
                return {
                    blob: new Blob([], { type: "video/mp4" }),
                    filename: `record-${stamp}.mp4`,
                };
            }
            muxer.finalize();
            const buffer = muxer.target.buffer ?? new ArrayBuffer(0);
            return {
                blob: new Blob([buffer], { type: "video/mp4" }),
                filename: `record-${stamp}.mp4`,
            };
        },
    };
}

/** 完成封装并直接下载，返回文件大小（便于 UI 提示） */
export function downloadRecording(rec: H264Recorder): number {
    const { blob, filename } = rec.finish();
    if (blob.size > 0) saveBlob(blob, filename);
    return blob.size;
}

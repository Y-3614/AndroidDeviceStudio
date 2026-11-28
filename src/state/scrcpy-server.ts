/**
 * scrcpy 服务端（server.bin）的获取与推送。
 *
 * 服务端二进制**随站点一起打包**在 `public/scrcpy/` 下，
 * 避免运行时依赖 GitHub 下载（国内网络不稳，且会拖慢首次投屏）。
 * 版本需与 `@yume-chan/adb-scrcpy` 支持的版本匹配。
 */
export const SCRCPY_SERVER_VERSION = "3.3.3";

/** 站点内服务端二进制的 URL（跟随 Vite 的 base 路径） */
export function scrcpyServerUrl(): string {
    return `${import.meta.env.BASE_URL}scrcpy/scrcpy-server-v${SCRCPY_SERVER_VERSION}`;
}

/** 设备上的目标路径（与 @yume-chan/scrcpy 的 DefaultServerPath 一致） */
export const SCRCPY_SERVER_PATH = "/data/local/tmp/scrcpy-server.jar";

/** 拉取服务端二进制（带简单缓存，避免重复下载） */
let cached: ArrayBuffer | undefined;
export async function fetchScrcpyServer(): Promise<Uint8Array> {
    if (cached) return new Uint8Array(cached);
    const res = await fetch(scrcpyServerUrl());
    if (!res.ok) {
        throw new Error(
            `无法加载 scrcpy 服务端（HTTP ${res.status}）。请确认站点内已包含 public/scrcpy 资源。`,
        );
    }
    cached = await res.arrayBuffer();
    return new Uint8Array(cached);
}

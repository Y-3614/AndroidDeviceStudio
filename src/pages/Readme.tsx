import { MessageBar, MessageBarType, Stack } from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { Diagnostics } from "../components/Diagnostics";
import { i18n } from "../state/i18n";

export const ReadmePage = observer(function ReadmePage() {
    const t = i18n.t;
    const zh = i18n.lang === "zh";

    return (
        <Stack styles={{ root: { padding: 24, gap: 16, overflow: "auto" } }}>
            <h1 style={{ fontSize: 24, margin: 0 }}>{t.appName}</h1>
            <p style={{ color: "#605e5c", margin: 0 }}>
                {zh
                    ? "基于浏览器的 Android 设备工具箱：通过 WebUSB 直连设备，提供文件管理、终端、投屏、日志、安装 APK 等能力，并支持 adb root / remount 提权。"
                    : "A browser-based Android device toolbox. Connect over WebUSB for file management, terminal, screen mirroring, logcat and APK install, with adb root / remount support."}
            </p>

            <MessageBar messageBarType={MessageBarType.warning} isMultiline>
                {zh
                    ? "前提：使用 Chrome 或 Edge 等 Chromium 内核浏览器；页面需通过 HTTPS 或 localhost 访问（WebUSB 要求安全上下文）；设备需开启 USB 调试。"
                    : "Requires a Chromium-based browser (Chrome/Edge), a secure context (HTTPS or localhost) for WebUSB, and USB debugging enabled on the device."}
            </MessageBar>

            <h2 style={{ fontSize: 18, margin: 0 }}>
                {zh ? "提权说明" : "Privilege notes"}
            </h2>
            <ol style={{ color: "#323254", lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
                <li>
                    {zh
                        ? "连接后自动探测：先试 adb root，再试 su，最后降级普通权限。"
                        : "On connect: tries adb root, then su, then falls back to normal permissions."}
                </li>
                <li>
                    {zh
                        ? "adb root 仅在 userdebug / eng 版固件上可用；user 版零售机会返回不可用。"
                        : "adb root only works on userdebug / eng builds; production builds will refuse."}
                </li>
                <li>
                    {zh
                        ? "remount 必须在 root 成功之后；Android 10+ 需先禁用 verity 并重启。"
                        : "remount requires root first; Android 10+ needs disable-verity + reboot."}
                </li>
                <li>
                    {zh
                        ? "提权模式下，文件的读取/写入/删除会改走 su 通道，可访问 /data 等受保护目录。"
                        : "In privileged mode, file read/write/delete go through the su channel for protected paths."}
                </li>
            </ol>

            <Diagnostics />
        </Stack>
    );
});

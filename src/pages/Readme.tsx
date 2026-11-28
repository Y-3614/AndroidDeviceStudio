import { MessageBar, MessageBarType, Stack } from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { Diagnostics } from "../components/Diagnostics";
import { i18n } from "../state/i18n";

const sectionStyle = {
    fontSize: 17,
    fontWeight: 600,
    margin: "8px 0 0",
    // flexShrink: 0 —— 关键！
    // 本页根容器是 height:100% 的 flex 纵向布局，子项默认 flex-shrink:1，
    // 内容超高时会被压缩，导致 <pre> 只显示半行（用户反馈的「显示不全」）。
    flexShrink: 0,
} as const;
const bodyStyle = {
    color: "#323130",
    lineHeight: 1.8,
    margin: 0,
    flexShrink: 0,
} as const;
const listStyle = {
    color: "#323130",
    lineHeight: 1.9,
    margin: 0,
    paddingLeft: 20,
    flexShrink: 0,
} as const;
const codeStyle = {
    background: "#f3f2f1",
    padding: "1px 5px",
    borderRadius: 3,
    fontFamily: "Consolas, Menlo, monospace",
    fontSize: 12,
} as const;
/** 命令代码块统一样式（不收缩、可横向滚动） */
const preStyle = {
    background: "#1e1e1e",
    color: "#d4d4d4",
    padding: 10,
    borderRadius: 4,
    fontSize: 12.5,
    margin: 0,
    flexShrink: 0,
    overflowX: "auto",
    whiteSpace: "pre",
} as const;

export const ReadmePage = observer(function ReadmePage() {
    const t = i18n.t;
    const zh = i18n.lang === "zh";

    const C = ({ children }: { children: string }) => (
        <code style={codeStyle}>{children}</code>
    );

    return (
        <Stack
            styles={{
                root: {
                    padding: 24,
                    gap: 12,
                    // 必须显式撑满高度 + 允许收缩，否则内容超高时会被父级裁掉而不滚动
                    height: "100%",
                    minHeight: 0,
                    boxSizing: "border-box",
                    overflowY: "auto",
                    overflowX: "hidden",
                },
            }}
        >
            <h1 style={{ fontSize: 24, margin: 0 }}>{t.appName}</h1>
            <p style={bodyStyle}>
                {zh
                    ? "基于浏览器的 Android 设备工具箱：通过 WebUSB 直连设备，无需安装任何客户端，即可完成文件管理、终端操作、投屏、日志抓取、APK 安装与电源控制，并支持 adb root / remount 提权。"
                    : "A browser-based Android device toolbox. Connect over WebUSB with no client install to manage files, run a terminal, mirror the screen, capture logcat, install APKs and control power — with adb root / remount support."}
            </p>

            {/* ── 使用前提 ── */}
            <h2 style={sectionStyle}>{zh ? "一、使用前提（重要）" : "1. Requirements"}</h2>
            <MessageBar messageBarType={MessageBarType.warning} isMultiline>
                {zh
                    ? "WebUSB 有浏览器安全限制，必须同时满足以下条件，否则「连接」不会有任何反应。"
                    : "WebUSB has browser security constraints. All of the following must hold, or Connect will do nothing."}
            </MessageBar>
            <ol style={listStyle}>
                <li>
                    {zh ? "浏览器：仅支持 Chromium 内核 —— " : "Browser: Chromium only — "}
                    <b>Chrome / Edge</b>
                    {zh ? "（Firefox、Safari 不支持 WebUSB）。" : " (Firefox/Safari do not support WebUSB)."}
                </li>
                <li>
                    {zh ? "安全上下文：页面必须通过 " : "Secure context: the page must be served over "}
                    <C>https://</C> {zh ? " 或 " : " or "} <C>localhost</C>
                    {zh ? " 访问。用本地文件直接打开会用不了。" : ". Opening a local file will not work."}
                </li>
                <li>
                    {zh ? "设备端：开启「开发者选项 → USB 调试」，并用支持数据传输的线连接电脑。" : "Device: enable Developer options → USB debugging, and use a data-capable cable."}
                </li>
                <li>
                    {zh
                        ? "首次连接时，浏览器会弹出授权框，需手动选中设备（安全策略，无法自动跳过）。"
                        : "On first connect the browser shows an authorization dialog; you must pick the device manually (security policy)."}
                </li>
            </ol>

            {/* ── 连接失败处理 ── */}
            <h2 style={sectionStyle}>{zh ? "二、连不上怎么办" : "2. Connection troubleshooting"}</h2>
            <p style={bodyStyle}>
                {zh
                    ? "最常见的原因是：设备已被本机的 adb server（或其他程序）占用，浏览器会提示「设备已被占用 / 访问被拒绝」。解决办法是在本机命令行执行："
                    : "The most common cause is that the device is already held by the local adb server (or another program), which surfaces as “device in use / access denied”. Fix it from your terminal:"}
            </p>
            <pre style={preStyle}>
{`adb kill-server`}
            </pre>
            <p style={bodyStyle}>
                {zh
                    ? "执行后回到本页重新点击「连接」。仍失败时，可在页面底部「连接诊断」中一键跑通基础命令，查看具体卡在哪一步。"
                    : "Then click Connect again. If it still fails, use the Connection diagnostics panel at the bottom to see exactly which step fails."}
            </p>

            {/* ── 功能说明 ── */}
            <h2 style={sectionStyle}>{zh ? "三、功能说明" : "3. Features"}</h2>
            <ul style={listStyle}>
                <li>
                    <b>{zh ? "设备信息" : "Device info"}</b>
                    {zh
                        ? "：读取型号、Android 版本、SDK、ABI、Build 类型、ADB 能力等。"
                        : ": model, Android version, SDK, ABI, build type, ADB features."}
                </li>
                <li>
                    <b>{zh ? "文件管理" : "File manager"}</b>
                    {zh
                        ? "：浏览目录、上传文件或整个文件夹、下载（文件夹自动打包 zip）、删除、新建文件夹。请先选中条目再下载/删除。"
                        : ": browse, upload files or whole folders, download (folders packed as zip), delete, create folders."}
                </li>
                <li>
                    <b>{zh ? "权限与挂载" : "Privilege & mount"}</b>
                    {zh
                        ? "：adb root / unroot / remount / disable-verity，带依赖联锁。"
                        : ": adb root / unroot / remount / disable-verity with dependency interlocks."}
                </li>
                <li>
                    <b>{zh ? "电源菜单" : "Power menu"}</b>
                    {zh
                        ? "：重启、重启到 Recovery / Bootloader、关机、息屏、唤醒、锁屏、电源菜单。"
                        : ": reboot, reboot to recovery/bootloader, power off, screen off, wake, lock, power menu."}
                </li>
                <li>
                    <b>{zh ? "WiFi ADB" : "WiFi ADB"}</b>
                    {zh
                        ? "：开启 tcpip 端口并读取设备 IP，随后可在本机命令行用 adb connect 切换为无线调试。"
                        : ": enable tcpip and read the device IP, then switch to wireless debugging via adb connect."}
                </li>
                <li>
                    <b>{zh ? "终端" : "Terminal"}</b>
                    {zh
                        ? "：基于 xterm.js 的交互式 shell，可切换 root 会话。"
                        : ": interactive shell built on xterm.js with a root session toggle."}
                </li>
                <li>
                    <b>{zh ? "投屏" : "Mirror"}</b>
                    {zh
                        ? "：实时画面 + 常用导航/电源键 + 录制为 WebM。"
                        : ": live screen plus navigation/power keys and WebM recording."}
                </li>
                <li>
                    <b>{zh ? "屏幕截图" : "Screen capture"}</b>
                    {zh ? "：抓取当前屏幕并下载 PNG。" : ": capture the screen and download a PNG."}
                </li>
                <li>
                    <b>{zh ? "日志 Logcat" : "Logcat"}</b>
                    {zh
                        ? "：等级开关、应用识别、关键字/标签过滤，并可把日志实时写入本地文件夹（20MB 分片）。"
                        : ": level toggles, app detection, keyword/tag filters, and streaming logs to a local folder in 20MB parts."}
                </li>
                <li>
                    <b>{zh ? "TEST 脚本" : "TEST Script"}</b>
                    {zh
                        ? "：把常用测试流程做成按钮 —— 日志采集与拉取到电脑、Monkey 稳定性测试、蓝牙 HCI 日志、CPU/内存监控、应用管理。所有命令与包名都可改。"
                        : ": common test flows as buttons — log capture & pull to PC, Monkey stability test, Bluetooth HCI logs, CPU/memory monitoring, app management. All commands and packages are editable."}
                </li>
                <li>
                    <b>{zh ? "安装 APK" : "Install APK"}</b>
                    {zh
                        ? "：推送至 /data/local/tmp 并安装，显示进度与失败原因。"
                        : ": push to /data/local/tmp and install, with progress and failure reasons."}
                </li>
            </ul>

            {/* ── 提权说明 ── */}
            <h2 style={sectionStyle}>{zh ? "四、提权说明" : "4. Privilege notes"}</h2>
            <p style={bodyStyle}>
                {zh
                    ? "连接成功后会自动进行三级提权探测，逐级降级："
                    : "After connecting, three privilege levels are probed in order, degrading gracefully:"}
            </p>
            <ol style={listStyle}>
                <li>
                    <b>adb root</b>
                    {zh
                        ? "：仅在 userdebug / eng 版固件上可用。成功后 adbd 重启，USB 连接会断开，页面会自动重连。"
                        : ": works only on userdebug / eng builds. adbd restarts and the USB link drops — the page reconnects automatically."}
                </li>
                <li>
                    <b>su</b>
                    {zh
                        ? "：设备已装 su（Magisk / SuperSU）时可用，通常需在手机上确认授权。"
                        : ": available when su (Magisk/SuperSU) is installed; usually needs on-device approval."}
                </li>
                <li>
                    <b>{zh ? "普通权限" : "Normal"}</b>
                    {zh
                        ? "：前两者不可用时的降级方案，仅能访问 /sdcard 等目录。"
                        : ": fallback when the above are unavailable; only /sdcard and similar are writable."}
                </li>
            </ol>
            <p style={bodyStyle}>
                {zh
                    ? "关于 remount：它把 /system、/vendor 等只读分区重新挂载为可写，必须在 root 成功之后执行。Android 10+（动态分区）需要先「禁用 verity」并重启，再 root → remount。"
                    : "remount re-mounts /system and /vendor as writable and requires root first. On Android 10+ (dynamic partitions) you must disable-verity and reboot before root → remount."}
            </p>
            <p style={bodyStyle}>
                {zh
                    ? "关于文件通道：adb root 生效时 adbd 本身即 root，直接使用原生 sync（快）；仅 su 模式才改走 shell 通道读写受保护目录。"
                    : "File channel: with adb root the adbd is root, so native sync is used directly (fast); only in su mode do file operations go through the shell channel."}
            </p>

            {/* ── 连接诊断 ── */}
            <h2 style={sectionStyle}>{zh ? "五、连接诊断" : "5. Connection diagnostics"}</h2>
            <Diagnostics />

            {/* ── TEST 脚本使用说明 ── */}
            <h2 style={sectionStyle}>{zh ? "六、TEST 脚本使用教程" : "6. TEST Script guide"}</h2>
            <p style={bodyStyle}>
                {zh
                    ? "「TEST 脚本」页把项目里常用的 .bat / .sh 流程固化成了按钮。所有输入框都可以改成你自己项目的值，点「保存配置」后会存在浏览器里，下次打开还在。"
                    : "The TEST Script page turns the project's .bat/.sh flows into buttons. Every input is editable; click Save config to persist settings in your browser."}
            </p>

            <h3 style={{ ...sectionStyle, fontSize: 15 }}>
                {zh ? "① 日志采集与拉取" : "① Log capture & pull"}
            </h3>
            <ol style={listStyle}>
                <li>
                    {zh ? "「后台 logcat 命令」默认 " : "Background logcat command defaults to "}
                    <C>logcat -v time</C>
                    {zh
                        ? "，会在设备后台运行并把输出写到 /sdcard/yx_log/。"
                        : ", runs in the background and writes output to /sdcard/yx_log/."}
                </li>
                <li>
                    {zh
                        ? "点「开始采集日志」启动；「清空设备日志缓冲」等价于 adb logcat -c。"
                        : "Click Start log capture; Clear device log buffer equals adb logcat -c."}
                </li>
                <li>
                    {zh
                        ? "「要拉取到电脑的路径」支持多行，每行一个设备目录（默认已按你的脚本预置 /data/yx_log、/data/anr、/data/tombstones 等）。"
                        : "Paths to pull accept multiple lines, one device directory each (pre-filled from your scripts: /data/yx_log, /data/anr, /data/tombstones, …)."}
                </li>
                <li>
                    <b>{zh ? "选择本地文件夹并导出" : "Choose local folder & export"}</b>
                    {zh
                        ? "：选一个电脑上的文件夹，日志会直接写进去（推荐，日志大时不占浏览器内存）。"
                        : ": pick a folder on your PC and logs are written directly into it (recommended for large logs)."}
                </li>
                <li>
                    <b>{zh ? "拉取并下载（zip）" : "Pull & download (zip)"}</b>
                    {zh
                        ? "：不想选文件夹时，会把每个目录打包成 zip 直接下载。"
                        : ": without picking a folder, each directory is packed into a zip and downloaded."}
                </li>
                <li>
                    <b>{zh ? "清理设备日志目录" : "Clean device log folders"}</b>
                    {zh
                        ? "：对「要清理的设备路径」执行 rm -rf。⚠️ 请先核对路径，这是不可撤销操作。"
                        : ": runs rm -rf on the clean paths. ⚠️ Verify the paths first — this is irreversible."}
                </li>
            </ol>

            <h3 style={{ ...sectionStyle, fontSize: 15 }}>
                {zh ? "② Monkey 稳定性测试" : "② Monkey stability test"}
            </h3>
            <ol style={listStyle}>
                <li>
                    {zh
                        ? "「被测应用包名」每行一个，默认已按你的脚本填入 yaxon 系列包名。"
                        : "Target packages, one per line; pre-filled with your yaxon package list."}
                </li>
                <li>
                    {zh
                        ? "「Monkey 参数」「事件间隔(ms)」「事件总数」都可改，下方会实时显示最终命令预览。"
                        : "Monkey arguments, throttle and event count are editable; a live command preview is shown."}
                </li>
                <li>
                    {zh
                        ? "点「后台运行 Monkey」会在设备后台启动，输出写入 /sdcard/yx_log/。"
                        : "Run Monkey in background starts it on the device; output goes to /sdcard/yx_log/."}
                </li>
            </ol>

            <h3 style={{ ...sectionStyle, fontSize: 15 }}>
                {zh ? "③ 蓝牙 HCI 日志" : "③ Bluetooth HCI logs"}
            </h3>
            <ol style={listStyle}>
                <li>
                    {zh
                        ? "「开启 HCI 日志」执行 setprop persist.bluetooth.btsnoopenable true；之后需重启蓝牙或设备才会开始记录。"
                        : "Enable HCI logs runs setprop persist.bluetooth.btsnoopenable true; restart Bluetooth (or the device) to start recording."}
                </li>
                <li>
                    {zh
                        ? "「导出 HCI 日志」/「导出到本地文件夹」会把 /data/misc/bluetooth/logs 拉取下来（需要 root）。"
                        : "Export HCI logs / Export to local folder pulls /data/misc/bluetooth/logs (root required)."}
                </li>
                <li>
                    {zh ? "「删除 HCI 日志」清空该目录。" : "Delete HCI logs clears that directory."}
                </li>
            </ol>

            <h3 style={{ ...sectionStyle, fontSize: 15 }}>
                {zh ? "④ CPU / 内存占用监控" : "④ CPU / memory monitoring"}
            </h3>
            <ol style={listStyle}>
                <li>
                    {zh
                        ? "设定采样间隔（秒）后点「开始监控」，会周期性执行 dumpsys cpuinfo / dumpsys meminfo。"
                        : "Set the interval (seconds) and click Start monitoring; it periodically runs dumpsys cpuinfo / dumpsys meminfo."}
                </li>
                <li>
                    {zh
                        ? "上方以趋势条显示 CPU% 与内存% 变化，下方显示最近一次原始采样结果。"
                        : "Trend bars show CPU% and memory% over time; the latest raw samples are shown below."}
                </li>
            </ol>

            <h3 style={{ ...sectionStyle, fontSize: 15 }}>
                {zh ? "⑤ 应用管理" : "⑤ App management"}
            </h3>
            <ol style={listStyle}>
                <li>
                    {zh
                        ? "「包含系统应用」开关决定是列全部应用还是仅第三方；点「列出所有应用包名」加载。"
                        : "Include system apps decides whether to list all apps or third-party only; click List all app packages to load."}
                </li>
                <li>
                    {zh
                        ? "在搜索框按包名过滤后下拉选择；点「启动应用」拉起，点「强制停止」结束。"
                        : "Filter by package name, pick it in the dropdown, then Launch app or Force stop."}
                </li>
                <li>
                    {zh
                        ? "勾选「启动前先强制停止」可在拉起前先 force-stop，确保冷启动。"
                        : "Force stop before launch ensures a cold start."}
                </li>
            </ol>

            <h3 style={{ ...sectionStyle, fontSize: 15 }}>
                {zh ? "⑥ 安装 APK 的安装路径" : "⑥ APK install path"}
            </h3>
            <p style={bodyStyle}>
                {zh
                    ? "安装 APK 页新增了「安装路径」下拉：默认 SD 卡（/sdcard），若推送失败或权限不足可改为 /data/local/tmp。"
                    : "The Install APK page now has an install-path dropdown: default SD card (/sdcard); switch to /data/local/tmp if pushing fails."}
            </p>

            <p style={{ ...bodyStyle, color: "#a19f9d", fontSize: 12, marginTop: 8 }}>
                {zh ? "反馈与源码：" : "Feedback & source: "}
                <a
                    href="https://github.com/Y-3614/AndroidDeviceStudio"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#0078d4" }}
                >
                    github.com/Y-3614/AndroidDeviceStudio
                </a>
            </p>
        </Stack>
    );
});

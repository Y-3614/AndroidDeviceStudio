import { MessageBar, MessageBarType, Stack } from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useState, type ReactNode } from "react";
import { Diagnostics } from "../components/Diagnostics";
import { i18n } from "../state/i18n";

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

/**
 * 可折叠目录条目。
 *
 * 为什么手写而不是用 Fluent 的 Accordion：
 * 之前吃过 Fluent 组件高度语义的亏（StackItem grow 塌成 0），
 * 这里用最朴素的 useState + div，行为完全可控。
 */
function Section({
    title,
    defaultOpen = false,
    children,
}: {
    title: string;
    defaultOpen?: boolean;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div
            style={{
                border: "1px solid #edebe9",
                borderRadius: 6,
                overflow: "hidden",
                flexShrink: 0,
            }}
        >
            <button
                onClick={() => setOpen((v) => !v)}
                style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 14px",
                    border: "none",
                    background: open ? "#f3f9fd" : "#faf9f8",
                    cursor: "pointer",
                    fontSize: 15,
                    fontWeight: 600,
                    color: open ? "#0078d4" : "#323130",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                }}
            >
                <span
                    style={{
                        display: "inline-block",
                        transform: open ? "rotate(90deg)" : "none",
                        transition: "transform .15s",
                        fontSize: 12,
                    }}
                >
                    ▶
                </span>
                {title}
            </button>
            {open && (
                <div
                    style={{
                        padding: "12px 16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        background: "#fff",
                    }}
                >
                    {children}
                </div>
            )}
        </div>
    );
}

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
                    // 显式撑满高度 + 允许收缩，否则内容超高时会被父级裁掉而不滚动
                    height: "100%",
                    minHeight: 0,
                    boxSizing: "border-box",
                    overflowY: "auto",
                    overflowX: "hidden",
                },
            }}
        >
            <h1 style={{ fontSize: 24, margin: 0, flexShrink: 0 }}>{t.appName}</h1>
            <p style={bodyStyle}>
                {zh
                    ? "基于浏览器的 Android 设备工具箱：通过 WebUSB 直连设备，无需安装任何客户端，即可完成文件管理、终端操作、投屏、日志抓取、APK 安装与电源控制，并支持 adb root / remount 提权。"
                    : "A browser-based Android device toolbox. Connect over WebUSB with no client install to manage files, run a terminal, mirror the screen, capture logcat, install APKs and control power — with adb root / remount support."}
            </p>
            <MessageBar messageBarType={MessageBarType.info} isMultiline>
                {zh
                    ? "点击下方任一条目可展开 / 折叠详情（默认折叠，便于快速定位）。"
                    : "Click any item below to expand/collapse its details (collapsed by default)."}
            </MessageBar>

            {/* ── 1. 使用前提 ── */}
            <Section title={zh ? "一、使用前提（重要）" : "1. Requirements"} defaultOpen>
                <MessageBar messageBarType={MessageBarType.warning} isMultiline>
                    {zh
                        ? "WebUSB 有浏览器安全限制，必须同时满足以下条件，否则「连接」不会有任何反应。"
                        : "WebUSB has browser security constraints. All of the following must hold, or Connect will do nothing."}
                </MessageBar>
                <ol style={listStyle}>
                    <li>
                        {zh ? "浏览器：仅支持 Chromium 内核 —— " : "Browser: Chromium only — "}
                        <b>Chrome / Edge</b>
                        {zh
                            ? "（Firefox、Safari 不支持 WebUSB）。"
                            : " (Firefox/Safari do not support WebUSB)."}
                    </li>
                    <li>
                        {zh ? "安全上下文：页面必须通过 " : "Secure context: the page must be served over "}
                        <C>https://</C> {zh ? " 或 " : " or "} <C>localhost</C>
                        {zh ? " 访问。用本地文件直接打开会用不了。" : ". Opening a local file will not work."}
                    </li>
                    <li>
                        {zh
                            ? "设备端：开启「开发者选项 → USB 调试」，并用支持数据传输的线连接电脑。"
                            : "Device: enable Developer options → USB debugging, and use a data-capable cable."}
                    </li>
                    <li>
                        {zh
                            ? "首次连接时，浏览器会弹出授权框，需手动选中设备（安全策略，无法自动跳过）。"
                            : "On first connect the browser shows an authorization dialog; you must pick the device manually (security policy)."}
                    </li>
                </ol>
            </Section>

            {/* ── 2. 连不上怎么办 ── */}
            <Section title={zh ? "二、连不上怎么办" : "2. Connection troubleshooting"}>
                <p style={bodyStyle}>
                    {zh
                        ? "最常见的原因是：设备已被本机的 adb server（或其他程序）占用，浏览器会提示「设备已被占用 / 访问被拒绝」。解决办法是在本机命令行执行："
                        : "The most common cause is that the device is already held by the local adb server (or another program). Fix it from your terminal:"}
                </p>
                <pre style={preStyle}>{`adb kill-server`}</pre>
                <p style={bodyStyle}>
                    {zh
                        ? "执行后回到本页重新点击「连接」。仍失败时，可在最下方「连接诊断」中一键跑通基础命令，查看具体卡在哪一步。"
                        : "Then click Connect again. If it still fails, use the Connection diagnostics panel below to see exactly which step fails."}
                </p>
            </Section>

            {/* ── 3. 功能详解（逐个页面） ── */}
            <Section title={zh ? "三、功能详解（逐页面）" : "3. Feature guide (by page)"}>
                <p style={bodyStyle}>
                    {zh
                        ? "左侧导航的每个页面都对应一类操作，下面逐一说明用途、前提与步骤。"
                        : "Each item in the left nav covers one kind of operation; details below."}
                </p>
                <ol style={listStyle}>
                    <li>
                        <b>{zh ? "设备信息" : "Device info"}</b>
                        {zh
                            ? "：连接后可读取型号、Android 版本、SDK 级别、CPU ABI、Build 类型（user/userdebug/eng）、设备序列号、屏幕分辨率与 ADB 支持的 feature 列表。用途是快速确认设备身份与是否具备提权条件（userdebug/eng 才能 adb root）。无需额外操作，连接后自动加载。"
                            : ": reads model, Android version, SDK level, CPU ABI, build type (user/userdebug/eng), serial, resolution and ADB features. Use it to confirm device identity and whether rooting is possible (userdebug/eng only). Loads automatically after connecting."}
                    </li>
                    <li>
                        <b>{zh ? "文件管理" : "File manager"}</b>
                        {zh
                            ? "：浏览设备目录、进入子目录、下载文件、上传文件或整个文件夹、新建文件夹、删除。要点：① 先选中条目再点下载/删除；② 下载文件夹会自动打包成 zip；③ 上传文件夹会保留完整目录结构；④ 非 root 时只能操作 /sdcard 等；adb root 后可操作 /data、/system。路径以面包屑显示，点击可回上级。"
                            : ": browse directories, download files, upload files or whole folders, create folders, delete. Notes: select items before download/delete; folders download as zip; folder upload keeps the tree; non-root can only touch /sdcard; after adb root you can reach /data and /system."}
                    </li>
                    <li>
                        <b>{zh ? "权限与挂载" : "Privilege & mount"}</b>
                        {zh
                            ? "：核心提权模块，含 adb root / adb unroot / adb remount / 禁用 verity。要点：① adb root 成功后 adbd 会重启、USB 断开，页面会自动重连；② remount 必须在 root 成功之后，按钮在未 root 时置灰；③ Android 10+ 动态分区设备需要先「禁用 verity」并重启，再 root → remount。"
                            : ": adb root / unroot / remount / disable-verity. Notes: after a successful adb root the adbd restarts and USB drops (the page reconnects automatically); remount requires root first, and its button is disabled until then; Android 10+ dynamic partitions need disable-verity + reboot before root → remount."}
                    </li>
                    <li>
                        <b>{zh ? "电源菜单" : "Power menu"}</b>
                        {zh
                            ? "：一键重启（adb reboot）、重启到 Recovery、重启到 Bootloader、关机、息屏、唤醒屏幕、锁屏、呼出电源菜单。用途是压测 / 稳定性测试时快速控制设备状态。注意重启类操作会断开当前连接。"
                            : ": one-click reboot, reboot to recovery/bootloader, power off, screen off/wake, lock, power menu. For quick device state control during stress tests. Reboots will drop the current connection."}
                    </li>
                    <li>
                        <b>{zh ? "WiFi ADB" : "WiFi ADB"}</b>
                        {zh
                            ? "：摆脱数据线的无线调试。正确顺序是①先用 USB 连接并读取设备 IP → ②再开启 tcpip 端口（此时 USB 会断开属正常）→ ③在本机命令行执行 adb connect <IP>:5555。注意：浏览器出于安全策略无法直接建立 TCP 连接，最后一步必须在电脑上完成。"
                            : ": wireless debugging. Correct order: ① read device IP over USB → ② enable tcpip (USB drops, normal) → ③ run adb connect <IP>:5555 on your PC. Browsers cannot open raw TCP, so the last step must be done on the computer."}
                    </li>
                    <li>
                        <b>{zh ? "终端" : "Terminal"}</b>
                        {zh
                            ? "：基于 xterm.js 的交互式 shell，支持命令输入、Ctrl+C 中断、命令历史、粘贴，以及「root 会话」开关（adb root 模式下直接是 root shell）。适合执行临时命令、查看 mount 状态、调试提权。终端宽度会与设备 PTY 实时同步，避免 ls 输出错乱。"
                            : ": interactive shell built on xterm.js with input, Ctrl+C, history, paste and a root-session toggle. Ideal for ad-hoc commands and checking mount state. Terminal width syncs to the device PTY to avoid garbled ls output."}
                    </li>
                    <li>
                        <b>{zh ? "命令大全" : "Command reference"}</b>
                        {zh
                            ? "：内置 100 条真实可用的 ADB 命令（按分类整理，不可删除/修改），支持搜索、一键复制、一键在设备上执行。你可以在此基础上新增自己的命令，新增的命令会保存到云端、共享给所有打开本网站的人；自己创建的可以随时修改或删除，他人创建的命令只读。"
                            : ": 100 built-in, ready-to-use ADB commands (grouped, not editable) with search, copy and run-on-device. Add your own commands — they are saved to the cloud and shared with everyone who opens this site; you can edit/delete the ones you created, while others' are read-only."}
                    </li>
                    <li>
                        <b>{zh ? "投屏" : "Mirror"}</b>
                        {zh
                            ? "：实时屏幕镜像（scrcpy 流），支持在画面上直接点击（点按）、拖拽（滑动）、长按 600ms 以上（长按），以及返回/主页/多任务/音量/电源等按键，并可录制为 MP4。若画面黑屏，可在下拉里切换解码器（默认软解兼容性最好，硬解更省 CPU）。首次启动会先推送 scrcpy 服务端（约 1~2 秒）。"
                            : ": live mirror (scrcpy stream) with click/drag/long-press on the canvas, nav/volume/power keys and MP4 recording. If the screen is black, switch the decoder in the dropdown (software is safest by default). First start pushes the scrcpy server (~1-2s)."}
                    </li>
                    <li>
                        <b>{zh ? "屏幕截图" : "Screen capture"}</b>
                        {zh
                            ? "：抓取当前屏幕并下载 PNG。当投屏不可用时，这是最快的看屏方式。"
                            : ": capture the current screen and download a PNG. The quickest way to see the screen when mirroring is unavailable."}
                    </li>
                    <li>
                        <b>{zh ? "日志 Logcat" : "Logcat"}</b>
                        {zh
                            ? "：实时日志。要点：① V/D/I/W/E/F 六个等级按钮，点亮即显示；② 可筛选应用（按 PID，应用重启后可刷新 PID）；③ 关键字 / 标签过滤，多项叠加生效；④ 可把日志实时写入电脑上的文件夹，每 20MB 分片，文件名用开始时间；⑤ 工具栏显示已落盘大小；⑥ 「自动停止」可设 N 分钟后自动结束采集，运行中显示剩余秒数倒计时，到时自动停止并提示。为兼顾性能，界面只渲染最近 300 行、内存保留最近 4000 行，完整内容在落盘文件里。命令侧不做设备端过滤，因此切换等级无需重新开始采集。"
                            : ": live logs. ① level buttons V/D/I/W/E/F; ② app filter by PID; ③ keyword/tag filters combined; ④ stream logs to a PC folder in 20MB parts named by start time; ⑤ toolbar shows bytes written; ⑥ Auto-stop ends capture after N minutes with a live countdown. Only the last 300 lines are rendered and 4000 kept in memory for performance; full content is in the written files. Filtering is client-side, so switching levels never restarts capture."}
                    </li>
                    <li>
                        <b>{zh ? "TEST 脚本" : "TEST Script"}</b>
                        {zh
                            ? "：把项目里常用的批处理 / shell 流程固化成按钮 —— 日志拉取到电脑（自动建时间戳子目录）、日志清理、Monkey 稳定性测试（含自检）、蓝牙 HCI 日志、CPU / 内存监控（可导出 CSV）、应用管理（可导出包名 txt）。所有命令、路径、包名都可改成你自己项目的值并保存。"
                            : ": turns common batch/shell flows into buttons — pull logs to PC (auto timestamp sub-folder), clean logs, Monkey stability test (with self-check), Bluetooth HCI logs, CPU/memory monitoring (CSV export), app management (txt export). All commands, paths and package names are editable and persisted."}
                    </li>
                    <li>
                        <b>{zh ? "安装 APK" : "Install APK"}</b>
                        {zh
                            ? "：选择本地 apk 后自动推送到设备并安装，带进度与结果。可选安装路径（SD 卡 / /data/local/tmp）。失败时会给出中文原因（签名冲突、空间不足、版本降级、包损坏等）。"
                            : ": pick a local APK; it is pushed and installed with progress. Choose install path (SD card / /data/local/tmp). Failures are explained in plain language (signature conflict, no space, downgrade, corrupt)."}
                    </li>
                </ol>
            </Section>

            {/* ── 4. 提权说明 ── */}
            <Section title={zh ? "四、提权说明（root / remount）" : "4. Privilege (root / remount)"}>
                <p style={bodyStyle}>
                    {zh
                        ? "连接成功后会自动进行三级提权探测，逐级降级："
                        : "After connecting, three privilege levels are probed in order, degrading gracefully:"}
                </p>
                <ol style={listStyle}>
                    <li>
                        <b>adb root</b>
                        {zh
                            ? "：仅在 userdebug / eng 版固件上可用（工程样机、车机常见）。成功后 adbd 重启，USB 连接会断开，页面会自动重连；此后原生 sync 通道也带 root 权限，速度最快。"
                            : ": works only on userdebug / eng builds (common on engineering samples and head units). adbd restarts and USB drops — the page reconnects automatically, after which even native sync carries root."}
                    </li>
                    <li>
                        <b>su</b>
                        {zh
                            ? "：设备已装 su（Magisk / SuperSU）时可用，通常需在手机上确认授权。此模式下文件读写会改走 shell 通道（因 sync 协议无法提权）。"
                            : ": available when su (Magisk/SuperSU) is installed, usually needs on-device approval. File I/O then goes through the shell channel since sync cannot be elevated."}
                    </li>
                    <li>
                        <b>{zh ? "普通权限" : "Normal"}</b>
                        {zh
                            ? "：前两者不可用时的降级方案，仅能访问 /sdcard、/storage 等目录。"
                            : ": fallback when the above are unavailable; only /sdcard and /storage."}
                    </li>
                </ol>
                <p style={bodyStyle}>
                    {zh
                        ? "关于 remount：它把 /system、/vendor 等只读分区重新挂载为可写，必须在 root 成功之后执行。Android 10+（动态分区）需要先「禁用 verity」并重启，再 root → remount。"
                        : "remount re-mounts /system and /vendor as writable and requires root first. On Android 10+ (dynamic partitions) you must disable-verity and reboot before root → remount."}
                </p>
            </Section>

            {/* ── 5. TEST 脚本使用教程 ── */}
            <Section title={zh ? "五、TEST 脚本使用教程" : "5. TEST Script guide"}>
                <p style={bodyStyle}>
                    {zh
                        ? "「TEST 脚本」页把项目里常用的 .bat / .sh 流程固化成了按钮。所有输入框都可以改成你自己项目的值，点「保存配置」后会存在浏览器里，下次打开还在。"
                        : "The TEST Script page turns the project's .bat/.sh flows into buttons. Every input is editable; click Save config to persist settings in your browser."}
                </p>

                <h3 style={{ fontSize: 14, fontWeight: 600, margin: "6px 0 0" }}>
                    {zh ? "① 日志拉取到电脑" : "① Pull logs to computer"}
                </h3>
                <ol style={listStyle}>
                    <li>
                        {zh
                            ? "「要拉取到电脑的路径」支持多行，每行一个设备目录（默认已按你的脚本预置 /data/yx_log、/data/anr、/data/tombstones 等）。"
                            : "Paths to pull accept multiple lines, one directory each (pre-filled from your scripts)."}
                    </li>
                    <li>
                        <b>{zh ? "选择文件夹并导出" : "Choose folder & export"}</b>
                        {zh
                            ? "：选一个电脑上的文件夹后，程序会**自动在其中新建「年月日_时分秒」子文件夹**（对应原 01_pull_log.bat 的 %a%），所有日志归入该子文件夹，多轮拉取不会混在一起；导出完成后界面会显示本次目录名。"
                            : ": after picking a PC folder, a “YYYY-MM-DD_HH-MM-SS” sub-folder is created automatically (matching 01_pull_log.bat) and all logs go inside it, so multiple pulls never mix."}
                    </li>
                    <li>
                        <b>{zh ? "拉取并下载（zip）" : "Pull & download (zip)"}</b>
                        {zh
                            ? "：不想选文件夹时，会把每个目录打包成 zip 直接下载。"
                            : ": without picking a folder, each directory is packed into a zip."}
                    </li>
                </ol>

                <h3 style={{ fontSize: 14, fontWeight: 600, margin: "6px 0 0" }}>
                    {zh ? "② 日志清理（设备端）" : "② Clean logs (on device)"}
                </h3>
                <ol style={listStyle}>
                    <li>
                        {zh
                            ? "「清空设备日志缓冲」等价于 adb logcat -c，只清 logcat 环形缓冲，不删文件。"
                            : "Clear device log buffer equals adb logcat -c (buffer only, no files)."}
                    </li>
                    <li>
                        <b>{zh ? "清理设备日志目录" : "Clean device log folders"}</b>
                        {zh
                            ? "：对「要清理的设备路径」执行 rm -rf。⚠️ 请先核对路径，这是不可撤销操作。"
                            : ": runs rm -rf on the clean paths. ⚠️ Verify first — irreversible."}
                    </li>
                </ol>

                <h3 style={{ fontSize: 14, fontWeight: 600, margin: "6px 0 0" }}>
                    {zh ? "③ Monkey 稳定性测试" : "③ Monkey stability test"}
                </h3>
                <ol style={listStyle}>
                    <li>
                        {zh
                            ? "「被测应用包名」每行一个，默认已按你的脚本填入 yaxon 系列包名；「Monkey 参数」「事件间隔(ms)」「事件总数」都可改，下方实时显示最终命令预览。"
                            : "Target packages (one per line, pre-filled), arguments, throttle and event count are editable; a live preview is shown."}
                    </li>
                    <li>
                        <b>{zh ? "自检（推荐先点）" : "Self-check (run first)"}</b>
                        {zh
                            ? "：会检查 monkey 是否存在、后台执行通道是否可用、/sdcard/yx_log 是否可写、目标包在设备上能找到几个 —— 点「后台运行 Monkey」没反应时先点它定位原因。"
                            : ": checks whether monkey exists, background channel works, /sdcard/yx_log is writable, and how many target packages exist on the device."}
                    </li>
                    <li>
                        {zh
                            ? "点「后台运行 Monkey」会在设备后台启动，输出写入 /sdcard/yx_log/monkey_时间戳.log；约 2.5 秒后会自动确认进程是否真的起来了。若未起来，可点「结束设备 monkey 进程」清理后重试。"
                            : "Run Monkey in background starts it on the device; output goes to /sdcard/yx_log/monkey_<timestamp>.log, and the process is verified after ~2.5s. Kill monkey process cleans up if needed."}
                    </li>
                </ol>

                <h3 style={{ fontSize: 14, fontWeight: 600, margin: "6px 0 0" }}>
                    {zh ? "④ 蓝牙 HCI 日志" : "④ Bluetooth HCI logs"}
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
                            : "Export HCI logs / to local folder pulls /data/misc/bluetooth/logs (root required)."}
                    </li>
                    <li>
                        {zh ? "「删除 HCI 日志」清空该目录。" : "Delete HCI logs clears that directory."}
                    </li>
                </ol>

                <h3 style={{ fontSize: 14, fontWeight: 600, margin: "6px 0 0" }}>
                    {zh ? "⑤ CPU / 内存占用监控" : "⑤ CPU / memory monitoring"}
                </h3>
                <ol style={listStyle}>
                    <li>
                        {zh
                            ? "设定采样间隔（秒）后点「开始监控」，会周期性执行 dumpsys cpuinfo / dumpsys meminfo。"
                            : "Set the interval (seconds) and click Start monitoring; it periodically runs dumpsys cpuinfo / meminfo."}
                    </li>
                    <li>
                        {zh
                            ? "上方以趋势条显示 CPU% 与内存% 变化，下方显示最近一次原始采样结果，右侧显示「上次采样」系统时点。"
                            : "Trend bars show CPU%/memory% over time; latest raw samples and the last sample timestamp are shown."}
                    </li>
                    <li>
                        <b>{zh ? "导出监控记录（CSV）" : "Export monitor log (CSV)"}</b>
                        {zh
                            ? "：可选择本地文件夹，把每次采样（时间、CPU%、内存%）保存为 CSV，便于后续用表格分析。"
                            : ": pick a local folder to save every sample (time, CPU%, memory%) as CSV for later analysis."}
                    </li>
                </ol>

                <h3 style={{ fontSize: 14, fontWeight: 600, margin: "6px 0 0" }}>
                    {zh ? "⑥ 应用管理" : "⑥ App management"}
                </h3>
                <ol style={listStyle}>
                    <li>
                        {zh
                            ? "「应用范围」默认「仅第三方」，可切「仅系统应用」或「全部应用」；点「列出应用包名」加载，搜索框可按包名过滤。"
                            : "App scope defaults to third-party only; switch to system/all. Click List app packages, then filter by name."}
                    </li>
                    <li>
                        <b>{zh ? "导出包名清单（txt）" : "Export package list (txt)"}</b>
                        {zh
                            ? "：选择本地文件夹，把当前列表存成 txt。"
                            : ": pick a local folder to save the current list as txt."}
                    </li>
                    <li>
                        {zh
                            ? "选中应用后可「启动应用」「进入应用界面」（打开系统设置里的应用详情页）或「强制停止」；勾选「启动前先强制停止」确保冷启动。"
                            : "Launch app, Open app info (system settings detail page), or Force stop; Force stop before launch ensures a cold start."}
                    </li>
                </ol>

                <h3 style={{ fontSize: 14, fontWeight: 600, margin: "6px 0 0" }}>
                    {zh ? "⑦ 安装 / 卸载 APK" : "⑦ Install / uninstall APK"}
                </h3>
                <p style={bodyStyle}>
                    {zh
                        ? "安装 APK 页支持：临时目录下拉（SD 卡 / /data/local/tmp / 自定义路径）、安装参数开关（-r 覆盖、-d 降级、-g 授权、--no-streaming 先推后装）、多选 APK 批量安装；页面底部可「列出已安装应用」并直接卸载第三方应用。"
                        : "Install APK supports: temp-dir dropdown (SD card / /data/local/tmp / custom), option toggles (-r/-d/-g/--no-streaming), multi-select batch install; the bottom section lists installed apps and uninstalls third-party ones."}
                </p>
            </Section>

            {/* ── 6. 命令大全使用教程 ── */}
            <Section title={zh ? "六、命令大全使用教程" : "6. Command reference guide"}>
                <ol style={listStyle}>
                    <li>
                        {zh
                            ? "内置 110+ 条命令按分类整理（设备与连接、设备信息、应用管理、文件操作、日志与调试、性能监控、内核与系统、输入界面、电源、网络、屏幕录制、系统权限等），分类标题可点击折叠 / 展开。右上角有锁标志的是内置命令，不可删除、不可修改。"
                            : "110+ built-in commands grouped by category (collapsible headers); those with a lock icon are built-in and cannot be edited."}
                    </li>
                    <li>
                        {zh
                            ? "每条命令都标注了「网页可执行」（带 adb shell，可直接在当前设备运行）或「电脑端」（需在本机命令行执行），还有「危险」标记。可用右上角下拉只显示「仅网页可执行」的命令。"
                            : "Each command is tagged “web-runnable” (adb shell …) or “host”; danger commands are flagged. The dropdown can show web-runnable only."}
                    </li>
                    <li>
                        {zh
                            ? "搜索框按命令或说明过滤；分类下拉可只看某一类；上方可切换「全部命令 / 仅网页可执行」。"
                            : "Filter by search box or category; toggle between all commands and web-runnable only."}
                    </li>
                    <li>
                        {zh
                            ? "每条命令右侧：「复制」拿到命令文本；「执行」就地弹出结果框（不占据列表空间）——带 adb shell 的会真正在设备上运行，电脑端的命令会给出网页内的等价结果或跳转指引（例如 adb devices -l 会返回当前设备的完整信息，adb root 会引导到「权限与挂载」页）。自定义命令额外有「修改」「删除」。"
                            : "Each row: Copy, and Run (shows results in a dialog). adb shell commands run on the device; host commands return an equivalent result or a jump hint (adb devices -l returns the current device info; adb root points to the Privilege page)."}
                    </li>
                    <li>
                        {zh
                            ? "点「新增命令」填写分类、命令、说明即可。新增的命令会保存到云端，所有打开本网站的人都能看到（页面顶部会显示是否已连接云端）。"
                            : "Click Add command to create one. It is saved to the cloud and shared with every visitor (the banner shows cloud status)."}
                    </li>
                    <li>
                        {zh
                            ? "若顶部提示「云端暂不可用」，说明网络或云端异常，此时新增的命令只保存在本机浏览器，不会共享；网络恢复后点「刷新云端」重新同步。也可用「导出 JSON」把命令集分享给同事。"
                            : "If the banner says the cloud is unavailable, new commands are kept locally only; click Refresh cloud once network returns. Export JSON shares your set with colleagues."}
                    </li>
                </ol>
            </Section>

            {/* ── 7. 连接诊断 ── */}
            <Section title={zh ? "七、连接诊断" : "7. Connection diagnostics"}>
                <p style={bodyStyle}>
                    {zh
                        ? "连接异常时点下方按钮，会依次执行若干条基础命令并显示每步的真实返回，便于定位卡在哪一环。"
                        : "When something fails, click below to run basic commands step by step and see the real output of each."}
                </p>
                <Diagnostics />
            </Section>

            <p
                style={{
                    ...bodyStyle,
                    color: "#a19f9d",
                    fontSize: 12,
                    marginTop: 8,
                }}
            >
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

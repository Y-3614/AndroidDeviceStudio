/**
 * ADB 常用命令大全 —— 内置 100 条**真实可用**的命令。
 *
 * ⚠️ 内置命令（builtin: true）在 UI 上**不可删除、不可修改**，
 * 用户只能在它们之上新增自己的命令；用户新增的命令才可改可删。
 *
 * 命令按用途分类，便于检索与查阅。
 */

export interface AdbCommand {
    /** 稳定 ID（builtin 用固定 id，云端用 c_<id>，本地用 uuid） */
    id: string;
    /** 分类（用于分组与筛选） */
    category: string;
    /** 命令本体（可复制的完整命令） */
    command: string;
    /** 中文说明：这条命令做什么、什么时候用 */
    description: string;
    /** 是否内置（内置不可删除） */
    builtin: boolean;
    /** 云端行 ID（仅自定义命令、且已同步到云端时存在） */
    cloudId?: number;
    /** 是否为当前浏览器创建的（决定能否编辑/删除） */
    mine?: boolean;
}

/** 分类顺序（导航与分组按此顺序展示） */
export const COMMAND_CATEGORIES = [
    "设备与连接",
    "设备信息",
    "应用管理",
    "安装与卸载",
    "启动与停止",
    "文件操作",
    "日志与调试",
    "性能与监控",
    "输入与界面",
    "电源与重启",
    "网络与端口",
    "屏幕与录制",
    "系统与权限",
] as const;

export type CommandCategory = (typeof COMMAND_CATEGORIES)[number];

const b = (
    id: string,
    category: CommandCategory,
    command: string,
    description: string,
): AdbCommand => ({ id, category, command, description, builtin: true });

/** 内置 100 条命令 */
export const BUILTIN_COMMANDS: AdbCommand[] = [
    /* ---------- 设备与连接（9） ---------- */
    b("d01", "设备与连接", "adb devices -l", "列出已连接设备，含型号与传输方式（usb / product 信息）。"),
    b("d02", "设备与连接", "adb connect 192.168.1.100:5555", "通过 WiFi 连接设备（需先用 adb tcpip 5555 开启无线端口）。IP 换成设备实际地址。"),
    b("d03", "设备与连接", "adb disconnect", "断开所有无线（TCP）连接。"),
    b("d04", "设备与连接", "adb kill-server", "结束本机 adb 服务。网页提示「设备被占用」时执行它即可释放。"),
    b("d05", "设备与连接", "adb start-server", "启动本机 adb 服务。"),
    b("d06", "设备与连接", "adb get-state", "查询设备状态：device（正常）/ offline（离线）/ unknown。"),
    b("d07", "设备与连接", "adb get-serialno", "获取设备序列号。"),
    b("d08", "设备与连接", "adb wait-for-device", "阻塞等待，直到设备上线（常用于脚本里确保设备就绪）。"),
    b("d09", "设备与连接", "adb usb", "把设备切回 USB 连接模式（从无线切回来时用）。"),

    /* ---------- 设备信息（8） ---------- */
    b("i01", "设备信息", "adb shell getprop ro.product.model", "读取设备型号。"),
    b("i02", "设备信息", "adb shell getprop ro.build.version.release", "读取 Android 版本号（如 12）。"),
    b("i03", "设备信息", "adb shell getprop ro.build.version.sdk", "读取 API 级别（如 31）。"),
    b("i04", "设备信息", "adb shell getprop ro.product.cpu.abi", "读取 CPU 架构（如 arm64-v8a）。"),
    b("i05", "设备信息", "adb shell getprop ro.build.type", "读取固件类型：user / userdebug / eng。判断能否 adb root 的关键。"),
    b("i06", "设备信息", "adb shell getprop ro.serialno", "读取设备序列号。"),
    b("i07", "设备信息", "adb shell wm size", "查看屏幕分辨率。"),
    b("i08", "设备信息", "adb shell wm density", "查看屏幕密度（DPI）。"),

    /* ---------- 应用管理（12） ---------- */
    b("a01", "应用管理", "adb shell pm list packages", "列出设备上所有应用包名。"),
    b("a02", "应用管理", "adb shell pm list packages -3", "仅列出第三方应用（-3 = 非系统）。"),
    b("a03", "应用管理", "adb shell pm list packages -s", "仅列出系统应用。"),
    b("a04", "应用管理", "adb shell pm list packages -d", "仅列出已被禁用的应用。"),
    b("a05", "应用管理", "adb shell pm list packages -e", "仅列出已启用的应用。"),
    b("a06", "应用管理", "adb shell pm list packages | grep yaxon", "按关键字过滤包名（把 yaxon 换成你要找的关键字）。"),
    b("a07", "应用管理", "adb shell pm path com.yaxon.radio", "查看应用的 APK 安装路径，可用于提取已装应用。"),
    b("a08", "应用管理", "adb shell dumpsys package com.yaxon.radio", "查看应用详细信息（版本、权限、Activity 等）。"),
    b("a09", "应用管理", "adb shell pm clear com.yaxon.radio", "清除应用数据（相当于「清除数据」，不可恢复）。"),
    b("a10", "应用管理", "adb shell pm disable-user com.yaxon.radio", "禁用应用（可随时用 enable 恢复，不会卸载）。"),
    b("a11", "应用管理", "adb shell pm enable com.yaxon.radio", "启用被禁用的应用。"),
    b("a12", "应用管理", "adb shell pm list packages -f", "列出包名同时显示 APK 路径。"),

    /* ---------- 安装与卸载（5） ---------- */
    b("p01", "安装与卸载", "adb install app.apk", "安装 APK。"),
    b("p02", "安装与卸载", "adb install -r app.apk", "覆盖安装并保留原有数据。"),
    b("p03", "安装与卸载", "adb install -r -d app.apk", "覆盖安装并允许版本降级。"),
    b("p04", "安装与卸载", "adb install -g app.apk", "安装并自动授予全部运行时权限。"),
    b("p05", "安装与卸载", "adb uninstall com.yaxon.radio", "卸载应用。"),

    /* ---------- 启动与停止（7） ---------- */
    b("s01", "启动与停止", "adb shell monkey -p com.yaxon.radio -c android.intent.category.LAUNCHER 1", "启动指定应用（通用做法，无需知道 Activity 名）。"),
    b("s02", "启动与停止", "adb shell am start -n com.yaxon.radio/.MainActivity", "启动指定 Activity（需知道完整类名）。"),
    b("s03", "启动与停止", "adb shell am force-stop com.yaxon.radio", "强制停止应用（完全结束，含后台服务）。"),
    b("s04", "启动与停止", "adb shell am kill com.yaxon.radio", "结束后台进程（保留前台与前台服务）。"),
    b("s05", "启动与停止", "adb shell am start -a android.intent.action.VIEW -d https://www.baidu.com", "用浏览器打开一个网址。"),
    b("s06", "启动与停止", "adb shell am start -a android.settings.SETTINGS", "打开系统设置主界面。"),
    b("s07", "启动与停止", "adb shell am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:com.yaxon.radio", "直接打开某应用的详情页。"),

    /* ---------- 文件操作（10） ---------- */
    b("f01", "文件操作", "adb push D:/test.txt /sdcard/", "把电脑上的文件推送到设备。"),
    b("f02", "文件操作", "adb pull /sdcard/test.txt D:/", "把设备上的文件拉到电脑。"),
    b("f03", "文件操作", "adb shell ls -al /sdcard", "列出目录内容，含权限、大小、时间。"),
    b("f04", "文件操作", "adb shell ls -al /data/local/tmp", "列出指定目录（换路径即可）。"),
    b("f05", "文件操作", "adb shell mkdir -p /sdcard/test", "创建目录（-p 表示父目录不存在时一并创建）。"),
    b("f06", "文件操作", "adb shell rm -rf /sdcard/test", "删除文件或目录（⚠️ 不可恢复，务必核对路径）。"),
    b("f07", "文件操作", "adb shell cp /sdcard/a.txt /sdcard/b.txt", "复制文件。"),
    b("f08", "文件操作", "adb shell mv /sdcard/a.txt /sdcard/b.txt", "移动或重命名文件。"),
    b("f09", "文件操作", "adb shell cat /sdcard/test.txt", "查看文本文件内容。"),
    b("f10", "文件操作", "adb shell df -h", "查看各分区剩余空间。"),

    /* ---------- 日志与调试（10） ---------- */
    b("l01", "日志与调试", "adb logcat", "实时输出设备日志。"),
    b("l02", "日志与调试", "adb logcat -v time", "带时间戳输出日志（最常用）。"),
    b("l03", "日志与调试", "adb logcat -v threadtime", "线程时间格式，含 PID / TID，便于定位线程。"),
    b("l04", "日志与调试", "adb logcat -c", "清空日志缓冲区。"),
    b("l05", "日志与调试", "adb logcat -d", "输出当前缓冲区内容后立即退出（不阻塞）。"),
    b("l06", "日志与调试", "adb logcat -G 16M", "把日志缓冲区大小设为 16M（默认较小，长时间抓日志建议调大）。"),
    b("l07", "日志与调试", "adb logcat -b main", "只查看 main 缓冲区（还可选 system / crash / events）。"),
    b("l08", "日志与调试", "adb logcat -s ActivityManager", "只显示指定标签的日志。"),
    b("l09", "日志与调试", "adb logcat *:E", "只显示 Error 及以上级别（V/D/I/W/E/F）。"),
    b("l10", "日志与调试", "adb logcat -v time > log.txt", "抓取日志并保存到本地文件（在电脑命令行执行）。"),

    /* ---------- 性能与监控（8） ---------- */
    b("m01", "性能与监控", "adb shell dumpsys cpuinfo", "查看各进程 CPU 占用及总计。"),
    b("m02", "性能与监控", "adb shell dumpsys meminfo", "查看系统整体内存使用情况。"),
    b("m03", "性能与监控", "adb shell dumpsys meminfo com.yaxon.radio", "查看指定应用的内存占用明细。"),
    b("m04", "性能与监控", "adb shell top -n 1", "进程资源占用快照（CPU / 内存排序）。"),
    b("m05", "性能与监控", "adb shell dumpsys battery", "查看电池状态与电量。"),
    b("m06", "性能与监控", "adb shell dumpsys battery set level 50", "模拟电量 50%（调试用，仅工程机有效）。"),
    b("m07", "性能与监控", "adb shell dumpsys battery unplug", "模拟拔掉充电器（调试充电相关逻辑）。"),
    b("m08", "性能与监控", "adb shell dumpsys battery reset", "恢复真实电池状态。"),

    /* ---------- 输入与界面（8） ---------- */
    b("n01", "输入与界面", "adb shell input tap 500 1000", "在屏幕坐标 (500,1000) 处点击。"),
    b("n02", "输入与界面", "adb shell input swipe 300 1000 300 300", "从 (300,1000) 滑到 (300,300)。"),
    b("n03", "输入与界面", "adb shell input swipe 500 500 500 500 1000", "长按：起止同点，时长 1000ms。"),
    b("n04", "输入与界面", "adb shell input text \"hello\"", "输入文本（不支持中文，中文需用其他输入法方案）。"),
    b("n05", "输入与界面", "adb shell input keyevent 3", "按键：3 = Home。"),
    b("n06", "输入与界面", "adb shell input keyevent 4", "按键：4 = 返回。"),
    b("n07", "输入与界面", "adb shell input keyevent 26", "按键：26 = 电源。"),
    b("n08", "输入与界面", "adb shell input keyevent 224", "按键：224 = 唤醒屏幕。"),

    /* ---------- 电源与重启（6） ---------- */
    b("w01", "电源与重启", "adb reboot", "重启设备。"),
    b("w02", "电源与重启", "adb reboot recovery", "重启进入 Recovery 模式。"),
    b("w03", "电源与重启", "adb reboot bootloader", "重启进入 Bootloader（fastboot）模式。"),
    b("w04", "电源与重启", "adb shell reboot -p", "关机。"),
    b("w05", "电源与重启", "adb shell svc power stayon true", "屏幕保持常亮（调试时防止息屏）。"),
    b("w06", "电源与重启", "adb shell settings put system screen_off_timeout 600000", "把自动息屏时间设为 10 分钟（600000ms）。"),

    /* ---------- 网络与端口（7） ---------- */
    b("t01", "网络与端口", "adb tcpip 5555", "开启无线调试端口（设备重启后失效）。"),
    b("t02", "网络与端口", "adb shell ip route", "查看网络路由与设备 IP。"),
    b("t03", "网络与端口", "adb shell ifconfig wlan0", "查看无线网卡信息（含 IP）。"),
    b("t04", "网络与端口", "adb forward tcp:8080 tcp:8080", "端口转发：电脑 8080 → 设备 8080。"),
    b("t05", "网络与端口", "adb reverse tcp:8080 tcp:8080", "反向转发：设备 8080 → 电脑 8080。"),
    b("t06", "网络与端口", "adb shell svc wifi enable", "打开 WiFi。"),
    b("t07", "网络与端口", "adb shell svc wifi disable", "关闭 WiFi。"),

    /* ---------- 屏幕与录制（4） ---------- */
    b("r01", "屏幕与录制", "adb shell screencap -p /sdcard/screen.png", "截图并保存到设备。"),
    b("r02", "屏幕与录制", "adb exec-out screencap -p > screen.png", "截图并直接保存到电脑（无需二次 pull）。"),
    b("r03", "屏幕与录制", "adb shell screenrecord /sdcard/video.mp4", "录屏（默认最长 180 秒，Ctrl+C 提前结束）。"),
    b("r04", "屏幕与录制", "adb shell screenrecord --time-limit 10 /sdcard/video.mp4", "限时 10 秒录屏。"),

    /* ---------- 系统与权限（6） ---------- */
    b("y01", "系统与权限", "adb root", "以 root 权限重启 adbd。仅 userdebug / eng 固件可用。"),
    b("y02", "系统与权限", "adb unroot", "把 adbd 恢复为普通权限。"),
    b("y03", "系统与权限", "adb remount", "把 /system 等只读分区重新挂载为可写（需先 root）。"),
    b("y04", "系统与权限", "adb shell su -c id", "检测设备是否已 root（返回 uid=0 即已 root）。"),
    b("y05", "系统与权限", "adb shell mount | grep system", "查看系统分区挂载状态（rw 表示可写）。"),
    b("y06", "系统与权限", "adb shell settings get global device_provisioned", "查看设备是否已完成初始化。"),
];

/** 快捷统计 */
export const BUILTIN_COUNT = BUILTIN_COMMANDS.length;

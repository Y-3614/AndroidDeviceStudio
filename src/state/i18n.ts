import { makeAutoObservable, runInAction } from "mobx";

export type Lang = "zh" | "en";

const STORAGE_KEY = "adb-studio-lang";

/** 所有静态 UI 文案。动态内容（文件名、日志）不翻译。 */
const dict = {
    zh: {
        appName: "Android Device Studio",
        tryNewApp: "试试新版本",
        feedback: "反馈",
        toggleMenu: "切换菜单",

        availableDevices: "可用设备",
        noAvailableDevices: "暂无可用设备",
        connect: "连接",
        disconnect: "断开",
        add: "添加设备",
        grantDevice: "授权 USB 设备",
        webusbUnsupported:
            "当前浏览器不支持 WebUSB。请使用最新版 Chrome 或 Edge 打开本页面。",
        connecting: "连接中…",
        authenticating: "认证中（请在手机上确认授权）…",
        connected: "已连接",

        nav: {
            readme: "说明",
            deviceInfo: "设备信息",
            fileManager: "文件管理",
            screenCapture: "屏幕截图",
            terminal: "终端",
            mirror: "投屏",
            record: "录制",
            logcat: "日志 Logcat",
            install: "安装 APK",
            privilege: "权限与挂载",
            power: "电源与WiFi",
        },

        upload: "上传",
        download: "下载",
        delete: "删除",
        refresh: "刷新",
        cancel: "取消",
        confirm: "确定",
        close: "关闭",
        save: "保存",
        clear: "清空",
        start: "开始",
        stop: "停止",
        pause: "暂停",
        resume: "继续",

        colFileType: "类型",
        colName: "名称",
        colPermission: "权限",
        colSize: "大小",
        colMtime: "修改时间",
        colCtime: "创建时间",
        colAtime: "访问时间",
        breadcrumbRoot: "设备",

        uploading: "上传中…",
        downloading: "下载中…",
        uploadingProgress: "上传进度",
        uploadFolder: "上传文件夹",
        newFolder: "新建文件夹",
        newFolderPrompt: "请输入文件夹名称：",
        confirmDelete: "确定要删除选中的 {count} 个项目吗？此操作不可撤销。",
        emptyFolder: "此文件夹为空",
        requiresRoot: "此目录需要 root 权限，当前设备未授权。",
        loadFailed: "加载失败",
        operationFailed: "操作失败",

        privilegeTitle: "权限与挂载",
        currentStatus: "当前状态",
        privUnknown: "未探测",
        privNone: "普通权限",
        privSu: "su 提权",
        privAdbRoot: "adb root",
        adbRoot: "adb root",
        adbUnroot: "adb unroot",
        adbRemount: "adb remount",
        disableVerity: "禁用 verity",
        mountState: "分区状态",
        mountReadonly: "只读",
        mountWritable: "可写",
        mountUnknown: "未知",
        rootHint: "需先 root 成功，remount 才可用",
        reprobe: "重新探测",
        rootRestartHint:
            "注意：adb root / adb unroot 会导致 adbd 重启、当前 USB 连接断开，这是正常现象。执行后请点击「重新连接」恢复。",
        verityHint:
            "Android 10+ 动态分区需先「禁用 verity」并重启，再执行 root → remount。",
        forceDisable: "调试：强制关闭提权",
        forceDisableHint: "开启后所有操作以普通权限执行，便于对比行为差异",

        terminalRootShell: "root 会话",
        terminalRootHint: "开启后以 su 身份打开会话（设备需已 root）",
        terminalAlreadyRoot: "当前 adbd 已是 root，无需再开 su",
        fontSize: "字号",
        copyOutput: "复制输出",
        clearScreen: "清屏",

        mirrorStart: "开始投屏",
        mirrorStop: "停止投屏",
        mirrorPushServer: "推送 scrcpy 服务端…",
        mirrorStarting: "启动投屏…",
        recordStart: "开始录制",
        recordStop: "停止录制并下载",
        rotate: "旋转",
        powerKey: "电源键",
        volUp: "音量 +",
        volDown: "音量 -",
        navBack: "返回",
        navHome: "主页",
        navRecents: "多任务",

        captureScreenshot: "截取当前屏幕",
        screenshotSaved: "截图已下载",

        logcatFilter: "过滤",
        logcatTag: "标签",
        logcatPriority: "级别",
        logcatFormat: "格式",
        logcatBuffer: "缓冲区",
        logcatLevel: "日志等级",
        levelOn: "已显示，点击隐藏",
        levelOff: "已隐藏，点击显示",
        levelAll: "全选",
        levelNone: "全不选",
        clearDeviceBuffer: "清空设备缓冲",
        clearDeviceBufferHint: "在设备上执行 logcat -c，清掉历史日志",
        keywordFilter: "关键字",
        tagFilter: "标签",
        appFilter: "应用",
        loadApps: "加载应用列表",
        allApps: "全部应用",
        refreshPid: "刷新 PID",
        autoScroll: "自动滚动",
        exportLog: "导出日志",
        logFolder: "日志保存文件夹",
        chooseFolder: "选择文件夹",
        clearFolder: "改用浏览器内存",
        logFolderHint:
            "选择本地文件夹后，日志会按 20MB 分片写入该文件夹（文件名以开始打印的时间命名），不再受浏览器内存限制。未选择时仅缓存在浏览器内存中。",
        folderUnsupported:
            "当前浏览器不支持选择文件夹（需桌面版 Chrome/Edge）。日志将仅缓存在浏览器内存。",
        defaultBrowserMemory: "浏览器内存（未选择文件夹）",
        autoStopAfter: "自动停止",
        minutes: "分钟",
        unlimited: "不限制",
        collectedLines: "已采集",
        showingLines: "显示",
        autoStopped: "已达到设定的时间，自动停止采集",
        logcatPickAppHint: "选择应用后仅显示该应用的日志（按 PID 过滤，可按「刷新 PID」重新匹配）",
        logcatNoData:
            "暂无日志。请点击「开始」，并确认应用的日志等级已勾选（默认显示 Debug 及以上）。",

        powerTitle: "电源与设备控制",
        reboot: "重启",
        rebootRecovery: "重启到 Recovery",
        rebootBootloader: "重启到 Bootloader",
        powerOff: "关机",
        screenOff: "息屏",
        screenOn: "唤醒屏幕",
        lockScreen: "锁屏",
        powerDialog: "电源菜单（长按电源）",
        wakeUp: "唤醒",
        sleep: "息屏",
        wifiAdbTitle: "ADB over WiFi",
        wifiAdbHint:
            "① 先用 USB 连接设备；② 点「开启 TCPIP」让设备监听端口；③ 点「读取设备 IP」获取地址。得到 IP:端口后，可在本机命令行用 adb connect 连接（浏览器出于安全限制无法直接建立 TCP 连接）。",
        wifiPort: "端口",
        enableTcpip: "开启 TCPIP",
        readIp: "读取设备 IP",
        deviceIp: "设备地址（IP:端口）",

        screenshotForbidden: "该应用禁止了截屏（FrameBuffer 不可用），请切换到桌面后重试。",

        pushing: "推送",
        apkPushFailed: "APK 推送失败，设备上未找到该文件",
        hintAlreadyExists:
            "提示：已存在同包名应用且签名不同，请先卸载旧版本再安装。",
        hintSignature:
            "提示：已安装版本与新 APK 签名不一致，需先卸载原应用（会清除其数据）。",
        hintNoSpace: "提示：设备存储空间不足，请清理后重试。",
        hintDowngrade: "提示：新版本号低于已安装版本，可先卸载旧版或提升版本号。",
        hintParse: "提示：APK 文件损坏或不是有效的安装包。",

        installTitle: "安装 APK",
        chooseApk: "选择 APK 文件",
        installing: "安装中…",
        installDone: "安装完成",
        installFailed: "安装失败",

        deviceProperties: "设备属性",
        adbFeatures: "ADB 能力",

        ready: "就绪",
        waiting: "等待设备连接…",
        loading: "加载中…",
        reconnect: "重新连接",
    },
    en: {
        appName: "Android Device Studio",
        tryNewApp: "Try new version",
        feedback: "Feedback",
        toggleMenu: "Toggle Menu",

        availableDevices: "Available devices",
        noAvailableDevices: "No available devices",
        connect: "Connect",
        disconnect: "Disconnect",
        add: "Add",
        grantDevice: "Authorize USB device",
        webusbUnsupported:
            "Your browser does not support WebUSB. Please open this page with the latest Chrome or Edge.",
        connecting: "Connecting…",
        authenticating: "Authenticating (confirm on your device)…",
        connected: "Connected",

        nav: {
            readme: "README",
            deviceInfo: "Device Info",
            fileManager: "File Manager",
            screenCapture: "Screen Capture",
            terminal: "Terminal",
            mirror: "Mirror",
            record: "Record",
            logcat: "Logcat",
            install: "Install APK",
            privilege: "Privilege & Mount",
            power: "Power & WiFi",
        },

        upload: "Upload",
        download: "Download",
        delete: "Delete",
        refresh: "Refresh",
        cancel: "Cancel",
        confirm: "Confirm",
        close: "Close",
        save: "Save",
        clear: "Clear",
        start: "Start",
        stop: "Stop",
        pause: "Pause",
        resume: "Resume",

        colFileType: "File Type",
        colName: "Name",
        colPermission: "Permission",
        colSize: "Size",
        colMtime: "Last Modified Time",
        colCtime: "Creation Time",
        colAtime: "Last Access Time",
        breadcrumbRoot: "Device",

        uploading: "Uploading…",
        downloading: "Downloading…",
        uploadingProgress: "Upload progress",
        uploadFolder: "Upload folder",
        newFolder: "New folder",
        newFolderPrompt: "Enter folder name:",
        confirmDelete: "Delete {count} selected item(s)? This cannot be undone.",
        emptyFolder: "This folder is empty",
        requiresRoot: "This directory requires root, but the device is not authorized.",
        loadFailed: "Failed to load",
        operationFailed: "Operation failed",

        privilegeTitle: "Privilege & Mount",
        currentStatus: "Status",
        privUnknown: "Unknown",
        privNone: "Normal",
        privSu: "su",
        privAdbRoot: "adb root",
        adbRoot: "adb root",
        adbUnroot: "adb unroot",
        adbRemount: "adb remount",
        disableVerity: "Disable verity",
        mountState: "Mount state",
        mountReadonly: "Read-only",
        mountWritable: "Writable",
        mountUnknown: "Unknown",
        rootHint: "Root is required before remount",
        reprobe: "Re-probe",
        rootRestartHint:
            "Note: adb root / adb unroot restart adbd and drop the current USB connection — this is expected. Click \"Reconnect\" afterwards.",
        verityHint:
            "Android 10+ dynamic partitions require disable-verity + reboot before root → remount.",
        forceDisable: "Debug: force-disable privilege",
        forceDisableHint:
            "When on, all operations run with normal permissions for comparison",

        terminalRootShell: "root shell",
        terminalRootHint: "Open the session as su (device must be rooted)",
        terminalAlreadyRoot: "adbd is already root — su is not needed",
        fontSize: "Font size",
        copyOutput: "Copy output",
        clearScreen: "Clear",

        mirrorStart: "Start mirror",
        mirrorStop: "Stop mirror",
        mirrorPushServer: "Pushing scrcpy server…",
        mirrorStarting: "Starting mirror…",
        recordStart: "Start recording",
        recordStop: "Stop & download",
        rotate: "Rotate",
        powerKey: "Power",
        volUp: "Vol +",
        volDown: "Vol -",
        navBack: "Back",
        navHome: "Home",
        navRecents: "Recents",

        captureScreenshot: "Capture screen",
        screenshotSaved: "Screenshot downloaded",

        logcatFilter: "Filter",
        logcatTag: "Tag",
        logcatPriority: "Priority",
        logcatFormat: "Format",
        logcatBuffer: "Buffer",
        logcatLevel: "Log level",
        levelOn: "Shown, click to hide",
        levelOff: "Hidden, click to show",
        levelAll: "All",
        levelNone: "None",
        clearDeviceBuffer: "Clear device buffer",
        clearDeviceBufferHint: "Run logcat -c on device to wipe history",
        keywordFilter: "Keyword",
        tagFilter: "Tag",
        appFilter: "App",
        loadApps: "Load apps",
        allApps: "All apps",
        refreshPid: "Refresh PID",
        autoScroll: "Auto scroll",
        exportLog: "Export",
        logFolder: "Log folder",
        chooseFolder: "Choose folder",
        clearFolder: "Use browser memory",
        logFolderHint:
            "Pick a local folder to stream logs to disk in 20MB parts (named by the session start time); no more browser memory limit. Otherwise logs stay in memory only.",
        folderUnsupported:
            "Folder picker unsupported (needs desktop Chrome/Edge). Logs will stay in memory.",
        defaultBrowserMemory: "Browser memory (no folder chosen)",
        autoStopAfter: "Auto stop after",
        minutes: "min",
        unlimited: "Unlimited",
        collectedLines: "Collected",
        showingLines: "Showing",
        autoStopped: "Auto-stopped after the configured duration",
        logcatPickAppHint:
            "Select an app to show only its logs (filtered by PID; use Refresh PID to re-match).",
        logcatNoData:
            "No logs yet. Click Start and make sure at least one level is enabled (Debug and above by default).",

        powerTitle: "Power & Device Control",
        reboot: "Reboot",
        rebootRecovery: "Reboot to Recovery",
        rebootBootloader: "Reboot to Bootloader",
        powerOff: "Power off",
        screenOff: "Screen off",
        screenOn: "Wake screen",
        lockScreen: "Lock",
        powerDialog: "Power menu (long-press power)",
        wakeUp: "Wake",
        sleep: "Sleep",
        wifiAdbTitle: "ADB over WiFi",
        wifiAdbHint:
            "① Connect via USB; ② click Enable TCPIP so the device listens on a port; ③ click Read device IP. Then use `adb connect <ip>:<port>` from your terminal (browsers cannot open raw TCP connections for security reasons).",
        wifiPort: "Port",
        enableTcpip: "Enable TCPIP",
        readIp: "Read device IP",
        deviceIp: "Device address (IP:port)",

        screenshotForbidden:
            "This app blocks screenshots (FrameBuffer unavailable). Try again from the home screen.",

        pushing: "Pushing",
        apkPushFailed: "Failed to push APK — file not found on device",
        hintAlreadyExists:
            "Hint: an app with the same package but a different signature exists. Uninstall the old one first.",
        hintSignature:
            "Hint: signature mismatch with the installed version. Uninstall the old app first (its data will be cleared).",
        hintNoSpace: "Hint: not enough storage on device.",
        hintDowngrade:
            "Hint: version code is lower than the installed one. Uninstall first or raise the version code.",
        hintParse: "Hint: the APK is corrupt or not a valid package.",

        installTitle: "Install APK",
        chooseApk: "Choose APK file",
        installing: "Installing…",
        installDone: "Installed",
        installFailed: "Install failed",

        deviceProperties: "Device properties",
        adbFeatures: "ADB features",

        ready: "Ready",
        waiting: "Waiting for device…",
        loading: "Loading…",
        reconnect: "Reconnect",
    },
} as const;

export type Strings = typeof dict.zh;

class I18nStore {
    lang: Lang = "zh";

    constructor() {
        makeAutoObservable(this);
        if (typeof localStorage !== "undefined") {
            const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
            if (saved === "zh" || saved === "en") {
                this.lang = saved;
            }
        }
    }

    get t(): Strings {
        return dict[this.lang] as Strings;
    }

    setLang(lang: Lang) {
        runInAction(() => {
            this.lang = lang;
        });
        if (typeof localStorage !== "undefined") {
            localStorage.setItem(STORAGE_KEY, lang);
        }
    }

    toggle() {
        this.setLang(this.lang === "zh" ? "en" : "zh");
    }
}

export const i18n = new I18nStore();

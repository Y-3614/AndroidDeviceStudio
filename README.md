# Android Device Studio

基于浏览器的 Android 设备工具箱。通过 WebUSB 直连设备（无需安装任何客户端），
提供文件管理、终端、投屏录制、日志、APK 安装、电源控制等常用能力，并支持
`adb root` / `adb remount` 提权操作。

> 反馈 / Issues：https://github.com/Y-3614/AndroidDeviceStudio

## 快速开始

```bash
npm install
npm run dev      # 开发：http://localhost:3000
npm run build    # 构建到 dist/
npm run preview  # 预览构建产物
```

## 使用前提（重要）

WebUSB 有浏览器安全限制，请务必满足以下条件，否则「连接」按钮不会有任何反应：

1. **浏览器**：仅支持 Chromium 内核 —— **Chrome / Edge**（Firefox、Safari 不支持 WebUSB）。
2. **安全上下文**：页面必须通过 **HTTPS** 或 **localhost** 访问。
3. **设备端**：开启「开发者选项 → USB 调试」，用数据线连接电脑。
4. 首次连接需在弹出的系统授权框中**手动选择设备**（浏览器安全策略，无法自动跳过）。

### 连接失败提示

若提示「设备已被占用」，通常是本机的 adb server 抢先占用了设备。
在本机命令行执行后重试：

```bash
adb kill-server
```

## 功能一览

| 页面 | 能力 |
| --- | --- |
| 说明 | 使用说明 + 连接诊断面板（逐条执行基础命令并显示真实返回） |
| 设备信息 | 读取型号、Android 版本、SDK、ABI、Build 类型等属性 |
| 文件管理 | 浏览 / 上传（含整个文件夹）/ 下载（目录自动打包 zip）/ 删除 / 新建文件夹 |
| 权限与挂载 | `adb root` / `adb unroot` / `adb remount` / `disable-verity`，带依赖联锁 |
| 电源与 WiFi | 重启 / Recovery / Bootloader / 关机 / 息屏 / 唤醒 / 锁屏；ADB over WiFi（tcpip 端口 + 设备 IP） |
| 终端 | 基于 xterm.js 的交互式 shell，支持 root 会话切换 |
| 投屏 | 基于 framebuffer 的实时画面 + 常用导航/电源键 + 录制为 WebM |
| 屏幕截图 | 抓取当前屏幕并下载为 PNG |
| 日志 Logcat | 实时日志、等级开关、应用/关键字/标签过滤、本地文件夹落盘（20MB 分片） |
| 安装 APK | 推送至 `/data/local/tmp` 并安装，显示进度与失败原因提示 |

顶栏提供**中英文切换**（选择持久化到 localStorage）。默认打开「说明」页。

## 日志 Logcat 说明

- **等级过滤**：V / D / I / W / E / F 六个按钮独立开关，默认显示 Debug 及以上。
  命令侧**不做设备端等级过滤**（全量拉取），因此切换等级无需重启采集。
- **应用识别**：可从设备已安装应用中选择包名，按 PID 精确过滤该应用日志；
  应用重启后点「刷新 PID」重新匹配。
- **关键字 / 标签过滤**：与等级、应用过滤**叠加生效**（AND 关系）。
- **本地落盘**：可选择一个本地文件夹，日志会实时写入该文件夹，
  按 **20MB 分片**，文件名以**开始采集的时间**命名（如 `logcat-20261127-163012.txt`）。
  未选择文件夹时仅缓存在浏览器内存中。
- **自动停止**：可设置采集时长（1/5/10/30/60 分钟），到时自动停止。

## 提权说明

连接成功后会自动进行**三级提权探测**：

| 顺序 | 方式 | 条件 |
| --- | --- | --- |
| ① | `adb root` | 仅 **userdebug / eng 版固件**可用；user 版零售机会返回 `adbd cannot run as root in production builds` |
| ② | `su -c id` | 设备已安装 `su`（Magisk / SuperSU），通常需在手机上确认授权 |
| ③ | 普通权限 | 前两者都不可用时的降级方案 |

> **重要**：`adb root` / `adb unroot` 会让 adbd 重启，**当前 USB 连接会断开**。
> 界面会自动重连并重新探测权限级别。

### 关于 `adb remount`

`remount` 把 `/system`、`/vendor` 等只读分区重新挂载为可写，**必须在 root 成功之后**才能执行。
**Android 10+（动态分区）** 需要额外步骤：

```
disable-verity → 重启设备 → adb root → adb remount
```

### 提权模式下的文件操作

`adb sync` 协议运行在 adbd 内，无法提权。提权生效时：

- **`adb root` 模式**：adbd 本身已是 root，**直接使用原生 sync**（快速且天然带 root 权限）。
- **`su` 模式**：改走 shell 通道 —— 读取用 `base64`、写入用 `cat >` + 分块 stdin、删除用 `rm -rf`。

## 技术栈

- **Vite + React 18 + TypeScript**
- **Fluent UI v8**（`@fluentui/react`）
- **MobX** —— 连接状态、文件列表、提权状态、日志等响应式状态
- **@yume-chan/adb v2** —— 纯前端 ADB 协议栈
- **@xterm/xterm** —— 终端
- **fflate** —— 目录 zip 打包（按需分包加载）

## 目录结构

```
src/
  state/
    connection.ts   # ADB 连接与认证握手（WebUSB）+ 错误中文化
    privilege.ts    # 三级提权探测 + root/unroot/remount/disable-verity
    fs.ts           # 文件系统操作（sync / su 双通道）
    framebuffer.ts  # 截图与投屏共用的像素解码（RGBA）
    logcat.ts       # Logcat 状态 + 解析 + 本地落盘
    i18n.ts         # 中英文文案
    router.ts       # 哈希路由
  components/
    Connect.tsx     # 设备连接面板
    Nav.tsx         # 左侧导航
    Diagnostics.tsx # 连接诊断
  pages/            # 各功能页面
```

## 已知限制

- 投屏采用 framebuffer 轮询方案，帧率受设备抓帧速度限制（通常 5–15 fps）；
  未接入 scrcpy 高帧率方案。
- 浏览器出于安全限制无法直接建立 TCP 连接，因此 ADB over WiFi 仅提供
  「开启 tcpip + 读取设备 IP」，实际连接需在本机命令行用 `adb connect`。
- `base64` 通道大文件下载较慢；超大文件建议在非 `su` 模式下用原生 sync。

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
| 说明 | 可折叠目录 + 各功能详解 + 连接诊断面板（逐条执行基础命令并显示真实返回） |
| 设备信息 | 读取型号、Android 版本、SDK、ABI、Build 类型等属性 |
| 文件管理 | 浏览 / 上传（含整个文件夹）/ 下载（目录自动打包 zip）/ 删除 / 新建文件夹 |
| 权限与挂载 | `adb root` / `adb unroot` / `adb remount` / `disable-verity`，带依赖联锁 |
| 电源菜单 | 重启 / Recovery / Bootloader / 关机 / 息屏 / 唤醒 / 锁屏 / 电源菜单 |
| WiFi ADB | 开启 tcpip 端口 + 读取设备 IP（实际连接在本机 `adb connect`） |
| 终端 | 基于 xterm.js 的交互式 shell，支持 root 会话切换 |
| **命令大全** | 内置 **112 条真实可用命令**（分类可折叠、不可删）+ 用户自定义（可增删改，**云端共享**） |
| 投屏 | scrcpy 实时流 + 触摸/导航/电源键 + 录制 MP4 |
| 屏幕截图 | 抓取当前屏幕并下载为 PNG |
| 日志 Logcat | 实时日志、等级开关、应用/关键字/标签过滤、本地文件夹落盘（20MB 分片）、**自动停止倒计时** |
| TEST 脚本 | 日志拉取（自动建时间戳子目录）/清理、Monkey（含自检）、蓝牙 HCI、CPU/内存监控（CSV 导出）、应用管理（txt 导出） |
| 安装 APK | 推送并安装（多选、参数开关、自定义路径），底部支持卸载第三方应用 |

顶栏提供**中英文切换**（选择持久化到 localStorage）。默认打开「说明」页。

## ADB 命令大全（内置 112 条 + 云端共享自定义）

「命令大全」页提供 **112 条真实可用的 ADB 命令**，按分类整理（分类标题可折叠）：

| 分类 | 条数 | 分类 | 条数 |
| --- | --- | --- | --- |
| 设备与连接 | 9 | 性能与监控 | 8 |
| 设备信息 | 8 | 内核与系统 | 12 |
| 应用管理 | 12 | 输入与界面 | 8 |
| 安装与卸载 | 5 | 电源与重启 | 6 |
| 启动与停止 | 7 | 网络与端口 | 7 |
| 文件操作 | 10 | 屏幕与录制 | 4 |
| 日志与调试 | 10 | 系统与权限 | 6 |

### 规则

- **内置命令不可删除、不可修改**（列表里带 🔒 标志）。
- 每条命令标注 **「网页可执行」**（带 `adb shell`，可直接在当前设备运行）或 **「电脑端」**（需本机命令行执行）；危险命令标 **「危险」**。
- 每条支持**一键复制**；连接设备后**一键执行会就地弹出结果框** —— 网页可执行的命令真正在设备上运行，电脑端命令给出等价结果或跳转指引（如 `adb devices -l` 直接返回当前设备信息）。
- 用户可在此基础上**新增自定义命令**，并**修改 / 删除自己创建的**命令。

### 跨用户共享（云服务）

- 自定义命令保存在**云端**（WorkBuddy 云服务数据库表 `adb_commands`），
  **所有打开本网站的人都能看到**彼此新增的命令。
- 仅「自己这个浏览器创建的」命令显示编辑 / 删除按钮（依据本机 `client_id`）；
  他人创建的命令在界面上只读。
- 云端不可用时（断网 / 服务异常）自动**降级为本地 localStorage**，页面顶部会**明确提示**，
  不会让用户误以为已共享；网络恢复后点「刷新云端」重新同步。
- 支持 **导出 / 导入 JSON**，便于把命令集分享给未接入云端的同事。

> 云服务配置（`endpoint` / `publishableKey` / `oauthRelayBaseUrl`）位于 `src/state/cloud.ts`，
> 均为可安全公开的前端配置；数据库权限由服务端 RLS 策略约束。

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
- **Fluent UI v8**（`@fluentui/react`；图标字体**本地打包**，不依赖微软 CDN）
- **MobX** —— 连接状态、文件列表、提权状态、日志、命令等响应式状态
- **@yume-chan/adb v2** —— 纯前端 ADB 协议栈
- **@yume-chan/adb-scrcpy** + WebCodecs / TinyH264 —— 投屏与录制
- **@xterm/xterm** —— 终端
- **fflate** —— 目录 zip 打包（按需分包加载）
- **mp4-muxer** —— 把 H.264 流直接封装为标准 MP4
- **@tencent-ai/workbuddy-cloud-sdk** —— 命令大全的云端共享存储

## 目录结构

```
src/
  state/
    connection.ts     # ADB 连接与认证握手（WebUSB）+ 错误中文化
    privilege.ts      # 三级提权探测 + root/unroot/remount/disable-verity
    fs.ts             # 文件系统操作（sync / su 双通道）
    framebuffer.ts    # 截图与投屏共用的像素解码（RGBA）
    logcat.ts         # Logcat 状态 + 解析 + 本地落盘
    recorder.ts       # scrcpy H.264 流 → 标准 MP4（mp4-muxer）
    scrcpy-server.ts  # scrcpy 服务端二进制加载与推送
    adb-commands.ts   # 内置 112 条命令数据
    commands-store.ts # 命令大全 store（云端优先 + 本地降级）
    cloud.ts          # 云服务客户端初始化与 publicConfig
    testscript.ts     # TEST 脚本页状态（配置持久化）
    i18n.ts           # 中英文文案
    router.ts         # 哈希路由
  components/
    Connect.tsx       # 设备连接面板
    Nav.tsx           # 左侧导航
    Diagnostics.tsx   # 连接诊断
  pages/              # 各功能页面
docs/
  用户手册.md          # 面向使用者的详细手册
```

## 已知限制

- 浏览器出于安全限制无法直接建立 TCP 连接，因此 ADB over WiFi 仅提供
  「开启 tcpip + 读取设备 IP」，实际连接需在本机命令行用 `adb connect`。
- 投屏依赖设备端 scrcpy-server（已随站点打包，v3.3.3）；部分设备 H.264 编码
  profile 与软解不兼容时，可在投屏页切换解码器（默认软解兼容性最好）。
- `su` 模式下大文件下载走 `base64` 通道会较慢；`adb root` 模式下走原生 sync 更快。

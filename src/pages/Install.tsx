import {
    DefaultButton,
    Dropdown,
    type IDropdownOption,
    MessageBar,
    MessageBarType,
    ProgressIndicator,
    Stack,
    TextField,
    Toggle,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";
import { fs } from "../state/fs";
import { shell } from "../state/privilege";

/** 安装临时目录快捷选项（也可自定义输入） */
const PRESET_DIRS = [
    { key: "/sdcard", text: "SD 卡（/sdcard）" },
    { key: "/data/local/tmp", text: "/data/local/tmp" },
] as const;

/** 安装参数开关 */
interface InstallOptions {
    replace: boolean; // -r 覆盖安装（保留数据）
    downgrade: boolean; // -d 允许版本降级
    grant: boolean; // -g 授予全部运行时权限
    noStreaming: boolean; // --no-streaming 先推后装（兼容部分车机）
}

export const InstallPage = observer(function InstallPage() {
    const t = i18n.t;
    const zh = i18n.lang === "zh";
    const [installing, setInstalling] = useState(false);
    const [progress, setProgress] = useState(0);
    const [log, setLog] = useState("");
    const [error, setError] = useState<string | undefined>();
    const [notice, setNotice] = useState<string | undefined>();

    // 临时目录（下拉快捷 + 自定义输入）
    const [dirSel, setDirSel] = useState<string>("/sdcard");
    const [customDir, setCustomDir] = useState("");
    const tmpDir = dirSel === "__custom__" ? customDir.trim() || "/sdcard" : dirSel;

    // 已安装的包（供卸载）
    const [packages, setPackages] = useState<
        { package: string; system: boolean }[]
    >([]);
    const [loadingPkgs, setLoadingPkgs] = useState(false);
    const [uninstalling, setUninstalling] = useState<string | undefined>();

    const [opts, setOpts] = useState<InstallOptions>({
        replace: true,
        downgrade: true,
        grant: true,
        noStreaming: false,
    });

    const append = (s: string) => setLog((prev) => prev + s + "\n");

    const buildInstallArgs = (): string => {
        const a: string[] = ["install"];
        if (opts.replace) a.push("-r");
        if (opts.downgrade) a.push("-d");
        if (opts.grant) a.push("-g");
        return a.join(" ");
    };

    const chooseApk = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".apk,application/vnd.android.package-archive";
        input.multiple = true;
        input.onchange = async () => {
            const files = Array.from(input.files ?? []);
            for (const file of files) {
                await install(file);
            }
        };
        input.click();
    };

    const install = async (file: File) => {
        const adb = connection.adb;
        if (!adb) return;
        setInstalling(true);
        setProgress(0);
        setLog("");
        setError(undefined);
        setNotice(undefined);

        const remote = `${tmpDir}/${file.name}`;
        try {
            // ① 确保临时目录存在
            await shell(adb, `mkdir -p ${tmpDir}`);

            // ② 推送 APK 到临时目录
            append(`${t.pushing} ${file.name} → ${tmpDir} …`);
            await fs.uploadFile(
                file,
                (uploaded) => {
                    setProgress(Math.round((uploaded / file.size) * 45));
                },
                remote,
            );

            // ③ 校验文件确实存在
            const stat = await shell(adb, `ls -l "${remote}"`);
            if (!stat.trim() || /no such file/i.test(stat)) {
                throw new Error(t.apkPushFailed);
            }
            append(stat.trim());

            // ④ 安装
            append(t.installing);
            const baseArgs = buildInstallArgs();
            const cmd = opts.noStreaming
                ? `pm ${baseArgs} --no-streaming "${remote}"`
                : `pm ${baseArgs} "${remote}"`;
            append(`$ ${cmd}`);
            const out = await shell(adb, cmd);
            if (out.trim()) append(out.trim());
            setProgress(95);

            if (/Success/i.test(out)) {
                append(t.installDone);
                setProgress(100);
                setNotice(`${t.installDone}：${file.name}`);
            } else {
                let hint = "";
                if (/INSTALL_FAILED_ALREADY_EXISTS/i.test(out)) {
                    hint = t.hintAlreadyExists;
                } else if (
                    /INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(out)
                ) {
                    hint = t.hintSignature;
                } else if (/INSTALL_FAILED_INSUFFICIENT_STORAGE/i.test(out)) {
                    hint = t.hintNoSpace;
                } else if (/INSTALL_FAILED_VERSION_DOWNGRADE/i.test(out)) {
                    hint = t.hintDowngrade;
                } else if (/INSTALL_PARSE_FAILED/i.test(out)) {
                    hint = t.hintParse;
                } else if (/INSTALL_FAILED_INVALID_APK/i.test(out)) {
                    hint = zh
                        ? "提示：APK 文件损坏或不是有效的安装包，请确认已完整下载。"
                        : "Hint: the APK is corrupt or invalid.";
                }
                setError(t.installFailed + "：" + out.trim() + (hint ? "\n" + hint : ""));
            }

            // ⑤ 清理临时文件
            shell(adb, `rm -f "${remote}"`).catch(() => {});
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            append(msg);
            setError(msg);
        } finally {
            setInstalling(false);
        }
    };

    /** 列出已安装的第三方应用（供卸载） */
    const loadPackages = async () => {
        const adb = connection.adb;
        if (!adb) return;
        setLoadingPkgs(true);
        try {
            const out = await shell(adb, "pm list packages -3");
            const list = out
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l.startsWith("package:"))
                .map((l) => ({ package: l.slice(8).trim(), system: false }))
                .sort((a, b) => a.package.localeCompare(b.package));
            setPackages(list);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoadingPkgs(false);
        }
    };

    /** 卸载应用 */
    const uninstall = async (pkg: string) => {
        const adb = connection.adb;
        if (!adb) return;
        if (
            !window.confirm(
                zh ? `确认卸载「${pkg}」？其数据将一并清除。` : `Uninstall “${pkg}”? Its data will be cleared.`,
            )
        ) {
            return;
        }
        setUninstalling(pkg);
        setError(undefined);
        setLog("");
        try {
            append(`$ pm uninstall ${pkg}`);
            const out = await shell(adb, `pm uninstall ${pkg}`);
            append(out.trim());
            if (/Success/i.test(out)) {
                append(t.uninstallDone);
                setNotice(`${t.uninstallDone}：${pkg}`);
                setPackages((prev) => prev.filter((p) => p.package !== pkg));
            } else {
                setError("卸载失败：" + out.trim());
            }
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setUninstalling(undefined);
        }
    };

    if (!connection.isConnected) {
        return (
            <Stack styles={{ root: { padding: 16 } }}>
                <MessageBar>{t.waiting}</MessageBar>
            </Stack>
        );
    }

    const dirOptions: IDropdownOption[] = [
        ...PRESET_DIRS.map((d) => ({ key: d.key, text: d.text })),
        { key: "__custom__", text: t.installPathCustom },
    ];
    const pkgOptions: IDropdownOption[] = packages.map((p) => ({
        key: p.package,
        text: p.package,
    }));

    return (
        <Stack
            styles={{
                root: {
                    padding: 16,
                    gap: 12,
                    height: "100%",
                    minHeight: 0,
                    boxSizing: "border-box",
                    overflowY: "auto",
                    overflowX: "hidden",
                },
            }}
        >
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
                {t.installTitle}
            </h2>

            {/* 临时目录 */}
            <Dropdown
                label={t.installPath}
                selectedKey={dirSel}
                options={dirOptions}
                onChange={(_, o) => setDirSel(String(o?.key ?? "/sdcard"))}
                styles={{ root: { maxWidth: 360 } }}
                disabled={installing}
            />
            {dirSel === "__custom__" && (
                <TextField
                    label={t.installPathCustomLabel}
                    placeholder="/data/local/tmp"
                    value={customDir}
                    onChange={(_, v) => setCustomDir(v ?? "")}
                    styles={{ root: { maxWidth: 360 } }}
                    disabled={installing}
                />
            )}
            <span style={{ fontSize: 11, color: "#a19f9d" }}>
                {t.installPathHint} {zh ? "当前：" : "current: "}
                {tmpDir}
            </span>

            {/* 安装参数 */}
            <Stack tokens={{ childrenGap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t.installParams}</div>
                <Stack horizontal tokens={{ childrenGap: 16 }} wrap>
                    <Toggle
                        label={t.installOptReplace}
                        checked={opts.replace}
                        onChange={(_, c) => setOpts((s) => ({ ...s, replace: !!c }))}
                        disabled={installing}
                    />
                    <Toggle
                        label={t.installOptDowngrade}
                        checked={opts.downgrade}
                        onChange={(_, c) => setOpts((s) => ({ ...s, downgrade: !!c }))}
                        disabled={installing}
                    />
                    <Toggle
                        label={t.installOptGrant}
                        checked={opts.grant}
                        onChange={(_, c) => setOpts((s) => ({ ...s, grant: !!c }))}
                        disabled={installing}
                    />
                    <Toggle
                        label={t.installOptNoStreaming}
                        checked={opts.noStreaming}
                        onChange={(_, c) => setOpts((s) => ({ ...s, noStreaming: !!c }))}
                        disabled={installing}
                    />
                </Stack>
                <span style={{ fontSize: 11, color: "#a19f9d" }}>
                    {t.installParamsHint} pm {buildInstallArgs()}
                    {opts.noStreaming ? " --no-streaming" : ""} "&lt;apk&gt;"
                </span>
            </Stack>

            <Stack horizontal tokens={{ childrenGap: 8 }} wrap>
                <DefaultButton
                    text={t.chooseApk}
                    iconProps={{ iconName: "Package" }}
                    disabled={installing}
                    onClick={chooseApk}
                />
            </Stack>

            {installing && (
                <ProgressIndicator
                    percentComplete={progress / 100}
                    description={`${progress}%`}
                />
            )}

            {error && (
                <MessageBar messageBarType={MessageBarType.error} isMultiline>
                    {error}
                </MessageBar>
            )}
            {notice && (
                <MessageBar
                    messageBarType={MessageBarType.success}
                    onDismiss={() => setNotice(undefined)}
                >
                    {notice}
                </MessageBar>
            )}

            {log && (
                <pre
                    style={{
                        background: "#1e1e1e",
                        color: "#d4d4d4",
                        padding: 8,
                        borderRadius: 4,
                        fontSize: 12,
                        maxHeight: 300,
                        overflow: "auto",
                        whiteSpace: "pre-wrap",
                    }}
                >
                    {log}
                </pre>
            )}

            {/* 卸载 */}
            <div
                style={{
                    borderTop: "1px solid #edebe9",
                    paddingTop: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                }}
            >
                <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                    {t.uninstallTitle}
                </h3>
                <Stack horizontal tokens={{ childrenGap: 8 }} wrap verticalAlign="end">
                    <DefaultButton
                        text={t.loadPackages}
                        iconProps={{ iconName: "Refresh" }}
                        onClick={() => void loadPackages()}
                        disabled={loadingPkgs}
                    />
                    <Dropdown
                        placeholder={
                            packages.length
                                ? `${t.tsAppsLoaded}${packages.length}`
                                : t.selectPackageToUninstall
                        }
                        options={pkgOptions}
                        onChange={(_, o) => {
                            const pkg = String(o?.key ?? "");
                            if (pkg) void uninstall(pkg);
                        }}
                        styles={{ root: { minWidth: 360 } }}
                        disabled={loadingPkgs || !!uninstalling}
                    />
                    {uninstalling && (
                        <span style={{ fontSize: 12, color: "#0078d4" }}>
                            {t.uninstalling} {uninstalling} …
                        </span>
                    )}
                </Stack>
                <span style={{ fontSize: 11, color: "#a19f9d" }}>
                    {t.uninstallHint}
                </span>
            </div>
        </Stack>
    );
});

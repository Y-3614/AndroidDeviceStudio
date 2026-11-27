import {
    DefaultButton,
    MessageBar,
    MessageBarType,
    ProgressIndicator,
    Stack,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";
import { fs } from "../state/fs";
import { shell } from "../state/privilege";

const TMP_DIR = "/data/local/tmp";

export const InstallPage = observer(function InstallPage() {
    const t = i18n.t;
    const [installing, setInstalling] = useState(false);
    const [progress, setProgress] = useState(0);
    const [log, setLog] = useState("");
    const [error, setError] = useState<string | undefined>();

    const chooseApk = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".apk,application/vnd.android.package-archive";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (file) await install(file);
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

        const remote = `${TMP_DIR}/${file.name}`;
        const append = (s: string) => setLog((prev) => prev + s + "\n");

        try {
            // ① 确保临时目录存在
            await shell(adb, `mkdir -p ${TMP_DIR}`);

            // ② 推送到 /data/local/tmp（关键：显式指定目标路径，
            //    之前 bug 是推到了浏览器当前目录，pm 自然找不到文件）
            append(`${t.pushing} ${file.name} …`);
            await fs.uploadFile(
                file,
                (uploaded) => {
                    setProgress(Math.round((uploaded / file.size) * 45));
                },
                remote,
            );

            // ③ 校验文件确实存在（存在性问题提早暴露）
            const stat = await shell(adb, `ls -l "${remote}"`);
            if (!stat.trim() || /no such file/i.test(stat)) {
                throw new Error(t.apkPushFailed);
            }
            append(stat.trim());

            // ④ 安装：-r 覆盖安装，-d 允许降级，-g 授予全部运行时权限
            append(t.installing);
            const out = await shell(adb, `pm install -r -d -g "${remote}"`);
            append(out.trim());
            setProgress(95);

            if (/Success/i.test(out)) {
                append(t.installDone);
                setProgress(100);
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
                }
                setError(
                    t.installFailed + "：" + out.trim() + (hint ? "\n" + hint : ""),
                );
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

    if (!connection.isConnected) {
        return (
            <Stack styles={{ root: { padding: 16 } }}>
                <MessageBar>{t.waiting}</MessageBar>
            </Stack>
        );
    }

    return (
        <Stack styles={{ root: { padding: 16, gap: 12 } }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
                {t.installTitle}
            </h2>

            <DefaultButton
                text={t.chooseApk}
                iconProps={{ iconName: "Box" }}
                disabled={installing}
                onClick={chooseApk}
            />

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
        </Stack>
    );
});

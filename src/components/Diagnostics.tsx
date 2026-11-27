import {
    DefaultButton,
    MessageBar,
    MessageBarType,
    Stack,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { connection } from "../state/connection";
import { privilege, shell } from "../state/privilege";

interface DiagResult {
    label: string;
    ok: boolean;
    detail: string;
}

/**
 * 连接诊断：逐条执行基础 ADB 命令并显示实际返回，
 * 用于快速定位「连上了但没反应」这类问题。
 */
export const Diagnostics = observer(function Diagnostics() {
    const [running, setRunning] = useState(false);
    const [results, setResults] = useState<DiagResult[]>([]);

    const run = async () => {
        const adb = connection.adb;
        if (!adb || running) return;
        setRunning(true);
        setResults([]);
        const out: DiagResult[] = [];

        const step = async (label: string, fn: () => Promise<string>) => {
            try {
                const detail = await fn();
                out.push({ label, ok: true, detail: detail.slice(0, 200).trim() });
            } catch (e) {
                out.push({
                    label,
                    ok: false,
                    detail: (e instanceof Error ? e.message : String(e)).slice(0, 200),
                });
            }
            setResults([...out]);
        };

        await step("① 连接对象", async () =>
            adb ? `serial=${adb.serial ?? "?"}` : "无 adb 实例",
        );
        await step("② 设备横幅 banner", async () =>
            String((adb as unknown as { banner?: unknown }).banner ?? "(空)"),
        );
        await step("③ 执行 id", async () => await shell(adb, "id"));
        await step("④ 读取 SDK 版本", async () => await adb.getProp("ro.build.version.sdk"));
        await step("⑤ 列出 /sdcard", async () => {
            const text = await shell(adb, "ls /sdcard");
            return text || "(空目录或无权限)";
        });
        await step("⑥ 原生 sync 列 /sdcard", async () => {
            const s = await adb.sync();
            try {
                const entries = await s.readdir("/sdcard");
                return entries
                    .slice(0, 12)
                    .map((e) => e.name)
                    .join(", ");
            } finally {
                s.dispose();
            }
        });

        setRunning(false);
    };

    return (
        <Stack tokens={{ childrenGap: 8 }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>连接诊断</h2>
            <DefaultButton
                text={running ? "诊断中…" : "运行诊断"}
                iconProps={{ iconName: "Diagnostic" }}
                disabled={!connection.isConnected || running}
                onClick={run}
            />
            {results.map((r) => (
                <MessageBar
                    key={r.label}
                    messageBarType={r.ok ? MessageBarType.success : MessageBarType.error}
                    isMultiline
                >
                    <b>
                        {r.label} {r.ok ? "✓" : "✗"}
                    </b>
                    <div
                        style={{
                            fontFamily: "Consolas, monospace",
                            fontSize: 12,
                            marginTop: 4,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                        }}
                    >
                        {r.detail}
                    </div>
                </MessageBar>
            ))}
            {privilege.probing && (
                <MessageBar>权限探测中…</MessageBar>
            )}
        </Stack>
    );
});

import {
    DefaultButton,
    Dropdown,
    type IDropdownOption,
    MessageBar,
    MessageBarType,
    PrimaryButton,
    SpinButton,
    Stack,
    TextField,
    Toggle,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";
import { saveBlob } from "../state/file-stream";
import { testScript } from "../state/testscript";

const mono: React.CSSProperties = {
    fontFamily: "Consolas, Menlo, monospace",
    fontSize: 12,
};
/** TextField 的 field 样式：Fluent 用 IRawStyle（数值需为字符串） */
const monoField = {
    fontFamily: "Consolas, Menlo, monospace",
    fontSize: "12px",
} as const;
const card: React.CSSProperties = {
    border: "1px solid #edebe9",
    borderRadius: 4,
    padding: 12,
    background: "#faf9f8",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flexShrink: 0,
};
const h3: React.CSSProperties = {
    fontSize: 15,
    fontWeight: 600,
    margin: 0,
    color: "#323130",
};
const preview: React.CSSProperties = {
    background: "#1e1e1e",
    color: "#d4d4d4",
    padding: 8,
    borderRadius: 4,
    margin: 0,
    overflowX: "auto",
    whiteSpace: "pre",
    flexShrink: 0,
    ...mono,
};

/** 简易趋势条（不引入图表库，保持体积） */
function Trend({ data, color, unit }: { data: number[]; color: string; unit: string }) {
    const latest = data.length ? data[data.length - 1] : 0;
    const max = Math.max(1, ...data);
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 62 }}>
                {latest.toFixed(1)}
                {unit}
            </span>
            <div
                style={{
                    flex: 1,
                    height: 22,
                    background: "#edebe9",
                    borderRadius: 3,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "flex-end",
                    gap: 1,
                }}
            >
                {data.slice(-60).map((v, i) => (
                    <div
                        key={i}
                        style={{
                            flex: 1,
                            height: `${Math.max(4, (v / max) * 100)}%`,
                            background: color,
                            opacity: 0.85,
                        }}
                    />
                ))}
            </div>
        </div>
    );
}

export const TestScriptPage = observer(function TestScriptPage() {
    const t = i18n.t;
    const outRef = useRef<HTMLDivElement | null>(null);
    const [appQuery, setAppQuery] = useState("");

    // 输出自动滚到底
    useEffect(() => {
        if (outRef.current) {
            outRef.current.scrollTop = outRef.current.scrollHeight;
        }
    }, [testScript.output.length]);

    if (!connection.isConnected) {
        return (
            <Stack styles={{ root: { padding: 16 } }}>
                <MessageBar>{t.tsNotConnected}</MessageBar>
            </Stack>
        );
    }

    /** 让用户选一个本地文件夹（用于日志/HCI 导出） */
    const pickFolder = async (): Promise<FileSystemDirectoryHandle | undefined> => {
        const picker = (
            window as unknown as {
                showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
            }
        ).showDirectoryPicker;
        if (!picker) {
            testScript.append("当前浏览器不支持选择文件夹，将改为直接下载 zip", "err");
            return undefined;
        }
        try {
            return await picker.call(window);
        } catch {
            return undefined;
        }
    };

    const appOptions: IDropdownOption[] = testScript.apps
        .filter((a) => !appQuery || a.package.toLowerCase().includes(appQuery.toLowerCase()))
        .slice(0, 300)
        .map((a) => ({
            key: a.package,
            text: a.pid ? `${a.package} (pid ${a.pid})` : a.package,
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
                {t.testScriptTitle}
            </h2>
            <p style={{ margin: 0, color: "#605e5c", lineHeight: 1.7 }}>
                {t.testScriptIntro}
            </p>

            <Stack horizontal tokens={{ childrenGap: 8 }} wrap>
                <DefaultButton
                    text={t.tsSaveConfig}
                    iconProps={{ iconName: "Save" }}
                    onClick={() => testScript.save()}
                />
                <DefaultButton
                    text={t.tsResetConfig}
                    iconProps={{ iconName: "Refresh" }}
                    onClick={() => testScript.resetDefaults()}
                />
            </Stack>

            {/* ── 一、日志采集与拉取 ── */}
            <div style={card}>
                <h3 style={h3}>{t.tsSectionLog}</h3>
                <TextField
                    label={t.tsLogcatCommand}
                    description={t.tsLogcatCommandHint}
                    value={testScript.logcatCommand}
                    onChange={(_, v) => (testScript.logcatCommand = v ?? "")}
                    styles={{ root: { maxWidth: 520 } }}
                />
                <Stack horizontal tokens={{ childrenGap: 8 }} wrap>
                    {testScript.logRunning ? (
                        <DefaultButton
                            text={t.tsStopLog}
                            iconProps={{ iconName: "Stop" }}
                            onClick={() => testScript.stopLogcat()}
                        />
                    ) : (
                        <PrimaryButton
                            text={t.tsStartLog}
                            iconProps={{ iconName: "Play" }}
                            onClick={() => void testScript.startLogcat()}
                        />
                    )}
                    <DefaultButton
                        text={t.tsClearDeviceLog}
                        iconProps={{ iconName: "Delete" }}
                        onClick={() => void testScript.clearDeviceLog()}
                    />
                    <DefaultButton
                        text={t.tsRemoveLogs}
                        iconProps={{ iconName: "Delete" }}
                        onClick={() => void testScript.removeDeviceLogs()}
                    />
                </Stack>
                <TextField
                    label={t.tsCleanPaths}
                    description={t.tsRemoveLogsHint}
                    value={testScript.cleanPaths}
                    onChange={(_, v) => (testScript.cleanPaths = v ?? "")}
                    multiline
                    rows={4}
                    styles={{ root: { maxWidth: 620 }, field: monoField }}
                />
                <TextField
                    label={t.tsPullPaths}
                    value={testScript.pullPaths}
                    onChange={(_, v) => (testScript.pullPaths = v ?? "")}
                    multiline
                    autoAdjustHeight
                    styles={{ root: { maxWidth: 620 }, field: monoField }}
                />
                <Stack horizontal tokens={{ childrenGap: 8 }} wrap verticalAlign="center">
                    <PrimaryButton
                        text={t.tsPullToFolder}
                        iconProps={{ iconName: "FolderOpen" }}
                        disabled={testScript.pulling || testScript.logRunning}
                        onClick={async () => {
                            const dir = await pickFolder();
                            if (!dir) return;
                            await testScript.pullLogs(dir).catch(() => "");
                        }}
                    />
                    <DefaultButton
                        text={t.tsPullDownload}
                        iconProps={{ iconName: "Download" }}
                        disabled={testScript.pulling}
                        onClick={async () => {
                            const results = await testScript
                                .pullLogs()
                                .catch(() => [] as { name: string; blob: Blob }[]);
                            for (const r of results) saveBlob(r.blob, r.name);
                        }}
                    />
                    {testScript.pullProgress && (
                        <span style={{ fontSize: 12, color: "#0078d4" }}>
                            {testScript.pullProgress}
                        </span>
                    )}
                </Stack>
            </div>

            {/* ── 二、Monkey ── */}
            <div style={card}>
                <h3 style={h3}>{t.tsSectionMonkey}</h3>
                <TextField
                    label={t.tsMonkeyPackages}
                    value={testScript.monkeyPackages}
                    onChange={(_, v) => (testScript.monkeyPackages = v ?? "")}
                    multiline
                    autoAdjustHeight
                    styles={{ root: { maxWidth: 620 }, field: monoField }}
                />
                <TextField
                    label={t.tsMonkeyArgs}
                    value={testScript.monkeyArgs}
                    onChange={(_, v) => (testScript.monkeyArgs = v ?? "")}
                    multiline
                    autoAdjustHeight
                    styles={{ root: { maxWidth: 620 }, field: monoField }}
                />
                <Stack horizontal tokens={{ childrenGap: 12 }} wrap verticalAlign="end">
                    <SpinButton
                        label={t.tsMonkeyThrottle}
                        value={String(testScript.monkeyThrottle)}
                        min={0}
                        step={50}
                        onIncrement={(v) => {
                            testScript.monkeyThrottle = Number(v) + 50;
                        }}
                        onDecrement={(v) => {
                            testScript.monkeyThrottle = Math.max(0, Number(v) - 50);
                        }}
                        onChange={(_, v) => {
                            testScript.monkeyThrottle = Number(v) || 0;
                        }}
                        styles={{ root: { width: 150 } }}
                    />
                    <SpinButton
                        label={t.tsMonkeyEvents}
                        value={String(testScript.monkeyEvents)}
                        min={0}
                        step={100000}
                        onIncrement={(v) => {
                            testScript.monkeyEvents = Number(v) + 100000;
                        }}
                        onDecrement={(v) => {
                            testScript.monkeyEvents = Math.max(0, Number(v) - 100000);
                        }}
                        onChange={(_, v) => {
                            testScript.monkeyEvents = Number(v) || 0;
                        }}
                        styles={{ root: { width: 180 } }}
                    />
                </Stack>
                <div>
                    <div style={{ fontSize: 12, color: "#605e5c", marginBottom: 4 }}>
                        {t.tsMonkeyPreview}
                    </div>
                    <pre style={preview}>{testScript.buildMonkeyCommand()}</pre>
                </div>
                <Stack horizontal tokens={{ childrenGap: 8 }}>
                    {testScript.monkeyRunning ? (
                        <DefaultButton
                            text={t.tsStopMonkey}
                            iconProps={{ iconName: "Stop" }}
                            onClick={() => testScript.stopMonkey()}
                        />
                    ) : (
                        <PrimaryButton
                            text={t.tsRunMonkey}
                            iconProps={{ iconName: "Play" }}
                            onClick={() => void testScript.runMonkey()}
                        />
                    )}
                </Stack>
            </div>

            {/* ── 三、蓝牙 HCI ── */}
            <div style={card}>
                <h3 style={h3}>{t.tsSectionHci}</h3>
                <MessageBar messageBarType={MessageBarType.info}>
                    {t.tsHciHint}
                </MessageBar>
                <Stack horizontal tokens={{ childrenGap: 8 }} wrap verticalAlign="center">
                    <PrimaryButton
                        text={t.tsEnableHci}
                        iconProps={{ iconName: "Bluetooth" }}
                        onClick={() => void testScript.enableHci()}
                    />
                    <DefaultButton
                        text={t.tsExportHci}
                        iconProps={{ iconName: "Download" }}
                        onClick={() => void testScript.exportHci()}
                    />
                    <DefaultButton
                        text={t.tsExportHciToFolder}
                        iconProps={{ iconName: "FolderOpen" }}
                        onClick={async () => {
                            const dir = await pickFolder();
                            if (dir) await testScript.exportHci(dir).catch(() => "");
                        }}
                    />
                    <DefaultButton
                        text={t.tsRemoveHci}
                        iconProps={{ iconName: "Delete" }}
                        onClick={() => void testScript.removeHci()}
                    />
                    {testScript.hciExportProgress && (
                        <span style={{ fontSize: 12, color: "#0078d4" }}>
                            {testScript.hciExportProgress}
                        </span>
                    )}
                </Stack>
            </div>

            {/* ── 四、CPU / 内存监控 ── */}
            <div style={card}>
                <h3 style={h3}>{t.tsSectionMonitor}</h3>
                <Stack horizontal tokens={{ childrenGap: 12 }} wrap verticalAlign="end">
                    <SpinButton
                        label={t.tsMonitorInterval}
                        value={String(testScript.monitorIntervalSec)}
                        min={2}
                        step={1}
                        onIncrement={(v) => {
                            testScript.monitorIntervalSec = Number(v) + 1;
                        }}
                        onDecrement={(v) => {
                            testScript.monitorIntervalSec = Math.max(2, Number(v) - 1);
                        }}
                        onChange={(_, v) => {
                            testScript.monitorIntervalSec = Number(v) || 10;
                        }}
                        styles={{ root: { width: 160 } }}
                    />
                    {testScript.monitoring ? (
                        <DefaultButton
                            text={t.tsStopMonitor}
                            iconProps={{ iconName: "Stop" }}
                            onClick={() => testScript.stopMonitor()}
                        />
                    ) : (
                        <PrimaryButton
                            text={t.tsStartMonitor}
                            iconProps={{ iconName: "Play" }}
                            onClick={() => void testScript.startMonitor()}
                        />
                    )}
                </Stack>
                <div>
                    <div style={{ fontSize: 12, color: "#605e5c", marginBottom: 4 }}>
                        {t.tsCpuUsage}
                    </div>
                    <Trend data={testScript.cpuHistory} color="#d13438" unit="%" />
                </div>
                <div>
                    <div style={{ fontSize: 12, color: "#605e5c", marginBottom: 4 }}>
                        {t.tsMemUsage}
                    </div>
                    <Trend data={testScript.memHistory} color="#0078d4" unit="%" />
                </div>
                {(testScript.cpuSample || testScript.memSample) && (
                    <pre style={{ ...preview, maxHeight: 180, overflowY: "auto" }}>
                        {`# CPU\n${testScript.cpuSample ?? ""}\n\n# MEM\n${testScript.memSample ?? ""}`}
                    </pre>
                )}
            </div>

            {/* ── 五、应用管理 ── */}
            <div style={card}>
                <h3 style={h3}>{t.tsSectionApps}</h3>
                <Stack horizontal tokens={{ childrenGap: 12 }} wrap verticalAlign="end">
                    <Toggle
                        label={t.tsIncludeSystem}
                        checked={testScript.includeSystemApps}
                        onChange={(_, c) => void testScript.loadApps(!!c)}
                    />
                    <DefaultButton
                        text={t.tsListApps}
                        iconProps={{ iconName: "Refresh" }}
                        onClick={() => void testScript.loadApps()}
                        disabled={testScript.loadingApps}
                    />
                    <TextField
                        placeholder="搜索包名…"
                        value={appQuery}
                        onChange={(_, v) => setAppQuery(v ?? "")}
                        styles={{ root: { width: 220 } }}
                    />
                </Stack>
                <Dropdown
                    placeholder={`共 ${testScript.apps.length} 个应用`}
                    selectedKey={testScript.selectedPackage || undefined}
                    options={appOptions}
                    onChange={(_, o) =>
                        (testScript.selectedPackage = String(o?.key ?? ""))
                    }
                    styles={{ root: { maxWidth: 520 } }}
                />
                <Stack horizontal tokens={{ childrenGap: 12 }} wrap verticalAlign="center">
                    <Toggle
                        label={t.tsLaunchFirstStop}
                        checked={testScript.launchForceStop}
                        onChange={(_, c) => (testScript.launchForceStop = !!c)}
                    />
                    <PrimaryButton
                        text={t.tsLaunchApp}
                        iconProps={{ iconName: "Play" }}
                        disabled={!testScript.selectedPackage}
                        onClick={() =>
                            void testScript.launchApp(testScript.selectedPackage)
                        }
                    />
                    <DefaultButton
                        text={t.tsForceStop}
                        iconProps={{ iconName: "Stop" }}
                        disabled={!testScript.selectedPackage}
                        onClick={() =>
                            void testScript.forceStopApp(testScript.selectedPackage)
                        }
                    />
                </Stack>
                <span style={{ fontSize: 11, color: "#a19f9d" }}>{t.tsAppHint}</span>
            </div>

            {/* ── 执行输出 ── */}
            <div style={card}>
                <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="center">
                    <h3 style={{ ...h3, flex: 1 }}>{t.tsOutput}</h3>
                    <DefaultButton
                        text={t.tsClearOutput}
                        onClick={() => testScript.clearOutput()}
                    />
                </Stack>
                <div
                    ref={outRef}
                    style={{
                        height: 260,
                        overflow: "auto",
                        background: "#1e1e1e",
                        borderRadius: 4,
                        padding: 8,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        ...mono,
                    }}
                >
                    {testScript.output.length === 0 ? (
                        <span style={{ color: "#8c8c8c" }}>—</span>
                    ) : (
                        testScript.output.map((o, i) => (
                            <div
                                key={i}
                                style={{
                                    color:
                                        o.kind === "err"
                                            ? "#f48771"
                                            : o.kind === "ok"
                                              ? "#6ac07a"
                                              : "#d4d4d4",
                                }}
                            >
                                [{o.time}] {o.text}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </Stack>
    );
});

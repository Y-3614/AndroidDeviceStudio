import {
    DefaultButton,
    Label,
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
import { LineChart } from "../components/LineChart";
import { OpProgress } from "../components/OpProgress";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";
import { saveBlob } from "../state/file-stream";
import { testScript, type AppFilter } from "../state/testscript";

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
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    flexShrink: 0,
    ...mono,
};

export const TestScriptPage = observer(function TestScriptPage() {
    const t = i18n.t;
    const zh = i18n.lang === "zh";
    const outRef = useRef<HTMLDivElement | null>(null);
    const monkeyLogRef = useRef<HTMLDivElement | null>(null);
    const [appQuery, setAppQuery] = useState("");

    // 输出自动滚到底
    useEffect(() => {
        if (outRef.current) {
            outRef.current.scrollTop = outRef.current.scrollHeight;
        }
    }, [testScript.output.length]);

    // Monkey 实时日志自动滚到底
    useEffect(() => {
        if (monkeyLogRef.current) {
            monkeyLogRef.current.scrollTop = monkeyLogRef.current.scrollHeight;
        }
    }, [testScript.monkeyLiveLog.length]);

    if (!connection.isConnected) {
        return (
            <Stack styles={{ root: { padding: 16 } }}>
                <MessageBar>{t.tsNotConnected}</MessageBar>
            </Stack>
        );
    }

    /** 让用户选一个本地文件夹 */
    const pickFolder = async (): Promise<FileSystemDirectoryHandle | undefined> => {
        const picker = (
            window as unknown as {
                showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
            }
        ).showDirectoryPicker;
        if (!picker) {
            testScript.append("当前浏览器不支持选择文件夹，将改为直接下载", "err");
            return undefined;
        }
        try {
            return await picker.call(window);
        } catch {
            return undefined;
        }
    };

    const appFilterOptions: { key: AppFilter; text: string }[] = [
        { key: "third", text: t.tsAppThird },
        { key: "system", text: t.tsAppSystem },
        { key: "all", text: t.tsAppAll },
    ];

    /** 应用范围三按钮（默认「仅第三方」） */
    const appFilterButtons = (
        <Stack
            horizontal
            tokens={{ childrenGap: 0 }}
            styles={{ root: { alignSelf: "flex-end" } }}
        >
            {appFilterOptions.map((o, i) => {
                const active = testScript.appFilter === o.key;
                const isFirst = i === 0;
                const isLast = i === appFilterOptions.length - 1;
                return (
                    <button
                        key={o.key}
                        onClick={() => void testScript.loadApps(o.key)}
                        style={{
                            padding: "6px 14px",
                            fontSize: 13,
                            cursor: "pointer",
                            border: "1px solid #8a8886",
                            borderLeft: isFirst ? "1px solid #8a8886" : "none",
                            borderTopLeftRadius: isFirst ? 2 : 0,
                            borderBottomLeftRadius: isFirst ? 2 : 0,
                            borderTopRightRadius: isLast ? 2 : 0,
                            borderBottomRightRadius: isLast ? 2 : 0,
                            background: active ? "#0078d4" : "#fff",
                            color: active ? "#fff" : "#323130",
                            fontWeight: active ? 600 : 400,
                        }}
                    >
                        {o.text}
                    </button>
                );
            })}
        </Stack>
    );

    const appOptions = testScript.apps
        .filter(
            (a) => !appQuery || a.package.toLowerCase().includes(appQuery.toLowerCase()),
        )
        .slice(0, 400)
        .map((a) => ({
            key: a.package,
            text: a.pid ? `${a.package} (pid ${a.pid})` : a.package,
        }));

    const minToText = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}分${String(s).padStart(2, "0")}秒`;
    };

    const leakLevelColor =
        testScript.leakResult?.level === "likely"
            ? "#a4262c"
            : testScript.leakResult?.level === "slight"
              ? "#8a6d00"
              : "#107c10";

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

            {/* ── 一、日志拉取到电脑 ── */}
            <div style={card}>
                <h3 style={h3}>{t.tsSectionPull}</h3>
                <TextField
                    label={t.tsPullPaths}
                    value={testScript.pullPaths}
                    onChange={(_, v) => (testScript.pullPaths = v ?? "")}
                    multiline
                    autoAdjustHeight
                    styles={{ root: { maxWidth: 640 }, field: monoField }}
                />
                <Stack horizontal tokens={{ childrenGap: 8 }} wrap verticalAlign="center">
                    <PrimaryButton
                        text={t.tsPullToFolder}
                        iconProps={{ iconName: "FolderOpen" }}
                        disabled={testScript.pulling}
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
                </Stack>
                <OpProgress bar={testScript.getProgress("pullProgress")} />
                <span style={{ fontSize: 11, color: "#a19f9d" }}>
                    {t.tsPullFolderHint}
                </span>
                {testScript.lastPullFolder && (
                    <span style={{ fontSize: 12, color: "#107c10" }}>
                        ✓ {t.tsLastFolder}：{testScript.lastPullFolder}
                    </span>
                )}
            </div>

            {/* ── 二、日志清理 ── */}
            <div style={card}>
                <h3 style={h3}>{t.tsSectionClean}</h3>
                <Stack horizontal tokens={{ childrenGap: 8 }} wrap>
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
                <OpProgress bar={testScript.getProgress("cleanProgress")} />
                <TextField
                    label={t.tsCleanPaths}
                    description={t.tsRemoveLogsHint}
                    value={testScript.cleanPaths}
                    onChange={(_, v) => (testScript.cleanPaths = v ?? "")}
                    multiline
                    rows={4}
                    styles={{ root: { maxWidth: 640 }, field: monoField }}
                />
            </div>

            {/* ── 三、Monkey ── */}
            <div style={card}>
                <h3 style={h3}>{t.tsSectionMonkey}</h3>
                <TextField
                    label={t.tsMonkeyPackages}
                    value={testScript.monkeyPackages}
                    onChange={(_, v) => (testScript.monkeyPackages = v ?? "")}
                    multiline
                    autoAdjustHeight
                    styles={{ root: { maxWidth: 640 }, field: monoField }}
                />
                <TextField
                    label={t.tsMonkeyArgs}
                    value={testScript.monkeyArgs}
                    onChange={(_, v) => (testScript.monkeyArgs = v ?? "")}
                    multiline
                    autoAdjustHeight
                    styles={{ root: { maxWidth: 640 }, field: monoField }}
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

                {/* 执行方式 */}
                <Stack tokens={{ childrenGap: 4 }}>
                    <Label>{t.tsMonkeyMode}</Label>
                    <Stack horizontal tokens={{ childrenGap: 16 }} wrap>
                        <Toggle
                            label={t.tsMonkeyModeFg}
                            checked={testScript.monkeyMode === "fg"}
                            onChange={(_, c) => {
                                if (c) testScript.monkeyMode = "fg";
                            }}
                            disabled={testScript.monkeyRunning}
                        />
                        <Toggle
                            label={t.tsMonkeyModeBg}
                            checked={testScript.monkeyMode === "bg"}
                            onChange={(_, c) => {
                                if (c) testScript.monkeyMode = "bg";
                            }}
                            disabled={testScript.monkeyRunning}
                        />
                    </Stack>
                </Stack>

                <div>
                    <div style={{ fontSize: 12, color: "#605e5c", marginBottom: 4 }}>
                        {t.tsMonkeyPreview}
                    </div>
                    <pre style={preview}>{testScript.buildMonkeyCommand()}</pre>
                </div>

                <Stack horizontal tokens={{ childrenGap: 8 }} wrap verticalAlign="center">
                    {testScript.monkeyRunning ? (
                        <DefaultButton
                            text={t.tsStopMonkey}
                            iconProps={{ iconName: "Stop" }}
                            onClick={() => void testScript.stopMonkey()}
                        />
                    ) : (
                        <PrimaryButton
                            text={
                                testScript.monkeyMode === "fg"
                                    ? t.tsRunMonkey
                                    : t.tsRunMonkeyBg
                            }
                            iconProps={{ iconName: "Play" }}
                            onClick={() => void testScript.runMonkey()}
                        />
                    )}
                    <DefaultButton
                        text={t.tsMonkeySelfCheck}
                        iconProps={{ iconName: "TestBeaker" }}
                        onClick={() => void testScript.selfCheckMonkey()}
                    />
                    <DefaultButton
                        text={t.tsKillMonkey}
                        iconProps={{ iconName: "Delete" }}
                        onClick={() => void testScript.killMonkey()}
                    />
                    {testScript.monkeyRunning && (
                        <span style={{ fontSize: 12, color: "#0078d4" }}>
                            ⏳ {t.tsMonkeyRunning}
                        </span>
                    )}
                    {testScript.monkeyFinished && !testScript.monkeyRunning && (
                        <span style={{ fontSize: 12, color: "#107c10" }}>
                            ✓ {t.tsMonkeyFinished}
                        </span>
                    )}
                </Stack>

                {testScript.monkeyCheck && (
                    <pre style={{ ...preview, maxHeight: 160, overflowY: "auto" }}>
                        {testScript.monkeyCheck}
                    </pre>
                )}

                {/* 后台模式：设备端日志路径 + 导出 */}
                {testScript.monkeyMode === "bg" && testScript.monkeyLogFile && (
                    <div
                        style={{
                            border: "1px solid #c7e0f4",
                            background: "#f3f9fd",
                            borderRadius: 4,
                            padding: 8,
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                        }}
                    >
                        <div style={{ fontSize: 12, color: "#005a9e" }}>
                            <b>{zh ? "设备端日志路径：" : "Device log path: "}</b>
                            <code style={mono}>{testScript.monkeyLogFile}</code>
                        </div>
                        <Stack
                            horizontal
                            tokens={{ childrenGap: 8 }}
                            wrap
                            verticalAlign="center"
                        >
                            <DefaultButton
                                text={zh ? "从设备导出日志" : "Export device log"}
                                iconProps={{ iconName: "Download" }}
                                onClick={async () => {
                                    const dir = await pickFolder();
                                    await testScript
                                        .exportMonkeyDeviceLog(dir)
                                        .catch(() => false);
                                }}
                            />
                            <DefaultButton
                                text={zh ? "刷新文件大小" : "Refresh size"}
                                iconProps={{ iconName: "Refresh" }}
                                onClick={async () => {
                                    const info =
                                        await testScript.refreshMonkeyDeviceLogInfo();
                                    if (info)
                                        testScript.append(
                                            `设备端日志（${testScript.monkeyLogFile}）：${info}`,
                                            "info",
                                        );
                                }}
                            />
                        </Stack>
                        <OpProgress bar={testScript.getProgress("monkeyDeviceLog")} />
                    </div>
                )}

                {/* Monkey 实时日志 */}
                <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="center" wrap>
                    <b style={{ flex: 1, fontSize: 13 }}>{t.tsMonkeyLiveLog}</b>
                    <span style={{ fontSize: 11, color: "#a19f9d" }}>
                        {testScript.monkeyLiveLog.length} {t.tsLines}
                        {testScript.monkeySinkDir && (
                            <span style={{ color: "#107c10", marginLeft: 6 }}>
                                · {zh ? "直写落盘" : "sinking"} {testScript.monkeySinkLines}{" "}
                                {t.tsLines}
                            </span>
                        )}
                    </span>
                    <Toggle
                        checked={!!testScript.monkeySinkDir}
                        onText={zh ? "直写本地文件夹" : "Sink to folder"}
                        offText={zh ? "直写本地文件夹" : "Sink to folder"}
                        styles={{ root: { marginBottom: 0 } }}
                        onChange={async (_, c) => {
                            if (c) {
                                const dir = await pickFolder();
                                await testScript.pickMonkeySink(dir);
                            } else {
                                await testScript.pickMonkeySink(undefined);
                            }
                        }}
                    />
                    <DefaultButton
                        text={t.tsMonkeySaveLog}
                        iconProps={{ iconName: "Save" }}
                        disabled={testScript.monkeyLiveLog.length === 0}
                        onClick={async () => {
                            const dir = await pickFolder();
                            if (dir)
                                await testScript.saveMonkeyLog(dir).catch(() => false);
                        }}
                    />
                    <DefaultButton
                        text={t.tsMonkeyDownloadLog}
                        iconProps={{ iconName: "Download" }}
                        disabled={testScript.monkeyLiveLog.length === 0}
                        onClick={() => void testScript.saveMonkeyLog()}
                    />
                    <DefaultButton
                        text={t.tsClearOutput}
                        disabled={testScript.monkeyLiveLog.length === 0}
                        onClick={() => testScript.clearMonkeyLog()}
                    />
                </Stack>
                <div
                    ref={monkeyLogRef}
                    style={{
                        height: 240,
                        minHeight: 100,
                        maxHeight: 640,
                        resize: "vertical",
                        overflow: "auto",
                        background: "#1e1e1e",
                        borderRadius: 4,
                        padding: 8,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        ...mono,
                    }}
                >
                    {testScript.monkeyLiveLog.length === 0 ? (
                        <span style={{ color: "#8c8c8c" }}>
                            {zh
                                ? "（点「前台运行 Monkey」后，monkey 日志会实时打印在这里；若开启「直写本地文件夹」，完整日志直接写入磁盘，页面只保留最近 1500 行以避免卡顿）"
                                : "(Monkey log streams here. Enable “Sink to folder” to write the full log straight to disk; the page keeps only the latest 1500 lines for performance.)"}
                        </span>
                    ) : (
                        testScript.monkeyLiveLog.map((l, i) => (
                            <div key={i} style={{ color: "#d4d4d4" }}>
                                {l}
                            </div>
                        ))
                    )}
                </div>
                <span style={{ fontSize: 11, color: "#a19f9d" }}>{t.tsMonkeyStopHint}</span>
            </div>

            {/* ── 四、蓝牙 HCI ── */}
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
                </Stack>
                <OpProgress bar={testScript.getProgress("hciExport")} />
                <OpProgress bar={testScript.getProgress("hciRemove")} />
            </div>

            {/* ── 五、CPU / 内存监控 ── */}
            <div style={card}>
                <h3 style={h3}>{t.tsSectionMonitor}</h3>
                <Stack horizontal tokens={{ childrenGap: 12 }} wrap verticalAlign="end">
                    <SpinButton
                        label={t.tsMonitorInterval}
                        value={String(testScript.monitorIntervalSec)}
                        min={2}
                        step={1}
                        onIncrement={(v) => {
                            testScript.setMonitorInterval(Number(v) + 1);
                        }}
                        onDecrement={(v) => {
                            testScript.setMonitorInterval(Math.max(2, Number(v) - 1));
                        }}
                        onChange={(_, v) => {
                            testScript.setMonitorInterval(Number(v) || 10);
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
                    <DefaultButton
                        text={t.tsDetectLeak}
                        iconProps={{ iconName: "SearchIssue" }}
                        disabled={testScript.monitorSampleCount < 5}
                        onClick={() => testScript.detectLeak()}
                    />
                    <DefaultButton
                        text={t.tsExportMonitor}
                        iconProps={{ iconName: "Download" }}
                        onClick={async () => {
                            const dir = await pickFolder();
                            if (dir)
                                await testScript.exportMonitor(dir).catch(() => false);
                        }}
                    />
                </Stack>
                <Stack horizontal tokens={{ childrenGap: 20 }} wrap>
                    <span style={{ fontSize: 12, color: "#605e5c" }}>
                        {t.tsMonitorSamples}：<b>{testScript.monitorSampleCount}</b>
                    </span>
                    <span style={{ fontSize: 12, color: "#605e5c" }}>
                        {t.tsMonitorDuration}：
                        <b>
                            {minToText(
                                testScript.monitoring
                                    ? testScript.monitorTick
                                    : testScript.monitorDurationSec,
                            )}
                        </b>
                        {testScript.monitoring && (
                            <span style={{ color: "#107c10", marginLeft: 4 }}>
                                {zh ? "（计时中…）" : "(timing…)"}
                            </span>
                        )}
                    </span>
                    <span style={{ fontSize: 12, color: "#605e5c" }}>
                        {zh ? "采样间隔" : "Interval"}：<b>{testScript.monitorIntervalSec}s</b>
                    </span>
                    {testScript.lastSampleAt && (
                        <span style={{ fontSize: 12, color: "#605e5c" }}>
                            {t.tsLastSample}：{testScript.lastSampleAt}
                        </span>
                    )}
                </Stack>

                {/* 统计：最小 / 平均 / 峰值 */}
                {testScript.monitorStats && (
                    <div
                        style={{
                            display: "flex",
                            gap: 16,
                            flexWrap: "wrap",
                            fontSize: 12,
                            background: "#fff",
                            border: "1px solid #edebe9",
                            borderRadius: 4,
                            padding: "8px 10px",
                        }}
                    >
                        <span>
                            <b style={{ color: "#d13438" }}>CPU</b>
                            {"  "}
                            {zh ? "最小" : "min"} {testScript.monitorStats.cpu.min}% ·{" "}
                            {zh ? "平均" : "avg"}{" "}
                            <b>{testScript.monitorStats.cpu.avg}%</b> ·{" "}
                            {zh ? "峰值" : "peak"}{" "}
                            <b style={{ color: "#d13438" }}>
                                {testScript.monitorStats.cpu.max}%
                            </b>
                        </span>
                        <span>
                            <b style={{ color: "#0078d4" }}>内存</b>
                            {"  "}
                            {zh ? "最小" : "min"} {testScript.monitorStats.mem.min}% ·{" "}
                            {zh ? "平均" : "avg"}{" "}
                            <b>{testScript.monitorStats.mem.avg}%</b> ·{" "}
                            {zh ? "峰值" : "peak"}{" "}
                            <b style={{ color: "#0078d4" }}>
                                {testScript.monitorStats.mem.max}%
                            </b>
                        </span>
                    </div>
                )}
                <OpProgress bar={testScript.getProgress("monitorExport")} />

                <div>
                    <div style={{ fontSize: 12, color: "#605e5c", marginBottom: 4 }}>
                        {t.tsCpuUsage}
                    </div>
                    <LineChart
                        series={[
                            {
                                name: "CPU",
                                color: "#d13438",
                                data: testScript.cpuHistory,
                            },
                        ]}
                        maxY={100}
                        height={140}
                        markPeak
                    />
                </div>
                <div>
                    <div style={{ fontSize: 12, color: "#605e5c", marginBottom: 4 }}>
                        {t.tsMemUsage}
                    </div>
                    <LineChart
                        series={[
                            {
                                name: "MEM",
                                color: "#0078d4",
                                data: testScript.memHistory,
                            },
                        ]}
                        maxY={100}
                        height={140}
                        markPeak
                    />
                </div>

                {/* Top 进程明细：谁拉高了整体占用 */}
                {(testScript.lastTopCpu.length > 0 || testScript.lastTopMem.length > 0) && (
                    <Stack horizontal tokens={{ childrenGap: 12 }} wrap>
                        <div style={{ flex: 1, minWidth: 280 }}>
                            <div
                                style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "#d13438",
                                    marginBottom: 4,
                                }}
                            >
                                {zh
                                    ? `CPU 占用 Top（谁拉高了 CPU，最近 ${testScript.lastSampleAt}）`
                                    : `Top CPU processes (${testScript.lastSampleAt})`}
                            </div>
                            <div
                                style={{
                                    maxHeight: 200,
                                    overflowY: "auto",
                                    border: "1px solid #edebe9",
                                    borderRadius: 4,
                                    background: "#fff",
                                    ...mono,
                                }}
                            >
                                {testScript.lastTopCpu.map((p, i) => {
                                    const total = testScript.cpuHistory.at(-1) ?? 0;
                                    const share = total > 0 ? (p.value / total) * 100 : 0;
                                    return (
                                        <div
                                            key={i}
                                            style={{
                                                padding: "3px 8px",
                                                borderBottom: "1px solid #f3f2f1",
                                                display: "flex",
                                                gap: 8,
                                            }}
                                        >
                                            <span
                                                style={{
                                                    width: 52,
                                                    color: "#d13438",
                                                    textAlign: "right",
                                                }}
                                            >
                                                {p.value}%
                                            </span>
                                            <span style={{ flex: 1 }}>
                                                {p.name}
                                                {p.pid ? (
                                                    <span style={{ color: "#a19f9d" }}>
                                                        {" "}
                                                        (pid {p.pid})
                                                    </span>
                                                ) : null}
                                            </span>
                                            <span style={{ color: "#605e5c" }}>
                                                {zh ? "占整体" : "of total"}{" "}
                                                {share.toFixed(0)}%
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 280 }}>
                            <div
                                style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "#0078d4",
                                    marginBottom: 4,
                                }}
                            >
                                {zh
                                    ? `内存占用 Top（谁拉高了内存，最近 ${testScript.lastSampleAt}）`
                                    : `Top memory processes (${testScript.lastSampleAt})`}
                            </div>
                            <div
                                style={{
                                    maxHeight: 200,
                                    overflowY: "auto",
                                    border: "1px solid #edebe9",
                                    borderRadius: 4,
                                    background: "#fff",
                                    ...mono,
                                }}
                            >
                                {testScript.lastTopMem.map((p, i) => (
                                    <div
                                        key={i}
                                        style={{
                                            padding: "3px 8px",
                                            borderBottom: "1px solid #f3f2f1",
                                            display: "flex",
                                            gap: 8,
                                        }}
                                    >
                                        <span
                                            style={{
                                                width: 62,
                                                color: "#0078d4",
                                                textAlign: "right",
                                            }}
                                        >
                                            {p.value}MB
                                        </span>
                                        <span style={{ flex: 1 }}>
                                            {p.name}
                                            {p.pid ? (
                                                <span style={{ color: "#a19f9d" }}>
                                                    {" "}
                                                    (pid {p.pid})
                                                </span>
                                            ) : null}
                                        </span>
                                        {p.percent !== undefined && (
                                            <span style={{ color: "#605e5c" }}>
                                                {p.percent}%
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </Stack>
                )}

                {/* 内存泄露检测结果 */}
                {testScript.leakResult && (
                    <div
                        style={{
                            border: `1px solid ${leakLevelColor}`,
                            borderRadius: 4,
                            padding: 10,
                            background: "#fff",
                        }}
                    >
                        <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="center">
                            <div
                                style={{
                                    flex: 1,
                                    fontWeight: 600,
                                    color: leakLevelColor,
                                }}
                            >
                                {t.tsLeakTitle}：
                                {testScript.leakResult.level === "likely"
                                    ? t.tsLeakLikely
                                    : testScript.leakResult.level === "slight"
                                      ? t.tsLeakSlight
                                      : t.tsLeakNone}
                            </div>
                            {testScript.leakBugs.length > 0 && (
                                <DefaultButton
                                    text={zh ? "导出问题单" : "Export bug report"}
                                    iconProps={{ iconName: "Download" }}
                                    onClick={async () => {
                                        const dir = await pickFolder();
                                        await testScript
                                            .exportLeakBugs(dir)
                                            .catch(() => false);
                                    }}
                                />
                            )}
                        </Stack>
                        <pre
                            style={{
                                ...preview,
                                background: "#faf9f8",
                                color: "#323130",
                                maxHeight: 200,
                                overflowY: "auto",
                            }}
                        >
                            {testScript.leakResult.detail}
                        </pre>
                        <OpProgress bar={testScript.getProgress("leakExport")} />

                        {/* 详细问题单（提 bug 单格式） */}
                        {testScript.leakBugs.map((b, i) => (
                            <div
                                key={i}
                                style={{
                                    marginTop: 10,
                                    border: "1px solid #edebe9",
                                    borderRadius: 4,
                                    background: "#faf9f8",
                                    padding: 10,
                                }}
                            >
                                <div
                                    style={{
                                        fontWeight: 600,
                                        color: leakLevelColor,
                                        marginBottom: 4,
                                    }}
                                >
                                    {zh ? "缺陷" : "Bug"} {i + 1}：{b.title}
                                </div>
                                <div style={{ fontSize: 12, color: "#605e5c" }}>
                                    {zh ? "严重程度" : "Severity"}：<b>{b.severity}</b>
                                </div>
                                {[
                                    [zh ? "问题现象" : "Phenomenon", b.phenomenon],
                                    [
                                        zh ? "复现步骤" : "Steps",
                                        b.steps.map((s, k) => `${k + 1}. ${s}`).join("\n"),
                                    ],
                                    [
                                        zh ? "数据证据" : "Evidence",
                                        b.evidence.map((e) => `· ${e}`).join("\n"),
                                    ],
                                    [zh ? "判定依据" : "Basis", b.basis],
                                    [zh ? "影响范围" : "Impact", b.impact],
                                    [zh ? "建议排查方向" : "Suggestion", b.suggestion],
                                ].map(([label, val], k) => (
                                    <div key={k} style={{ marginTop: 6 }}>
                                        <div
                                            style={{
                                                fontSize: 12,
                                                fontWeight: 600,
                                                color: "#323130",
                                            }}
                                        >
                                            【{label}】
                                        </div>
                                        <pre
                                            style={{
                                                margin: "2px 0 0",
                                                whiteSpace: "pre-wrap",
                                                wordBreak: "break-all",
                                                fontSize: 12,
                                                color: "#323130",
                                                fontFamily:
                                                    "Segoe UI, system-ui, sans-serif",
                                                lineHeight: 1.7,
                                            }}
                                        >
                                            {val}
                                        </pre>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}

                {(testScript.cpuSample || testScript.memSample) && (
                    <pre style={{ ...preview, maxHeight: 200, overflowY: "auto" }}>
                        {`# CPU\n${testScript.cpuSample ?? ""}\n\n# MEM\n${testScript.memSample ?? ""}`}
                    </pre>
                )}
                <span style={{ fontSize: 11, color: "#a19f9d" }}>{t.tsMonitorHint}</span>
            </div>

            {/* ── 六、应用管理 ── */}
            <div style={card}>
                <h3 style={h3}>{t.tsSectionApps}</h3>
                <Stack horizontal tokens={{ childrenGap: 12 }} wrap verticalAlign="end">
                    <Stack tokens={{ childrenGap: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                            {t.tsAppFilter}
                        </span>
                        {appFilterButtons}
                    </Stack>
                    <DefaultButton
                        text={t.tsListApps}
                        iconProps={{ iconName: "Refresh" }}
                        onClick={() => void testScript.loadApps()}
                        disabled={testScript.loadingApps}
                    />
                    <TextField
                        placeholder={t.tsSearchPkg}
                        value={appQuery}
                        onChange={(_, v) => setAppQuery(v ?? "")}
                        styles={{ root: { width: 200 } }}
                    />
                    <DefaultButton
                        text={t.tsExportAppList}
                        iconProps={{ iconName: "Download" }}
                        onClick={async () => {
                            const dir = await pickFolder();
                            if (dir)
                                await testScript.exportAppList(dir).catch(() => false);
                        }}
                    />
                </Stack>
                <OpProgress bar={testScript.getProgress("appListExport")} />
                <Stack
                    horizontal
                    tokens={{ childrenGap: 12 }}
                    wrap
                    verticalAlign="center"
                >
                    <TextField
                        placeholder={`${t.tsAppsLoaded}${testScript.apps.length}`}
                        value={testScript.selectedPackage}
                        onChange={(_, v) => (testScript.selectedPackage = v ?? "")}
                        list="pkg-list"
                        styles={{ root: { minWidth: 360 } }}
                    />
                    <datalist id="pkg-list">
                        {appOptions.map((o) => (
                            <option key={String(o.key)} value={String(o.key)} />
                        ))}
                    </datalist>
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
                        text={t.tsOpenApp}
                        iconProps={{ iconName: "OpenInNewWindow" }}
                        disabled={!testScript.selectedPackage}
                        onClick={() =>
                            void testScript.openApp(testScript.selectedPackage)
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
                    <span style={{ fontSize: 11, color: "#a19f9d" }}>
                        {testScript.output.length} {t.tsLines}
                    </span>
                    <DefaultButton
                        text={t.tsClearOutput}
                        onClick={() => testScript.clearOutput()}
                    />
                </Stack>
                <div
                    ref={outRef}
                    style={{
                        height: 280,
                        minHeight: 100,
                        maxHeight: 720,
                        resize: "vertical",
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
                <span style={{ fontSize: 11, color: "#a19f9d" }}>
                    {t.tsOutputResizeHint}
                </span>
            </div>
        </Stack>
    );
});

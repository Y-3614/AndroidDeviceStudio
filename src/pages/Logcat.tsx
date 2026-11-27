import {
    DefaultButton,
    Dropdown,
    type IDropdownOption,
    MessageBar,
    MessageBarType,
    SearchBox,
    Stack,
    TextField,
    Toggle,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";
import {
    LOGCAT_BUFFERS,
    LOGCAT_FORMATS,
    logcat,
    LEVEL_ORDER,
} from "../state/logcat";
import { saveBlob } from "../state/file-stream";

const LEVEL_STYLE: Record<string, { color: string; label: string }> = {
    V: { color: "#a19f9d", label: "Verbose" },
    D: { color: "#0078d4", label: "Debug" },
    I: { color: "#107c10", label: "Info" },
    W: { color: "#c19c00", label: "Warn" },
    E: { color: "#d13438", label: "Error" },
    F: { color: "#a4262c", label: "Fatal" },
};
const LINE_COLOR: Record<string, string> = {
    V: "#8c8c8c",
    D: "#4fc1ff",
    I: "#6ac07a",
    W: "#e2c08d",
    E: "#f48771",
    F: "#f48771",
    A: "#f48771",
};

export const LogcatPage = observer(function LogcatPage() {
    const t = i18n.t;
    const [autoScroll, setAutoScroll] = useState(true);
    const viewRef = useRef<HTMLDivElement | null>(null);

    // 进入页面时自动加载应用列表
    useEffect(() => {
        if (connection.isConnected && logcat.apps.length === 0) {
            void logcat.loadApps();
        }
    }, []);

    useEffect(() => {
        if (autoScroll && viewRef.current) {
            viewRef.current.scrollTop = viewRef.current.scrollHeight;
        }
    }, [logcat.lines.length, autoScroll]);

    if (!connection.isConnected) {
        return (
            <Stack styles={{ root: { padding: 16 } }}>
                <MessageBar>{t.waiting}</MessageBar>
            </Stack>
        );
    }

    const filtered = logcat.filtered;
    const activeLevelCount = LEVEL_ORDER.filter(
        (l) => logcat.enabledLevels[l],
    ).length;

    const appOptions: IDropdownOption[] = [
        { key: "", text: t.allApps },
        ...logcat.apps.map((a) => ({
            key: a.package,
            text: a.pid ? `${a.package} (pid ${a.pid})` : a.package,
        })),
    ];

    return (
        <Stack styles={{ root: { padding: 16, height: "100%", gap: 8 } }}>
            {/* 第一行：采集控制 + 格式/缓冲 */}
            <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="end" wrap>
                {logcat.running ? (
                    <DefaultButton
                        text={t.stop}
                        iconProps={{ iconName: "Stop" }}
                        onClick={() => void logcat.stop()}
                    />
                ) : (
                    <DefaultButton
                        text={t.start}
                        iconProps={{ iconName: "Play" }}
                        onClick={() => void logcat.start()}
                    />
                )}
                <DefaultButton
                    text={t.clear}
                    iconProps={{ iconName: "Clear" }}
                    onClick={() => (logcat.lines = [])}
                />
                <DefaultButton
                    text={t.clearDeviceBuffer}
                    iconProps={{ iconName: "Delete" }}
                    title={t.clearDeviceBufferHint}
                    onClick={() => void logcat.clearDeviceBuffer()}
                />
                <DefaultButton
                    text={t.exportLog}
                    iconProps={{ iconName: "Download" }}
                    onClick={() => {
                        const blob = new Blob([logcat.exportText()], {
                            type: "text/plain",
                        });
                        saveBlob(blob, `logcat-${Date.now()}.txt`);
                    }}
                />
                <Dropdown
                    label={t.logcatFormat}
                    selectedKey={logcat.format}
                    options={LOGCAT_FORMATS.map((f) => ({ key: f.key, text: f.text }))}
                    onChange={(_, o) => (logcat.format = o?.key as string)}
                    styles={{ root: { width: 260 } }}
                    disabled={logcat.running}
                />
                <Dropdown
                    label={t.logcatBuffer}
                    selectedKey={logcat.buffer}
                    options={LOGCAT_BUFFERS.map((b) => ({ key: b.key, text: b.text }))}
                    onChange={(_, o) => (logcat.buffer = o?.key as string)}
                    styles={{ root: { width: 190 } }}
                    disabled={logcat.running}
                />
            </Stack>

            {/* 第二行：等级 + 自动滚动 */}
            <Stack horizontal tokens={{ childrenGap: 6 }} verticalAlign="center" wrap>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {t.logcatLevel}：
                </span>
                {LEVEL_ORDER.map((lv) => {
                    const on = logcat.enabledLevels[lv];
                    const sty = LEVEL_STYLE[lv]!;
                    return (
                        <button
                            key={lv}
                            type="button"
                            onClick={() => logcat.setLevel(lv, !on)}
                            style={{
                                minWidth: 46,
                                height: 30,
                                borderRadius: 4,
                                cursor: "pointer",
                                fontWeight: 600,
                                fontSize: 13,
                                border: `1px solid ${on ? sty.color : "#c8c6c4"}`,
                                background: on ? sty.color : "#ffffff",
                                color: on ? "#ffffff" : "#605e5c",
                                transition: "all .15s",
                            }}
                            title={`${sty.label} — ${on ? t.levelOn : t.levelOff}`}
                        >
                            {lv}
                        </button>
                    );
                })}
                <DefaultButton
                    text={
                        activeLevelCount === LEVEL_ORDER.length
                            ? t.levelNone
                            : t.levelAll
                    }
                    onClick={() =>
                        logcat.setAllLevels(activeLevelCount !== LEVEL_ORDER.length)
                    }
                    styles={{ root: { height: 30 } }}
                />
                <Toggle
                    label={t.autoScroll}
                    inlineLabel
                    checked={autoScroll}
                    onChange={(_, c) => setAutoScroll(!!c)}
                />
            </Stack>

            {/* 第三行：应用识别 + 关键字 + 标签 */}
            <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="end" wrap>
                <Dropdown
                    label={t.appFilter}
                    selectedKey={logcat.packageFilter}
                    options={appOptions}
                    onChange={(_, o) => {
                        logcat.packageFilter = (o?.key as string) ?? "";
                        void logcat.refreshFilterPid();
                    }}
                    styles={{ root: { width: 300 } }}
                    disabled={logcat.loadingApps}
                />
                <DefaultButton
                    text={t.loadApps}
                    iconProps={{ iconName: "Refresh" }}
                    onClick={() => void logcat.loadApps()}
                    disabled={logcat.loadingApps}
                />
                <DefaultButton
                    text={t.refreshPid}
                    iconProps={{ iconName: "Sync" }}
                    onClick={() => void logcat.refreshFilterPid()}
                    disabled={!logcat.packageFilter}
                />
                <SearchBox
                    placeholder={t.keywordFilter}
                    value={logcat.keyword}
                    onChange={(_, v) => (logcat.keyword = v ?? "")}
                    styles={{ root: { width: 200 } }}
                />
                <TextField
                    placeholder={t.tagFilter}
                    value={logcat.tagFilter}
                    onChange={(_, v) => (logcat.tagFilter = v ?? "")}
                    styles={{ root: { width: 150 } }}
                />
                <span style={{ color: "#605e5c", fontSize: 12 }}>
                    {t.collectedLines} {logcat.total} · {t.showingLines}{" "}
                    {filtered.length}
                    {logcat.hiddenByDisplayCap
                        ? `（含已省略 ${logcat.hiddenByDisplayCap}）`
                        : ""}
                </span>
            </Stack>

            {/* 第四行：日志落盘设置 */}
            <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="center" wrap>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {t.logFolder}：
                </span>
                <span
                    style={{
                        fontSize: 12,
                        color: logcat.dirName ? "#107c10" : "#605e5c",
                    }}
                >
                    {logcat.dirName
                        ? `${logcat.dirName} / ${logcat.writer.baseName || "..."}`
                        : t.defaultBrowserMemory}
                </span>
                <DefaultButton
                    text={t.chooseFolder}
                    iconProps={{ iconName: "FolderOpen" }}
                    onClick={() => void logcat.chooseLogDirectory()}
                />
                {logcat.dirName && (
                    <DefaultButton
                        text={t.clearFolder}
                        onClick={() => logcat.clearLogDirectory()}
                    />
                )}
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {t.autoStopAfter}：
                </span>
                <Dropdown
                    selectedKey={String(logcat.autoStopMinutes)}
                    options={[
                        { key: "0", text: t.unlimited },
                        { key: "1", text: `1 ${t.minutes}` },
                        { key: "5", text: `5 ${t.minutes}` },
                        { key: "10", text: `10 ${t.minutes}` },
                        { key: "30", text: `30 ${t.minutes}` },
                        { key: "60", text: `60 ${t.minutes}` },
                    ]}
                    onChange={(_, o) => (logcat.autoStopMinutes = Number(o?.key))}
                    styles={{ root: { width: 120 } }}
                    disabled={logcat.running}
                />
            </Stack>

            <span style={{ fontSize: 11, color: "#a19f9d" }}>{t.logFolderHint}</span>
            <span style={{ fontSize: 11, color: "#a19f9d" }}>{t.logcatPickAppHint}</span>

            {logcat.error && (
                <MessageBar messageBarType={MessageBarType.warning} isMultiline>
                    {logcat.error}
                </MessageBar>
            )}

            <div
                ref={viewRef}
                style={{
                    flexGrow: 1,
                    minHeight: 0,
                    overflow: "auto",
                    background: "#1e1e1e",
                    color: "#d4d4d4",
                    fontFamily: "Consolas, Menlo, monospace",
                    fontSize: 12,
                    padding: 8,
                    borderRadius: 4,
                    whiteSpace: "pre",
                }}
            >
                {filtered.length === 0 ? (
                    <div style={{ color: "#8c8c8c" }}>{t.logcatNoData}</div>
                ) : (
                    filtered.map((l) => (
                        <div
                            key={l.id}
                            style={{ color: LINE_COLOR[l.level] ?? "#d4d4d4" }}
                        >
                            {l.raw}
                        </div>
                    ))
                )}
            </div>
        </Stack>
    );
});

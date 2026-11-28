import {
    ComboBox,
    DefaultButton,
    type IComboBoxOption,
    Dropdown,
    MessageBar,
    MessageBarType,
    SearchBox,
    Stack,
    TextField,
    Toggle,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef, useState } from "react";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";
import {
    LOGCAT_BUFFERS,
    LOGCAT_FORMATS,
    logcat,
    LEVEL_ORDER,
    type LogLine,
} from "../state/logcat";
import { formatSize } from "../state/fs";
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

/* =========================================================================
 * 性能与稳定性要点（踩过的坑）：
 *
 * 采集时每 ~300ms 提交一批新日志，会触发响应式更新。
 * 若把「工具栏（含 500+ 选项的应用下拉）」和「日志列表」放在同一个 observer 组件里，
 * 每次更新都会重渲染整个工具栏 —— 表现就是用户反馈的
 * 「应用下拉点开就自动收起 / 闪退」。
 *
 * 解决：按更新频率拆成独立 observer 子组件：
 *   - Toolbar：只观察低频状态（格式/缓冲/等级/目录名），采集时**不重渲染**；
 *   - Stats  ：观察高频计数（已采集/显示/日志大小），体积极小；
 *   - List   ：观察高频日志行。
 * 另外给 ComboBox 开 `persistMenu`，避免弹层在重渲染时被销毁。
 * ========================================================================= */

/** 高频统计（独立小组件，避免拖累工具栏） */
const LogStats = observer(function LogStats() {
    const t = i18n.t;
    return (
        <Stack horizontal tokens={{ childrenGap: 12 }} verticalAlign="center" wrap>
            <span
                style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#0078d4",
                    background: "#f3f2f1",
                    padding: "2px 8px",
                    borderRadius: 4,
                }}
            >
                {t.logSize}：{formatSize(logcat.logBytes)}
                {logcat.logPart > 0 ? ` · ${t.logFilePart} ${logcat.logPart + 1}` : ""}
            </span>
            <span style={{ color: "#605e5c", fontSize: 12 }}>
                {t.collectedLines} {logcat.total} · {t.showingLines}{" "}
                {logcat.filteredTotal}
                {logcat.hiddenByDisplayCap
                    ? `（含已省略 ${logcat.hiddenByDisplayCap}）`
                    : ""}
            </span>
        </Stack>
    );
});

/** 日志列表（高频更新只影响这里） */
const LogListView = observer(function LogListView({
    autoScroll,
    onUserScroll,
}: {
    autoScroll: boolean;
    onUserScroll: (atBottom: boolean) => void;
}) {
    const t = i18n.t;
    const ref = useRef<HTMLDivElement | null>(null);
    const lines = logcat.filtered;
    const stickRef = useRef(true);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (!autoScroll) return;
        // 只有「贴底跟随」时才自动滚到底；用户上滚后不再强制拉回
        if (stickRef.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [lines.length, autoScroll]);

    return (
        <div
            ref={ref}
            onScroll={(e) => {
                const el = e.currentTarget;
                const atBottom =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                stickRef.current = atBottom;
                onUserScroll(atBottom);
            }}
            style={{
                flexGrow: 1,
                flexBasis: 0,
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",
                background: "#1e1e1e",
                color: "#d4d4d4",
                fontFamily: "Consolas, Menlo, monospace",
                fontSize: 12,
                padding: 8,
                borderRadius: 4,
                // 长行折行显示：避免横向滚动条造成「滚动条动了但内容不动」的错觉
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
            }}
        >
            {lines.length === 0 ? (
                <div style={{ color: "#8c8c8c" }}>{t.logcatNoData}</div>
            ) : (
                lines.map((l: LogLine) => (
                    <div
                        key={l.id}
                        style={{ color: LINE_COLOR[l.level] ?? "#d4d4d4" }}
                    >
                        {l.raw}
                    </div>
                ))
            )}
        </div>
    );
});

export const LogcatPage = observer(function LogcatPage() {
    const t = i18n.t;
    const [autoScroll, setAutoScroll] = useState(true);
    const [followBottom, setFollowBottom] = useState(true);

    // 进入页面时自动加载应用列表
    useEffect(() => {
        if (connection.isConnected && logcat.apps.length === 0) {
            void logcat.loadApps();
        }
    }, []);

    // 应用选项：仅在应用数量变化时重建
    const appOptions: IComboBoxOption[] = useMemo(
        () => [
            { key: "", text: t.allApps },
            ...logcat.apps.map((a) => ({
                key: a.package,
                text: a.pid ? `${a.package} (pid ${a.pid})` : a.package,
            })),
        ],
        [logcat.apps.length, t.allApps],
    );

    if (!connection.isConnected) {
        return (
            <Stack styles={{ root: { padding: 16 } }}>
                <MessageBar>{t.waiting}</MessageBar>
            </Stack>
        );
    }

    const activeLevelCount = LEVEL_ORDER.filter(
        (l) => logcat.enabledLevels[l],
    ).length;

    return (
        <Stack
            styles={{
                root: {
                    padding: 16,
                    height: "100%",
                    boxSizing: "border-box",
                    gap: 8,
                    overflow: "hidden",
                },
            }}
        >
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
                    onChange={(_, c) => {
                        setAutoScroll(!!c);
                        setFollowBottom(!!c);
                    }}
                />
            </Stack>

            {/* 第三行：应用识别 + 关键字 + 标签 */}
            <Stack horizontal tokens={{ childrenGap: 8 }} verticalAlign="end" wrap>
                <ComboBox
                    label={t.appFilter}
                    allowFreeform
                    autoComplete="on"
                    // persistMenu：弹层常驻 DOM，避免重渲染时被销毁（闪退）
                    persistMenu
                    selectedKey={logcat.packageFilter || ""}
                    options={appOptions}
                    onChange={(_, o) => {
                        if (!o) return;
                        logcat.packageFilter = String(o.key ?? "");
                        void logcat.refreshFilterPid();
                    }}
                    calloutProps={{ calloutMaxHeight: 400 }}
                    styles={{
                        root: { width: 300 },
                        callout: { maxHeight: 400 },
                    }}
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
            </Stack>

            {/* 第四行：日志落盘设置 + 大小显示 */}
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
                        ? `${logcat.dirName} / ${logcat.writer.baseName || "..."}.txt`
                        : t.defaultBrowserMemory}
                </span>
                <DefaultButton
                    text={t.chooseFolder}
                    iconProps={{ iconName: "FolderOpen" }}
                    onClick={() => void logcat.chooseLogDirectory()}
                    disabled={logcat.running}
                />
                {logcat.dirName && (
                    <DefaultButton
                        text={t.clearFolder}
                        onClick={() => logcat.clearLogDirectory()}
                        disabled={logcat.running}
                    />
                )}
                <LogStats />
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
            {logcat.logError && (
                <MessageBar messageBarType={MessageBarType.error} isMultiline>
                    落盘错误：{logcat.logError}
                </MessageBar>
            )}

            <LogListView
                autoScroll={autoScroll && followBottom}
                onUserScroll={(atBottom) => setFollowBottom(atBottom)}
            />
        </Stack>
    );
});

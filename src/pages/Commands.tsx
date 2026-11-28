import {
    DefaultButton,
    Dialog,
    DialogFooter,
    DialogType,
    Dropdown,
    type IDropdownOption,
    Icon,
    IconButton,
    MessageBar,
    MessageBarType,
    PrimaryButton,
    SearchBox,
    Spinner,
    SpinnerSize,
    Stack,
    TextField,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { adbCommands, type AdbCommand } from "../state/commands-store";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";

/** 命令大全页：内置 100 条（不可删）+ 用户自定义（可增删改，云端共享） */
export const CommandsPage = observer(function CommandsPage() {
    const t = i18n.t;
    const zh = i18n.lang === "zh";

    const [editing, setEditing] = useState<AdbCommand | undefined>();
    const [showForm, setShowForm] = useState(false);
    const [formCategory, setFormCategory] = useState("自定义");
    const [formCommand, setFormCommand] = useState("");
    const [formDesc, setFormDesc] = useState("");
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<string | undefined>();

    // 进入页面时从云端拉取（失败自动降级本地）
    useEffect(() => {
        void adbCommands.syncFromCloud();
    }, []);

    const openAdd = () => {
        setEditing(undefined);
        setFormCategory("自定义");
        setFormCommand("");
        setFormDesc("");
        setShowForm(true);
    };

    const openEdit = (cmd: AdbCommand) => {
        setEditing(cmd);
        setFormCategory(cmd.category);
        setFormCommand(cmd.command);
        setFormDesc(cmd.description);
        setShowForm(true);
    };

    const save = async () => {
        if (!formCommand.trim() || saving) return;
        setSaving(true);
        try {
            if (editing) {
                await adbCommands.updateCustom(editing.id, {
                    category: formCategory,
                    command: formCommand,
                    description: formDesc,
                });
                setNotice(zh ? "已更新。" : "Updated.");
            } else {
                const r = await adbCommands.addCustom({
                    category: formCategory,
                    command: formCommand,
                    description: formDesc,
                });
                setNotice(
                    r.cloud
                        ? zh
                            ? "已保存到云端，所有人都能看到。"
                            : "Saved to cloud — visible to everyone."
                        : zh
                          ? `云端暂不可用，已保存在本机浏览器：${r.error ?? ""}`
                          : `Cloud unavailable; saved locally: ${r.error ?? ""}`,
                );
            }
        } finally {
            setSaving(false);
            setShowForm(false);
        }
    };

    const remove = async (cmd: AdbCommand) => {
        if (
            !window.confirm(
                zh
                    ? `确认删除这条自定义命令？\n\n${cmd.command}`
                    : `Delete this custom command?\n\n${cmd.command}`,
            )
        ) {
            return;
        }
        await adbCommands.removeCustom(cmd.id);
        setNotice(zh ? "已删除。" : "Deleted.");
    };

    const categoryOptions: IDropdownOption[] = adbCommands.categories.map((c) => ({
        key: c,
        text: c,
    }));

    const cloudBadge = () => {
        switch (adbCommands.cloudState) {
            case "loading":
                return (
                    <MessageBar>
                        {zh ? "正在从云端加载命令…" : "Loading commands from cloud…"}
                    </MessageBar>
                );
            case "ready":
                return (
                    <MessageBar>
                        {zh
                            ? `已连接云端，自定义命令对所有访客共享。最近同步：${adbCommands.lastSync}`
                            : `Cloud connected — custom commands are shared with every visitor. Last sync: ${adbCommands.lastSync}`}
                    </MessageBar>
                );
            case "local":
            case "error":
                return (
                    <MessageBar
                        messageBarType={MessageBarType.warning}
                        isMultiline
                    >
                        {zh
                            ? `云端暂不可用，新增命令仅保存在本机浏览器（不共享）。原因：${adbCommands.cloudError ?? "未知"}`
                            : `Cloud unavailable — new commands are saved locally only (not shared). Reason: ${adbCommands.cloudError ?? "unknown"}`}
                    </MessageBar>
                );
            default:
                return null;
        }
    };

    return (
        <Stack
            styles={{
                root: {
                    padding: 16,
                    gap: 10,
                    height: "100%",
                    minHeight: 0,
                    boxSizing: "border-box",
                    overflowY: "auto",
                    overflowX: "hidden",
                },
            }}
        >
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
                {zh ? "ADB 命令大全" : "ADB Command Reference"}
            </h2>
            <p style={{ color: "#605e5c", margin: 0, lineHeight: 1.7 }}>
                {zh
                    ? `内置 ${adbCommands.builtinCount} 条真实可用命令（不可删除、不可修改），可在其基础上新增自己的命令。新增的命令会共享给所有打开本网站的人；自己创建的命令可以修改和删除。点击「复制」拿到命令，或点「执行」直接在当前连接的设备上运行。`
                    : `${adbCommands.builtinCount} built-in commands (not editable), plus your own additions. Added commands are shared with everyone who opens this site; the ones you created can be edited and deleted.`}
            </p>

            {cloudBadge()}

            {notice && (
                <MessageBar
                    onDismiss={() => setNotice(undefined)}
                    dismissButtonAriaLabel="close"
                >
                    {notice}
                </MessageBar>
            )}

            {/* 工具栏 */}
            <Stack horizontal tokens={{ childrenGap: 8 }} wrap verticalAlign="end">
                <SearchBox
                    placeholder={zh ? "搜索命令或说明…" : "Search commands…"}
                    value={adbCommands.query}
                    onChange={(_, v) => adbCommands.setQuery(v ?? "")}
                    styles={{ root: { width: 260 } }}
                />
                <Dropdown
                    placeholder={zh ? "全部分类" : "All categories"}
                    options={[{ key: "", text: zh ? "全部分类" : "All" }, ...categoryOptions]}
                    selectedKey={adbCommands.category}
                    onChange={(_, o) => adbCommands.setCategory(String(o?.key ?? ""))}
                    styles={{ root: { width: 180 } }}
                />
                <PrimaryButton
                    text={zh ? "新增命令" : "Add command"}
                    iconProps={{ iconName: "Add" }}
                    onClick={openAdd}
                />
                <DefaultButton
                    text={zh ? "刷新云端" : "Refresh cloud"}
                    iconProps={{ iconName: "Refresh" }}
                    onClick={() => void adbCommands.syncFromCloud()}
                />
                <DefaultButton
                    text={zh ? "导出 JSON" : "Export JSON"}
                    iconProps={{ iconName: "Download" }}
                    onClick={() => {
                        const blob = new Blob([adbCommands.exportJson()], {
                            type: "application/json",
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "adb-commands.json";
                        a.click();
                        URL.revokeObjectURL(url);
                    }}
                />
                <span style={{ color: "#605e5c", fontSize: 13, alignSelf: "center" }}>
                    {zh
                        ? `内置 ${adbCommands.builtinCount} · 自定义 ${adbCommands.customCount}`
                        : `Built-in ${adbCommands.builtinCount} · Custom ${adbCommands.customCount}`}
                </span>
            </Stack>

            {/* 执行结果 */}
            {adbCommands.results.length > 0 && (
                <Stack
                    styles={{
                        root: {
                            border: "1px solid #edebe9",
                            borderRadius: 4,
                            padding: 10,
                            gap: 6,
                            background: "#faf9f8",
                        },
                    }}
                >
                    <Stack horizontal horizontalAlign="space-between">
                        <b>{zh ? "执行结果" : "Execution results"}</b>
                        <DefaultButton
                            text={zh ? "清空" : "Clear"}
                            onClick={() => adbCommands.clearResults()}
                        />
                    </Stack>
                    {adbCommands.results.map((r, i) => (
                        <div key={i} style={{ fontFamily: "Consolas, Menlo, monospace", fontSize: 12 }}>
                            <div style={{ color: "#0078d4" }}>
                                $ {r.command}{" "}
                                {!r.ok && (
                                    <span style={{ color: "#a4262c" }}>
                                        ({zh ? "失败" : "failed"})
                                    </span>
                                )}
                            </div>
                            <pre
                                style={{
                                    margin: 0,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-all",
                                    color: r.ok ? "#323130" : "#a4262c",
                                    maxHeight: 180,
                                    overflow: "auto",
                                }}
                            >
                                {r.output}
                            </pre>
                        </div>
                    ))}
                </Stack>
            )}

            {!connection.isConnected && (
                <MessageBar messageBarType={MessageBarType.info}>
                    {zh
                        ? "尚未连接设备。「复制」始终可用；「执行」需要先连接设备。"
                        : "No device connected. Copy always works; Run needs a connected device."}
                </MessageBar>
            )}

            {/* 命令分组 */}
            {adbCommands.cloudState === "loading" && adbCommands.custom.length === 0 ? (
                <Spinner size={SpinnerSize.medium} />
            ) : (
                adbCommands.grouped.map((g) => (
                    <Stack key={g.category} styles={{ root: { gap: 6 } }}>
                        <h3
                            style={{
                                fontSize: 15,
                                fontWeight: 600,
                                margin: "10px 0 0",
                                color: "#0078d4",
                            }}
                        >
                            {g.category}
                            <span style={{ color: "#a19f9d", fontWeight: 400, marginLeft: 6 }}>
                                ({g.items.length})
                            </span>
                        </h3>
                        {g.items.map((c) => (
                            <div
                                key={c.id}
                                style={{
                                    border: "1px solid #edebe9",
                                    borderRadius: 4,
                                    padding: "8px 10px",
                                    display: "flex",
                                    gap: 10,
                                    alignItems: "flex-start",
                                    background: "#fff",
                                }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <pre
                                        style={{
                                            margin: 0,
                                            fontFamily: "Consolas, Menlo, monospace",
                                            fontSize: 13,
                                            color: "#323130",
                                            whiteSpace: "pre-wrap",
                                            wordBreak: "break-all",
                                        }}
                                    >
                                        {c.command}
                                    </pre>
                                    {c.description && (
                                        <div
                                            style={{
                                                color: "#605e5c",
                                                fontSize: 12.5,
                                                marginTop: 4,
                                                lineHeight: 1.6,
                                            }}
                                        >
                                            {c.description}
                                        </div>
                                    )}
                                </div>
                                <Stack horizontal tokens={{ childrenGap: 2 }}>
                                    {!c.builtin && c.mine === false && (
                                        <span
                                            title={
                                                zh
                                                    ? "由其他访客创建，不可修改"
                                                    : "Created by another visitor"
                                            }
                                            style={{
                                                color: "#a19f9d",
                                                fontSize: 11,
                                                alignSelf: "center",
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {zh ? "他人共享" : "shared"}
                                        </span>
                                    )}
                                    <IconButton
                                        iconProps={{
                                            iconName:
                                                adbCommands.copiedId === c.id
                                                    ? "CheckMark"
                                                    : "Copy",
                                        }}
                                        title={zh ? "复制命令" : "Copy"}
                                        onClick={() => void adbCommands.copy(c)}
                                    />
                                    <IconButton
                                        iconProps={{ iconName: "Play" }}
                                        title={zh ? "在设备上执行" : "Run on device"}
                                        disabled={!connection.isConnected || adbCommands.running}
                                        onClick={() => void adbCommands.run(c)}
                                    />
                                    {!c.builtin && c.mine !== false && (
                                        <>
                                            <IconButton
                                                iconProps={{ iconName: "Edit" }}
                                                title={zh ? "修改" : "Edit"}
                                                onClick={() => openEdit(c)}
                                            />
                                            <IconButton
                                                iconProps={{ iconName: "Delete" }}
                                                title={zh ? "删除" : "Delete"}
                                                onClick={() => void remove(c)}
                                            />
                                        </>
                                    )}
                                    {c.builtin && (
                                        <Icon
                                            iconName="Lock"
                                            title={zh ? "内置命令，不可删除/修改" : "Built-in"}
                                            styles={{
                                                root: {
                                                    fontSize: 12,
                                                    color: "#a19f9d",
                                                    alignSelf: "center",
                                                    padding: "0 4px",
                                                },
                                            }}
                                        />
                                    )}
                                </Stack>
                            </div>
                        ))}
                    </Stack>
                ))
            )}

            {adbCommands.visible.length === 0 && (
                <div style={{ color: "#a19f9d", padding: 16 }}>
                    {zh ? "没有匹配的命令。" : "No matching commands."}
                </div>
            )}

            {/* 新增 / 修改对话框 */}
            <Dialog
                hidden={!showForm}
                onDismiss={() => setShowForm(false)}
                dialogContentProps={{
                    type: DialogType.normal,
                    title: editing
                        ? zh
                            ? "修改自定义命令"
                            : "Edit custom command"
                        : zh
                          ? "新增自定义命令"
                          : "Add custom command",
                }}
                modalProps={{ isBlocking: false }}
            >
                <Stack tokens={{ childrenGap: 10 }}>
                    <TextField
                        label={zh ? "分类" : "Category"}
                        value={formCategory}
                        onChange={(_, v) => setFormCategory(v ?? "")}
                        placeholder={zh ? "例如：我的常用" : "e.g. My favorites"}
                    />
                    <TextField
                        label={zh ? "命令" : "Command"}
                        value={formCommand}
                        onChange={(_, v) => setFormCommand(v ?? "")}
                        multiline
                        rows={2}
                        styles={{
                            field: {
                                fontFamily: "Consolas, Menlo, monospace",
                                fontSize: 13,
                            },
                        }}
                        placeholder="adb shell dumpsys battery"
                    />
                    <TextField
                        label={zh ? "说明（可选）" : "Description (optional)"}
                        value={formDesc}
                        onChange={(_, v) => setFormDesc(v ?? "")}
                        multiline
                        rows={2}
                    />
                </Stack>
                <DialogFooter>
                    <PrimaryButton
                        text={zh ? "保存" : "Save"}
                        onClick={() => void save()}
                        disabled={saving || !formCommand.trim()}
                    />
                    <DefaultButton
                        text={zh ? "取消" : "Cancel"}
                        onClick={() => setShowForm(false)}
                    />
                </DialogFooter>
            </Dialog>
        </Stack>
    );
});

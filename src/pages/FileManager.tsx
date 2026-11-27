import {
    Breadcrumb,
    CommandBar,
    DefaultButton,
    type ICommandBarItemProps,
    DetailsList,
    DetailsListLayoutMode,
    type IColumn,
    Icon,
    MessageBar,
    MessageBarType,
    Selection,
    SelectionMode,
    Spinner,
    SpinnerSize,
    Stack,
    StackItem,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef, useState } from "react";
import { i18n } from "../state/i18n";
import { connection } from "../state/connection";
import {
    formatSize,
    fs,
    isDirectory,
    permissionString,
    type FsEntry,
} from "../state/fs";
import { saveBlob } from "../state/file-stream";
import { extensionOf, iconNameForExtension } from "../state/file-icons";
import { privilege } from "../state/privilege";

/** 拼接远程路径 */
function resolvePath(base: string, name: string): string {
    if (name.startsWith("/")) return name;
    return base === "/" ? `/${name}` : `${base}/${name}`;
}

export const FileManagerPage = observer(function FileManagerPage() {
    const t = i18n.t;
    const selectedRef = useRef<FsEntry[]>([]);
    const [selected, setSelected] = useState<FsEntry[]>([]);
    const [uploadPct, setUploadPct] = useState<number | undefined>();
    const [opError, setOpError] = useState<string | undefined>();
    const selectionRef = useRef<Selection>(new Selection());

    useEffect(() => {
        const selection = new Selection({
            selectionMode: SelectionMode.multiple,
            onSelectionChanged: () => {
                const items = selection.getSelection() as FsEntry[];
                selectedRef.current = items;
                setSelected(items);
            },
        });
        selectionRef.current = selection;
    }, []);

    // 连接状态变化时自动加载目录（首次挂载时若已连接也会加载）
    // 提权级别变化时也重载：root 与 su 通道的可见目录不同
    useEffect(() => {
        if (connection.isConnected) {
            fs.loadFiles();
        }
    }, [connection.isConnected, privilege.level]);

    const columns: IColumn[] = useMemo(
        () => [
            {
                key: "type",
                name: t.colFileType,
                minWidth: 28,
                maxWidth: 28,
                isIconOnly: true,
                onRender: (item: FsEntry) => {
                    // 目录用文件夹图标，文件按扩展名映射（纯离线字体图标）
                    const name = isDirectory(item.type)
                        ? "FolderFill"
                        : iconNameForExtension(extensionOf(item.name));
                    return (
                        <Icon
                            iconName={name}
                            styles={{
                                root: {
                                    fontSize: 18,
                                    color: isDirectory(item.type)
                                        ? "#0078d4"
                                        : "#605e5c",
                                },
                            }}
                        />
                    );
                },
            },
            {
                key: "name",
                name: t.colName,
                minWidth: 120,
                isRowHeader: true,
                onRender: (item: FsEntry) => (
                    <span style={{ cursor: "pointer", color: "#323130" }}>
                        {item.name}
                    </span>
                ),
            },
            {
                key: "permission",
                name: t.colPermission,
                minWidth: 80,
                onRender: (item: FsEntry) => permissionString(item.mode),
            },
            {
                key: "size",
                name: t.colSize,
                minWidth: 80,
                onRender: (item: FsEntry) =>
                    isDirectory(item.type) ? "" : formatSize(Number(item.size)),
            },
            {
                key: "mtime",
                name: t.colMtime,
                minWidth: 150,
                onRender: (item: FsEntry) =>
                    item.mtime
                        ? new Date(Number(item.mtime) * 1000).toLocaleString()
                        : "",
            },
        ],
        [t],
    );

    const commandItems: ICommandBarItemProps[] =
        selected.length === 0
            ? [
                  {
                      key: "upload",
                      text: t.upload,
                      iconProps: { iconName: "Upload" },
                      disabled: !connection.isConnected,
                      onClick: () => {
                          handleUpload();
                      },
                  },
                  {
                      key: "uploadFolder",
                      text: t.uploadFolder,
                      iconProps: { iconName: "FolderOpen" },
                      disabled: !connection.isConnected,
                      onClick: () => {
                          handleUploadFolder();
                      },
                  },
                  {
                      key: "newFolder",
                      text: t.newFolder,
                      iconProps: { iconName: "NewFolder" },
                      disabled: !connection.isConnected,
                      onClick: () => {
                          handleNewFolder();
                      },
                  },
                  {
                      key: "refresh",
                      text: t.refresh,
                      iconProps: { iconName: "Refresh" },
                      disabled: !connection.isConnected,
                      onClick: () => {
                          void fs.loadFiles();
                      },
                  },
              ]
            : [
                  {
                      key: "download",
                      text: t.download,
                      iconProps: { iconName: "Download" },
                      onClick: () => {
                          void handleDownload();
                      },
                  },
                  {
                      key: "delete",
                      text: t.delete,
                      iconProps: { iconName: "Delete" },
                      onClick: () => {
                          void handleDelete();
                      },
                  },
              ];

    const handleUpload = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.onchange = async () => {
            const files = Array.from(input.files ?? []);
            setOpError(undefined);
            for (const file of files) {
                setUploadPct(0);
                try {
                    await fs.uploadFile(file, (uploaded) => {
                        setUploadPct(Math.round((uploaded / file.size) * 100));
                    });
                } catch (e) {
                    setOpError(
                        `${file.name}: ${e instanceof Error ? e.message : String(e)}`,
                    );
                }
            }
            setUploadPct(undefined);
            fs.loadFiles();
        };
        input.click();
    };

    /** 上传整个文件夹（保留目录结构） */
    const handleUploadFolder = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.webkitdirectory = true;
        input.onchange = async () => {
            const list = Array.from(input.files ?? []);
            if (!list.length) return;
            setOpError(undefined);
            setUploadPct(0);
            // webkitRelativePath 形如 "myFolder/sub/a.txt"，去掉最外层包裹目录
            const entries = list.map((file) => {
                const rel = file.webkitRelativePath || file.name;
                const parts = rel.split("/");
                return {
                    file,
                    relativePath: parts.length > 1 ? parts.slice(1).join("/") : file.name,
                };
            });
            // 顶层文件夹名
            const rootName = (list[0]!.webkitRelativePath || "").split("/")[0];
            try {
                if (rootName) await fs.ensureDir(connection.adb!, resolvePath(fs.path, rootName));
                await fs.uploadDirectory(
                    entries.map((e) => ({
                        file: e.file,
                        relativePath: rootName
                            ? `${rootName}/${e.relativePath}`
                            : e.relativePath,
                    })),
                    (uploaded, total) => {
                        setUploadPct(
                            total ? Math.round((uploaded / total) * 100) : 0,
                        );
                    },
                );
            } catch (e) {
                setOpError(e instanceof Error ? e.message : String(e));
            }
            setUploadPct(undefined);
            fs.loadFiles();
        };
        input.click();
    };

    /** 新建文件夹 */
    const handleNewFolder = async () => {
        const name = window.prompt(t.newFolderPrompt);
        if (!name) return;
        const adb = connection.adb;
        if (!adb) return;
        setOpError(undefined);
        try {
            await fs.ensureDir(adb, resolvePath(fs.path, name));
        } catch (e) {
            setOpError(e instanceof Error ? e.message : String(e));
        }
        fs.loadFiles();
    };

    const handleDownload = async () => {
        setOpError(undefined);
        for (const entry of selected) {
            try {
                // 文件直接下载；文件夹自动打包为 zip
                const { blob, name } = await fs.downloadEntry(entry);
                saveBlob(blob, name);
            } catch (e) {
                setOpError(
                    `${entry.name}: ${e instanceof Error ? e.message : String(e)}`,
                );
            }
        }
    };

    const handleDelete = async () => {
        if (
            !window.confirm(
                t.confirmDelete.replace("{count}", String(selected.length)),
            )
        ) {
            return;
        }
        setOpError(undefined);
        try {
            await fs.deleteEntries(selected);
        } catch (e) {
            setOpError(e instanceof Error ? e.message : String(e));
        }
        selectionRef.current.setAllSelected(false);
    };

    const breadcrumbItems = fs.breadcrumbs.map((b, index) => ({
        key: b.path,
        text: index === 0 ? t.breadcrumbRoot : b.text,
        onClick:
            index === fs.breadcrumbs.length - 1
                ? undefined
                : () => fs.changeDirectory(b.path),
    }));

    return (
        <Stack
            styles={{
                root: {
                    padding: 16,
                    height: "100%",
                    gap: 8,
                    overflow: "auto",
                    position: "relative",
                },
            }}
        >
            {!connection.isConnected ? (
                <Stack tokens={{ childrenGap: 8 }}>
                    <MessageBar messageBarType={MessageBarType.warning}>
                        {t.waiting}
                    </MessageBar>
                    {connection.error && (
                        <MessageBar messageBarType={MessageBarType.error} isMultiline>
                            {connection.error}
                        </MessageBar>
                    )}
                    <DefaultButton
                        iconProps={{ iconName: "Refresh" }}
                        text={t.reconnect}
                        onClick={() => {
                            connection.connect().catch(() => {
                                /* 错误已在 store 中显示 */
                            });
                        }}
                    />
                </Stack>
            ) : (
                <>
                    <CommandBar items={commandItems} />

                    {uploadPct !== undefined && (
                        <MessageBar>
                            {t.uploadingProgress}: {uploadPct}%
                        </MessageBar>
                    )}

                    {opError && (
                        <MessageBar messageBarType={MessageBarType.error} isMultiline>
                            {t.operationFailed}：{opError}
                        </MessageBar>
                    )}

                    <Breadcrumb items={breadcrumbItems} />

                    {fs.permissionDenied && (
                        <MessageBar messageBarType={MessageBarType.warning}>
                            {t.requiresRoot}
                        </MessageBar>
                    )}

                    {fs.error && !fs.permissionDenied && (
                        <MessageBar messageBarType={MessageBarType.error} isMultiline>
                            {t.loadFailed}：{fs.error}
                        </MessageBar>
                    )}

                    <StackItem grow styles={{ root: { minHeight: 0 } }}>
                        {fs.loading ? (
                            <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
                                <Spinner size={SpinnerSize.medium} />
                                <span style={{ color: "#605e5c" }}>{t.loading}</span>
                            </Stack>
                        ) : fs.items.length === 0 ? (
                            <div style={{ color: "#a19f9d", padding: 16 }}>
                                {fs.error ? t.loadFailed : t.emptyFolder}
                            </div>
                        ) : (
                            <DetailsList
                                items={fs.items}
                                columns={columns}
                                selection={selectionRef.current}
                                selectionMode={SelectionMode.multiple}
                                layoutMode={DetailsListLayoutMode.justified}
                                setKey={fs.path}
                                onItemInvoked={(item: FsEntry) => {
                                    if (isDirectory(item.type)) {
                                        fs.changeDirectory(item.key);
                                    }
                                }}
                            />
                        )}
                    </StackItem>
                </>
            )}
        </Stack>
    );
});

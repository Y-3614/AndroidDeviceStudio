import { DefaultButton, MessageBar, Stack, Toggle } from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";
import { privilege } from "../state/privilege";

import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { IDisposable } from "@xterm/xterm";

export const TerminalPage = observer(function TerminalPage() {
    const t = i18n.t;
    /**
     * 用 state 保存容器节点：容器 div 只在「已连接」时才渲染，
     * 不能再用「挂载时初始化 xterm」的写法（容器还没出现，term.open 拿不到节点）。
     */
    const [container, setContainer] = useState<HTMLDivElement | null>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const [rootShell, setRootShell] = useState(false);

    /**
     * 终端尺寸同步函数（由会话 effect 注册）。
     *
     * 关键：设备端 PTY 必须知道自己有多少行多少列，否则 `ls` 之类的命令
     * 会按错误的宽度排版，显示成一团乱 —— 这正是之前终端错乱的根因。
     * 这里把 xterm 的 cols/rows 实时推给设备端 PTY。
     */
    const syncSizeRef = useRef<((rows: number, cols: number) => void) | null>(
        null,
    );

    // ① 容器就绪 → 创建并挂载 xterm
    useEffect(() => {
        if (!container) return;
        const term = new Terminal({
            fontSize: 13,
            fontFamily:
                "Consolas, 'Cascadia Mono', Menlo, Monaco, 'Courier New', monospace",
            theme: {
                background: "#1e1e1e",
                foreground: "#d4d4d4",
                cursor: "#d4d4d4",
            },
            cursorBlink: true,
            scrollback: 10000,
            convertEol: false,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(container);
        try {
            fit.fit();
        } catch {
            /* 容器尺寸未就绪时忽略 */
        }
        termRef.current = term;
        fitRef.current = fit;

        // 尺寸变化 → 通知设备端 PTY（resize / stty）
        const sizeSub: IDisposable = term.onResize(({ rows, cols }) => {
            syncSizeRef.current?.(rows, cols);
        });

        const doFit = () => {
            try {
                fit.fit();
            } catch {
                /* ignore */
            }
        };
        window.addEventListener("resize", doFit);
        const ro =
            typeof ResizeObserver !== "undefined"
                ? new ResizeObserver(doFit)
                : undefined;
        ro?.observe(container);

        return () => {
            window.removeEventListener("resize", doFit);
            ro?.disconnect();
            sizeSub.dispose();
            term.dispose();
            termRef.current = null;
            fitRef.current = null;
        };
    }, [container]);

    // ② 建立 shell 会话
    useEffect(() => {
        const adb = connection.adb;
        const term = termRef.current;
        if (!connection.isConnected || !adb || !term) return;

        /*
         * 每个 effect 实例使用自己的闭包变量，彻底避免竞态：
         * 旧实现把 controller 存在 ref 里，新会话会覆盖它，
         * 导致旧会话的 pipeTo 绑到了新 signal 上而无法中止。
         */
        let disposed = false;
        const abort = new AbortController();
        let dataSub: IDisposable | null = null;
        let session: { kill(): unknown } | null = null;
        let writer: {
            write(chunk: Uint8Array): Promise<void>;
            releaseLock?(): void;
        } | null = null;

        const useSu = rootShell && privilege.level !== "adbRoot";
        const command = useSu ? "su" : "sh";
        const banner =
            privilege.level === "adbRoot"
                ? "root (adb root)"
                : useSu
                  ? "root (su)"
                  : "shell";
        term.writeln(`\x1b[36m>>> ${banner}\x1b[0m`);

        void (async () => {
            try {
                let output: ReadableStream<Uint8Array>;
                let syncSize: (rows: number, cols: number) => void;
                const svc = adb.subprocess.shellProtocol;

                if (svc?.isSupported) {
                    // 首选 ShellV2：真正支持 PTY 与窗口尺寸协商
                    const pty = await svc.pty({ command });
                    if (disposed) {
                        try {
                            pty.kill();
                        } catch {
                            /* ignore */
                        }
                        return;
                    }
                    session = pty;
                    output = pty.output as unknown as ReadableStream<Uint8Array>;
                    writer = pty.input as unknown as typeof writer;
                    syncSize = (rows, cols) => {
                        void pty.resize(rows, cols).catch(() => {
                            /* 会话已结束 */
                        });
                    };
                } else {
                    // 降级：老设备无 ShellV2。用 stty 显式设定尺寸，
                    // 之后每次 resize 通过 stdin 再发一次 stty。
                    const pty = await adb.subprocess.noneProtocol.pty(
                        `stty rows ${term.rows} cols ${term.cols} 2>/dev/null; exec ${command}`,
                    );
                    if (disposed) {
                        try {
                            pty.kill();
                        } catch {
                            /* ignore */
                        }
                        return;
                    }
                    session = pty;
                    output = pty.output as unknown as ReadableStream<Uint8Array>;
                    writer = pty.input as unknown as typeof writer;
                    syncSize = (rows, cols) => {
                        void writer
                            ?.write(
                                new TextEncoder().encode(
                                    `stty rows ${rows} cols ${cols} 2>/dev/null\n`,
                                ),
                            )
                            .catch(() => {
                                /* closed */
                            });
                    };
                }

                // 流式解码：保证多字节字符（中文）跨分片也不乱码
                const decoder = new TextDecoder();
                output
                    .pipeTo(
                        new WritableStream<Uint8Array>({
                            write(chunk) {
                                term.write(decoder.decode(chunk, { stream: true }));
                            },
                        }),
                        { signal: abort.signal },
                    )
                    .catch(() => {
                        /* aborted */
                    });

                // 输入 → 设备：只在本会话注册一次
                dataSub = term.onData((data) => {
                    writer
                        ?.write(new TextEncoder().encode(data))
                        .catch(() => {
                            /* closed */
                        });
                });

                // 立即把当前终端尺寸同步给设备端（关键修复）
                syncSizeRef.current = syncSize;
                try {
                    fitRef.current?.fit();
                } catch {
                    /* ignore */
                }
                syncSize(term.rows, term.cols);
            } catch (e) {
                if (!disposed) {
                    term.writeln(
                        `\x1b[31m${
                            e instanceof Error ? e.message : String(e)
                        }\x1b[0m`,
                    );
                }
            }
        })();

        return () => {
            disposed = true;
            dataSub?.dispose();
            abort.abort();
            syncSizeRef.current = null;
            try {
                writer?.releaseLock?.();
            } catch {
                /* ignore */
            }
            try {
                session?.kill();
            } catch {
                /* ignore */
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connection.isConnected, rootShell, privilege.level, container]);

    return (
        <Stack styles={{ root: { padding: 16, height: "100%", gap: 8 } }}>
            {!connection.isConnected ? (
                <MessageBar>{t.waiting}</MessageBar>
            ) : (
                <>
                    <Stack
                        horizontal
                        verticalAlign="center"
                        tokens={{ childrenGap: 12 }}
                        wrap
                    >
                        <Toggle
                            label={t.terminalRootShell}
                            inlineLabel
                            checked={rootShell}
                            onChange={(_, c) => setRootShell(!!c)}
                        />
                        <span style={{ fontSize: 12, color: "#605e5c" }}>
                            {privilege.level === "adbRoot"
                                ? t.terminalAlreadyRoot
                                : t.terminalRootHint}
                        </span>
                        <DefaultButton
                            text={t.clearScreen}
                            onClick={() => termRef.current?.clear()}
                        />
                        <DefaultButton
                            text={t.copyOutput}
                            onClick={() => {
                                const buf = termRef.current?.buffer.active;
                                if (!buf) return;
                                const lines: string[] = [];
                                for (let i = 0; i < buf.length; i++) {
                                    lines.push(
                                        buf.getLine(i)?.translateToString() ??
                                            "",
                                    );
                                }
                                navigator.clipboard.writeText(lines.join("\n"));
                            }}
                        />
                    </Stack>

                    <div
                        ref={setContainer}
                        style={{
                            flexGrow: 1,
                            minHeight: 0,
                            background: "#1e1e1e",
                            borderRadius: 4,
                            padding: 4,
                            overflow: "hidden",
                        }}
                    />
                </>
            )}
        </Stack>
    );
});

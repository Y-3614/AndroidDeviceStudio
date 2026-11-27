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
     * 用 state 保存容器节点。
     *
     * 关键：容器 div 只在「已连接」时才渲染，所以不能再用
     * 「挂载时初始化 xterm」那种写法（容器还没出现，term.open 拿不到节点）。
     * 改为容器就绪后再创建终端。
     */
    const [container, setContainer] = useState<HTMLDivElement | null>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const [rootShell, setRootShell] = useState(false);

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

        const onResize = () => {
            try {
                fit.fit();
            } catch {
                /* ignore */
            }
        };
        window.addEventListener("resize", onResize);
        // 容器自身尺寸变化（侧栏折叠等）也自适应
        const ro =
            typeof ResizeObserver !== "undefined"
                ? new ResizeObserver(onResize)
                : undefined;
        ro?.observe(container);

        return () => {
            window.removeEventListener("resize", onResize);
            ro?.disconnect();
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
         * 导致旧会话的 pipeTo 绑到了新 signal 上而无法中止 ——
         * 结果两个 shell 同时往同一个终端写，显示错乱。
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
                const s = await adb.subprocess.noneProtocol.pty(command);
                // 若期间已切换/卸载，丢弃这个会话
                if (disposed) {
                    try {
                        s.kill();
                    } catch {
                        /* ignore */
                    }
                    return;
                }
                session = s;

                // 流式解码：保证多字节字符（中文）跨分片也不乱码
                const decoder = new TextDecoder();
                (s.output as unknown as ReadableStream<Uint8Array>)
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

                writer = s.input.getWriter() as unknown as {
                    write(chunk: Uint8Array): Promise<void>;
                    releaseLock?(): void;
                };

                // 输入 → 设备：只在本会话注册一次
                dataSub = term.onData((data) => {
                    writer
                        ?.write(new TextEncoder().encode(data))
                        .catch(() => {
                            /* closed */
                        });
                });
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

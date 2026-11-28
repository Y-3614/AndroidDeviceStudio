import { makeAutoObservable, runInAction } from "mobx";
import {
    BUILTIN_COMMANDS,
    COMMAND_CATEGORIES,
    type AdbCommand,
    type CommandCategory,
} from "./adb-commands";
import {
    COMMANDS_TABLE,
    getClientId,
    getCloud,
    unwrap,
    type CloudCommandRow,
} from "./cloud";
import { connection } from "./connection";
import { shell } from "./privilege";

/**
 * ADB 命令大全 store。
 *
 * 两部分：
 *  1. **内置 100 条**（BUILTIN_COMMANDS）：真实可用，**不可删除、不可修改**。
 *  2. **用户自定义**：在内置基础上新增，可修改、可删除。
 *
 * 存储策略：
 *  - **首选云端**（`adb_commands` 表）：这样「打开网页的人都能看到」彼此新增的命令；
 *  - 云端不可用（断网 / 未授权）时**自动降级为本地 localStorage**，并在界面上明确标注，
 *    不让用户误以为已经共享成功。
 */

const LS_KEY = "ads.adbCommands.custom.v1";

export interface CommandResult {
    command: string;
    output: string;
    ok: boolean;
    time: string;
}

/** 云端同步状态 */
export type CloudState = "idle" | "loading" | "ready" | "error" | "local";

class AdbCommandStore {
    /** 用户自定义命令（云端或本地） */
    custom: AdbCommand[] = [];
    /** 搜索关键字 */
    query = "";
    /** 当前选中分类（空 = 全部） */
    category = "";
    /** 每条的复制反馈 */
    copiedId = "";
    /** 执行结果 */
    results: CommandResult[] = [];
    running = false;

    /** 云端同步状态 */
    cloudState: CloudState = "idle";
    cloudError: string | undefined = undefined;
    /** 最近一次同步时间 */
    lastSync = "";

    constructor() {
        makeAutoObservable(this, {}, { autoBind: true });
        // 先加载本地缓存，保证离线也能用
        this.loadLocal();
    }

    /* ---------------- 本地兜底 ---------------- */

    private loadLocal() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return;
            const list = JSON.parse(raw) as AdbCommand[];
            if (Array.isArray(list)) {
                this.custom = list
                    .filter((c) => c && c.id && c.command)
                    .map((c) => ({
                        id: String(c.id),
                        category: String(c.category || "自定义"),
                        command: String(c.command),
                        description: String(c.description || ""),
                        builtin: false,
                        mine: true,
                    }));
            }
        } catch {
            /* 数据损坏则忽略 */
        }
    }

    private persistLocal() {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(this.custom));
        } catch {
            /* 配额满等情况忽略 */
        }
    }

    /* ---------------- 云端同步 ---------------- */

    /**
     * 从云端拉取全部自定义命令。
     * 失败时保持本地数据可用，并把状态标为 local/error，界面据此提示。
     */
    async syncFromCloud() {
        runInAction(() => {
            this.cloudState = "loading";
            this.cloudError = undefined;
        });
        try {
            const cloud = getCloud();
            const rows = unwrap(
                (await cloud.database
                    .from(COMMANDS_TABLE)
                    .select("*")
                    .order("created_at", {
                        ascending: false,
                    })) as {
                    data: CloudCommandRow[] | null;
                    error: unknown;
                },
            );
            const list = (rows ?? []).map((r) => this.rowToCommand(r));
            runInAction(() => {
                this.custom = list;
                this.cloudState = "ready";
                this.lastSync = new Date().toLocaleTimeString();
                this.cloudError = undefined;
            });
            this.persistLocal();
        } catch (e) {
            runInAction(() => {
                // 云端不可用 → 降级本地，但如实标注
                this.cloudState = "local";
                this.cloudError = e instanceof Error ? e.message : String(e);
            });
        }
    }

    private rowToCommand(r: CloudCommandRow): AdbCommand {
        return {
            id: `c_${r.id}`,
            category: String(r.category || "自定义"),
            command: String(r.command),
            description: String(r.description ?? ""),
            builtin: false,
            cloudId: r.id,
            // 只有自己这个浏览器创建的才允许改/删
            mine: !!r.client_id && r.client_id === getClientId(),
        };
    }

    /* ---------------- 派生数据 ---------------- */

    /** 全部命令（内置 + 自定义） */
    get all(): AdbCommand[] {
        return [...BUILTIN_COMMANDS, ...this.custom];
    }

    get builtinCount(): number {
        return BUILTIN_COMMANDS.length;
    }

    get customCount(): number {
        return this.custom.length;
    }

    /** 分类列表 */
    get categories(): string[] {
        const set = new Set<string>(COMMAND_CATEGORIES);
        for (const c of this.custom) set.add(c.category || "自定义");
        return [...set];
    }

    /** 当前展示的命令（按分类与关键字过滤） */
    get visible(): AdbCommand[] {
        const q = this.query.trim().toLowerCase();
        return this.all.filter((c) => {
            if (this.category && c.category !== this.category) return false;
            if (!q) return true;
            return (
                c.command.toLowerCase().includes(q) ||
                c.description.toLowerCase().includes(q) ||
                c.category.toLowerCase().includes(q)
            );
        });
    }

    /** 按分类分组（供分组渲染） */
    get grouped(): { category: string; items: AdbCommand[] }[] {
        const map = new Map<string, AdbCommand[]>();
        for (const c of this.visible) {
            const key = c.category || "自定义";
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(c);
        }
        return [...map.entries()].map(([category, items]) => ({
            category,
            items,
        }));
    }

    setQuery(v: string) {
        this.query = v;
    }

    setCategory(v: string) {
        this.category = v;
    }

    /* ---------------- 增 / 改 / 删 ---------------- */

    /** 新增：写云端（优先）；失败时写本地并标记 */
    async addCustom(input: {
        category: string;
        command: string;
        description: string;
    }): Promise<{ ok: boolean; cloud: boolean; error?: string }> {
        const command = input.command.trim();
        if (!command) return { ok: false, cloud: false, error: "命令不能为空" };
        const payload = {
            category: input.category.trim() || "自定义",
            command,
            description: input.description.trim(),
            client_id: getClientId(),
        };

        // 先乐观更新本地，界面立刻有反馈
        const localItem: AdbCommand = {
            id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            category: payload.category,
            command: payload.command,
            description: payload.description,
            builtin: false,
            mine: true,
        };
        runInAction(() => {
            this.custom = [localItem, ...this.custom];
        });

        try {
            const cloud = getCloud();
            const rows = unwrap(
                (await cloud.database
                    .from(COMMANDS_TABLE)
                    .insert(payload)
                    .select()) as {
                    data: CloudCommandRow[] | null;
                    error: unknown;
                },
            );
            const created = rows?.[0];
            runInAction(() => {
                // 用云端返回的真实行替换本地临时项
                if (created) {
                    this.custom = this.custom.map((c) =>
                        c.id === localItem.id ? this.rowToCommand(created) : c,
                    );
                }
                this.cloudState = "ready";
                this.cloudError = undefined;
            });
            this.persistLocal();
            return { ok: true, cloud: true };
        } catch (e) {
            runInAction(() => {
                this.cloudState = "local";
                this.cloudError = e instanceof Error ? e.message : String(e);
            });
            this.persistLocal();
            return { ok: true, cloud: false, error: this.cloudError };
        }
    }

    /** 修改（仅自己创建的命令） */
    async updateCustom(
        id: string,
        input: { category: string; command: string; description: string },
    ): Promise<boolean> {
        const target = this.custom.find((c) => c.id === id);
        if (!target || target.builtin) return false;
        if (target.mine === false) return false;
        const command = input.command.trim();
        if (!command) return false;

        const next = {
            category: input.category.trim() || "自定义",
            command,
            description: input.description.trim(),
        };

        runInAction(() => {
            this.custom = this.custom.map((c) =>
                c.id === id ? { ...c, ...next } : c,
            );
        });
        this.persistLocal();

        // 云端行才需要回写
        if (target.cloudId !== undefined) {
            try {
                const cloud = getCloud();
                const rows = unwrap(
                    (await cloud.database
                        .from(COMMANDS_TABLE)
                        .update({
                            ...next,
                            updated_at: new Date().toISOString(),
                        })
                        .eq("id", target.cloudId)
                        .select()) as {
                        data: CloudCommandRow[] | null;
                        error: unknown;
                    },
                );
                if (!rows || rows.length === 0) {
                    // RLS 过滤掉了 —— 说明不是当前客户端的行
                    runInAction(() => {
                        this.cloudError =
                            "云端未更新（该命令不属于当前浏览器）";
                    });
                }
            } catch (e) {
                runInAction(() => {
                    this.cloudState = "local";
                    this.cloudError = e instanceof Error ? e.message : String(e);
                });
            }
        }
        return true;
    }

    /** 删除（仅自己创建的命令） */
    async removeCustom(id: string): Promise<boolean> {
        const target = this.custom.find((c) => c.id === id);
        if (!target || target.builtin) return false;
        if (target.mine === false) return false;

        runInAction(() => {
            this.custom = this.custom.filter((c) => c.id !== id);
        });
        this.persistLocal();

        if (target.cloudId !== undefined) {
            try {
                const cloud = getCloud();
                await cloud.database
                    .from(COMMANDS_TABLE)
                    .delete()
                    .eq("id", target.cloudId);
            } catch (e) {
                runInAction(() => {
                    this.cloudState = "local";
                    this.cloudError = e instanceof Error ? e.message : String(e);
                });
            }
        }
        return true;
    }

    /* ---------------- 导入 / 导出 ---------------- */

    exportJson(): string {
        return JSON.stringify(
            this.custom.map((c) => ({
                category: c.category,
                command: c.command,
                description: c.description,
            })),
            null,
            2,
        );
    }

    async importJson(text: string): Promise<{ added: number; error?: string }> {
        try {
            const list = JSON.parse(text) as AdbCommand[];
            if (!Array.isArray(list)) {
                return { added: 0, error: "格式不正确：需要 JSON 数组" };
            }
            const valid = list.filter((c) => c && c.command);
            let added = 0;
            for (const c of valid) {
                const r = await this.addCustom({
                    category: String(c.category || "导入"),
                    command: String(c.command),
                    description: String(c.description || ""),
                });
                if (r.ok) added++;
            }
            return { added };
        } catch (e) {
            return { added: 0, error: (e as Error).message };
        }
    }

    /* ---------------- 执行 ---------------- */

    async copy(cmd: AdbCommand) {
        try {
            await navigator.clipboard.writeText(cmd.command);
        } catch {
            const ta = document.createElement("textarea");
            ta.value = cmd.command;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
        }
        runInAction(() => {
            this.copiedId = cmd.id;
        });
        setTimeout(() => {
            runInAction(() => {
                if (this.copiedId === cmd.id) this.copiedId = "";
            });
        }, 1500);
    }

    /** 在设备上执行命令（自动去掉 adb / adb shell 前缀） */
    async run(cmd: AdbCommand) {
        const adb = connection.adb;
        if (!adb || this.running) return;
        let command = cmd.command.trim();
        if (command.startsWith("adb shell ")) command = command.slice(10);
        else if (command.startsWith("adb ")) command = command.slice(4);

        runInAction(() => {
            this.running = true;
        });
        const time = new Date().toLocaleTimeString();
        try {
            const out = await shell(adb, command);
            runInAction(() => {
                this.results = [
                    { command, output: out.trim() || "(无输出)", ok: true, time },
                    ...this.results.slice(0, 19),
                ];
            });
        } catch (e) {
            runInAction(() => {
                this.results = [
                    { command, output: (e as Error).message, ok: false, time },
                    ...this.results.slice(0, 19),
                ];
            });
        } finally {
            runInAction(() => {
                this.running = false;
            });
        }
    }

    clearResults() {
        this.results = [];
    }
}

export const adbCommands = new AdbCommandStore();
export type { AdbCommand, CommandCategory };

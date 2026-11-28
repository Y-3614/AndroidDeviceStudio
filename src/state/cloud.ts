/**
 * 云服务接入层（WorkBuddy Cloud Service）。
 *
 * ⚠️ 下面的 endpoint / publishableKey / oauthRelayBaseUrl 均来自
 * `workbuddy_cloud_service` 返回的 `publicConfig`，是**可安全内联到前端**的公开配置
 * （publishableKey 仅用于标识「是哪个应用」，本身不含任何权限，服务端还会校验 Origin）。
 *
 * 用途：把用户新增的自定义 ADB 命令存到云端，实现「打开网页的人都能看到」。
 */
import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";

/**
 * 数据库 Schema 类型（供 SDK 泛型使用）。
 * 只需覆盖本应用实际用到的表；结构遵循 supabase 的 `Database` 约定。
 */
export interface Database {
    public: {
        Tables: {
            adb_commands: {
                Row: {
                    id: number;
                    owner_id: string | null;
                    owner_name: string | null;
                    client_id: string | null;
                    category: string;
                    command: string;
                    description: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: number;
                    owner_id?: string | null;
                    owner_name?: string | null;
                    client_id?: string | null;
                    category?: string;
                    command: string;
                    description?: string | null;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    category?: string;
                    command?: string;
                    description?: string | null;
                    updated_at?: string;
                };
            };
        };
        Views: Record<string, never>;
        Functions: Record<string, never>;
    };
}

/** 公开配置（唯一来源，禁止从 location / env 推导，也不要在别处硬编码） */
export const publicConfig = {
    endpoint: "https://android-device-studio.app.workbuddy.host",
    oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
    publishableKey: "wbpk_5ugSV6HxYHgwLbpPfEFgdg_pkghmXkQQTlz7xgxOOmuICCF8XuSB95T",
} as const;

let client: ReturnType<typeof createWorkBuddyCloud<Database>> | undefined;

/** 懒初始化：只在真正需要访问云端时才创建客户端 */
export function getCloud() {
    if (!client) {
        client = createWorkBuddyCloud<Database>({
            endpoint: publicConfig.endpoint,
            oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
            publishableKey: publicConfig.publishableKey,
        });
    }
    return client;
}

/** 云端表名 */
export const COMMANDS_TABLE = "adb_commands";

/**
 * 本机身份标识。
 *
 * 该应用**无需登录**即可使用（WebUSB 直连设备），但「谁创建了这条命令」需要一个稳定的
 * 客户端标识，用于决定是否显示「编辑 / 删除」按钮。它只是显示层（UI affordance）的
 * 依据，**不是安全边界**（真正的边界由数据库 RLS 承担）。
 */
const CLIENT_ID_KEY = "ads.cloud.clientId.v1";

export function getClientId(): string {
    try {
        let id = localStorage.getItem(CLIENT_ID_KEY);
        if (!id) {
            id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            localStorage.setItem(CLIENT_ID_KEY, id);
        }
        return id;
    } catch {
        // localStorage 不可用（隐私模式）时退化为会话内临时 id
        return `t_${Math.random().toString(36).slice(2, 10)}`;
    }
}

/** 数据库返回的行结构 */
export interface CloudCommandRow {
    id: number;
    owner_id: string | null;
    owner_name: string | null;
    client_id: string | null;
    category: string;
    command: string;
    description: string | null;
    created_at: string;
    updated_at: string;
}

/** 把 { data, error } 信封变成「抛错或返回值」 */
export function unwrap<T>({ data, error }: { data: T; error: unknown }): T {
    if (error) throw error;
    return data;
}

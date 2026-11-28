import type { Adb } from "@yume-chan/adb";
import { LinuxFileType, type AdbSyncEntry, type AdbSync } from "@yume-chan/adb";
import { makeAutoObservable, runInAction } from "mobx";
import { connection } from "./connection";
import { createFileStream } from "./file-stream";
import { privilege, q, shell } from "./privilege";

export interface FsEntry {
    key: string;
    name: string;
    type: number;
    mode: number;
    size: bigint;
    mtime: bigint;
    ctime?: bigint;
    atime?: bigint;
}

export function formatSize(value: number): string {
    const units = [" B", " KB", " MB", " GB"];
    let index = 0;
    while (index < units.length - 1 && value > 1024) {
        index += 1;
        value /= 1024;
    }
    return (
        value.toLocaleString(undefined, { maximumFractionDigits: 2 }) +
        units[index]
    );
}

export function permissionString(mode: number): string {
    const bits = ["---", "--x", "-w-", "-wx", "r--", "r-x", "rw-", "rwx"];
    return (
        bits[(mode >> 6) & 7]! + bits[(mode >> 3) & 7]! + bits[mode & 7]!
    );
}

export function resolve(base: string, name: string): string {
    if (name.startsWith("/")) return name;
    return base === "/" ? `/${name}` : `${base}/${name}`;
}

/** 用 su 执行命令（仅在 su 提权模式使用） */
function su(adb: Adb, command: string): Promise<string> {
    return shell(adb, `su -c ${q(command)}`);
}

export const isDirectory = (type: number) => type === LinuxFileType.Directory;

class FsStore {
    path = "/";
    items: FsEntry[] = [];
    loading = false;
    error: string | undefined = undefined;
    permissionDenied = false;

    constructor() {
        makeAutoObservable(this, {}, { autoBind: true });
    }

    get adb(): Adb | undefined {
        return connection.adb;
    }

    /**
     * 是否必须走 su 通道。
     *
     * 注意：`adb root` 成功后 adbd 本身就是 root，原生 sync 协议天然带 root 权限，
     * **无需也不能再套 su**（套了反而会因为引号/uid 问题失败）。只有设备本身有 su
     * 且 adbd 非 root 时，才需要走 su 通道。
     */
    private get needSuChannel(): boolean {
        return privilege.effective && privilege.level === "su";
    }

    get breadcrumbs(): { text: string; path: string }[] {
        const parts = this.path.split("/").filter(Boolean);
        const result = [{ text: "Device", path: "/" }];
        let acc = "";
        for (const p of parts) {
            acc += "/" + p;
            result.push({ text: p, path: acc });
        }
        return result;
    }

    async changeDirectory(path: string) {
        if (this.path === path && this.items.length) return;
        this.path = path;
        await this.loadFiles();
    }

    async loadFiles() {
        const adb = this.adb;
        if (!adb) {
            runInAction(() => {
                this.items = [];
                this.loading = false;
                this.error = undefined;
            });
            return;
        }

        runInAction(() => {
            this.loading = true;
            this.error = undefined;
            this.permissionDenied = false;
        });

        try {
            const entries = this.needSuChannel
                ? await this.listViaShell(adb, this.path)
                : await this.listViaSync(adb, this.path);
            runInAction(() => {
                this.items = entries;
                this.loading = false;
            });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            const denied = /permission denied|not permitted|EACCES/i.test(message);
            runInAction(() => {
                this.items = [];
                this.loading = false;
                this.error = message;
                this.permissionDenied = denied;
            });
        }
    }

    private async listViaSync(adb: Adb, path: string): Promise<FsEntry[]> {
        const sync = await adb.sync();
        try {
            const list = await sync.readdir(path);
            return list
                .filter((e) => e.name !== "." && e.name !== "..")
                .map((e) => this.toEntry(e, path));
        } finally {
            sync.dispose();
        }
    }

    private async listViaShell(adb: Adb, path: string): Promise<FsEntry[]> {
        const out = await su(adb, `ls -la ${q(path)}`);
        const result: FsEntry[] = [];
        for (const line of out.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("total")) continue;
            const entry = this.parseLsLine(trimmed, path);
            if (entry) result.push(entry);
        }
        return result;
    }

    /** 解析 `ls -la` 一行 */
    private parseLsLine(line: string, base: string): FsEntry | null {
        const parts = line.split(/\s+/);
        if (parts.length < 7) return null;
        const perms = parts[0]!;
        const first = perms[0];
        let type: number;
        switch (first) {
            case "d":
                type = LinuxFileType.Directory;
                break;
            case "l":
                type = LinuxFileType.Link;
                break;
            case "-":
                type = LinuxFileType.File;
                break;
            default:
                type = LinuxFileType.File;
        }

        let name = parts.slice(7).join(" ");
        if (type === LinuxFileType.Link && name.includes(" -> ")) {
            name = name.split(" -> ")[0]!;
        }
        if (!name) name = parts[parts.length - 1]!;
        if (name === "." || name === "..") return null;

        const size = Number(parts[4]) || 0;
        const mode = this.parseMode(perms);

        return {
            key: resolve(base, name),
            name,
            type,
            mode,
            size: BigInt(size),
            mtime: 0n,
        };
    }

    private parseMode(perms: string): number {
        const t = perms.slice(1);
        const map = (s: string) =>
            (s[0] === "r" ? 4 : 0) | (s[1] === "w" ? 2 : 0) | (s[2] === "x" ? 1 : 0);
        return (
            (map(t.slice(0, 3)) << 6) |
            (map(t.slice(3, 6)) << 3) |
            map(t.slice(6, 9))
        );
    }

    private toEntry(entry: AdbSyncEntry, base: string): FsEntry {
        return {
            key: resolve(base, entry.name),
            name: entry.name,
            type: entry.type,
            mode: entry.permission ?? entry.mode & 0o777,
            size: entry.size ?? 0n,
            mtime: entry.mtime ?? 0n,
            ctime: entry.ctime,
            atime: entry.atime,
        };
    }

    async deleteEntries(entries: FsEntry[]) {
        const adb = this.adb;
        if (!adb) return;
        for (const entry of entries) {
            const full = resolve(this.path, entry.name);
            if (this.needSuChannel) {
                await su(adb, `rm -rf ${q(full)}`);
            } else {
                await adb.rm(full, { recursive: true, force: true });
            }
        }
        await this.loadFiles();
    }

    /** 下载文件为 Blob */
    async downloadFile(entry: FsEntry): Promise<Blob> {
        const adb = this.adb;
        if (!adb) throw new Error("未连接");
        if (isDirectory(entry.type)) {
            // 目录不能用 sync.read（adbd 会返回 open failed），必须走 zip 打包
            throw new Error("这是文件夹，请使用「下载文件夹（zip）」");
        }
        const full = resolve(this.path, entry.name);

        if (this.needSuChannel) {
            const b64 = await su(adb, `base64 ${q(full)}`);
            return base64ToBlob(b64.replace(/\s+/g, ""));
        }

        const sync = await adb.sync();
        try {
            const stream = sync.read(full);
            const chunks: Uint8Array[] = [];
            const reader = stream.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            return new Blob(chunks as BlobPart[]);
        } finally {
            sync.dispose();
        }
    }

    /** 下载条目：文件直接下载，目录自动打包成 zip */
    async downloadEntry(entry: FsEntry): Promise<{ blob: Blob; name: string }> {
        if (!isDirectory(entry.type)) {
            const blob = await this.downloadFile(entry);
            return { blob, name: entry.name };
        }
        const collected = await this.collectDirectory(entry);
        const zipped = await zipFiles(collected);
        return { blob: zipped, name: `${entry.name}.zip` };
    }

    /** 递归收集一个目录下所有文件（用于 zip 打包） */
    async collectDirectory(entry: FsEntry): Promise<{ name: string; blob: Blob }[]> {
        const adb = this.adb;
        if (!adb) return [];
        const files: { name: string; blob: Blob }[] = [];
        const walk = async (dirPath: string, prefix: string) => {
            const entries = await (async () => {
                if (this.needSuChannel) {
                    const out = await su(adb, `ls -la ${q(dirPath)}`);
                    const result: FsEntry[] = [];
                    for (const line of out.split("\n")) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith("total")) continue;
                        const e = this.parseLsLine(trimmed, dirPath);
                        if (e) result.push(e);
                    }
                    return result;
                }
                const sync = await adb.sync();
                try {
                    return (await sync.readdir(dirPath)).map((e) =>
                        this.toEntry(e, dirPath),
                    );
                } finally {
                    sync.dispose();
                }
            })();

            for (const e of entries) {
                if (e.name === "." || e.name === "..") continue;
                const rel = prefix ? `${prefix}/${e.name}` : e.name;
                if (isDirectory(e.type)) {
                    await walk(resolve(dirPath, e.name), rel);
                } else {
                    const blob = await this.downloadPath(adb, resolve(dirPath, e.name));
                    files.push({ name: rel, blob });
                }
            }
        };
        await walk(resolve(this.path, entry.name), entry.name);
        return files;
    }

    private async downloadPath(adb: Adb, full: string): Promise<Blob> {
        if (this.needSuChannel) {
            const b64 = await su(adb, `base64 ${q(full)}`);
            return base64ToBlob(b64.replace(/\s+/g, ""));
        }
        const sync = await adb.sync();
        try {
            const stream = sync.read(full);
            const chunks: Uint8Array[] = [];
            const reader = stream.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            return new Blob(chunks as BlobPart[]);
        } finally {
            sync.dispose();
        }
    }

    /**
     * 上传单个文件。
     * @param target 显式的远程完整路径；不传时按「当前目录 + 文件名」推断。
     */
    async uploadFile(
        file: File,
        onProgress?: (uploaded: number) => void,
        target?: string,
    ) {
        const adb = this.adb;
        if (!adb) throw new Error("未连接");
        const dest = target ?? resolve(this.path, file.name);

        if (this.needSuChannel) {
            await this.uploadViaShell(adb, dest, file, onProgress);
            return;
        }

        const sync = await adb.sync();
        try {
            let uploaded = 0;
            const source = createFileStream(file).pipeThrough(
                new TransformStream<Uint8Array, Uint8Array>({
                    transform(chunk, controller) {
                        uploaded += chunk.byteLength;
                        onProgress?.(uploaded);
                        controller.enqueue(chunk);
                    },
                }),
            );
            await sync.write({
                filename: dest,
                file: source as never,
            });
        } finally {
            sync.dispose();
        }
    }

    /** 确保远程目录存在（递归创建） */
    async ensureDir(adb: Adb, dir: string) {
        if (!dir || dir === "/") return;
        if (this.needSuChannel) {
            await su(adb, `mkdir -p ${q(dir)}`);
            return;
        }
        // 走 shell 协议并转义，路径含空格/中文也不会出错
        await shell(adb, `mkdir -p ${q(dir)}`);
    }

    /** 上传整个文件夹（保留相对目录结构） */
    async uploadDirectory(
        files: { file: File; relativePath: string }[],
        onProgress?: (uploaded: number, total: number) => void,
    ) {
        const adb = this.adb;
        if (!adb) throw new Error("未连接");
        const total = files.reduce((s, f) => s + f.file.size, 0);
        let done = 0;
        for (const { file, relativePath } of files) {
            // 关键：显式传入完整目标路径，保留文件夹内部的相对结构
            const target = resolve(this.path, relativePath);
            const dir = target.slice(0, target.lastIndexOf("/")) || "/";
            await this.ensureDir(adb, dir);
            await this.uploadFile(
                file,
                (uploaded) => {
                    onProgress?.(done + uploaded, total);
                },
                target,
            );
            done += file.size;
        }
        onProgress?.(total, total);
    }

    /** su 通道上传：分块写入 stdin（必须用 pty，才能真正经过 shell 解释重定向） */
    private async uploadViaShell(
        adb: Adb,
        target: string,
        file: File,
        onProgress?: (uploaded: number) => void,
    ) {
        const CHUNK = 96 * 1024;
        const session = await adb.subprocess.noneProtocol.pty(
            `su -c ${q(`cat > ${q(target)}`)}`,
        );
        const writer = session.input.getWriter() as unknown as {
            write(chunk: Uint8Array): Promise<void>;
            close(): Promise<void>;
            abort(reason?: unknown): Promise<void>;
        };
        const buffer = new Uint8Array(await file.arrayBuffer());
        try {
            for (let offset = 0; offset < buffer.length; offset += CHUNK) {
                const slice = buffer.subarray(offset, offset + CHUNK);
                await writer.write(slice);
                onProgress?.(Math.min(offset + CHUNK, buffer.length));
            }
            await writer.close();
        } catch (e) {
            await writer.abort(e as Error);
            throw e;
        }
    }

    /**
     * 下载设备上**任意绝对路径**（文件或目录）。
     * 供「TEST 脚本」页拉取日志目录使用。
     * - 文件 → 直接返回 Blob
     * - 目录 → 递归收集后打包为 zip
     */
    async pullPath(
        remotePath: string,
        onProgress?: (stage: string) => void,
    ): Promise<{ blob: Blob; name: string }> {
        const adb = this.adb;
        if (!adb) throw new Error("未连接");
        onProgress?.(remotePath);
        const isDir = await this.isRemoteDirectory(adb, remotePath);
        const base = remotePath.replace(/\/+$/, "").split("/").pop() || "log";
        if (!isDir) {
            const blob = await this.downloadPath(adb, remotePath);
            return { blob, name: base };
        }
        const files = await this.collectRemoteDir(adb, remotePath, base);
        const zipped = await zipFiles(files);
        return { blob: zipped, name: `${base}.zip` };
    }

    /** 判断远端路径是否为目录（用 ls -ld 的权限首字符） */
    async isRemoteDirectory(adb: Adb, path: string): Promise<boolean> {
        try {
            const out = await shell(
                adb,
                this.needSuChannel
                    ? `su -c ${q(`ls -ld ${q(path)}`)}`
                    : `ls -ld ${q(path)}`,
            );
            // 形如 drwxr-xr-x ...
            return out.trim().startsWith("d");
        } catch {
            return false;
        }
    }

    /** 递归收集远端目录下所有文件（供 zip 打包） */
    async collectRemoteDir(
        adb: Adb,
        dirPath: string,
        prefix: string,
        onProgress?: (file: string) => void,
    ): Promise<{ name: string; blob: Blob }[]> {
        const files: { name: string; blob: Blob }[] = [];
        const walk = async (current: string, rel: string) => {
            const entries = await this.listRemote(adb, current);
            for (const e of entries) {
                if (e.name === "." || e.name === "..") continue;
                const childRel = rel ? `${rel}/${e.name}` : e.name;
                const childPath = resolve(current, e.name);
                if (isDirectory(e.type)) {
                    await walk(childPath, childRel);
                } else {
                    onProgress?.(childPath);
                    const blob = await this.downloadPath(adb, childPath);
                    files.push({ name: childRel, blob });
                }
            }
        };
        await walk(dirPath, prefix);
        return files;
    }

    /** 列出远端目录（自动选择 sync 或 su 通道） */
    private async listRemote(adb: Adb, dirPath: string): Promise<FsEntry[]> {
        if (this.needSuChannel) {
            const out = await su(adb, `ls -la ${q(dirPath)}`);
            const result: FsEntry[] = [];
            for (const line of out.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith("total")) continue;
                const e = this.parseLsLine(trimmed, dirPath);
                if (e) result.push(e);
            }
            return result;
        }
        const sync = await adb.sync();
        try {
            return (await sync.readdir(dirPath)).map((e) =>
                this.toEntry(e, dirPath),
            );
        } catch (e) {
            // 权限不足时自动降级到 su 通道再试一次
            if (!this.needSuChannel) {
                try {
                    const out = await su(adb, `ls -la ${q(dirPath)}`);
                    const result: FsEntry[] = [];
                    for (const line of out.split("\n")) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith("total")) continue;
                        const e2 = this.parseLsLine(trimmed, dirPath);
                        if (e2) result.push(e2);
                    }
                    return result;
                } catch {
                    /* 仍失败则抛出原错误 */
                }
            }
            throw e;
        } finally {
            sync.dispose();
        }
    }
}

function base64ToBlob(b64: string): Blob {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes]);
}

/** 把多个文件打包成 zip（用于下载文件夹） */
async function zipFiles(
    files: { name: string; blob: Blob }[],
): Promise<Blob> {
    const { zip } = await import("fflate");
    const entries: Record<string, Uint8Array> = {};
    if (files.length === 0) {
        // 空文件夹：放一个占位条目，保证 zip 可解压
        entries[".keep"] = new Uint8Array(0);
    }
    for (const f of files) {
        entries[f.name] = new Uint8Array(await f.blob.arrayBuffer());
    }
    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
        zip(entries, { level: 6 }, (err, data) => {
            if (err) reject(err);
            else resolve(data);
        });
    });
    return new Blob([zipped as BlobPart], { type: "application/zip" });
}

export const fs = new FsStore();
export type { AdbSync };

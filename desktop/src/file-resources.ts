import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DesktopHostConnection } from "./host-http";
import type { FileResource, FileResourceTarget, WorkspaceFileInfo } from "./file-resources-shared";

const CHUNK_BYTES = 512 * 1024;
interface HostResult<T> { ok: boolean; result?: T; error?: { message?: string } }
interface Lease { target: FileResourceTarget; host: DesktopHostConnection; file: WorkspaceFileInfo; controller: AbortController; owner: number }

export function parseFileResourceTarget(value: unknown): FileResourceTarget {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid file resource target");
	const input = value as Record<string, unknown>;
	if (Object.keys(input).some(key => !["targetId", "workspaceId", "path"].includes(key))) throw new Error("Invalid file resource fields");
	if (input.targetId !== null && (typeof input.targetId !== "string" || !input.targetId || input.targetId.length > 512 || input.targetId.includes("\0"))) throw new Error("Invalid target id");
	if (typeof input.workspaceId !== "string" || !input.workspaceId || input.workspaceId.length > 512 || input.workspaceId.includes("\0")) throw new Error("Invalid workspace id");
	if (typeof input.path !== "string" || !input.path || input.path.length > 4096 || input.path.includes("\0") || /^(?:[\\/]|[A-Za-z]:)/.test(input.path) || input.path.split(/[\\/]/).includes("..")) throw new Error("Invalid workspace-relative path");
	return { targetId: input.targetId, workspaceId: input.workspaceId, path: input.path };
}

function result<T>(response: HostResult<T>): T {
	if (!response?.ok || response.result === undefined) throw new Error(response?.error?.message ?? "Host file request failed");
	return response.result;
}

/** Leases own a Host connection and version, so a target switch cannot retarget a stream. */
export class FileResources {
	#epoch = 0;
	readonly #leases = new Map<string, Lease>();
	constructor(readonly connection: (targetId?: string) => DesktopHostConnection) {}

	async open(value: unknown, owner: number): Promise<FileResource> {
		const target = parseFileResourceTarget(value);
		const host = this.connection(target.targetId ?? undefined);
		const epoch = this.#epoch;
		const file = result(await host.query<HostResult<WorkspaceFileInfo>>({ queryName: "workspace.file.inspect", input: { workspaceId: target.workspaceId, path: target.path } }));
		if (epoch !== this.#epoch) throw new Error("File resources are closed");
		if (file.workspaceId !== target.workspaceId || typeof file.path !== "string" || typeof file.id !== "string" || typeof file.name !== "string" || !file.name || typeof file.mime !== "string" || !/^[\w.+-]+\/[\w.+-]+$/.test(file.mime) || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.version !== "string" || !file.version || typeof file.writable !== "boolean") throw new Error("Host returned invalid file metadata");
		parseFileResourceTarget({ ...target, path: file.path });
		const id = randomUUID();
		this.#leases.set(id, { target: { ...target, path: file.path }, host, file, controller: new AbortController(), owner });
		return { id, file, url: `zeta-file://viewer/${id}` };
	}

	get(id: string, owner?: number): Lease {
		const lease = this.#leases.get(id);
		if (!lease || owner !== undefined && lease.owner !== owner) throw new Error("File view is closed");
		return lease;
	}

	release(id: string, owner?: number): void {
		const lease = this.#leases.get(id);

		if (lease && (owner === undefined || lease.owner === owner)) { lease.controller.abort(); this.#leases.delete(id); }
	}
	/** Electron webRequest supplies the actual initiating WebContents, never a renderer claim. */
	allowsRequest(url: string, owner: number): boolean {
		try {
			const parsed = new URL(url);
			return parsed.protocol === "zeta-file:" && parsed.hostname === "viewer" && !parsed.port && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && /^\/[a-f0-9-]{36}$/.test(parsed.pathname) && this.#leases.get(parsed.pathname.slice(1))?.owner === owner;
		} catch { return false; }
	}

	releaseOwner(owner: number): void {
		for (const [id, lease] of this.#leases) if (lease.owner === owner) this.release(id);
	}

	async *bytes(id: string, start = 0, end?: number, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
		const lease = this.get(id), limit = Math.min(end ?? lease.file.size - 1, lease.file.size - 1);
		for (let offset = start; offset <= limit;) {
			lease.controller.signal.throwIfAborted(); signal?.throwIfAborted();
			const length = Math.min(CHUNK_BYTES, limit - offset + 1);
			const chunk = result(await lease.host.query<HostResult<{ data: string; bytes: number }>>({ queryName: "workspace.file.readChunk", input: { workspaceId: lease.target.workspaceId, path: lease.target.path, version: lease.file.version, offset, length } }));
			lease.controller.signal.throwIfAborted(); signal?.throwIfAborted();
			if (!Number.isInteger(chunk.bytes) || chunk.bytes <= 0 || chunk.bytes > length || typeof chunk.data !== "string" || chunk.data.length > Math.ceil(CHUNK_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk.data)) throw new Error("Host returned an invalid file chunk");
			const bytes = Buffer.from(chunk.data, "base64");
			if (bytes.length !== chunk.bytes) throw new Error("Host file chunk size mismatch");
			offset += chunk.bytes;
			yield bytes;
		}
	}

	async copy(id: string, destination: string): Promise<void> {
		await pipeline(Readable.from(this.bytes(id)), createWriteStream(destination), { signal: this.get(id).controller.signal });
	}

	async response(request: Request, origin: string): Promise<Response> {
		const url = new URL(request.url);
		if (url.protocol !== "zeta-file:" || url.hostname !== "viewer" || url.port || url.username || url.password || url.search || url.hash || !["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 400 });
		if (request.headers.get("origin") && request.headers.get("origin") !== origin) return new Response(null, { status: 403 });
		if (!/^\/[a-f0-9-]{36}$/.test(url.pathname)) return new Response(null, { status: 404 });
		const id = url.pathname.slice(1);
		let lease: Lease;
		try { lease = this.get(id); } catch { return new Response(null, { status: 404 }); }
		const size = lease.file.size, range = request.headers.get("range");
		const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
		let start = 0, end = size - 1;
		if (range) {
			if (!match || !match[1] && !match[2] || match.slice(1).some(value => value !== "" && !Number.isSafeInteger(Number(value)))) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
			if (!match[1]) start = Math.max(0, size - Number(match[2]));
			else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
			if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
		}
		const headers: Record<string, string> = {
			"Content-Type": lease.file.mime, "Content-Length": String(Math.max(0, end - start + 1)), "Accept-Ranges": "bytes",
			"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
			"Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": "Accept-Ranges,Content-Length,Content-Range", Vary: "Origin",
		};
		if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
		const stream = request.method === "HEAD" || size === 0 ? null : Readable.from(this.bytes(id, start, end, request.signal), { objectMode: false });
		return new Response(stream ? Readable.toWeb(stream) as ReadableStream<Uint8Array> : null, { status: range ? 206 : 200, headers });
	}

	dispose(): void { this.#epoch++; for (const id of this.#leases.keys()) this.release(id); }
}

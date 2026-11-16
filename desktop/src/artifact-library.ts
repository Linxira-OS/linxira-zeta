import { randomUUID } from "node:crypto";
import { open as openFile, rename, rm, type FileHandle } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import type { PrivateIpcMain, PrivateSender } from "./private-ipc";

/**
 * Native import/export for the Host-owned session artifact store.
 *
 * Wiring contract for Main:
 * - Register only the two channels below. The caller must be the trusted main
 *   frame and is rechecked after every native dialog and Host request.
 * - `connection(targetId)` MUST resolve exactly that execution target. It MUST
 *   throw when a remote target is disconnected and MUST NOT substitute the
 *   local connection. {@link null} means the local Host.
 * - `allowsRequest` MUST be called from `webRequest.onBeforeRequest` with the
 *   actual `webContents`, `frame` and `resourceType` Electron supplies.
 * - `response` MUST be the `protocol.handle("zeta-artifact")` branch for
 *   {@link isArtifactLibraryUrl library URLs}. Other `zeta-artifact:` URLs
 *   (plain recorder filenames) keep the previous terminal-recording handler.
 * - The renderer never supplies a filesystem path; only native dialogs do.
 */

export const ARTIFACT_LIBRARY_CHANNELS = {
	import: "zeta-studio:artifact-import",
	export: "zeta-studio:artifact-export",
} as const;

export const ARTIFACT_LIBRARY_MAX_BYTES = 28 * 1024 * 1024;

export const ARTIFACT_KINDS = [
	"graphic",
	"image",
	"video",
	"audio",
	"transcript",
	"judgment",
	"benchmark",
	"recording",
	"annotation",
	"export",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** Public artifact facts. Absolute storage paths never cross this boundary. */
export interface ArtifactRecord {
	readonly artifactId: string;
	readonly kind: ArtifactKind;
	readonly name: string;
	readonly mimeType: string;
	readonly bytes: number;
	readonly createdAt: string;
	readonly workspaceId?: string;
	readonly sessionId?: string;
	readonly runId?: string;
	readonly sha256: string;
}

export interface ArtifactStorageState {
	readonly locationName: string;
	readonly writable: boolean;
	readonly total: number;
	readonly totalBytes: number;
}

export type StudioArtifactFileResult =
	| { readonly ok: true; readonly cancelled: boolean; readonly artifact?: ArtifactRecord; readonly storage?: ArtifactStorageState }
	| { readonly ok: false; readonly message: string };

export interface ArtifactImportInput {
	readonly kind: ArtifactKind;
	readonly sessionId: string;
	readonly workspaceId?: string;
	readonly contextId: string;
	/** Exact execution target; `null`/omitted is the local Host, never a fallback. */
	readonly targetId?: string | null;
}

export interface ArtifactExportInput {
	readonly artifactId: string;
	readonly contextId?: string;
	/** Exact execution target; `null`/omitted is the local Host, never a fallback. */
	readonly targetId?: string | null;
}

/** The Main-owned Host connection surface this module needs. */
export interface ArtifactLibraryConnection {
	request(route: string, init?: RequestInit): Promise<Response>;
}

export interface ArtifactLibraryOptions {
	readonly ipcMain: PrivateIpcMain;
	/** Resolve exactly one Host connection; throw instead of falling back to local. */
	connection(targetId: string | null): ArtifactLibraryConnection;
	isTrustedSender(sender: PrivateSender): boolean;
	/** Main-owned native open dialog. `undefined` means the user cancelled. */
	pickImport(kind: ArtifactKind): Promise<string | undefined>;
	/** Main-owned native save dialog. `undefined` means the user cancelled. */
	pickExport(name: string): Promise<string | undefined>;
}

export interface ArtifactLibrary {
	/**
	 * `protocol.handle` branch for library URLs. `origin` is the trusted web UI
	 * origin Main already uses for `zeta-file`; it is reflected only for CORS.
	 */
	response(request: Request, origin: string): Promise<Response>;
	/** webRequest gate: actual initiating WebContents/frame/resource type. */
	allowsRequest(url: string, sender: PrivateSender | undefined, frame: unknown, resourceType: string): boolean;
	dispose(): void;
}

const REQUEST_TIMEOUT_MS = 60_000;
const GENERIC_FAILURE = "Artifact operation failed. Check the selected file and try again.";
const UNAVAILABLE_FAILURE = "Artifact operation is unavailable.";
const NAVIGATED_FAILURE = "The window changed while the artifact operation was in progress.";
const HOST_FAILURE = "The Host could not complete the artifact operation.";
const FILE_FAILURE = "Choose a supported regular artifact file.";
const SIZE_FAILURE = "Artifact files must be between 1 byte and 28 MiB.";
const DESTINATION_FAILURE = "Choose a local export destination.";

/** Messages raised here are safe constants; native error text is never returned. */
class ArtifactFailure extends Error {}
function fail(message: string): never {
	throw new ArtifactFailure(message);
}

const TEXT_TYPES: Readonly<Record<string, string>> = {
	".json": "application/json",
	".jsonl": "application/x-ndjson",
	".txt": "text/plain",
	".md": "text/markdown",
	".csv": "text/csv",
};

const IMPORT_TYPES: Readonly<Partial<Record<ArtifactKind, Readonly<Record<string, string>>>>> = {
	image: {
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".webp": "image/webp",
		".gif": "image/gif",
		".avif": "image/avif",
	},
	video: {
		".mp4": "video/mp4",
		".webm": "video/webm",
	},
	graphic: { ...TEXT_TYPES, ".svg": "image/svg+xml" },
	recording: { ".studiocast": "application/x-studio-terminalcast", ".cast": "application/x-studio-terminalcast" },
	annotation: TEXT_TYPES,
	judgment: TEXT_TYPES,
	benchmark: TEXT_TYPES,
	transcript: TEXT_TYPES,
	export: { ...TEXT_TYPES, ".tar": "application/x-tar", ".zip": "application/zip" },
};

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif": ".gif",
	"image/avif": ".avif",
	"video/mp4": ".mp4",
	"video/webm": ".webm",
	"image/svg+xml": ".svg",
	"application/json": ".json",
	"application/x-ndjson": ".jsonl",
	"text/plain": ".txt",
	"text/markdown": ".md",
	"text/csv": ".csv",
	"application/x-studio-terminalcast": ".studiocast",
	"application/x-tar": ".tar",
	"application/zip": ".zip",
};

interface ArtifactLibraryTarget {
	readonly artifactId: string;
	readonly contextId: string;
	readonly targetId: string | null;
	readonly route: string;
}

/** True for the library namespace only; recorder names are deliberately false. */
export function isArtifactLibraryUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === "zeta-artifact:" &&
			url.host === "library" &&
			url.username === "" &&
			url.password === ""
		);
	} catch {
		return false;
	}
}

/** Strictly parse `zeta-artifact://library/<encodedid>?contextId=&targetId=`. */
function parseArtifactLibraryUrl(value: string): ArtifactLibraryTarget | undefined {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}
	if (
		url.protocol !== "zeta-artifact:" ||
		url.host !== "library" ||
		url.username !== "" ||
		url.password !== "" ||
		url.hash !== "" ||
		!/^\/[^/]+$/u.test(url.pathname)
	) {
		return undefined;
	}
	let artifactId: string;
	try {
		artifactId = decodeURIComponent(url.pathname.slice(1));
	} catch {
		return undefined;
	}
	if (!opaqueId(artifactId, 4096)) return undefined;
	const keys = [...url.searchParams.keys()];
	if (keys.some(key => key !== "targetId" && key !== "contextId") || new Set(keys).size !== keys.length) return undefined;
	const contextId = url.searchParams.get("contextId");
	if (!contextId || !opaqueId(contextId, 1024)) return undefined;
	const rawTarget = url.searchParams.get("targetId");
	const targetId = rawTarget === null || rawTarget === "" ? null : opaqueId(rawTarget, 512) ? rawTarget : undefined;
	if (targetId === undefined) return undefined;
	return { artifactId, contextId, targetId, route: artifactRoute(artifactId, contextId) };
}

export function registerArtifactLibrary(options: ArtifactLibraryOptions): ArtifactLibrary {
	const documents = new Map<number, SenderDocument>();
	let disposed = false;

	interface SenderDocument {
		readonly sender: PrivateSender;
		readonly frame: unknown;
		readonly controller: AbortController;
		valid(): boolean;
		teardown(): void;
	}

	const begin = (event: { sender: PrivateSender; senderFrame?: unknown }): SenderDocument => {
		const sender = event.sender;
		let trusted = false;
		try {
			trusted = !disposed && event.senderFrame === sender.mainFrame && !sender.isDestroyed() && options.isTrustedSender(sender);
		} catch {
			trusted = false;
		}
		if (!trusted) fail(UNAVAILABLE_FAILURE);
		const frame = event.senderFrame;
		const existing = documents.get(sender.id);
		if (existing && existing.valid()) return existing;
		existing?.teardown();
		const controller = new AbortController();
		const teardown = (): void => {
			if (document !== undefined && documents.get(sender.id) === document) documents.delete(sender.id);
			controller.abort();
			try {
				sender.removeListener("destroyed", teardown);
				sender.removeListener("did-navigate", teardown);
				sender.removeListener("render-process-gone", teardown);
				sender.removeListener("did-start-navigation", navigate);
			} catch {
				// The WebContents may already be gone.
			}
		};
		const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean): void => {
			if (mainFrame && !inPlace) teardown();
		};
		const document: SenderDocument = {
			sender,
			frame,
			controller,
			valid() {
				try {
					return (
						!disposed &&
						document !== undefined &&
						documents.get(sender.id) === document &&
						!sender.isDestroyed() &&
						sender.mainFrame === frame &&
						options.isTrustedSender(sender)
					);
				} catch {
					return false;
				}
			},
			teardown,
		};
		documents.set(sender.id, document);
		try {
			sender.on("destroyed", teardown);
			sender.on("did-navigate", teardown);
			sender.on("render-process-gone", teardown);
			sender.on("did-start-navigation", navigate);
		} catch {
			teardown();
			fail(UNAVAILABLE_FAILURE);
		}
		return document;
	};

	const requireValid = (document: SenderDocument): void => {
		if (!document.valid()) fail(NAVIGATED_FAILURE);
	};

	const signal = (document: SenderDocument): AbortSignal =>
		AbortSignal.any([document.controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);

	const importArtifact = async (document: SenderDocument, raw: unknown): Promise<StudioArtifactFileResult> => {
		const input = importInput(raw);
		// Capture the exact target before awaiting a dialog so a later target
		// switch cannot retarget this operation; a disconnected remote fails now.
		const connection = options.connection(input.targetId);
		const chosen = await options.pickImport(input.kind);
		requireValid(document);
		if (chosen === undefined || chosen === "") return { ok: true, cancelled: true };
		const name = basename(chosen);
		if (!safeArtifactName(name)) fail(FILE_FAILURE);
		const mimeType = importMime(input.kind, name);
		const bytes = await readChosenFile(chosen);
		requireValid(document);
		const response = await connection.request(importRoute(input, name, mimeType), {
			method: "POST",
			headers: { accept: "application/json", "content-type": "application/octet-stream" },
			body: bytes,
			signal: signal(document),
		});
		requireValid(document);
		if (!response.ok) {
			await response.body?.cancel().catch(() => {});
			fail(HOST_FAILURE);
		}
		const payload: unknown = await response.json().catch(() => fail(HOST_FAILURE));
		requireValid(document);
		return { ok: true, cancelled: false, artifact: parseArtifactResponse(payload, input.kind, mimeType, bytes.byteLength) };
	};

	const exportArtifact = async (document: SenderDocument, raw: unknown): Promise<StudioArtifactFileResult> => {
		const input = exportInput(raw);
		const connection = options.connection(input.targetId);
		const route = artifactRoute(input.artifactId, input.contextId);
		const head = await connection.request(route, {
			method: "HEAD",
			headers: { accept: "application/octet-stream" },
			signal: signal(document),
		});
		requireValid(document);
		if (!head.ok) {
			await head.body?.cancel().catch(() => {});
			fail(HOST_FAILURE);
		}
		await head.body?.cancel().catch(() => {});
		const declared = contentLength(head);
		if (declared !== undefined && declared > ARTIFACT_LIBRARY_MAX_BYTES) fail(SIZE_FAILURE);
		const mimeType = safeContentType(head.headers.get("content-type")) ?? "application/octet-stream";
		const destination = await options.pickExport(exportName(input.artifactId, mimeType));
		requireValid(document);
		if (destination === undefined || destination === "") return { ok: true, cancelled: true };
		if (!validDestination(destination)) fail(DESTINATION_FAILURE);
		const response = await connection.request(route, {
			method: "GET",
			headers: { accept: "application/octet-stream", "accept-encoding": "identity" },
			signal: signal(document),
		});
		requireValid(document);
		if (!response.ok) {
			await response.body?.cancel().catch(() => {});
			fail(HOST_FAILURE);
		}
		const bytes = await readBoundedBody(response);
		requireValid(document);
		await writeAtomic(destination, bytes, async () => {
			requireValid(document);
			const current = await connection.request(route, {
				method: "HEAD",
				headers: { accept: "application/octet-stream" },
				signal: signal(document),
			});
			await current.body?.cancel().catch(() => {});
			requireValid(document);
			if (!current.ok) fail(HOST_FAILURE);
		});
		return { ok: true, cancelled: false };
	};

	const handler = (action: (document: SenderDocument, raw: unknown) => Promise<StudioArtifactFileResult>) => {
		return async (event: { sender: PrivateSender; senderFrame?: unknown }, raw: unknown): Promise<StudioArtifactFileResult> => {
			try {
				return await action(begin(event), raw);
			} catch (error) {
				return error instanceof ArtifactFailure ? { ok: false, message: error.message } : { ok: false, message: GENERIC_FAILURE };
			}
		};
	};

	options.ipcMain.handle(ARTIFACT_LIBRARY_CHANNELS.import, handler(importArtifact));
	options.ipcMain.handle(ARTIFACT_LIBRARY_CHANNELS.export, handler(exportArtifact));

	const response = async (request: Request, origin: string): Promise<Response> => {
		try {
			const target = parseArtifactLibraryUrl(request.url);
			if (!target || !["GET", "HEAD"].includes(request.method)) return emptyResponse(400);
			const requestOrigin = request.headers.get("origin");
			if (origin !== "" && requestOrigin !== null && requestOrigin !== origin) return emptyResponse(403);
			// One captured connection per request: a remote target never falls
			// back to local after a disconnect, and every lookup rechecks its
			// Host generation inside the Main-owned request().
			const connection = options.connection(target.targetId);
			const headers = new Headers({ accept: "application/octet-stream", "accept-encoding": "identity" });
			const range = request.headers.get("range");
			if (range !== null) {
				if (!/^bytes=\d*-\d*$/u.test(range)) return emptyResponse(416);
				headers.set("range", range);
			}
			const upstream = await connection.request(target.route, {
				method: request.method,
				headers,
				signal: request.signal,
			});
			if (upstream.status === 416) {
				await upstream.body?.cancel().catch(() => {});
				const result = emptyResponse(416);
				const contentRange = safeHeaderValue(upstream.headers.get("content-range"));
				if (contentRange) result.headers.set("content-range", contentRange);
				if (origin !== "") result.headers.set("access-control-allow-origin", origin);
				return result;
			}
			if (upstream.status !== 200 && upstream.status !== 206) {
				await upstream.body?.cancel().catch(() => {});
				return emptyResponse(404);
			}
			const resultHeaders = new Headers({
				"content-type": safeContentType(upstream.headers.get("content-type")) ?? "application/octet-stream",
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
				"content-security-policy": "default-src 'none'; sandbox",
				"accept-ranges": "bytes",
			});
			const length = contentLength(upstream);
			if (length !== undefined) resultHeaders.set("content-length", String(length));
			const contentRange = safeHeaderValue(upstream.headers.get("content-range"));
			if (upstream.status === 206 && contentRange) resultHeaders.set("content-range", contentRange);
			if (origin !== "") {
				resultHeaders.set("access-control-allow-origin", origin);
				resultHeaders.set("access-control-expose-headers", "accept-ranges, content-length, content-range, content-type");
				resultHeaders.set("vary", "origin");
			}
			if (request.method === "HEAD") {
				await upstream.body?.cancel().catch(() => {});
				return new Response(null, { status: upstream.status, headers: resultHeaders });
			}
			return new Response(upstream.body, { status: upstream.status, headers: resultHeaders });
		} catch {
			// Never surface native causes or paths through the protocol handler.
			return emptyResponse(404);
		}
	};

	const allowsRequest = (url: string, sender: PrivateSender | undefined, frame: unknown, resourceType: string): boolean => {
		if (disposed || !sender || !isArtifactLibraryUrl(url)) return false;
		if (resourceType !== "image" && resourceType !== "media" && resourceType !== "fetch" && resourceType !== "xhr") return false;
		try {
			return !sender.isDestroyed() && frame === sender.mainFrame && options.isTrustedSender(sender);
		} catch {
			return false;
		}
	};

	return {
		response,
		allowsRequest,
		dispose(): void {
			if (disposed) return;
			disposed = true;
			for (const document of [...documents.values()]) document.teardown();
			options.ipcMain.removeHandler(ARTIFACT_LIBRARY_CHANNELS.import);
			options.ipcMain.removeHandler(ARTIFACT_LIBRARY_CHANNELS.export);
		},
	};
}

function importInput(value: unknown): { kind: ArtifactKind; sessionId: string; workspaceId?: string; contextId: string; targetId: string | null } {
	const record = strictRecord(value, ["kind", "sessionId", "workspaceId", "contextId", "targetId"]);
	const kind = record.kind;
	if (typeof kind !== "string" || !(ARTIFACT_KINDS as readonly string[]).includes(kind)) fail("Unsupported artifact type.");
	if (kind === "audio") fail("Audio import is unavailable.");
	const sessionId = opaqueRequired(record.sessionId, 512);
	const contextId = opaqueRequired(record.contextId, 1024);
	const workspaceId = record.workspaceId === undefined ? undefined : opaqueRequired(record.workspaceId, 512);
	const targetId = targetValue(record.targetId);
	return { kind: kind as ArtifactKind, sessionId, contextId, ...(workspaceId === undefined ? {} : { workspaceId }), targetId };
}

function exportInput(value: unknown): { artifactId: string; contextId?: string; targetId: string | null } {
	const record = strictRecord(value, ["artifactId", "contextId", "targetId"]);
	const artifactId = opaqueRequired(record.artifactId, 4096);
	const contextId = record.contextId === undefined ? undefined : opaqueRequired(record.contextId, 1024);
	const targetId = targetValue(record.targetId);
	return { artifactId, ...(contextId === undefined ? {} : { contextId }), targetId };
}

function targetValue(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || !opaqueId(value, 512)) fail("Invalid execution target.");
	return value;
}

function strictRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid artifact request.");
	const record = value as Record<string, unknown>;
	if (Object.keys(record).some(key => !keys.includes(key))) fail("Invalid artifact request.");
	return record;
}

function opaqueRequired(value: unknown, maximum: number): string {
	if (typeof value !== "string" || !opaqueId(value, maximum)) fail("Invalid artifact scope.");
	return value;
}

function opaqueId(value: string, maximum: number): boolean {
	return value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f/\\?#]/u.test(value);
}

function safeArtifactName(value: string): boolean {
	return (
		value.length > 0 &&
		value.length <= 255 &&
		value !== "." &&
		value !== ".." &&
		!/[\u0000-\u001f\u007f\\/]/u.test(value)
	);
}

function importMime(kind: ArtifactKind, name: string): string {
	const types = IMPORT_TYPES[kind];
	if (!types) fail(kind === "audio" ? "Audio import is unavailable." : "This artifact type cannot be imported.");
	const mimeType = types[extname(name).toLowerCase()];
	if (!mimeType) fail("Choose a supported artifact file.");
	return mimeType;
}

function importRoute(input: { kind: ArtifactKind; sessionId: string; contextId: string }, name: string, mimeType: string): string {
	const query = new URLSearchParams();
	query.set("sessionId", input.sessionId);
	query.set("name", name);
	query.set("kind", input.kind);
	query.set("mimeType", mimeType);
	query.set("contextId", input.contextId);
	return `/api/v1/artifacts?${query.toString()}`;
}

function artifactRoute(artifactId: string, contextId?: string): string {
	const route = `/api/v1/artifacts/${encodeURIComponent(artifactId)}`;
	return contextId === undefined ? route : `${route}?contextId=${encodeURIComponent(contextId)}`;
}

function parseArtifactResponse(value: unknown, kind: ArtifactKind, mimeType: string, bytes: number): ArtifactRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail(HOST_FAILURE);
	const payload = value as Record<string, unknown>;
	const raw = payload.artifact;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(HOST_FAILURE);
	const record = raw as Record<string, unknown>;
	if (
		typeof record.artifactId !== "string" ||
		!opaqueId(record.artifactId, 4096) ||
		record.kind !== kind ||
		typeof record.name !== "string" ||
		!safeArtifactName(record.name) ||
		record.mimeType !== mimeType ||
		record.bytes !== bytes ||
		typeof record.sha256 !== "string" ||
		!/^[a-f0-9]{64}$/u.test(record.sha256) ||
		typeof record.createdAt !== "string" ||
		record.createdAt.length > 64 ||
		Number.isNaN(Date.parse(record.createdAt))
	) {
		fail(HOST_FAILURE);
	}
	const artifact: ArtifactRecord = {
		artifactId: record.artifactId,
		kind,
		name: record.name,
		mimeType,
		bytes,
		createdAt: record.createdAt,
		sha256: record.sha256,
	};
	const workspaceId = optionalField(record.workspaceId);
	const sessionId = optionalField(record.sessionId);
	const runId = optionalField(record.runId);
	return {
		...artifact,
		...(workspaceId === undefined ? {} : { workspaceId }),
		...(sessionId === undefined ? {} : { sessionId }),
		...(runId === undefined ? {} : { runId }),
	};
}

function optionalField(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !opaqueId(value, 1024)) fail(HOST_FAILURE);
	return value;
}

async function readChosenFile(file: string): Promise<Uint8Array<ArrayBuffer>> {
	if (!isAbsolute(file)) fail(FILE_FAILURE);
	const handle = await openFile(file, "r");
	try {
		const stats = await handle.stat();
		if (!stats.isFile()) fail(FILE_FAILURE);
		if (!Number.isSafeInteger(stats.size) || stats.size < 1 || stats.size > ARTIFACT_LIBRARY_MAX_BYTES) fail(SIZE_FAILURE);
		const bytes = new Uint8Array(stats.size);
		let offset = 0;
		while (offset < bytes.byteLength) {
			const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
			if (bytesRead === 0) break;
			offset += bytesRead;
		}
		if (offset !== bytes.byteLength) fail(FILE_FAILURE);
		return bytes;
	} finally {
		await handle.close().catch(() => {});
	}
}

async function readBoundedBody(response: Response): Promise<Uint8Array<ArrayBuffer>> {
	const declared = contentLength(response);
	if (declared !== undefined && declared > ARTIFACT_LIBRARY_MAX_BYTES) {
		await response.body?.cancel().catch(() => {});
		fail(SIZE_FAILURE);
	}
	if (!response.body) fail(HOST_FAILURE);
	const reader = response.body.getReader();
	const exact = declared === undefined ? undefined : new Uint8Array(declared);
	const chunks: Uint8Array<ArrayBufferLike>[] = [];
	let total = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			if (total + chunk.value.byteLength > ARTIFACT_LIBRARY_MAX_BYTES) fail(SIZE_FAILURE);
			if (exact) {
				if (total + chunk.value.byteLength > exact.byteLength) fail(HOST_FAILURE);
				exact.set(chunk.value, total);
			} else {
				chunks.push(chunk.value);
			}
			total += chunk.value.byteLength;
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	if (total < 1) fail(HOST_FAILURE);
	if (exact) {
		if (total !== exact.byteLength) fail(HOST_FAILURE);
		return exact;
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function contentLength(response: Response): number | undefined {
	const encoding = response.headers.get("content-encoding");
	if (encoding !== null && encoding.toLowerCase() !== "identity") return undefined;
	const value = response.headers.get("content-length");
	if (value === null || !/^\d+$/u.test(value)) return undefined;
	const length = Number(value);
	return Number.isSafeInteger(length) ? length : undefined;
}

function validDestination(destination: string): boolean {
	if (!isAbsolute(destination)) return false;
	const name = basename(destination);
	return name.length > 0 && name !== "." && name !== "..";
}

/** Commit only after the captured Host context and trusted document are rechecked. */
async function writeAtomic(destination: string, bytes: Uint8Array<ArrayBuffer>, beforeCommit: () => Promise<void>): Promise<void> {
	const temporary = join(dirname(destination), `.zeta-artifact-${randomUUID()}.tmp`);
	let handle: FileHandle | undefined;
	try {
		handle = await openFile(temporary, "wx", 0o600);
		await handle.writeFile(bytes);
		await handle.sync();
		await handle.close();
		handle = undefined;
		await beforeCommit();
		await rename(temporary, destination);
	} catch (error) {
		if (handle) await handle.close().catch(() => {});
		await rm(temporary, { force: true }).catch(() => {});
		throw error;
	}
}

/** Default filename only; the native save dialog remains the authority. */
function exportName(artifactId: string, mimeType: string): string {
	const fallback = "artifact" + (MIME_EXTENSIONS[mimeType] ?? "");
	try {
		const parts = Buffer.from(artifactId, "base64url").toString("utf8").split("\u0000");
		const name = parts[2];
		if (parts.length === 3 && parts[0] === "zeta-artifact" && parts[1] !== "" && name !== undefined && safeArtifactName(name)) {
			return extname(name) === "" ? name + (MIME_EXTENSIONS[mimeType] ?? "") : name;
		}
	} catch {
		// The id is opaque; a malformed one only loses the filename suggestion.
	}
	return fallback;
}

function safeContentType(value: string | null): string | undefined {
	if (value === null) return undefined;
	const match = /^([a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*)(?:\s*;\s*charset=(?:utf-8|us-ascii))?$/iu.exec(value.trim());
	return match?.[0];
}

function safeHeaderValue(value: string | null): string | undefined {
	return value !== null && value.length > 0 && value.length <= 256 && !/[\r\n\u0000]/u.test(value) ? value : undefined;
}

function emptyResponse(status: number): Response {
	return new Response(null, {
		status,
		headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
	});
}

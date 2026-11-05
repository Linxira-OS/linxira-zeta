/**
 * Session artifact (`local://`) file access for remote clients.
 *
 * A `local://` file lives under the artifacts directory of the session that
 * wrote it, on the host that owns that session. A TUI attached to a backend on
 * another machine cannot resolve it with the local filesystem, so the gateway
 * exposes the same root the tools use:
 *
 * - `GET  /api/sessions/:id/artifacts`        — list regular files (newest first)
 * - `GET  /api/sessions/:id/artifacts/:name`  — raw bytes of one file
 * - `PUT  /api/sessions/:id/artifacts/:name`  — replace one file (28 MiB cap)
 *
 * Paths resolve through `InternalUrlRouter.locate("local://…")`, which applies
 * the same realpath + root-containment rules as the tools: traversal and
 * escaping symlinks are refused, and a write never creates anything outside the
 * session's artifacts directory. Absolute paths are never returned.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { InternalUrlRouter, listLocalFiles, type LocalFileEntry, type LocalProtocolOptions } from "../../internal-urls";
import { resolveSessionPath } from "./sessions";

const MAX_ARTIFACT_BYTES = 28 * 1024 * 1024;

/**
 * What a `local://` artifact is, from its name alone: Zeta writes these files
 * itself, so the suffix and the producer's own stem are the only signals (no
 * sidecar metadata exists). Order matters — the stem checks come first because
 * a `recording-…webm` is a recording before it is generic media.
 */
function artifactKind(name: string): string {
	const stem = name.toLowerCase();
	const extension = path.extname(stem);
	if (stem.includes("judgment")) return "judgment";
	if (stem.includes("bench")) return "benchmark";
	if (stem.includes("annotation")) return "annotation";
	if (stem.includes("recording")) return "recording";
	if (stem.includes("transcript") || extension === ".jsonl") return "transcript";
	if (AUDIO_EXTENSIONS.has(extension)) return "audio";
	if (VIDEO_EXTENSIONS.has(extension)) return "video";
	if (IMAGE_EXTENSIONS.has(extension)) return "image";
	if (GRAPHIC_EXTENSIONS.has(extension)) return "graphic";
	return "export";
}

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".ogg", ".flac"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp"]);
const GRAPHIC_EXTENSIONS = new Set([".svg"]);

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	".json": "application/json",
	".jsonl": "application/x-ndjson",
	".md": "text/markdown",
	".txt": "text/plain",
	".csv": "text/csv",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".avif": "image/avif",
	".wav": "audio/wav",
	".mp3": "audio/mpeg",
	".m4a": "audio/mp4",
	".ogg": "audio/ogg",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
};

/**
 * Content digests, keyed by `path\0mtimeMs\0size`: a listing must carry
 * `sha256` (the client contract requires it), and re-hashing every file on every
 * panel poll would read the whole artifacts directory each time.
 */
const digestCache = new Map<string, string>();

async function sha256Of(entry: LocalFileEntry): Promise<string> {
	const key = `${entry.path}\u0000${entry.mtimeMs}\u0000${entry.size}`;
	const cached = digestCache.get(key);
	if (cached !== undefined) return cached;
	const data = await fs.readFile(entry.path);
	const digest = createHash("sha256").update(data).digest("hex");
	if (digestCache.size >= 512) digestCache.clear();
	digestCache.set(key, digest);
	return digest;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** Same derivation as `SessionManager.getArtifactsDir()`: the journal path without `.jsonl`. */
async function localOptions(sessionId: string): Promise<LocalProtocolOptions | null> {
	const sessionFile = await resolveSessionPath(sessionId);
	if (!sessionFile?.endsWith(".jsonl")) return null;
	const artifactsDir = sessionFile.slice(0, -".jsonl".length);
	return { getArtifactsDir: () => artifactsDir, getSessionId: () => sessionId };
}

/**
 * `GET /api/sessions/:id/artifacts[?kind=&limit=&cursor=]`
 *
 * The entry shape is additive: `name`/`url`/`size`/`mtimeMs` stay (the legacy
 * Next panel reads them), and the Studio host consumes `artifactId`, `kind`,
 * `mimeType`, `bytes`, `createdAt` and `sha256` on top. `cursor` is the last
 * name of the previous page, so pages stay stable while files are added.
 */
export async function handleListArtifacts(
	sessionId: string,
	search: { kind?: string | null; limit?: string | null; cursor?: string | null } = {},
): Promise<Response> {
	const options = await localOptions(sessionId);
	if (!options) return json({ error: "not_found" }, 404);
	const kind = search.kind && search.kind !== "" ? search.kind : undefined;
	const requestedLimit = Number(search.limit ?? "");
	const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : undefined;
	const cursor = search.cursor && search.cursor !== "" ? search.cursor : undefined;

	// Files above the read cap are not artifacts any client can open; listing
	// them would only advertise a record whose read always fails.
	const listed = (await listLocalFiles(options)).filter(entry => entry.size <= MAX_ARTIFACT_BYTES);
	const withKind = await Promise.all(
		listed.map(async entry => ({
			entry,
			kind: artifactKind(entry.name),
			sha256: await sha256Of(entry),
		})),
	);
	const filtered = kind === undefined ? withKind : withKind.filter(item => item.kind === kind);
	const start = cursor === undefined ? 0 : filtered.findIndex(item => item.entry.name === cursor) + 1;
	const window = limit === undefined ? filtered.slice(start) : filtered.slice(start, start + limit);
	const remaining = filtered.length - start - window.length;
	return json({
		entries: window.map(({ entry, kind: entryKind, sha256 }) => ({
			name: entry.name,
			url: entry.url,
			size: entry.size,
			mtimeMs: entry.mtimeMs,
			artifactId: entry.name,
			kind: entryKind,
			mimeType: MIME_BY_EXTENSION[path.extname(entry.name).toLowerCase()] ?? "application/octet-stream",
			bytes: entry.size,
			createdAt: new Date(entry.mtimeMs).toISOString(),
			sha256,
		})),
		total: filtered.length,
		totalBytes: filtered.reduce((sum, item) => sum + item.entry.size, 0),
		...(remaining > 0 && window.length > 0 ? { nextCursor: window[window.length - 1]!.entry.name } : {}),
	});
}

/** `DELETE /api/sessions/:id/artifacts/:name` — containment is checked before unlink. */
export async function handleDeleteArtifact(sessionId: string, encodedName: string): Promise<Response> {
	const name = decodeName(encodedName);
	if (name === null) return json({ error: "bad_name" }, 400);
	const options = await localOptions(sessionId);
	if (!options) return json({ error: "not_found" }, 404);
	let located: string | null;
	try {
		located = await InternalUrlRouter.instance().locate(`local://${name}`, { localProtocolOptions: options });
	} catch {
		return json({ error: "forbidden" }, 403);
	}
	if (!located) return json({ error: "not_found" }, 404);
	try {
		await fs.unlink(located);
	} catch {
		return json({ error: "not_found" }, 404);
	}
	return new Response(null, { status: 204 });
}

/** `GET /api/sessions/:id/artifacts/:name` */
export async function handleReadArtifact(sessionId: string, encodedName: string): Promise<Response> {
	const name = decodeName(encodedName);
	if (name === null) return json({ error: "bad_name" }, 400);
	const options = await localOptions(sessionId);
	if (!options) return json({ error: "not_found" }, 404);

	let located: string | null;
	try {
		located = await InternalUrlRouter.instance().locate(`local://${name}`, { localProtocolOptions: options });
	} catch {
		// Containment/realpath refusal: traversal and escaping symlinks are client errors, not misses.
		return json({ error: "forbidden" }, 403);
	}
	if (!located) return json({ error: "not_found" }, 404);
	const stat = await fs.stat(located);
	if (!stat.isFile()) return json({ error: "not_a_file" }, 404);
	if (stat.size > MAX_ARTIFACT_BYTES) return json({ error: "too_large" }, 413);

	const data = await fs.readFile(located);
	return new Response(data, {
		headers: {
			"content-type": "application/octet-stream",
			"content-length": String(data.byteLength),
			"cache-control": "no-store",
		},
	});
}

/** `PUT /api/sessions/:id/artifacts/:name` */
export async function handleWriteArtifact(req: Request, sessionId: string, encodedName: string): Promise<Response> {
	const name = decodeName(encodedName);
	if (name === null) return json({ error: "bad_name" }, 400);
	const options = await localOptions(sessionId);
	if (!options) return json({ error: "not_found" }, 404);

	const data = new Uint8Array(await req.arrayBuffer());
	if (data.byteLength > MAX_ARTIFACT_BYTES) return json({ error: "too_large" }, 413);

	let located: string | null;
	try {
		located = await InternalUrlRouter.instance().locate(
			`local://${name}`,
			{ localProtocolOptions: options },
			{ create: true },
		);
	} catch {
		return json({ error: "forbidden" }, 403);
	}
	if (!located) return json({ error: "not_found" }, 404);

	await fs.mkdir(path.dirname(located), { recursive: true });
	await fs.writeFile(located, data);
	return new Response(null, { status: 204 });
}

/**
 * The client sends `encodeURIComponent(name)`, so a nested `local://` path
 * arrives with `%2F`. Decoding once restores the name `locate()` expects; a
 * malformed escape or an empty name is a client bug, never a filesystem miss.
 */
function decodeName(encodedName: string): string | null {
	let name: string;
	try {
		name = decodeURIComponent(encodedName);
	} catch {
		return null;
	}
	return name.length > 0 ? name : null;
}

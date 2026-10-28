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
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { InternalUrlRouter, listLocalFiles, type LocalProtocolOptions } from "../../internal-urls";
import { resolveSessionPath } from "./sessions";

const MAX_ARTIFACT_BYTES = 28 * 1024 * 1024;

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

/** `GET /api/sessions/:id/artifacts` */
export async function handleListArtifacts(sessionId: string): Promise<Response> {
	const options = await localOptions(sessionId);
	if (!options) return json({ error: "not_found" }, 404);
	const entries = await listLocalFiles(options);
	return json({
		entries: entries.map(entry => ({
			name: entry.name,
			url: entry.url,
			size: entry.size,
			mtimeMs: entry.mtimeMs,
		})),
	});
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

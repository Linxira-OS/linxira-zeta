/**
 * Web Gateway — session archive handlers.
 *
 * Archive = move the session jsonl (+ its artifacts dir) from
 * `~/.zeta/agent/sessions/<encoded-cwd>/<file>.jsonl` to
 * `~/.zeta/agent/archive/sessions/PROJECT_DIR/FILE.jsonl`. The archive root
 * matches the gc-cli cold-archive convention
 * (`path.join(dirname(getSessionsDir()), "archive", "sessions")`), and the
 * live listing only scans the sessions tree — so archived transcripts leave
 * the main session list, while this module's identical one-level scan rooted
 * at the archive tree surfaces them. Unarchive is the exact inverse; on
 * destination name collisions a numeric suffix is appended (`.2.jsonl`)
 * rather than failing — archive and unarchive are bulk, reversible ops.
 *
 * Bot-registry cleanup is shared with delete via
 * `disposeSessionRegistryEntry` (sessions.ts): bot/draft entries + chat
 * pointers are dropped on archive; `relay` sessions refuse to archive (like
 * delete) — the live relay runtime still points at the transcript.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getSessionsDir, logger } from "@linxiraos/pi-utils";
import { WebConfig } from "../../config/web-config";
import { parseSessionContent } from "../../session/session-loader";
import { serializeTitleSlot } from "../../session/session-title-slot";
import { removeRunningSession } from "./running-sessions";
import {
	disposeSessionRegistryEntry,
	invalidateSessionListCache,
	readSessionHeader,
	resolveSessionPath,
	sessionPathKey,
} from "./sessions";
import type { SessionInfo } from "./types";

/** Artifacts dir convention: sibling directory with the `.jsonl` suffix stripped. */
function artifactsDirFor(sessionFile: string): string {
	return sessionFile.slice(0, -".jsonl".length);
}

function getArchivedSessionsRoot(): string {
	return path.join(path.dirname(getSessionsDir()), "archive", "sessions");
}

/**
 * Map an archived session file to the gateway SessionInfo DTO. `archivedFrom`
 * records the original project cwd from the header; message counts are not
 * recomputed (the archive list is for discovery/restore, not preview).
 */
async function archivedSessionInfo(archiveFile: string): Promise<SessionInfo | null> {
	try {
		const header = readSessionHeader(archiveFile);
		if (!header) return null;
		const stat = fs.statSync(archiveFile);
		return {
			path: archiveFile,
			id: header.id,
			cwd: header.cwd ?? "",
			name: header.name,
			created: header.timestamp,
			modified: stat.mtime.toISOString(),
			messageCount: 0,
			firstMessage: "(archived session)",
			projectRoot: header.cwd ?? "",
			archivedFrom: header.cwd ?? "",
		} satisfies SessionInfo;
	} catch (error) {
		logger.warn("web-gateway: archived session unreadable", {
			archiveFile,
			error: String(error),
		});
		return null;
	}
}

/**
 * GET /api/sessions/archived — list archived sessions (newest first).
 */
export async function handleListArchivedSessions(): Promise<Response> {
	try {
		const root = getArchivedSessionsRoot();
		const files: string[] = [];
		try {
			for await (const name of new Bun.Glob("*/*.jsonl").scan({ cwd: root, onlyFiles: true })) {
				files.push(path.join(root, name));
			}
		} catch {
			// Archive root absent — nothing archived yet.
		}
		const infos = await Promise.all(files.map(archivedSessionInfo));
		const sessions = infos
			.filter((info): info is SessionInfo => info !== null)
			.sort((a, b) => b.modified.localeCompare(a.modified));
		return Response.json({ sessions });
	} catch (error) {
		logger.error("web-gateway: list archived sessions failed", { error: String(error) });
		return Response.json({ error: String(error) }, { status: 500 });
	}
}

/**
 * Re-parent direct children of `filePath` to its parent before the file leaves
 * the main tree — identical cascade contract to handleDeleteSession.
 */
function reParentChildren(filePath: string): void {
	const parentSessionPath = readSessionHeader(filePath)?.parentSession;
	const targetPathKey = sessionPathKey(filePath);
	const dir = path.dirname(filePath);
	try {
		const files = fs
			.readdirSync(dir)
			.filter(file => file.endsWith(".jsonl") && sessionPathKey(path.join(dir, file)) !== targetPathKey);
		for (const file of files) {
			const childPath = path.join(dir, file);
			try {
				const content = fs.readFileSync(childPath, "utf8");
				const parsed = parseSessionContent(content);
				const sessionIdx = parsed.entries.findIndex(e => e.type === "session");
				if (sessionIdx < 0) continue;
				const header = parsed.entries[sessionIdx] as { parentSession?: string };
				if (header.parentSession && sessionPathKey(header.parentSession) === targetPathKey) {
					header.parentSession = parentSessionPath;
					const body = `${parsed.entries.map(entry => JSON.stringify(entry)).join("\n")}\n`;
					const nextContent = parsed.titleSlot ? `${serializeTitleSlot(parsed.titleSlot)}${body}` : body;
					fs.writeFileSync(childPath, nextContent, "utf8");
				}
			} catch {
				// skip malformed
			}
		}
	} catch {
		// skip if dir unreadable
	}
}

/** Resolve a numeric-suffix destination if `destFile` already exists. */
function resolveCollision(destFile: string): string {
	if (!fs.existsSync(destFile)) return destFile;
	const base = path.basename(destFile).replace(/\.jsonl$/, "");
	const dir = path.dirname(destFile);
	let n = 2;
	let candidate = path.join(dir, `${base}.${n}.jsonl`);
	while (fs.existsSync(candidate)) {
		n += 1;
		candidate = path.join(dir, `${base}.${n}.jsonl`);
	}
	return candidate;
}

/**
 * POST /api/sessions/:id/archive — move the session jsonl (+ artifacts dir)
 * into the archive tree, dropping any bot/draft registry entry. Relay
 * sessions are refused (400) — the live relay runtime still owns the
 * transcript.
 */
export async function handleArchiveSession(sessionId: string): Promise<Response> {
	try {
		const filePath = await resolveSessionPath(sessionId);
		if (!filePath) {
			return Response.json({ error: "Session not found" }, { status: 404 });
		}

		reParentChildren(filePath);

		const webConfig = await WebConfig.load();
		const disposed = await disposeSessionRegistryEntry(webConfig, filePath);
		if (disposed === "relay-protected") {
			return Response.json({ error: "relay 会话不可归档" }, { status: 400 });
		}

		// Destination: <archive>/<encoded-cwd-dir>/<original-filename>.
		const archiveRoot = getArchivedSessionsRoot();
		const destDir = path.join(archiveRoot, path.basename(path.dirname(filePath)));
		fs.mkdirSync(destDir, { recursive: true });
		const destFile = resolveCollision(path.join(destDir, path.basename(filePath)));

		const sourceArtifacts = artifactsDirFor(filePath);
		const destArtifacts = artifactsDirFor(destFile);

		removeRunningSession(sessionId);
		fs.renameSync(filePath, destFile);
		if (fs.existsSync(sourceArtifacts)) {
			fs.renameSync(sourceArtifacts, destArtifacts);
		}
		invalidateSessionListCache();
		return Response.json({ ok: true, archivePath: destFile });
	} catch (error) {
		logger.error("web-gateway: archive session failed", { sessionId, error: String(error) });
		return Response.json({ error: String(error) }, { status: 500 });
	}
}

/**
 * POST /api/sessions/:id/unarchive — restore an archived session into the
 * live sessions tree. The file is located by scanning the archive root for
 * the header id. No registry cleanup applies on the way back — the entry (if
 * any) was disposed at archive time.
 */
export async function handleUnarchiveSession(sessionId: string): Promise<Response> {
	try {
		const root = getArchivedSessionsRoot();
		const candidates: string[] = [];
		try {
			for await (const name of new Bun.Glob("*/*.jsonl").scan({ cwd: root, onlyFiles: true })) {
				candidates.push(path.join(root, name));
			}
		} catch {
			return Response.json({ error: "Session not archived" }, { status: 404 });
		}
		const target = candidates.find(file => readSessionHeader(file)?.id === sessionId);
		if (!target) {
			return Response.json({ error: "Session not archived" }, { status: 404 });
		}

		// The archive dir name encodes the project root (see session-paths), so
		// restoring it verbatim reconstructs the original live layout.
		const destDir = path.join(getSessionsDir(), path.basename(path.dirname(target)));
		fs.mkdirSync(destDir, { recursive: true });
		const destFile = resolveCollision(path.join(destDir, path.basename(target)));

		const sourceArtifacts = artifactsDirFor(target);
		const destArtifacts = artifactsDirFor(destFile);

		fs.renameSync(target, destFile);
		if (fs.existsSync(sourceArtifacts)) {
			fs.renameSync(sourceArtifacts, destArtifacts);
		}
		invalidateSessionListCache();
		return Response.json({ ok: true, path: destFile });
	} catch (error) {
		logger.error("web-gateway: unarchive session failed", { sessionId, error: String(error) });
		return Response.json({ error: String(error) }, { status: 500 });
	}
}

/**
 * Taste candidate queue.
 *
 * Producers (per-prompt extraction, and the `super_memory record` tool) write one
 * JSON file per candidate under `queue/<sessionId>/`; the consolidator lists,
 * applies and unlinks exactly the files it read. File-per-candidate keeps
 * producers lock-free — there is no shared append fd to race a consuming rename —
 * and a crash between apply and unlink only re-delivers a candidate, which is
 * harmless because consolidation is a pure function of the queue plus the store.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent } from "@linxiraos/pi-utils";

import { tasteQueueDir } from "./paths";
import type { TasteScopeKey } from "./scope";
import type { TasteCategory, TastePolarity } from "./store";

/** One extracted candidate. Deliberately has no confidence field: the host owns it. */
export interface TasteCandidate {
	v: 1;
	/** Epoch millis; also the queue file's sort key. */
	ts: number;
	sessionId: string;
	/** Stable identity for a window candidate, retained by the host after consolidation. */
	sourceId?: string;
	category: TasteCategory;
	statement: string;
	polarity: TastePolarity;
	/** The user's own words this candidate rests on; must be a verbatim substring. */
	evidenceText: string;
}

/** A queued candidate plus the file backing it (consume token). */
export interface QueuedTasteCandidate {
	candidate: TasteCandidate;
	file: string;
}

const SESSION_DIR_RE = /^[A-Za-z0-9_-]+$/;

function queueFileName(ts: number): string {
	const nonce = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
	return `${ts.toString(36).padStart(10, "0")}-${nonce}.json`;
}

/** Session ids become directory names; strip anything path-hostile. */
export function sanitizeTasteSessionId(sessionId: string): string {
	const cleaned = sessionId.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
	return cleaned || "session";
}

/** Persist one candidate into its session's queue directory. */
export async function appendTasteCandidate(
	agentDir: string,
	key: TasteScopeKey,
	candidate: TasteCandidate,
): Promise<string> {
	const dir = path.join(tasteQueueDir(agentDir, key), sanitizeTasteSessionId(candidate.sessionId));
	await fs.mkdir(dir, { recursive: true });
	const file = path.join(dir, candidate.sourceId ? `window-${candidate.sourceId}.json` : queueFileName(candidate.ts));
	await Bun.write(file, `${JSON.stringify(candidate)}\n`);
	return file;
}

/**
 * Every queued candidate of one scope, oldest first. Unreadable or malformed
 * entries are left in place (never consumed) so a torn write cannot wedge the
 * queue and a foreign file stays inspectable.
 */
export async function listTasteCandidates(agentDir: string, key: TasteScopeKey): Promise<QueuedTasteCandidate[]> {
	const queueRoot = tasteQueueDir(agentDir, key);
	let sessionDirs: string[];
	try {
		sessionDirs = (await fs.readdir(queueRoot, { withFileTypes: true }))
			.filter(entry => entry.isDirectory() && SESSION_DIR_RE.test(entry.name))
			.map(entry => entry.name);
	} catch (error) {
		if (isEnoent(error)) return [];
		throw error;
	}
	const queued: QueuedTasteCandidate[] = [];
	for (const sessionId of sessionDirs) {
		const dir = path.join(queueRoot, sessionId);
		const names = (await fs.readdir(dir).catch(() => [] as string[]))
			.filter(name => name.endsWith(".json"))
			.sort((a, b) => a.localeCompare(b));
		for (const name of names) {
			const file = path.join(dir, name);
			try {
				const parsed = (await Bun.file(file).json()) as TasteCandidate;
				if (parsed && typeof parsed === "object" && parsed.v === 1 && typeof parsed.statement === "string") {
					queued.push({ candidate: parsed, file });
				}
			} catch {
				// Leave it for inspection — never consume what we cannot read.
			}
		}
	}
	queued.sort((a, b) => a.candidate.ts - b.candidate.ts);
	return queued;
}

/** Remove consumed candidate files and prune emptied session directories. */
export async function consumeTasteCandidates(files: readonly string[]): Promise<void> {
	const dirs = new Set<string>();
	for (const file of files) {
		await fs.rm(file, { force: true }).catch(() => {});
		dirs.add(path.dirname(file));
	}
	for (const dir of dirs) {
		const remaining = await fs.readdir(dir).catch(() => null);
		if (remaining !== null && remaining.length === 0) {
			await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
		}
	}
}

/** How many candidates are waiting across sessions (for the tool's `stats`). */
export async function tasteQueueDepth(agentDir: string, key: TasteScopeKey): Promise<number> {
	return (await listTasteCandidates(agentDir, key)).length;
}

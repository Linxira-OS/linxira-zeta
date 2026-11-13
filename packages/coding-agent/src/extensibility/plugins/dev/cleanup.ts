/**
 * Retention cleanup for `<agentDir>/plugins-dev`.
 *
 * Agent-authored plugins are session scratch: the user promotes what should
 * survive. A session directory untouched for the retention window is removed
 * without following links; the active session is the caller's responsibility
 * to exclude.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { devPluginsRoot, isWithin, removeTreeSafely } from "./paths";

export interface CleanupOptions {
	readonly agentDir: string;
	/** Sessions to keep even if old (normally the current one). */
	readonly keepSessionIds?: readonly string[];
	readonly now?: number;
	readonly retentionMs?: number;
}

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Remove expired session directories; returns the removed directory names. */
export function cleanupExpiredDevPlugins(options: CleanupOptions): string[] {
	const root = devPluginsRoot(options.agentDir);
	const retention = options.retentionMs ?? DEFAULT_RETENTION_MS;
	const now = options.now ?? Date.now();
	const keep = new Set(options.keepSessionIds ?? []);
	let sessions: fs.Dirent[];
	try {
		sessions = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const removed: string[] = [];
	for (const session of sessions) {
		if (!session.isDirectory() || session.name.startsWith(".") || keep.has(session.name)) continue;
		const sessionPath = path.join(root, session.name);
		let stat: fs.Stats;
		try {
			stat = fs.statSync(sessionPath);
		} catch {
			continue;
		}
		if (now - stat.mtimeMs < retention) continue;
		try {
			for (const entry of fs.readdirSync(sessionPath, { withFileTypes: true })) {
				const target = path.join(sessionPath, entry.name);
				if (isWithin(target, root)) removeTreeSafely(target, root);
			}
			fs.rmdirSync(sessionPath);
			removed.push(session.name);
		} catch {
			// Another process may still own the directory; a later cleanup retries.
		}
	}
	return removed;
}

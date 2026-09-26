import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@linxiraos/pi-utils";
import type { ToolSession } from "../tools";
import type { EditMode } from "@linxiraos/pi-tui/tools/edit";

import { cfgEditBlackboxEnabled } from "./settings";

export const EDIT_BLACKBOX_FILE = "edit-blackbox.jsonl";

/** Full source transition committed by one edit operation. */
export interface AppliedEditSnapshot {
	/** Path used to select the tree-sitter language. */
	path: string;
	/** File content immediately before the operation. */
	prev: string;
	/** File content immediately after the operation. */
	next: string;
}

/** Observes a committed edit before its full-file snapshots are pruned. */
export type AppliedEditObserver = (snapshot: AppliedEditSnapshot) => Promise<void>;

/** Create the enabled recorder that appends native-detected parse regressions. */
export function createEditBlackboxRecorder(
	session: ToolSession,
	variant: EditMode,
	arg: unknown,
): AppliedEditObserver | undefined {
	if (!cfgEditBlackboxEnabled.get(session.settings)) return undefined;
	const logPath = path.join(session.settings.getAgentDir(), EDIT_BLACKBOX_FILE);
	const model = session.getActiveModelString?.() ?? "unknown";

	return async ({ path: filePath, prev, next }) => {
		try {
			// `path` is the load-bearing field: without it the log is a pile of
			// content blobs with no way to map a snapshot back to a file, which
			// makes every downstream use (diff review, selective revert, feeding
			// the distro's snapshot tool) impossible. `arg` carries a path only
			// incidentally, and not at all for some edit modes.
			await fs.promises.appendFile(
				logPath,
				`${JSON.stringify({ path: filePath, prev, new: next, model, variant, arg })}\n`,
			);
		} catch (error) {
			// Recording is diagnostic only. The edit has already committed, so a
			// telemetry failure must not turn it into a reported edit failure.
			logger.debug("Failed to record edit parse regression", {
				path: logPath,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};
}

/** One line of `edit-blackbox.jsonl`, as persisted. */
export interface EditBlackboxEntry {
	/** Path the edit targeted, exactly as the editor saw it. */
	path: string;
	/** File content immediately before the operation. */
	prev: string;
	/** File content immediately after the operation. */
	new: string;
	/** Model string that produced the edit, or `"unknown"`. */
	model: string;
	/** Edit mode in effect (replace / insert / …). */
	variant: EditMode;
	/** Original tool argument, kept for diagnostics. */
	arg: unknown;
	/** Append-file timestamp (ms since epoch), absent on pre-`path` entries. */
	ts?: number;
}

/** Absolute path of the blackbox log for a given agent dir. */
export function editBlackboxPath(agentDir: string): string {
	return path.join(agentDir, EDIT_BLACKBOX_FILE);
}

/**
 * Result of a blackbox read: the entries plus what had to be skipped.
 *
 * `corruptLines` is reported rather than logged from inside the reader. A
 * library that logs on a hot read path pays a file-sink initialisation cost the
 * first time it is called, and callers that poll the log (the `/edits` command,
 * a restore tool) would pay it again on every poll. How loudly a damaged log
 * deserves to be reported is the caller's decision, and it has a count to
 * decide with.
 */
export interface EditBlackboxRead {
	entries: EditBlackboxEntry[];
	/** Lines skipped because they were not valid JSON, or lacked the content fields. */
	corruptLines: number;
}

/**
 * Read recorded edits, oldest first.
 *
 * The log is append-only JSONL, so an interrupted `appendFile` costs at most the
 * final line, and a torn tail ends the read as a normal outcome. An unparsable
 * line *followed by more content* means the file is damaged some other way: it is
 * counted in {@link EditBlackboxRead.corruptLines} and the rest of the log is
 * still returned, because losing the tail of the history is the one failure
 * mode this log cannot have.
 *
 * Entries written before `path` existed come back without it. Callers that need
 * a path must treat a missing one as "unattributable" instead of guessing from
 * `arg`, which is only incidentally a path on some edit modes.
 */
export async function readEditBlackbox(
	agentDir: string,
	options?: { since?: number; path?: string },
): Promise<EditBlackboxRead> {
	let raw: string;
	try {
		raw = await fs.promises.readFile(editBlackboxPath(agentDir), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], corruptLines: 0 };
		throw error;
	}
	const lines = raw.split("\n");
	// Resolved once, walking backwards: a torn tail is only meaningful as the
	// last content line, and deciding that per bad line would re-scan the tail.
	let lastContent = lines.length - 1;
	while (lastContent >= 0 && lines[lastContent]!.trim() === "") lastContent--;

	const entries: EditBlackboxEntry[] = [];
	let corruptLines = 0;
	for (const [index, line] of lines.entries()) {
		if (line.trim() === "") continue;
		let parsed: EditBlackboxEntry;
		try {
			parsed = JSON.parse(line) as EditBlackboxEntry;
		} catch {
			if (index === lastContent) break; // torn tail: the write was interrupted
			corruptLines++;
			continue;
		}
		if (typeof parsed.prev !== "string" || typeof parsed.new !== "string") {
			corruptLines++;
			continue;
		}
		if (options?.path !== undefined && parsed.path !== options.path) continue;
		entries.push(parsed);
	}
	return { entries: options?.since === undefined ? entries : entries.slice(-options.since), corruptLines };
}

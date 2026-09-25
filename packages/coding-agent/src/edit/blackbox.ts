import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@linxiraos/pi-utils";
import type { ToolSession } from "../tools";
import type { EditMode } from "@linxiraos/pi-tui/tools/edit";

import { cfgEditBlackboxEnabled } from "./settings";

const EDIT_BLACKBOX_FILE = "edit-blackbox.jsonl";

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
 * Read recorded edits, oldest first.
 *
 * The log is append-only JSONL, so an interrupted `appendFile` costs at most the
 * final line. A torn tail is expected and silent; an unparsable line *followed by
 * more content* means the file is damaged some other way, so it is logged at
 * warning level rather than dropped without trace — silently losing edit
 * history is the one failure mode this log cannot have.
 *
 * Entries written before `path` existed come back without it. Callers that need
 * a path must treat a missing one as "unattributable" instead of guessing from
 * `arg`, which is only incidentally a path on some edit modes.
 */
export async function readEditBlackbox(
	agentDir: string,
	options?: { since?: number; path?: string },
): Promise<EditBlackboxEntry[]> {
	let raw: string;
	try {
		raw = await fs.promises.readFile(editBlackboxPath(agentDir), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const lines = raw.split("\n");
	const entries: EditBlackboxEntry[] = [];
	for (const [index, line] of lines.entries()) {
		if (line.trim() === "") continue;
		let parsed: EditBlackboxEntry;
		try {
			parsed = JSON.parse(line) as EditBlackboxEntry;
		} catch {
			const isFinalLine = lines.slice(index + 1).every(rest => rest.trim() === "");
			if (isFinalLine) break; // torn tail: the write was interrupted
			logger.warn("Edit blackbox line is corrupt; skipping it", {
				path: editBlackboxPath(agentDir),
				line: index + 1,
			});
			continue;
		}
		if (typeof parsed.prev !== "string" || typeof parsed.new !== "string") continue;
		if (options?.path !== undefined && parsed.path !== options.path) continue;
		entries.push(parsed);
	}
	return options?.since === undefined ? entries : entries.slice(-options.since);
}

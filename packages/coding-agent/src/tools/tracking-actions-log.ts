/**
 * Bounded action log for project tracking (`<project>/.zeta/tracking/`).
 *
 * Rows used to be appended to a single unbounded `actions.jsonl`, and both
 * readers (the web gateway's tracking payload and `/tracking log`) slurped the
 * whole file. Rows now go through the shared size-rotating sink — 5 MB per
 * file, 3 files, rolled per local day — and readers share one bounded tail
 * read of the newest rows. Kept out of `tools/tracking.ts` so the gateway can
 * read the log without pulling in the tool, its prompt and the TUI.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { RotatingFileSink } from "@linxiraos/pi-utils/logger/rotating-file";
import { peekFileTail } from "@linxiraos/pi-utils/peek-file";

/** Row size at which the sink rolls over to the next file. */
export const TRACKING_ACTIONS_MAX_BYTES = 5 * 1024 * 1024;
/** Files kept per tracking directory; older ones are pruned on roll-over. */
export const TRACKING_ACTIONS_MAX_FILES = 3;
/** Ceiling for each reader's tail read — never the whole (rotated) log. */
export const TRACKING_ACTIONS_READ_MAX_BYTES = 1024 * 1024;

/**
 * Active-file names produced by {@link RotatingFileSink}:
 * `actions.<local day>.jsonl.log[.<roll-over index>]`. The index is absent on
 * the first file of a day.
 */
const ACTIONS_LOG_FILE_RE = /^actions\.(\d{4}-\d{2}-\d{2})\.jsonl\.log(?:\.(\d+))?$/;

/** One sink per tracking directory: it owns the active file's descriptor. */
const sinks = new Map<string, RotatingFileSink>();

function sinkFor(dir: string): RotatingFileSink {
	let sink = sinks.get(dir);
	if (!sink) {
		sink = new RotatingFileSink({
			directory: dir,
			filenamePrefix: "actions",
			filenameSuffix: "jsonl",
			maxBytes: TRACKING_ACTIONS_MAX_BYTES,
			maxFiles: TRACKING_ACTIONS_MAX_FILES,
		});
		sinks.set(dir, sink);
	}
	return sink;
}

/** Append one already-serialized JSONL row to the project action log. */
export function appendTrackingActionRow(dir: string, row: string): void {
	sinkFor(dir).write(row);
}

/** The action-log files of `dir` that exist right now, oldest first. */
export function trackingActionLogFiles(dir: string): string[] {
	let names: string[];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return [];
	}
	const ranked: { filePath: string; day: string; index: number }[] = [];
	for (const name of names) {
		const match = ACTIONS_LOG_FILE_RE.exec(name);
		if (!match) continue;
		ranked.push({ filePath: path.join(dir, name), day: match[1]!, index: match[2] ? Number(match[2]) : 0 });
	}
	ranked.sort((a, b) => (a.day === b.day ? a.index - b.index : a.day < b.day ? -1 : 1));
	return ranked.map(row => row.filePath);
}

/**
 * Judgeable lines of the newest rows the action log holds, oldest first — the
 * bounded tail read both readers share. Log files are walked newest first and
 * the walk stops once `maxBytes` has been taken; when a window does not cover
 * a file, its leading line is a truncated fragment and is dropped.
 */
export async function readTrackingActionRows(
	dir: string,
	maxBytes: number = TRACKING_ACTIONS_READ_MAX_BYTES,
): Promise<string[]> {
	const files = trackingActionLogFiles(dir);
	const segments: string[] = [];
	let remaining = maxBytes;
	for (let i = files.length - 1; i >= 0 && remaining > 0; i--) {
		const filePath = files[i]!;
		let size: number;
		try {
			size = fs.statSync(filePath).size;
		} catch {
			continue;
		}
		if (size <= 0) continue;
		const window = Math.min(remaining, size);
		const text = await peekFileTail(filePath, window, bytes => new TextDecoder().decode(bytes));
		remaining -= window;
		// `size > window` means the read started mid-file, so whatever precedes
		// the first newline is a truncated fragment (possibly the whole window).
		const firstNewline = size > window ? text.indexOf("\n") : -1;
		if (firstNewline === -1 && size > window) continue;
		segments.unshift(firstNewline === -1 ? text : text.slice(firstNewline + 1));
	}
	return segments
		.join("")
		.split("\n")
		.map(line => line.trim())
		.filter(Boolean);
}

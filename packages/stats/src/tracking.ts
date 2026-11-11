/**
 * Read-only project tracking snapshots for the stats dashboard.
 *
 * The tracking documents under `<project>/.zeta/tracking/` are written by the
 * coding agent's `tracking_update` tool; this module only reads them. It does
 * not import the agent package (types or implementation) and never creates,
 * repairs, or rewrites a tracking file.
 *
 * Reads are bounded per file and per directory, and every missing, truncated,
 * malformed or unreadable input is reported as such instead of being smoothed
 * into a plausible-looking status.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectTrackingDir } from "@linxiraos/pi-utils";
import { peekFileTail } from "@linxiraos/pi-utils/peek-file";
import type {
	TrackingActionRow,
	TrackingActionsSnapshot,
	TrackingSessionSnapshot,
	TrackingSnapshot,
	TrackingSnapshotState,
	TrackingStatusSnapshot,
	TrackingStatusValue,
	TrackingTextSnapshot,
} from "./shared-types";

const STATUS_FILE = "status.json";
const INDEX_FILE = "INDEX.md";
const SESSIONS_DIR = "sessions";
/** Pre-rotation single log; still read when present, then the rotated family. */
const LEGACY_ACTIONS_FILE = "actions.jsonl";
/** `actions.<local day>.jsonl.log[.<roll-over index>]` (see the agent's rotating sink). */
const ACTION_LOG_FILE_RE = /^actions\.(\d{4}-\d{2}-\d{2})\.jsonl\.log(?:\.(\d+))?$/;

/** Upper bounds for one snapshot; larger files are read partially and say so. */
export const TRACKING_READ_LIMITS = {
	statusBytes: 256 * 1024,
	indexBytes: 512 * 1024,
	sessionBytes: 256 * 1024,
	sessionFiles: 50,
	actionBytes: 1024 * 1024,
} as const;

interface HeadRead {
	text: string | null;
	size: number;
	mtimeMs: number;
	truncated: boolean;
	error: NodeJS.ErrnoException | null;
}

/** Read at most `maxBytes` from the start of a regular file (never a symlink). */
function readHead(filePath: string, maxBytes: number): HeadRead {
	try {
		const stat = fs.lstatSync(filePath);
		if (!stat.isFile()) {
			const error = new Error(`${filePath} is not a regular file`) as NodeJS.ErrnoException;
			error.code = "EINVAL";
			return { text: null, size: 0, mtimeMs: 0, truncated: false, error };
		}
		const length = Math.min(stat.size, maxBytes);
		const buffer = Buffer.alloc(length);
		if (length > 0) {
			const fd = fs.openSync(filePath, "r");
			try {
				fs.readSync(fd, buffer, 0, length, 0);
			} finally {
				fs.closeSync(fd);
			}
		}
		return { text: buffer.toString("utf8"), size: stat.size, mtimeMs: stat.mtimeMs, truncated: stat.size > maxBytes, error: null };
	} catch (error) {
		return { text: null, size: 0, mtimeMs: 0, truncated: false, error: error as NodeJS.ErrnoException };
	}
}

function readState(read: HeadRead, truncatedState: TrackingSnapshotState = "partial"): TrackingSnapshotState {
	if (read.error) return read.error.code === "ENOENT" ? "missing" : "error";
	return read.truncated ? truncatedState : "present";
}

function readError(read: HeadRead): string | null {
	return read.error ? read.error.message : null;
}

function textSnapshot(read: HeadRead): TrackingTextSnapshot {
	return {
		state: readState(read),
		content: read.error ? null : read.text,
		truncated: read.truncated,
		error: readError(read),
	};
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.map(String) : [];
}

/**
 * Validate the shape the agent writes. A top-level non-object or invalid JSON
 * is corrupt; wrong field types fall back to empty values, matching the tool's
 * own defaults instead of blanking the rest of the file.
 */
function parseStatus(text: string): { value: TrackingStatusValue | null; error: string | null } {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		return { value: null, error: error instanceof Error ? error.message : String(error) };
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { value: null, error: "status.json must be a JSON object" };
	}
	const record = raw as Record<string, unknown>;
	const phaseRows: unknown = record.phases;
	const phases = Array.isArray(phaseRows)
		? phaseRows.flatMap(row => {
				if (!row || typeof row !== "object") return [];
				if (!("name" in row) || !("status" in row)) return [];
				if (typeof row.name !== "string" || typeof row.status !== "string") return [];
				return [{ name: row.name, status: row.status }];
			})
		: undefined;
	return {
		value: {
			phase: String(record.phase ?? ""),
			progress: String(record.progress ?? ""),
			blockers: stringArray(record.blockers),
			decisions: stringArray(record.decisions),
			lastUpdated: String(record.lastUpdated ?? ""),
			...(typeof record.stage === "string" && record.stage !== "" ? { stage: record.stage } : {}),
			...(phases && phases.length > 0 ? { phases } : {}),
			...(typeof record.lastSessionId === "string" || record.lastSessionId === null
				? { lastSessionId: record.lastSessionId }
				: {}),
		},
		error: null,
	};
}

function readStatus(trackingDir: string): { snapshot: TrackingStatusSnapshot; mtimeMs: number } {
	const read = readHead(path.join(trackingDir, STATUS_FILE), TRACKING_READ_LIMITS.statusBytes);
	if (read.error) {
		return {
			snapshot: { state: readState(read), value: null, truncated: false, error: readError(read) },
			mtimeMs: read.mtimeMs,
		};
	}
	const parsed = parseStatus(read.text ?? "");
	if (!parsed.value) {
		return {
			snapshot: {
				state: read.truncated ? "partial" : "corrupt",
				value: null,
				truncated: read.truncated,
				error: parsed.error,
			},
			mtimeMs: read.mtimeMs,
		};
	}
	return {
		snapshot: {
			state: read.truncated ? "partial" : "present",
			value: parsed.value,
			truncated: read.truncated,
			error: null,
		},
		mtimeMs: read.mtimeMs,
	};
}

function readIndex(trackingDir: string): { snapshot: TrackingTextSnapshot; mtimeMs: number } {
	const read = readHead(path.join(trackingDir, INDEX_FILE), TRACKING_READ_LIMITS.indexBytes);
	return { snapshot: textSnapshot(read), mtimeMs: read.mtimeMs };
}

/** Oldest first: legacy `actions.jsonl`, then rotated day/index names. */
function actionLogFiles(trackingDir: string): string[] {
	let names: string[];
	try {
		names = fs.readdirSync(trackingDir);
	} catch {
		return [];
	}
	const ranked: { filePath: string; day: string; index: number }[] = [];
	for (const name of names) {
		if (name === LEGACY_ACTIONS_FILE) {
			ranked.push({ filePath: path.join(trackingDir, name), day: "", index: 0 });
			continue;
		}
		const match = ACTION_LOG_FILE_RE.exec(name);
		if (!match) continue;
		ranked.push({ filePath: path.join(trackingDir, name), day: match[1]!, index: match[2] ? Number(match[2]) : 0 });
	}
	ranked.sort((a, b) => (a.day === b.day ? a.index - b.index : a.day < b.day ? -1 : 1));
	return ranked.map(row => row.filePath);
}

/** Bounded tail read of every action-log generation, oldest first. */
async function readActions(trackingDir: string): Promise<TrackingActionsSnapshot> {
	const files = actionLogFiles(trackingDir);
	if (files.length === 0) return { state: "missing", rows: [], truncated: false, invalidRows: 0, error: null };

	const segments: string[] = [];
	const errors: string[] = [];
	let remaining = TRACKING_READ_LIMITS.actionBytes;
	let truncated = false;
	for (let i = files.length - 1; i >= 0; i--) {
		const filePath = files[i]!;
		try {
			const stat = fs.lstatSync(filePath);
			if (!stat.isFile()) {
				errors.push(`${path.basename(filePath)} is not a regular file`);
				continue;
			}
			if (remaining <= 0) {
				truncated = true;
				break;
			}
			if (stat.size <= 0) continue;
			const window = Math.min(remaining, stat.size);
			if (window < stat.size) truncated = true;
			const text = await peekFileTail(filePath, window, bytes => new TextDecoder().decode(bytes));
			remaining -= window;
			// A window starting mid-file begins in a truncated fragment.
			const firstNewline = window < stat.size ? text.indexOf("\n") : -1;
			if (firstNewline === -1 && window < stat.size) continue;
			segments.unshift(firstNewline === -1 ? text : text.slice(firstNewline + 1));
		} catch (error) {
			errors.push(`${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	const rows: TrackingActionRow[] = [];
	let invalidRows = 0;
	for (const line of segments.join("").split("\n").map(value => value.trim()).filter(Boolean)) {
		try {
			const parsed = JSON.parse(line) as Partial<TrackingActionRow> | null;
			if (!parsed || typeof parsed !== "object" || typeof parsed.action !== "string") {
				invalidRows++;
				continue;
			}
			rows.push({
				timestamp: String(parsed.timestamp ?? ""),
				action: parsed.action,
				...(parsed.detail !== undefined ? { detail: String(parsed.detail) } : {}),
			});
		} catch {
			invalidRows++;
		}
	}

	let state: TrackingSnapshotState;
	if (errors.length > 0) state = rows.length > 0 ? "partial" : "error";
	else if (invalidRows > 0) state = rows.length > 0 ? "partial" : "corrupt";
	else state = "present";
	return {
		state,
		rows,
		truncated,
		invalidRows,
		error: errors.length > 0 ? errors.join("; ") : null,
	};
}

/** Newest sessions first, up to the read limit; each file is bounded. */
function readSessions(trackingDir: string): {
	state: TrackingSnapshotState;
	sessions: TrackingSessionSnapshot[];
	mtimeMs: number;
	error: string | null;
} {
	const dir = path.join(trackingDir, SESSIONS_DIR);
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return {
			state: code === "ENOENT" ? "missing" : "error",
			sessions: [],
			mtimeMs: 0,
			error: code === "ENOENT" ? null : error instanceof Error ? error.message : String(error),
		};
	}

	const files: { filePath: string; name: string; mtimeMs: number }[] = [];
	const errors: string[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const filePath = path.join(dir, entry.name);
		try {
			const stat = fs.lstatSync(filePath);
			if (!stat.isFile()) continue;
			files.push({ filePath, name: entry.name, mtimeMs: stat.mtimeMs });
		} catch (error) {
			errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	files.sort((a, b) => b.mtimeMs - a.mtimeMs);
	const kept = files.slice(0, TRACKING_READ_LIMITS.sessionFiles);
	const sessions = kept.map(file => {
		const read = readHead(file.filePath, TRACKING_READ_LIMITS.sessionBytes);
		return { name: file.name, ...textSnapshot(read) };
	});
	const newest = files.length > 0 ? files[0]!.mtimeMs : 0;
	const state: TrackingSnapshotState =
		errors.length > 0 || sessions.some(session => session.state === "partial" || session.state === "error")
			? "partial"
			: "present";
	return { state, sessions, mtimeMs: newest, error: errors.length > 0 ? errors.join("; ") : null };
}

/**
 * Exact registry label. The label is an opaque database key, never a path, so
 * the caller cannot smuggle traversal into it; the server resolves the label to
 * a session-header cwd before calling {@link readTrackingSnapshot}.
 */
export function isTrackableProject(project: string, known: readonly string[]): boolean {
	return known.includes(project);
}

/** Read one project's tracking documents without writing anything. */
export async function readTrackingSnapshot(cwd: string, project = cwd): Promise<TrackingSnapshot> {
	if (!path.isAbsolute(cwd)) throw new Error("tracking cwd must be an absolute path");
	const trackingDir = getProjectTrackingDir(cwd);
	const missing = (): TrackingSnapshot => ({
		project,
		trackingDir,
		exists: false,
		updatedAt: null,
		status: { state: "missing", value: null, truncated: false, error: null },
		index: { state: "missing", content: null, truncated: false, error: null },
		actions: { state: "missing", rows: [], truncated: false, invalidRows: 0, error: null },
		sessions: [],
		sessionsState: "missing",
	});

	let dirStat: fs.Stats;
	try {
		dirStat = fs.lstatSync(trackingDir);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return missing();
		return {
			...missing(),
			status: { state: "error", value: null, truncated: false, error: String((error as Error).message) },
		};
	}
	if (!dirStat.isDirectory()) return missing();

	const status = readStatus(trackingDir);
	const index = readIndex(trackingDir);
	const actions = await readActions(trackingDir);
	const sessions = readSessions(trackingDir);
	const newest = Math.max(
		status.mtimeMs,
		index.mtimeMs,
		newestActionMtime(trackingDir),
		sessions.mtimeMs,
	);
	return {
		project,
		trackingDir,
		exists: true,
		updatedAt: newest > 0 ? new Date(newest).toISOString() : null,
		status: status.snapshot,
		index: index.snapshot,
		actions,
		sessions: sessions.sessions,
		sessionsState: sessions.state,
	};
}

/** Newest mtime among the action-log generations (even when every row is malformed). */
function newestActionMtime(trackingDir: string): number {
	let newest = 0;
	for (const filePath of actionLogFiles(trackingDir)) {
		try {
			const stat = fs.lstatSync(filePath);
			if (stat.isFile() && stat.mtimeMs > newest) newest = stat.mtimeMs;
		} catch {
			// ignore a file that disappeared mid-read
		}
	}
	return newest;
}

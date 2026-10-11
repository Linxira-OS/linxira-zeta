/**
 * Workspace persistence for the desktop shell.
 *
 * Lives at `<userData>/workspace-state.json` and records:
 *   - the last window bounds (+ maximized flag), restored on next launch
 *   - a bounded history of tool launches (zetacode / zetaide / zetaeditor),
 *     including the per-launch zetacode session directory used for `--resume`
 *
 * Writes are atomic (temp file + same-dir rename), mirroring
 * `writeDesktopSettingsAtomic` in session-monitor.ts.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const WORKSPACE_STATE_FILE = "workspace-state.json";

export const MAX_LAUNCH_RECORDS = 50;

export const TOOL_IDS = ["zetacode", "zetaide", "zetaeditor"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export function isToolId(value: unknown): value is ToolId {
	return typeof value === "string" && (TOOL_IDS as readonly string[]).includes(value);
}

export interface WindowBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LaunchRecord {
	tool: ToolId;
	cwd: string;
	pid: number | null;
	/** ISO-8601 timestamp of the spawn. */
	ts: string;
	/** zetacode only: the isolated session directory used for this launch. */
	sessionDir?: string;
}

export interface WorkspaceState {
	version: 1;
	bounds: WindowBounds | null;
	maximized: boolean;
	launches: LaunchRecord[];
}

export const DEFAULT_WORKSPACE_STATE: Readonly<WorkspaceState> = {
	version: 1,
	bounds: null,
	maximized: false,
	launches: [],
};

export function parseWindowBounds(value: unknown): WindowBounds | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Record<string, unknown>;
	const { x, y, width, height } = candidate;
	if (
		typeof x !== "number" ||
		typeof y !== "number" ||
		typeof width !== "number" ||
		typeof height !== "number" ||
		!Number.isFinite(x) ||
		!Number.isFinite(y) ||
		!Number.isFinite(width) ||
		!Number.isFinite(height)
	) {
		return null;
	}
	if (width <= 0 || height <= 0) return null;
	return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function parseLaunchRecord(value: unknown): LaunchRecord | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Record<string, unknown>;
	if (!isToolId(candidate.tool)) return null;
	if (typeof candidate.cwd !== "string" || candidate.cwd.length === 0) return null;
	if (typeof candidate.ts !== "string" || candidate.ts.length === 0) return null;
	const pid = typeof candidate.pid === "number" && Number.isFinite(candidate.pid) ? candidate.pid : null;
	const sessionDir = typeof candidate.sessionDir === "string" && candidate.sessionDir.length > 0 ? candidate.sessionDir : undefined;
	return { tool: candidate.tool, cwd: candidate.cwd, pid, ts: candidate.ts, sessionDir };
}

/** Whitelist rebuild: malformed JSON or unexpected fields fall back to defaults. */
export function parseWorkspaceState(raw: string): WorkspaceState {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ...DEFAULT_WORKSPACE_STATE, launches: [] };
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ...DEFAULT_WORKSPACE_STATE, launches: [] };
	}
	const record = parsed as Record<string, unknown>;
	const bounds = parseWindowBounds(record.bounds);
	const maximized = typeof record.maximized === "boolean" ? record.maximized : false;
	const launches = Array.isArray(record.launches)
		? record.launches.map(parseLaunchRecord).filter((entry): entry is LaunchRecord => entry !== null).slice(-MAX_LAUNCH_RECORDS)
		: [];
	return { version: 1, bounds, maximized, launches };
}

export function readWorkspaceState(dir: string): WorkspaceState {
	try {
		return parseWorkspaceState(fs.readFileSync(path.join(dir, WORKSPACE_STATE_FILE), "utf8"));
	} catch {
		return { ...DEFAULT_WORKSPACE_STATE, launches: [] };
	}
}

export function writeWorkspaceStateAtomic(dir: string, state: WorkspaceState): void {
	fs.mkdirSync(dir, { recursive: true });
	const target = path.join(dir, WORKSPACE_STATE_FILE);
	const temp = `${target}.${crypto.randomUUID()}.tmp`;
	fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	fs.renameSync(temp, target);
}

/** Append a launch record and truncate to the most recent MAX_LAUNCH_RECORDS. */
export function withLaunch(state: WorkspaceState, record: LaunchRecord): WorkspaceState {
	return { ...state, launches: [...state.launches, record].slice(-MAX_LAUNCH_RECORDS) };
}

/** Most recent zetacode launch for `cwd` that carries a session directory. */
export function lastZetacodeLaunch(state: WorkspaceState, cwd: string): LaunchRecord | null {
	for (let i = state.launches.length - 1; i >= 0; i--) {
		const launch = state.launches[i];
		if (launch.tool === "zetacode" && launch.cwd === cwd && launch.sessionDir) return launch;
	}
	return null;
}

/**
 * A bounds rect is trustworthy only when it lands inside some display's
 * work area (at least `minVisiblePx` visible on each axis) and clears the
 * minimum window size; otherwise fall back to a fresh default position.
 */
export function isBoundsValid(bounds: WindowBounds | null, workAreas: WindowBounds[], minVisiblePx = 80): bounds is WindowBounds {
	if (!bounds) return false;
	if (workAreas.length === 0) return true;
	return workAreas.some(area => {
		const overlapX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
		const overlapY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
		return overlapX >= minVisiblePx && overlapY >= minVisiblePx;
	});
}

/** Newest *.jsonl session file in `sessionDir`, or null when none/unreadable. */
export function newestSessionFile(sessionDir: string): string | null {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(sessionDir, { withFileTypes: true });
	} catch {
		return null;
	}
	let newest: { file: string; mtimeMs: number } | null = null;
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
		const full = path.join(sessionDir, entry.name);
		try {
			const stat = fs.statSync(full);
			if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { file: full, mtimeMs: stat.mtimeMs };
		} catch {
			// Skip unreadable entries.
		}
	}
	return newest ? newest.file : null;
}

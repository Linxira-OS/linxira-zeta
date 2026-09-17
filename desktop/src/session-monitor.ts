/**
 * Desktop session-completion monitor helpers.
 *
 * Pure, Electron-free logic for polling the gateway's lightweight
 * /api/agent/running snapshot (shape: `{ runningSessionIds: string[] }`,
 * same as the upstream web UI route) and deriving running→idle transitions
 * ("session finished"). Also hosts the userData/desktop-settings.json
 * persistence (atomic write, whitelist parse). Kept free of Electron imports
 * so node:test can exercise it directly (see scripts/session-monitor.test.mjs).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Response shape of GET /api/agent/running. */
export interface RunningSessionsResponse {
	runningSessionIds: string[];
}

export type SessionRunState = "running" | "idle";

export interface SessionTransition {
	id: string;
	from: SessionRunState;
	to: SessionRunState;
}

/**
 * Parse a /api/agent/running payload; returns null for anything that is not
 * the expected object shape so the poller can treat it as "unreachable" and
 * silently retry. Non-string / empty ids are dropped instead of failing the
 * whole snapshot.
 */
export function parseRunningSessions(body: unknown): RunningSessionsResponse | null {
	if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
	if (!("runningSessionIds" in body)) return null;
	const ids: unknown = body.runningSessionIds;
	if (!Array.isArray(ids)) return null;
	const runningSessionIds: string[] = [];
	for (const id of ids) {
		if (typeof id === "string" && id.length > 0) runningSessionIds.push(id);
	}
	return { runningSessionIds };
}

/**
 * Diff two running-id snapshots (order- and duplicate-insensitive):
 * present in prev but not next → running→idle (finished); the reverse →
 * idle→running (started). Output is sorted by session id.
 */
export function diffTransitions(prev: readonly string[], next: readonly string[]): SessionTransition[] {
	const prevSet = new Set(prev);
	const nextSet = new Set(next);
	const transitions: SessionTransition[] = [];
	for (const id of prevSet) {
		if (!nextSet.has(id)) transitions.push({ id, from: "running", to: "idle" });
	}
	for (const id of nextSet) {
		if (!prevSet.has(id)) transitions.push({ id, from: "idle", to: "running" });
	}
	transitions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return transitions;
}

/**
 * Stateful tracker across polls. The first snapshot after creation/reset is
 * a baseline (no transitions), so the shell never notifies for sessions that
 * were already running before it started watching.
 */
export class RunningSessionsTracker {
	#prev: Set<string> | null = null;

	update(next: readonly string[]): SessionTransition[] {
		const prev = this.#prev;
		this.#prev = new Set(next);
		if (prev === null) return [];
		return diffTransitions([...prev], next);
	}

	/**
	 * Forget the baseline. Used while the gateway is unreachable, so a service
	 * restart does not replay completions that happened while offline.
	 */
	reset(): void {
		this.#prev = null;
	}
}

/** Tray tooltip: shows the running-session count, plain name at zero. */
export function runningTooltip(runningCount: number, base = "Zeta"): string {
	if (!Number.isInteger(runningCount) || runningCount <= 0) return base;
	return `${base} — ${runningCount} running session${runningCount === 1 ? "" : "s"}`;
}

/** Build an id→name map from the gateway's /api/sessions response; tolerant
 *  of unexpected shapes (used to title completion notifications). */
export function parseSessionNames(body: unknown): Map<string, string> {
	const names = new Map<string, string>();
	if (body === null || typeof body !== "object" || Array.isArray(body)) return names;
	if (!("sessions" in body)) return names;
	const sessions: unknown = body.sessions;
	if (!Array.isArray(sessions)) return names;
	for (const session of sessions) {
		if (session === null || typeof session !== "object") continue;
		if (!("id" in session) || !("name" in session)) continue;
		const id: unknown = session.id;
		const name: unknown = session.name;
		if (typeof id === "string" && id.length > 0 && typeof name === "string" && name.length > 0) {
			names.set(id, name);
		}
	}
	return names;
}

// ---------------------------------------------------------------------------
// userData/desktop-settings.json
// ---------------------------------------------------------------------------

export interface DesktopSettings {
	notifications: boolean;
}

export const DEFAULT_DESKTOP_SETTINGS: Readonly<DesktopSettings> = { notifications: true };

const DESKTOP_SETTINGS_FILE = "desktop-settings.json";

/** Whitelist rebuild (reference shell pattern): malformed JSON or unexpected
 *  field types fall back to defaults instead of polluting runtime. */
export function parseDesktopSettings(raw: string): DesktopSettings {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ...DEFAULT_DESKTOP_SETTINGS };
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ...DEFAULT_DESKTOP_SETTINGS };
	}
	if (!("notifications" in parsed)) return { ...DEFAULT_DESKTOP_SETTINGS };
	const notifications: unknown = parsed.notifications;
	return {
		notifications: typeof notifications === "boolean" ? notifications : DEFAULT_DESKTOP_SETTINGS.notifications,
	};
}

/** Read settings; defaults when the file is missing or unreadable. */
export function readDesktopSettings(dir: string): DesktopSettings {
	try {
		return parseDesktopSettings(fs.readFileSync(path.join(dir, DESKTOP_SETTINGS_FILE), "utf8"));
	} catch {
		return { ...DEFAULT_DESKTOP_SETTINGS };
	}
}

/**
 * Persist settings atomically: write a uniquely-named temp file in the same
 * directory, then rename over the target (same-volume rename is atomic on all
 * supported platforms, so a crash can never leave a half-written file).
 */
export function writeDesktopSettingsAtomic(dir: string, settings: DesktopSettings): void {
	fs.mkdirSync(dir, { recursive: true });
	const target = path.join(dir, DESKTOP_SETTINGS_FILE);
	const temp = `${target}.${crypto.randomUUID()}.tmp`;
	fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	fs.renameSync(temp, target);
}

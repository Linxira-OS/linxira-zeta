/**
 * Terminal slots per workspace (P1: default workbench + reattach).
 *
 * The gateway reattaches a PTY by `(absolute cwd, instance id)` — see
 * `POST /api/terminal/ensure` in the gateway's `web-gateway/terminal.ts`. This
 * module owns the UI half of that contract:
 *
 *   - **Instance ids** are allocated here, one run per workspace: the first slot
 *     of a workspace is always `t1`, and "New terminal" takes `t{max + 1}` over
 *     the ids the workspace has seen. Numbers are never reused, so a slot that
 *     died can never collide with the PTY still living under the old key.
 *   - **Workspace keys** normalise a cwd (trim, `\` → `/`, no trailing slash,
 *     lower-cased on Windows-style drives) so the same directory reached
 *     through different spellings maps to one slot set. Switching workspaces
 *     therefore switches keys, and no session is ever shared between them.
 *   - **sessionIds** remembers the last session a slot resumed, which is how
 *     the pane tells "reconnected to the same PTY" (id unchanged) from "the
 *     gateway lost it — this is a fresh one" (id changed after a restart).
 *
 * Pure state transitions; `localStorage` I/O is guarded so SSR and private
 * modes degrade to in-memory state.
 */

export interface WorkspaceTerminalSlots {
	/** Instance ids in creation order; `instances[0]` is the default slot. */
	instances: string[];
	/** Slot the pane currently shows. */
	active: string;
	/** Last session id seen per slot (reattach/“ended” detection). */
	sessionIds: Record<string, string>;
}

/** Workspace key → its slots. */
export type TerminalSlotsState = Record<string, WorkspaceTerminalSlots>;

export const TERMINAL_SLOTS_STORAGE_KEY = "zeta.terminal.slots.v1";

/** First slot of every workspace. */
export const FIRST_TERMINAL_INSTANCE = "t1";

/**
 * Slot-set key for a cwd. `null`/empty means "gateway default cwd" and gets its
 * own bucket rather than sharing with any real directory.
 */
export function terminalWorkspaceKey(cwd: string | null | undefined): string {
	const trimmed = (cwd ?? "").trim();
	if (trimmed === "") return "";
	let normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
	if (/^[A-Za-z]:/.test(normalized)) normalized = normalized.toLowerCase();
	return normalized;
}

/** Next slot id for a workspace: `t1`, then max + 1 (never reuses a number). */
export function nextTerminalInstance(instances: readonly string[]): string {
	let max = 0;
	for (const id of instances) {
		const match = /^t(\d+)$/.exec(id);
		if (match) max = Math.max(max, Number(match[1]));
	}
	return `t${max + 1}`;
}

function emptySlots(): WorkspaceTerminalSlots {
	return { instances: [FIRST_TERMINAL_INSTANCE], active: FIRST_TERMINAL_INSTANCE, sessionIds: {} };
}

function isSlots(value: unknown): value is WorkspaceTerminalSlots {
	if (value === null || typeof value !== "object") return false;
	const candidate = value as Partial<WorkspaceTerminalSlots>;
	return (
		Array.isArray(candidate.instances) &&
		candidate.instances.every(id => typeof id === "string") &&
		typeof candidate.active === "string" &&
		candidate.sessionIds !== null &&
		typeof candidate.sessionIds === "object"
	);
}

/** Parse a persisted blob; anything malformed collapses to an empty state. */
export function parseTerminalSlots(raw: string | null): TerminalSlotsState {
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const state: TerminalSlotsState = {};
		for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (isSlots(value) && value.instances.length > 0) state[key] = value;
		}
		return state;
	} catch {
		return {};
	}
}

/** Slot set for a workspace, materialising the default slot on first use. */
export function slotsFor(state: TerminalSlotsState, key: string): WorkspaceTerminalSlots {
	const existing = state[key];
	if (existing && existing.instances.length > 0) return existing;
	return emptySlots();
}

/** Switch the visible slot; unknown ids fall back to the current one. */
export function withActiveInstance(state: TerminalSlotsState, key: string, instanceId: string): TerminalSlotsState {
	const slots = slotsFor(state, key);
	if (!slots.instances.includes(instanceId)) return state;
	return { ...state, [key]: { ...slots, active: instanceId } };
}

/** Allocate a new slot for an explicit "New terminal" and make it active. */
export function withNewInstance(
	state: TerminalSlotsState,
	key: string,
): { state: TerminalSlotsState; instanceId: string } {
	const slots = slotsFor(state, key);
	const instanceId = nextTerminalInstance(slots.instances);
	return { state: { ...state, [key]: { ...slots, instances: [...slots.instances, instanceId], active: instanceId } }, instanceId };
}

/** Record the session a slot resumed, for later reattach detection. */
export function withSessionId(
	state: TerminalSlotsState,
	key: string,
	instanceId: string,
	sessionId: string,
): TerminalSlotsState {
	const slots = slotsFor(state, key);
	return { ...state, [key]: { ...slots, sessionIds: { ...slots.sessionIds, [instanceId]: sessionId } } };
}

/** Forget a slot's session after an explicit stop (no "ended" notice next open). */
export function withoutSessionId(state: TerminalSlotsState, key: string, instanceId: string): TerminalSlotsState {
	const slots = slotsFor(state, key);
	if (!(instanceId in slots.sessionIds)) return state;
	const sessionIds = { ...slots.sessionIds };
	delete sessionIds[instanceId];
	return { ...state, [key]: { ...slots, sessionIds } };
}

/** Persisted state, or `{}` when storage is unavailable/empty. */
export function loadTerminalSlots(): TerminalSlotsState {
	if (typeof window === "undefined") return {};
	try {
		return parseTerminalSlots(window.localStorage.getItem(TERMINAL_SLOTS_STORAGE_KEY));
	} catch {
		return {};
	}
}

/** Best-effort persist; a full/blocked store must not break the pane. */
export function saveTerminalSlots(state: TerminalSlotsState): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(TERMINAL_SLOTS_STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Storage disabled (private mode, quota): slots stay in React state.
	}
}

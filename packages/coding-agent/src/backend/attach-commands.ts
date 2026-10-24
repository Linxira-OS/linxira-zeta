/**
 * Slash-command routing for a TUI attached to a backend-owned session.
 *
 * Three tiers:
 *
 * 1. **local** — client-only display/settings commands and the mirrored replica
 *    switches; they run in the attached process.
 * 2. **forwarded** — every other builtin with a headless handler, plus custom
 *    commands and prompt templates; the backend executes them against its own
 *    session (the same path ACP uses).
 * 3. **refused** — commands that would swap the backend's session, write
 *    credentials it already loaded, or spawn agents in the replica.
 *
 * The tables live here (not in the TUI controller) so the lightweight
 * `zetacode attach` client enforces the same contract.
 */

/** Commands that stay local while the model session lives on a backend. */
export const BACKEND_ATTACH_LOCAL_COMMANDS: Record<string, true> = {
	exit: true,
	quit: true,
	help: true,
	hotkeys: true,
	theme: true,
	settings: true,
	copy: true,
	export: true,
	dump: true,
	// Client-side only: the language catalogue, the dynamic-tool settings
	// (`/tool`, `/time`, `/tracking` write config the backend's settings watcher
	// re-gates), the changelog, and the local dashboards that read git/stats.
	language: true,
	tool: true,
	time: true,
	tracking: true,
	changelog: true,
	stats: true,
	git: true,
	// Backend-session dashboards. `/agents` and `/hub` are TUI-only, so their
	// data arrives through the backend subagent roster mirror (see
	// `backend/subagent-mirror.ts`); `/skills` and `/extensions` read the shared
	// config the backend also loaded. `/tools`, `/context`, `/usage` and `/jobs`
	// are *not* here: their headless handlers read the backend session (the
	// replica has no tools/jobs/context of its own), so forwarding is the only
	// correct route.
	agents: true,
	skills: true,
	extensions: true,
	// Display-only overlays and client-side capture. `pause` freezes the local
	// renderer, `hub` reads the mirrored agent tree, `record` writes the TUI
	// transcript on this machine, and `open`/`debug` never touch the backend.
	hub: true,
	pause: true,
	record: true,
	open: true,
	debug: true,
};

/**
 * Commands whose effect is a replica state change that `BackendAttachLink`
 * mirrors over the control plane (`model_changed`, `thinking_level_changed`,
 * `state_version_changed`). They run locally so the TUI shows the same
 * selector/picker as a local session; the wire command follows the event.
 */
export const BACKEND_ATTACH_MIRRORED_COMMANDS: Record<string, true> = {
	model: true,
	modelpreset: true,
	switch: true,
	effort: true,
	// `/fast` and `/slow` deliberately stay out: their headless handlers set the
	// backend session's tier, while the replica has no event that would mirror a
	// local toggle back. `/plan`, `/goal` and `/vibe` stay here because the TUI
	// pickers/menus need the replica's mode state; the input controller reroutes
	// every form that changes the backend to `mode_enter`/`goal` RPCs.
	plan: true,
	"plan-ultra": true,
	"plan-review": true,
	goal: true,
	vibe: true,
};

/**
 * Commands an attach client cannot apply to a backend-owned session:
 *
 * - sharing (`collab`, `join`, `leave`) belongs to the backend's process;
 * - live voice (`live`) binds the backend host's microphone/speaker and has no
 *   client-side audio bridge yet;
 * - guided goal is a TUI interview that still runs only in the owning process.
 *
 * `/setup` is retired globally, so it is deliberately forwarded: the backend
 * returns the retirement message instead of an attach-specific refusal.
 *
 * `/loop`, `/cleanse`, `/seance`, `/omfg` and `/tan` are *not* here: each has
 * a headless handler that runs against the backend session (the same path ACP
 * and RPC use), so an attached client forwards it instead of spawning work in
 * the replica.
 */
export const BACKEND_ATTACH_REFUSED_COMMANDS: Record<string, true> = {
	collab: true,
	join: true,
	leave: true,
	live: true,
	"guided-goal": true,
};

/**
 * Whether a slash command runs in the attached TUI itself instead of being
 * forwarded: client-only commands and the mirrored replica switches.
 */
export function isBackendAttachLocalCommand(verb: string | undefined): boolean {
	if (verb === undefined) return false;
	return BACKEND_ATTACH_LOCAL_COMMANDS[verb] === true || BACKEND_ATTACH_MIRRORED_COMMANDS[verb] === true;
}

/** Whether the attach client must refuse a command it cannot apply remotely. */
export function isBackendAttachRefusedCommand(verb: string | undefined): boolean {
	if (verb === undefined) return false;
	return BACKEND_ATTACH_REFUSED_COMMANDS[verb] === true;
}

/** The actionable half of a refusal: which local command does the same thing. */
export function backendAttachRefusalHint(verb: string): string {
	if (verb === "guided-goal") {
		return "the guided-goal interview is TUI-only; run it from the terminal that owns the backend session";
	}
	if (verb === "collab" || verb === "join" || verb === "leave") {
		return "live sharing is disabled pending review; use /share for a static GitHub transcript";
	}
	return "run it from the terminal that owns the backend session";
}

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
	// Read-only dashboards over the mirrored replica: they render the same
	// surfaces a local session shows and never mutate it.
	tools: true,
	context: true,
	agents: true,
	skills: true,
	extensions: true,
	status: true,
	usage: true,
	jobs: true,
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
	fast: true,
	slow: true,
	plan: true,
	"plan-ultra": true,
	"plan-review": true,
	"guided-goal": true,
	goal: true,
	vibe: true,
};

/**
 * Commands an attach client cannot apply to a backend-owned session:
 *
 * - a process restart (`restart`) must be done by the backend's host;
 * - setup writes credentials the running backend does not reload;
 * - credentials (`login`, `logout`, `setup`) are loaded by the backend at
 *   startup;
 * - sharing (`collab`, `join`, `leave`) belongs to the backend's process;
 * - TUI-only workflows (`loop`, `omfg`, `cleanse`, `tan`, `seance`, `live`)
 *   spawn agents or record on the client.
 */
export const BACKEND_ATTACH_REFUSED_COMMANDS: Record<string, true> = {
	collab: true,
	join: true,
	leave: true,
	live: true,
	loop: true,
	omfg: true,
	cleanse: true,
	restart: true,
	seance: true,
	setup: true,
	tan: true,
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
	if (verb === "restart") {
		return "restart the backend from its host: `zetacode daemon restart` (or stop and start `zetacode serve`)";
	}
	if (verb === "setup") {
		return "run `zetacode setup` on the backend host, then restart it so it loads the new credentials";
	}
	if (verb === "collab" || verb === "join" || verb === "leave") {
		return "sharing starts from the process that owns the session";
	}
	return "run it from the terminal that owns the backend session";
}

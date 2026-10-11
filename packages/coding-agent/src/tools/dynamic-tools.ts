/**
 * Dynamic small-tool framework.
 *
 * A dynamic tool is an ordinary built-in tool whose feature state is toggled at
 * runtime via `/tool <name> on|off` (persisted as entries of the
 * `session.dynamicTools` record setting). Its capability (not its presence) is
 * gated on that entry — the `time` tool stays registered even while injection is
 * off so the model can switch it back on with `action: "on"`. Each successful
 * toggle also injects a one-line, model-visible system notice so the agent
 * learns the capability appeared or vanished; a live session reconciles its
 * built-ins when the setting changes because `cfgBuiltinToolGates` includes it.
 */
import { M } from "../i18n";
import type { Settings } from "../config/settings";
import { cfgSessionDynamicTools, cfgSessionTimeInjectEvery } from "./settings";
import { sendTimestampLine } from "./time";

/** Registered dynamic tool category. */
export interface DynamicToolCategory {
	/** Tool name as registered in `BUILTIN_TOOLS` and `BUILTIN_TOOL_NAMES`. */
	name: string;
	label: string;
	/** One-line capability sentence used by the enable notice (active catalogue). */
	capability: () => string;
}

/** Every dynamic tool category, keyed by tool name. */
export const DYNAMIC_TOOL_CATEGORIES: Readonly<Record<string, DynamicToolCategory>> = {
	time: { name: "time", label: "Time", capability: () => M.timeCapability },
};

/** Whether `name` is a registered dynamic tool category. */
export function isDynamicToolName(name: string): boolean {
	return Object.hasOwn(DYNAMIC_TOOL_CATEGORIES, name);
}

/** Whether the dynamic tool `name` is currently enabled for `settings`. */
export function isDynamicToolEnabled(scope: Settings, name: string): boolean {
	return cfgSessionDynamicTools.get(scope)[name] === true;
}

/** Toggle one dynamic tool entry in the persisted `session.dynamicTools` record. */
export function setDynamicToolEnabled(scope: Settings, name: string, enabled: boolean): void {
	cfgSessionDynamicTools.setEntry(scope, name, enabled);
}

/** Custom-message type carrying dynamic-tool toggle notices to the model. */
export const DYNAMIC_TOOL_NOTICE_TYPE = "dynamic-tool-notice";

/**
 * Custom-message type carrying the periodic tool-call time injection.
 *
 * A distinct sibling of {@link DYNAMIC_TOOL_NOTICE_TYPE} because the payload is
 * time only — no capability sentence and no toggle wording — so surfaces must
 * not mistake it for an enable/disable notice.
 */
export const TIME_INJECT_NOTICE_TYPE = "time-inject-notice";

/** Session modes whose enabled state names the "current mode" in toggle notices. */
const NOTICE_MODE_IDS = ["plan", "goal", "vibe"] as const;

export type DynamicToolModeId = (typeof NOTICE_MODE_IDS)[number];

/** First enabled mode on `session` (via `AgentSession.getModeState`), if any. */
export function activeModeId(session: {
	getModeState(mode: string): { enabled?: boolean } | undefined;
}): DynamicToolModeId | undefined {
	for (const mode of NOTICE_MODE_IDS) {
		if (session.getModeState(mode)?.enabled) return mode;
	}
	return undefined;
}

/** Fill a `%s`-style catalogue template left to right. */
export function formatMessage(template: string, ...values: string[]): string {
	let index = 0;
	return template.replace(/%s/g, () => values[index++] ?? "");
}

/** The one-line model-visible notice for a successful toggle of `name`. */
export function buildDynamicToolNotice(name: string, enabled: boolean, mode: DynamicToolModeId | undefined): string {
	const category = DYNAMIC_TOOL_CATEGORIES[name];
	if (enabled) {
		return formatMessage(
			M.dynamicToolEnabledFmt,
			name,
			category?.capability() ?? "",
			mode ?? M.dynamicToolModeDefault,
		);
	}
	return formatMessage(M.dynamicToolDisabledFmt, name);
}

export type DynamicToolToggleResult = { error: string } | { name: string; enabled: boolean; changed: boolean };

/**
 * Effective tool-call interval between `time` injections for `settings`: the
 * persisted `session.timeInjectEvery`, clamped to an integer >= 1 so a
 * hand-edited config cannot disable the feature by writing 0 or a fraction.
 */
export function timeInjectInterval(settings: Settings): number {
	const raw = cfgSessionTimeInjectEvery.get(settings);
	return Number.isFinite(raw) && raw >= 1 ? Math.trunc(raw) : 1;
}

/**
 * Operator status line for the time injection feature: on/off state, the
 * tool-call interval, and the last-injection policy. Shared by the `/time`
 * command and the `time` tool's `status` action so both read identically.
 */
export function buildTimeStatusLine(settings: Settings): string {
	return [
		`time: ${isDynamicToolEnabled(settings, "time") ? "on" : "off"}`,
		formatMessage(M.timeStatusIntervalFmt, String(timeInjectInterval(settings))),
		M.timeStatusPolicy,
	].join("\n");
}

/**
 * Apply `/tool <name> on|off` to `settings`. Returns the parsed outcome; the
 * caller owns the operator status line and the model notice (which needs the
 * session's active mode).
 */
export function toggleDynamicTool(settings: Settings, args: string): DynamicToolToggleResult {
	const [name, action, ...rest] = args.trim().split(/\s+/).filter(Boolean);
	if (!name || !action || rest.length > 0 || (action !== "on" && action !== "off")) {
		return { error: M.dynamicToolUsage };
	}
	if (!isDynamicToolName(name)) {
		return {
			error: formatMessage(M.dynamicToolUnknownFmt, name, Object.keys(DYNAMIC_TOOL_CATEGORIES).join(", ")),
		};
	}
	const enabled = action === "on";
	const changed = isDynamicToolEnabled(settings, name) !== enabled;
	if (changed) setDynamicToolEnabled(settings, name, enabled);
	return { name, enabled, changed };
}

/**
 * Stamp a genuine user submission with its send instant while the dynamic
 * `time` tool is enabled. Synthetic (agent-initiated) prompts and explicit
 * agent attributions pass through unchanged; the line is formatted once, in
 * the machine's local zone.
 */
export function applyTimeSendTimestamp(
	settings: Settings,
	text: string,
	options: { synthetic?: boolean; attribution?: string; now?: Date },
): string {
	if (options.synthetic || options.attribution === "agent" || !isDynamicToolEnabled(settings, "time")) return text;
	return `${text}\n${sendTimestampLine(options.now ?? new Date())}`;
}

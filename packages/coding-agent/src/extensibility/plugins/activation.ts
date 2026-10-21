/**
 * Whether a plugin's declarative panels are active in this process.
 *
 * Declarative panels (`ui.panels`) are a workbench surface: the desktop shell
 * is the only renderer, and the panel-data call is an agent process spawned by
 * that shell. Everywhere else — a plain terminal, an SDK embedder, a headless
 * CLI invocation — a panel declaration has no host to draw it, so exposing it
 * only makes the agent's plugin inventory disagree with what the user can see.
 *
 * The activation rule is therefore one predicate, checked at every place the
 * agent hands a panel declaration to a host:
 *
 *   1. `PI_FORCE_PLUGIN_PANELS` truthy → active. This is the debug switch: it
 *      makes panels visible outside a workbench pane (and in tests) without
 *      changing the normal rule.
 *   2. Running inside a Zeta workbench terminal → active. Two observations
 *      count, because the two pane backends state different identities:
 *      `ZETA_WORKBENCH=1` (a pane spawned by `termide`) and
 *      `TERM_PROGRAM=zetawork` (a pane attached to `zetacode serve`, whose
 *      gateway stamps the identity). Both are produced by our own product;
 *      `isInsideZetaWorkbench` and `detectTerminalId` own the two probes.
 *   3. Otherwise → inactive, the declaration reads as "no panels".
 *
 * Inactive is not an error: a plugin without panels is a normal plugin, and the
 * rest of its behaviour (tools, hooks, commands) loads unchanged.
 */
import { $env, parseFlag } from "@linxiraos/pi-utils";
import { detectTerminalId, isInsideZetaWorkbench } from "@linxiraos/pi-tui/terminal-capabilities";

/** Debug override: truthy makes declarative panels active outside a workbench. */
export const PLUGIN_PANELS_FORCE_ENV = "PI_FORCE_PLUGIN_PANELS";

/** Why the panel surface is active or not; kept for diagnostics and tests. */
export type PanelActivationReason = "workbench" | "forced" | "outside-workbench";

export interface PanelActivation {
	enabled: boolean;
	reason: PanelActivationReason;
}

/**
 * True when this process is a child of one of our own workbench terminals.
 *
 * `isInsideZetaWorkbench` is the pane marker `termide` injects;
 * `detectTerminalId` resolves the serve-attached pane's terminal identity. A
 * process launched from a normal terminal can report neither, so the predicate
 * does not depend on the outer emulator.
 */
export function isInsideWorkbenchTerminal(env: NodeJS.ProcessEnv = $env): boolean {
	return isInsideZetaWorkbench(env) || detectTerminalId(env) === "zetawork";
}

/**
 * Resolve panel activation for one environment.
 *
 * Pure and environment-injected so callers that already hold an env snapshot
 * (a spawned CLI, a test) reason about the same observation the gate used.
 */
export function panelActivation(env: NodeJS.ProcessEnv = $env): PanelActivation {
	if (parseFlag(env[PLUGIN_PANELS_FORCE_ENV])) return { enabled: true, reason: "forced" };
	if (isInsideWorkbenchTerminal(env)) return { enabled: true, reason: "workbench" };
	return { enabled: false, reason: "outside-workbench" };
}

/**
 * The one message a hidden surface reports when something explicitly asked for
 * panel data. Naming the override keeps the failure actionable from a terminal.
 */
export const PANELS_INACTIVE_MESSAGE = `declarative plugin panels are inactive outside the Zeta workbench terminal (set ${PLUGIN_PANELS_FORCE_ENV}=1 to force them on)`;

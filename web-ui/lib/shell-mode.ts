/**
 * Shell display modes.
 *
 * `full` is the complete browser/desktop surface: project sidebar, top bar,
 * session tab strip and the right tool dock. `embed` is the conversation-only
 * surface a host application mounts (the zetawork GUI's WebView2, an iframe, a
 * kiosk page): the transcript plus the composer, with none of the web UI's own
 * chrome.
 *
 * The mode is purely a *presentation* concern owned by the shell, so the
 * mechanism lives in exactly two places: the normalization here, and the slot
 * gate in `components/shell/ShellLayout.tsx`. Sub-pages never branch on the
 * mode — they render the same tree and are simply not mounted when their region
 * is not part of the current mode.
 *
 * Ways to select the mode (both resolve to the same code path):
 *   - query parameter: `/?mode=embed` (also `/embed?...`)
 *   - route: `/embed` renders the shell with `mode="embed"` baked in
 */

export const SHELL_MODE_PARAM = "mode";
export const EMBED_MODE_ROUTE = "/embed";

export const SHELL_MODES = ["full", "embed"] as const;
export type ShellMode = (typeof SHELL_MODES)[number];

export const DEFAULT_SHELL_MODE: ShellMode = "full";

/**
 * Region markers every column/slot carries, so a host (or the shell tests) can
 * target them by contract instead of by incidental class name.
 */
export const SHELL_REGION_ATTRIBUTE = "data-shell-region";
export const SHELL_MODE_ATTRIBUTE = "data-shell-mode";

/**
 * Regions `embed` omits entirely, i.e. they are never rendered inside the
 * WebView — not merely hidden with CSS. `center` (the conversation column) is
 * always present, which is why it is not in this list.
 */
export const EMBED_HIDDEN_SHELL_REGIONS = ["sidebar", "topbar", "tabs", "rail", "dockWindow"] as const;

/** Normalizes a raw parameter value; anything unknown falls back to `full`. */
export function resolveShellMode(value: string | null | undefined): ShellMode {
	const normalized = value?.trim().toLowerCase();
	return (SHELL_MODES as readonly string[]).includes(normalized ?? "")
		? (normalized as ShellMode)
		: DEFAULT_SHELL_MODE;
}

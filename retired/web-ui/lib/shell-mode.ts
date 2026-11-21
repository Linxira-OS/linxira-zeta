/**
 * Shell / page display modes.
 *
 * `full` renders a route inside the complete application chrome (project
 * sidebar, top bar, session tab strip, right tool dock). `panel` renders **the
 * page's own content only** — no left rail, no right dock, no top bar, no outer
 * padding — which is what a host panel mounts: the desktop's right sidebar
 * (≈324px), an iframe, a kiosk page, a plugin view.
 *
 * The mode is a page-level presentation concern, so the mechanism lives in
 * exactly two places: the normalization here, and the region gate in
 * `components/shell/ShellLayout.tsx` (plus `PageSurface` for page routes that
 * are not the chat app). Feature components never branch on the mode.
 *
 * Ways to select the mode (both resolve to the same code path):
 *   - query parameter: `?mode=panel` (also on `/panel`)
 *   - route: `/panel` renders the chat surface with `mode="panel"` baked in
 */

export const SHELL_MODE_PARAM = "mode";
export const PANEL_MODE_ROUTE = "/panel";

export const SHELL_MODES = ["full", "panel"] as const;
export type ShellMode = (typeof SHELL_MODES)[number];

export const DEFAULT_SHELL_MODE: ShellMode = "full";

/**
 * Region markers every column/slot/surface carries, so a host (or the shell
 * tests) can target them by contract instead of by incidental class name.
 */
export const SHELL_REGION_ATTRIBUTE = "data-shell-region";
export const SHELL_MODE_ATTRIBUTE = "data-shell-mode";

/**
 * Regions `panel` omits entirely, i.e. they are never rendered inside the host
 * panel — not merely hidden with CSS. `center` (the page column) is always
 * present, which is why it is not in this list.
 */
export const PANEL_HIDDEN_SHELL_REGIONS = ["sidebar", "topbar", "tabs", "rail", "dockWindow"] as const;

/** Normalizes a raw parameter value; anything unknown falls back to `full`. */
export function resolveShellMode(value: string | null | undefined): ShellMode {
	const normalized = value?.trim().toLowerCase();
	return (SHELL_MODES as readonly string[]).includes(normalized ?? "")
		? (normalized as ShellMode)
		: DEFAULT_SHELL_MODE;
}

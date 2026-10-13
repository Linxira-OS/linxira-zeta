"use client";

import type { ReactNode } from "react";

/**
 * Single source of truth for every dockable panel (plan §2.4).
 *
 * Both entry surfaces — the persistent right-edge icon rail and the top-bar
 * chips — are generated from this registry, so a panel is declared exactly
 * once and can never drift into two divergent entry points.
 *
 * To add a panel (e.g. the context ring), append one `PanelDecl` here and add
 * its body to the dock switch in AppShell. `context` is intentionally not
 * listed yet: the context-ring panel ships in its own PR and will append its
 * own entry (id "context", surface "rail", kind "dock", widthTier "regular",
 * exclusive true).
 */
export type PanelId =
	| "session"
	| "files"
	| "tracking"
	| "terminal"
	| "plugins"
	| "stats"
	| "branches"
	| "system"
	| "history";

/** Which entry surface renders this panel. */
export type PanelSurface = "rail" | "topbar";

/**
 * How activating the entry behaves:
 * - `dock`      → opens the right-hand dock window (single-selection).
 * - `topPanel`  → opens a dropdown anchored under the top bar.
 * - `action`    → runs an imperative action (no persistent panel).
 */
export type PanelKind = "dock" | "topPanel" | "action";

/** Preferred in-flow width for a dock panel. */
export type PanelWidthTier = "regular" | "wide";

export interface PanelDecl {
	/** Stable id; also the `dockTool` / `activeTopPanel` value. */
	id: PanelId;
	/** i18n key for the human title (chip label, rail tooltip, window header). */
	titleKey: string;
	/** Entry surface that renders this panel. */
	surface: PanelSurface;
	kind: PanelKind;
	widthTier: PanelWidthTier;
	/** Dock panels share one window — only one can be open at a time. */
	exclusive: boolean;
	icon: ReactNode;
	/** Requires `tracking.enabled`; hidden until the setting resolves true. */
	requiresTracking?: boolean;
	/** Requires a selected session (e.g. the full-history export panel). */
	requiresSession?: boolean;
}

const GRID = "0 0 24 24";

function Icon({ children }: { children: ReactNode }) {
	return (
		<svg
			width="16"
			height="16"
			viewBox={GRID}
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

const SESSION_ICON = (
	<Icon>
		<circle cx="12" cy="12" r="9" />
		<line x1="12" y1="10" x2="12" y2="16" />
		<circle cx="12" cy="7.5" r="0.5" fill="currentColor" />
	</Icon>
);

const FILES_ICON = (
	<Icon>
		<rect x="3" y="3" width="18" height="18" rx="2" />
		<line x1="15" y1="3" x2="15" y2="21" />
	</Icon>
);

const TRACKING_ICON = (
	<Icon>
		<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
		<polyline points="14 2 14 8 20 8" />
		<line x1="16" y1="13" x2="8" y2="13" />
		<line x1="16" y1="17" x2="8" y2="17" />
		<polyline points="10 9 9 9 8 9" />
	</Icon>
);

const TERMINAL_ICON = (
	<Icon>
		<polyline points="4 17 10 11 4 5" />
		<line x1="12" y1="19" x2="20" y2="19" />
	</Icon>
);

const PLUGINS_ICON = (
	<Icon>
		<path d="M21 8l-9-6-9 6v8l9 6 9-6z" />
		<path d="M12 22V14" />
		<path d="M3.5 6.5L12 11l8.5-4.5" />
	</Icon>
);

const STATS_ICON = (
	<Icon>
		<line x1="18" y1="20" x2="18" y2="10" />
		<line x1="12" y1="20" x2="12" y2="4" />
		<line x1="6" y1="20" x2="6" y2="14" />
	</Icon>
);

const BRANCHES_ICON = (
	<Icon>
		<line x1="6" y1="3" x2="6" y2="15" />
		<circle cx="18" cy="6" r="3" />
		<circle cx="6" cy="18" r="3" />
		<path d="M18 9a9 9 0 0 1-9 9" />
	</Icon>
);

const SYSTEM_ICON = (
	<Icon>
		<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
		<polyline points="14 2 14 8 20 8" />
		<line x1="8" y1="13" x2="16" y2="13" />
		<line x1="8" y1="17" x2="13" y2="17" />
	</Icon>
);

const HISTORY_ICON = (
	<Icon>
		<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
		<path d="M3 3v5h5" />
		<path d="M12 7v5l3 2" />
	</Icon>
);

/**
 * Registry order = render order. `session`/`files` use the same inline SVG for
 * the top-bar chip and the rail because both surfaces render this `icon`.
 */
export const PANEL_REGISTRY: readonly PanelDecl[] = [
	{
		id: "session",
		titleKey: "dock.window.session",
		surface: "rail",
		kind: "dock",
		widthTier: "regular",
		exclusive: true,
		icon: SESSION_ICON,
	},
	{
		id: "files",
		titleKey: "dock.window.files",
		surface: "rail",
		kind: "dock",
		widthTier: "regular",
		exclusive: true,
		icon: FILES_ICON,
	},
	{
		id: "tracking",
		titleKey: "dock.window.tracking",
		surface: "rail",
		kind: "dock",
		widthTier: "regular",
		exclusive: true,
		icon: TRACKING_ICON,
		requiresTracking: true,
	},
	{
		id: "terminal",
		titleKey: "dock.window.terminal",
		surface: "rail",
		kind: "dock",
		widthTier: "regular",
		exclusive: true,
		icon: TERMINAL_ICON,
	},
	{
		id: "plugins",
		titleKey: "dock.window.plugins",
		surface: "rail",
		kind: "dock",
		widthTier: "regular",
		exclusive: true,
		icon: PLUGINS_ICON,
	},
	{
		id: "stats",
		titleKey: "dock.window.stats",
		surface: "rail",
		kind: "dock",
		widthTier: "regular",
		exclusive: true,
		icon: STATS_ICON,
	},
	{
		id: "branches",
		titleKey: "branches",
		surface: "topbar",
		kind: "topPanel",
		widthTier: "regular",
		exclusive: false,
		icon: BRANCHES_ICON,
	},
	{
		id: "system",
		titleKey: "topbar.systemPrompt",
		surface: "topbar",
		kind: "topPanel",
		widthTier: "regular",
		exclusive: false,
		icon: SYSTEM_ICON,
	},
	{
		id: "history",
		titleKey: "dock.window.history",
		surface: "rail",
		kind: "dock",
		widthTier: "regular",
		exclusive: true,
		icon: HISTORY_ICON,
		requiresSession: true,
	},
] as const;

/** Dock panels that are visible right now (honours the tracking + session gates). */
export function getDockPanels(trackingEnabled: boolean, hasSession: boolean): PanelDecl[] {
	return PANEL_REGISTRY.filter(
		panel =>
			panel.surface === "rail" &&
			(!panel.requiresTracking || trackingEnabled) &&
			(!panel.requiresSession || hasSession),
	);
}

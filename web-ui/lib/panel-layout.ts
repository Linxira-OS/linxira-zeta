export const MOBILE_MAX_WIDTH = 640;
export const SPLIT_PANEL_MIN_WIDTH = 960;

export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_COLLAPSED_WIDTH = 56;

const SIDEBAR_COLLAPSED_PREF_KEY = "zeta.sidebar.collapsed";

export function readSidebarCollapsedPref(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return window.localStorage.getItem(SIDEBAR_COLLAPSED_PREF_KEY) === "1";
	} catch {
		return false;
	}
}

export function writeSidebarCollapsedPref(collapsed: boolean): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(SIDEBAR_COLLAPSED_PREF_KEY, collapsed ? "1" : "0");
	} catch {
		// Storage unavailable (private mode, quota) — collapse state stays in-memory.
	}
}

export const RIGHT_PANEL_FALLBACK_WIDTH = 560;
export const RIGHT_PANEL_MIN_WIDTH = 300;
export const RIGHT_PANEL_MAX_WIDTH = 1200;

const COMPACT_CHAT_MIN_WIDTH = 320;
const DESKTOP_CHAT_MIN_WIDTH = 420;

export function clampPanelWidth(width: number, minWidth: number, maxWidth: number): number {
	const finiteWidth = Number.isFinite(width) ? width : minWidth;
	const effectiveMax = Math.max(minWidth, maxWidth);
	return Math.round(Math.max(minWidth, Math.min(effectiveMax, finiteWidth)));
}

export function getDefaultRightPanelWidth(viewportWidth: number): number {
	return clampPanelWidth(viewportWidth * 0.42, 360, 640);
}

export function getSidebarMaxWidth(options: {
	viewportWidth: number;
	rightPanelOpen: boolean;
	rightPanelWidth: number;
}): number {
	const { viewportWidth, rightPanelOpen, rightPanelWidth } = options;
	if (viewportWidth <= MOBILE_MAX_WIDTH) return SIDEBAR_MAX_WIDTH;

	const compact = viewportWidth < SPLIT_PANEL_MIN_WIDTH;
	const chatWidth = compact ? COMPACT_CHAT_MIN_WIDTH : DESKTOP_CHAT_MIN_WIDTH;
	const visibleRightPanelWidth = !compact && rightPanelOpen ? rightPanelWidth : 0;
	return Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - chatWidth - visibleRightPanelWidth);
}

export function getRightPanelMaxWidth(options: {
	viewportWidth: number;
	sidebarOpen: boolean;
	sidebarWidth: number;
}): number {
	const { viewportWidth, sidebarOpen, sidebarWidth } = options;
	if (viewportWidth < SPLIT_PANEL_MIN_WIDTH) return RIGHT_PANEL_MAX_WIDTH;

	const visibleSidebarWidth = sidebarOpen ? sidebarWidth : 0;
	return Math.min(RIGHT_PANEL_MAX_WIDTH, viewportWidth - DESKTOP_CHAT_MIN_WIDTH - visibleSidebarWidth);
}

/**
 * Width of the persistent right-edge dock rail (icon strip). It is always
 * visible and sits to the left of the dock window.
 */
export const DOCK_RAIL_WIDTH = 40;

/** Invisible hit area (px) of a column drag handle. */
export const PANEL_RESIZE_HIT_AREA = 8;

/**
 * Frozen shell geometry. Every pixel constant the three-column shell needs is
 * collected here so the layout maths lives in exactly one place.
 */
export const SHELL_GEOMETRY = Object.freeze({
	sidebarDefault: SIDEBAR_DEFAULT_WIDTH,
	sidebarMin: SIDEBAR_MIN_WIDTH,
	sidebarMax: SIDEBAR_MAX_WIDTH,
	sidebarRail: SIDEBAR_COLLAPSED_WIDTH,
	detailDefault: RIGHT_PANEL_FALLBACK_WIDTH,
	detailMin: RIGHT_PANEL_MIN_WIDTH,
	detailMax: RIGHT_PANEL_MAX_WIDTH,
	chatMinDesktop: DESKTOP_CHAT_MIN_WIDTH,
	chatMinCompact: COMPACT_CHAT_MIN_WIDTH,
	splitMin: SPLIT_PANEL_MIN_WIDTH,
	mobileMax: MOBILE_MAX_WIDTH,
	dockRail: DOCK_RAIL_WIDTH,
	resizeHitArea: PANEL_RESIZE_HIT_AREA,
} as const);

export interface ShellTracks {
	/** Width (px) of the left sidebar track; 0 when overlay/hidden. */
	sidebar: number;
	/** Width (px) of the centre chat track. */
	center: number;
	/** Width (px) of the right details track (rail + in-flow dock window). */
	details: number;
	/** Sidebar is a fixed overlay (mobile drawer) rather than an in-flow track. */
	sidebarOverlay: boolean;
	/** Dock window is a fixed overlay rather than an in-flow track. */
	detailOverlay: boolean;
	/** Yield chain closed the dock window to protect the chat track. */
	detailCollapsed: boolean;
}

/**
 * Pure column-width yield chain (plan §2.3). Contract:
 *   1. the centre chat column keeps at least `chatMinDesktop` px;
 *   2. the dock window is compressed first, down to `detailMin`;
 *   3. then the dock window is dropped entirely (never written back to prefs);
 *   4. then the sidebar is compressed, down to its own minimum.
 * Below `splitMin` the dock window overlays the chat; below `mobileMax` the
 * sidebar overlays too. No side effects — safe to call during render.
 */
export function resolveShellTracks(options: {
	viewportWidth: number;
	sidebarOpen: boolean;
	sidebarCollapsed: boolean;
	detailOpen: boolean;
	sidebarWidth: number;
	detailWidth: number;
}): ShellTracks {
	const { viewportWidth, sidebarOpen, sidebarCollapsed, detailOpen, sidebarWidth, detailWidth } = options;

	if (viewportWidth <= MOBILE_MAX_WIDTH) {
		return {
			sidebar: 0,
			center: Math.max(0, viewportWidth - DOCK_RAIL_WIDTH),
			details: DOCK_RAIL_WIDTH,
			sidebarOverlay: true,
			detailOverlay: true,
			detailCollapsed: !detailOpen,
		};
	}

	let sidebar = !sidebarOpen
		? 0
		: sidebarCollapsed
			? SIDEBAR_COLLAPSED_WIDTH
			: clampPanelWidth(sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);

	// 641-959 px: the dock window overlays the chat instead of claiming a track.
	if (viewportWidth < SPLIT_PANEL_MIN_WIDTH) {
		return {
			sidebar,
			center: Math.max(0, viewportWidth - sidebar - DOCK_RAIL_WIDTH),
			details: DOCK_RAIL_WIDTH,
			sidebarOverlay: false,
			detailOverlay: true,
			detailCollapsed: !detailOpen,
		};
	}

	let detailPx = detailOpen ? clampPanelWidth(detailWidth, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH) : 0;
	let detailCollapsed = false;
	let center = viewportWidth - sidebar - DOCK_RAIL_WIDTH - detailPx;

	// 2. compress the dock window.
	if (center < DESKTOP_CHAT_MIN_WIDTH && detailPx > 0) {
		const take = Math.min(DESKTOP_CHAT_MIN_WIDTH - center, Math.max(0, detailPx - RIGHT_PANEL_MIN_WIDTH));
		detailPx -= take;
		center += take;
	}
	// 3. drop the dock window (transient — preferences are never rewritten).
	if (center < DESKTOP_CHAT_MIN_WIDTH && detailPx > 0) {
		center += detailPx;
		detailPx = 0;
		detailCollapsed = true;
	}
	// 4. compress the sidebar down to its minimum.
	if (center < DESKTOP_CHAT_MIN_WIDTH && sidebar > SIDEBAR_MIN_WIDTH) {
		const take = Math.min(DESKTOP_CHAT_MIN_WIDTH - center, sidebar - SIDEBAR_MIN_WIDTH);
		sidebar -= take;
		center += take;
	}

	return {
		sidebar,
		center,
		details: DOCK_RAIL_WIDTH + detailPx,
		sidebarOverlay: false,
		detailOverlay: false,
		detailCollapsed,
	};
}

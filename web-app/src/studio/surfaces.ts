/**
 * Which client surface is this, and which actions does it actually support?
 *
 * Work Studio is one renderer served to five very different clients: the
 * Electron shell, a loopback browser, a browser reaching the machine through a
 * tunnel/proxy, a phone/WebView, and (outside this renderer) the TUI. The same
 * React tree therefore cannot answer "can I open the log folder here?" from a
 * capability manifest alone: that file is the *host's* answer, while a window
 * control or a native picker lives in the *client*.
 *
 * This module is the single decision table. It is pure so the settings UI, the
 * diagnostics page and the navigation guard all read the same answers, and so
 * the matrix can be tested per surface without a browser.
 *
 * Rules:
 * - a decision describes what the surface can honestly do, never what would be
 *   convenient to show;
 * - a hidden decision is for an action that makes no sense at all there, an
 *   unavailable one names the missing piece in `reason`;
 * - `pass-through` means the action runs on the host (or remote machine) and
 *   this surface only forwards the request.
 */

export type SurfaceId = "desktop" | "loopback-browser" | "remote-browser" | "mobile" | "tui";

export const SURFACE_IDS: readonly SurfaceId[] = [
	"desktop",
	"loopback-browser",
	"remote-browser",
	"mobile",
	"tui",
];

/** Facts a renderer can observe synchronously; `hostDesktop` comes from the gateway. */
export interface SurfaceFacts {
	/** The frameless shell's window-control bridge (`window.piDesktop`). */
	readonly windowBridge: boolean;
	/** Any desktop preload chrome API (`window.zetaStudioChrome`). */
	readonly chromeBridge: boolean;
	/** The SSH remote bridge (`window.zetaStudioRemote`), when the shell ships it. */
	readonly remoteBridge: boolean;
	/** The renderer was loaded from this machine's loopback origin. */
	readonly loopback: boolean;
	/** Phone-sized, coarse-pointer viewport. */
	readonly mobileViewport: boolean;
	/** A mobile browser/WebView user agent. */
	readonly mobileAgent: boolean;
	/** `GET /api/desktop/info` says the serving process was spawned by the shell. */
	readonly hostDesktop: boolean;
}

/** The classification used everywhere; the desktop shell wins over its loopback URL. */
export function classifySurface(facts: SurfaceFacts): SurfaceId {
	if (facts.windowBridge || facts.chromeBridge) return "desktop";
	if (facts.mobileViewport || facts.mobileAgent) return "mobile";
	return facts.loopback ? "loopback-browser" : "remote-browser";
}

const LOOPBACK_HOSTS: Record<string, true> = {
	localhost: true,
	"127.0.0.1": true,
	"[::1]": true,
	"::1": true,
};

/** Loopback is about the browser's address bar, not the host process. */
export function isLoopbackHost(hostname: string): boolean {
	return Object.hasOwn(LOOPBACK_HOSTS, hostname.toLowerCase());
}

interface SurfaceScope {
	readonly piDesktop?: { minimize?: unknown; maximize?: unknown; close?: unknown } | undefined;
	readonly zetaStudioChrome?: object | undefined;
	readonly zetaStudioRemote?: object | undefined;
	readonly location?: { readonly hostname?: string } | undefined;
	readonly navigator?: { readonly userAgent?: string; readonly maxTouchPoints?: number } | undefined;
	readonly matchMedia?: ((query: string) => { readonly matches: boolean }) | undefined;
}

/** A coarse-pointer, phone-width viewport — the mobile layout's own media query. */
const MOBILE_QUERY = "(max-width: 820px) and (pointer: coarse)";

/**
 * Observe the current renderer. Everything is optional so tests and the server
 * renderer can call the classifier with explicit facts instead.
 */
export function detectSurfaceFacts(scope: SurfaceScope = globalThis as SurfaceScope): SurfaceFacts {
	const bridge = scope.piDesktop;
	const windowBridge =
		bridge !== undefined &&
		typeof bridge.minimize === "function" &&
		typeof bridge.maximize === "function" &&
		typeof bridge.close === "function";
	let hostname = "";
	try {
		hostname = scope.location?.hostname ?? "";
	} catch {
		hostname = "";
	}
	const userAgent = scope.navigator?.userAgent ?? "";
	return {
		windowBridge,
		chromeBridge: scope.zetaStudioChrome !== undefined,
		remoteBridge: scope.zetaStudioRemote !== undefined,
		loopback: isLoopbackHost(hostname),
		mobileViewport: scope.matchMedia?.(MOBILE_QUERY).matches === true,
		mobileAgent: /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent),
		hostDesktop: false,
	};
}

/** Synchronous surface for code paths that cannot await `/api/desktop/info`. */
export function detectSurface(scope?: SurfaceScope): SurfaceId {
	return classifySurface(detectSurfaceFacts(scope));
}

/**
 * Routes a mobile surface may open. Settings is included so a phone can answer
 * a 2FA challenge and inspect its own paired device; the individual actions
 * inside it are still decided by the matrix below.
 */
const MOBILE_ROUTES: Record<string, true> = { workbench: true, history: true, settings: true };

export function navAllowedOnSurface(surface: SurfaceId, route: string): boolean {
	if (surface !== "mobile") return true;
	return Object.hasOwn(MOBILE_ROUTES, route);
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

export const SURFACE_ACTIONS = [
	"window-controls",
	"runtime-install",
	"runtime-restart",
	"local-update-import",
	"local-data-cleanup",
	"open-logs",
	"file-picker",
	"open-in-editor",
	"file-reveal",
	"im-channels",
	"im-credentials",
	"device-list",
	"device-revoke",
	"totp",
	"remote-pairing",
	"remote-token",
	"ssh-targets",
] as const;

export type SurfaceAction = (typeof SURFACE_ACTIONS)[number];

/**
 * `show`: this surface owns the control;
 * `read-only`: facts are visible, mutations are not offered;
 * `pass-through`: the request executes on the host/machine;
 * `hidden`: the action is meaningless here and no control is drawn;
 * `unavailable`: the action is meaningful but a named piece is missing.
 */
export type SurfaceAccess = "show" | "read-only" | "pass-through" | "hidden" | "unavailable";

export interface SurfaceDecision {
	readonly access: SurfaceAccess;
	/** i18n key suffix under `settings.security.reason.*`; present when access needs one. */
	readonly reason?: string;
}

const SHOW: SurfaceDecision = { access: "show" };
const PASS: SurfaceDecision = { access: "pass-through" };
const HIDDEN: SurfaceDecision = { access: "hidden" };
const READ_ONLY: SurfaceDecision = { access: "read-only" };
const unavailable = (reason: string): SurfaceDecision => ({ access: "unavailable", reason });

const DESKTOP_ONLY = unavailable("desktopOnly");
const SSH_PENDING = unavailable("sshBridgePending");
const RESTART_HOST = unavailable("restartHostMode");
const TOTP_REMOTE = { access: "read-only", reason: "totpLocalEnroll" } as const;

function desktopRow(): Record<SurfaceAction, SurfaceDecision> {
	return {
		"window-controls": SHOW,
		"runtime-install": PASS,
		"runtime-restart": RESTART_HOST,
		"local-update-import": SHOW,
		"local-data-cleanup": PASS,
		"open-logs": SHOW,
		"file-picker": SHOW,
		"open-in-editor": SHOW,
		"file-reveal": SHOW,
		"im-channels": PASS,
		"im-credentials": PASS,
		"device-list": SHOW,
		"device-revoke": SHOW,
		totp: SHOW,
		"remote-pairing": SHOW,
		"remote-token": SHOW,
		"ssh-targets": SSH_PENDING,
	};
}

const MATRIX: Record<SurfaceId, Record<SurfaceAction, SurfaceDecision>> = {
	desktop: desktopRow(),
	// A browser cannot draw window chrome or launch files in the host's desktop
	// session; everything else is a gateway request and works here.
	"loopback-browser": {
		"window-controls": HIDDEN,
		"runtime-install": PASS,
		"runtime-restart": RESTART_HOST,
		"local-update-import": DESKTOP_ONLY,
		"local-data-cleanup": PASS,
		"open-logs": DESKTOP_ONLY,
		"file-picker": PASS,
		"open-in-editor": HIDDEN,
		"file-reveal": HIDDEN,
		"im-channels": PASS,
		"im-credentials": PASS,
		"device-list": PASS,
		"device-revoke": PASS,
		totp: PASS,
		"remote-pairing": PASS,
		"remote-token": PASS,
		"ssh-targets": SSH_PENDING,
	},
	// Remote is not "less trusted by default": the gateway gate and TOTP decide
	// authorization. What it lacks is the local desktop session (window chrome,
	// native pickers, local apps) and local-only first enrollment.
	"remote-browser": {
		"window-controls": HIDDEN,
		"runtime-install": PASS,
		"runtime-restart": RESTART_HOST,
		"local-update-import": DESKTOP_ONLY,
		"local-data-cleanup": PASS,
		"open-logs": DESKTOP_ONLY,
		"file-picker": PASS,
		"open-in-editor": HIDDEN,
		"file-reveal": HIDDEN,
		"im-channels": PASS,
		"im-credentials": PASS,
		"device-list": PASS,
		"device-revoke": PASS,
		totp: TOTP_REMOTE,
		"remote-pairing": PASS,
		"remote-token": PASS,
		"ssh-targets": SSH_PENDING,
	},
	// Binding-scoped chat only: no local runtime, no credentials, no device admin.
	mobile: {
		"window-controls": HIDDEN,
		"runtime-install": HIDDEN,
		"runtime-restart": HIDDEN,
		"local-update-import": HIDDEN,
		"local-data-cleanup": HIDDEN,
		"open-logs": HIDDEN,
		"file-picker": PASS,
		"open-in-editor": HIDDEN,
		"file-reveal": HIDDEN,
		"im-channels": HIDDEN,
		"im-credentials": HIDDEN,
		"device-list": HIDDEN,
		"device-revoke": HIDDEN,
		// Verification is allowed (a phone must answer `totp_required`);
		// enrollment/disable/policy stay local-only, which the pane enforces.
		totp: { access: "read-only", reason: "totpLocalEnroll" },
		"remote-pairing": HIDDEN,
		"remote-token": HIDDEN,
		"ssh-targets": HIDDEN,
	},
	// The TUI has no renderer controls; these are CLI/terminal operations.
	tui: {
		"window-controls": HIDDEN,
		"runtime-install": PASS,
		"runtime-restart": RESTART_HOST,
		"local-update-import": PASS,
		"local-data-cleanup": PASS,
		"open-logs": PASS,
		"file-picker": PASS,
		"open-in-editor": PASS,
		"file-reveal": PASS,
		"im-channels": PASS,
		"im-credentials": PASS,
		"device-list": unavailable("tuiNoDeviceUi"),
		"device-revoke": unavailable("tuiNoDeviceUi"),
		totp: unavailable("tuiNoDeviceUi"),
		"remote-pairing": PASS,
		"remote-token": PASS,
		"ssh-targets": PASS,
	},
};

export function accessFor(surface: SurfaceId, action: SurfaceAction): SurfaceDecision {
	return MATRIX[surface][action];
}

/** True when the surface may draw the control at all (any non-hidden decision). */
export function surfaceShows(surface: SurfaceId, action: SurfaceAction): boolean {
	return accessFor(surface, action).access !== "hidden";
}

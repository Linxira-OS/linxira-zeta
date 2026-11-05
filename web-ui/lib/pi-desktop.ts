"use client";

/**
 * Desktop-shell bridge. The Electron preload exposes `window.piDesktop`
 * (see desktop/src/preload.ts); a plain browser — or any non-desktop
 * embedding — has no such global and falls back to Web APIs.
 */

declare global {
	interface Window {
		piDesktop?: {
			selectDirectory: (startPath?: string) => Promise<string | null>;
			// Self-drawn titlebar (frameless window on every platform). Optional:
			// an older desktop build — or a plain browser — simply has no shell.
			minimize?: () => Promise<void>;
			maximize?: () => Promise<void>;
			close?: () => Promise<void>;
			isMaximized?: () => Promise<boolean>;
			onWindowState?: (callback: (state: { maximized: boolean }) => void) => () => void;
			getOpenTargets?: () => Promise<{ id: string; label: string }[]>;
			openTarget?: (targetId: string, gatewayPath: { path: string; token: string }) => Promise<void>;
			// Topbar tool launchers (frameless desktop shell only).
			spawnTool?: (
				toolId: string,
				cwd?: string,
				opts?: { resume?: boolean },
			) => Promise<{ tool: string; cwd: string; pid: number | null; sessionDir?: string }>;
		};
	}
}

export function hasNativeDirectoryDialog(): boolean {
	return typeof window !== "undefined" && !!window.piDesktop;
}

/** OS directory dialog; resolves to the chosen path, or null on cancel/absence. */
export async function selectNativeDirectory(startPath?: string): Promise<string | null> {
	if (!hasNativeDirectoryDialog()) return null;
	try {
		return await window.piDesktop?.selectDirectory(startPath) ?? null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Self-drawn titlebar — window controls for the frameless desktop shell.
// Every helper degrades to a no-op outside the desktop shell (plain browser
// tab, or a desktop build that predates these APIs).
// ---------------------------------------------------------------------------

export function hasDesktopWindowControls(): boolean {
	return typeof window !== "undefined" && typeof window.piDesktop?.minimize === "function";
}

export interface DesktopOpenTarget {
	id: string;
	label: string;
}

export interface GatewayOpenPath {
	path: string;
	token: string;
}

export function hasDesktopOpenBridge(): boolean {
	return typeof window !== "undefined"
		&& typeof window.piDesktop?.getOpenTargets === "function"
		&& typeof window.piDesktop?.openTarget === "function";
}

/** Topbar tool launcher availability (frameless desktop shell only). */
export function hasDesktopToolLauncher(): boolean {
	return typeof window !== "undefined" && typeof window.piDesktop?.spawnTool === "function";
}

export type DesktopToolId = "zetacode" | "zetaide" | "zetawork";

/** Spawn a companion tool; rejects with the desktop shell's error message. */
export async function spawnDesktopTool(
	toolId: DesktopToolId,
	cwd?: string,
	opts?: { resume?: boolean },
): Promise<{ tool: string; cwd: string; pid: number | null; sessionDir?: string } | null> {
	if (!hasDesktopToolLauncher()) return null;
	return (await window.piDesktop?.spawnTool?.(toolId, cwd, opts)) ?? null;
}

export async function getDesktopOpenTargets(): Promise<DesktopOpenTarget[]> {
	if (!hasDesktopOpenBridge()) return [];
	try {
		return await window.piDesktop?.getOpenTargets?.() ?? [];
	} catch {
		return [];
	}
}

export async function openDesktopTarget(targetId: string, gatewayPath: GatewayOpenPath): Promise<void> {
	if (!hasDesktopOpenBridge()) return;
	await window.piDesktop?.openTarget?.(targetId, gatewayPath);
}

async function windowControl(method: "minimize" | "maximize" | "close"): Promise<void> {
	if (!hasDesktopWindowControls()) return;
	try {
		await window.piDesktop?.[method]?.();
	} catch {
		// The window may already be gone; nothing useful to do.
	}
}

export const minimizeWindow = (): Promise<void> => windowControl("minimize");
export const maximizeWindow = (): Promise<void> => windowControl("maximize");
export const closeWindow = (): Promise<void> => windowControl("close");

export async function isWindowMaximized(): Promise<boolean> {
	if (!hasDesktopWindowControls()) return false;
	try {
		return (await window.piDesktop?.isMaximized?.()) ?? false;
	} catch {
		return false;
	}
}

/** Subscribe to maximize/restore changes. Returns an unsubscribe function. */
export function subscribeWindowState(callback: (state: { maximized: boolean }) => void): () => void {
	if (!hasDesktopWindowControls()) return () => {};
	try {
		return window.piDesktop?.onWindowState?.(callback) ?? (() => {});
	} catch {
		return () => {};
	}
}

// ---------------------------------------------------------------------------
// /api/desktop/info probe — fetched once per page load.
// ---------------------------------------------------------------------------

export interface DesktopInfo {
	desktop: boolean;
}

let desktopInfoPromise: Promise<DesktopInfo> | null = null;

/** One-shot capability probe shared by every desktop-specific UI surface. */
export function fetchDesktopInfo(): Promise<DesktopInfo> {
	desktopInfoPromise ??= (async () => {
		try {
			const res = await fetch("/api/desktop/info");
			if (!res.ok) return { desktop: false };
			return (await res.json()) as DesktopInfo;
		} catch {
			return { desktop: false };
		}
	})();
	return desktopInfoPromise;
}

// ---------------------------------------------------------------------------
// Studio surface contract — `components/studio/**` asks these, never `window`.
//
// The ported renderer was written against a richer bridge (`ompStudioChrome`):
// a platform string, reveal/open, and a picker. Everything here is expressed on
// top of the calls above so there is still exactly one bridge object;
// `lib/platform-capabilities.ts` turns it into the `PlatformCapabilities` the
// shell passes down. A method an older shell does not implement simply reports
// `false`, and that surface takes its browser path.
// ---------------------------------------------------------------------------

import type { PlatformCapabilities } from "@/components/studio/adapters/types";

/** Extra fields the upcoming native shell (zetawork) may publish. */
interface StudioBridgeExtensions {
	platform?: string;
	nativeTitlebar?: boolean;
	openExternal?: (url: string) => Promise<void> | void;
	revealPath?: (path: string) => Promise<void> | void;
	pickDirectory?: (initialPath?: string | null) => Promise<string | null>;
	setTitlebarTheme?: (theme: "light" | "dark") => void;
}

/** The injected bridge, or undefined in a plain browser. */
export function getPiDesktop(): (Window["piDesktop"] & StudioBridgeExtensions) | undefined {
	if (typeof window === "undefined") return undefined;
	return window.piDesktop as (Window["piDesktop"] & StudioBridgeExtensions) | undefined;
}

function normalizePlatform(value: string | undefined): PlatformCapabilities["platform"] {
	if (value === "win32" || value === "linux" || value === "darwin") return value;
	return "other";
}

/** What the current surface can do. Cheap and synchronous; memoize at call site. */
export function platformCapabilities(): PlatformCapabilities {
	const bridge = getPiDesktop();
	return {
		desktop: bridge !== undefined,
		windowControls: hasDesktopWindowControls(),
		nativeDirectoryPicker: Boolean(bridge?.pickDirectory || bridge?.selectDirectory),
		revealInFileManager: typeof bridge?.revealPath === "function",
		openExternal: typeof bridge?.openExternal === "function",
		platform: normalizePlatform(bridge?.platform),
		nativeTitlebar: bridge?.nativeTitlebar === true,
	};
}

/** Open a URL in the user's browser (shell bridge when present). */
export function openExternal(url: string): void {
	const bridge = getPiDesktop();
	if (bridge?.openExternal) {
		void bridge.openExternal(url);
		return;
	}
	if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
}

/** Reveal a path in the OS file manager; false when the surface has no bridge. */
export async function revealPath(path: string): Promise<boolean> {
	const bridge = getPiDesktop();
	if (!bridge?.revealPath) return false;
	await bridge.revealPath(path);
	return true;
}

/** Directory picker: the newer bridge first, the Electron one second. */
export async function pickDirectory(initialPath?: string | null): Promise<string | null> {
	const bridge = getPiDesktop();
	if (bridge?.pickDirectory) return bridge.pickDirectory(initialPath ?? null);
	if (bridge?.selectDirectory) return bridge.selectDirectory(initialPath ?? undefined);
	return null;
}

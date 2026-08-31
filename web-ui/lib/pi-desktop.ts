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

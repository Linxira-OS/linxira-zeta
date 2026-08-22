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

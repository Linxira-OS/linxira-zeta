/**
 * Window-caption actions for the self-drawn desktop titlebar.
 *
 * The renderer's minimize / maximize-restore / close buttons reach Main over
 * IPC; this module owns what those channels do so the behavior is testable
 * without an Electron runtime. `main.ts` passes its real `BrowserWindow`
 * (structurally compatible with {@link WindowControlTarget}) and the renderer
 * stays a thin button surface.
 */

/** The `BrowserWindow` surface the caption buttons touch. */
export interface WindowControlTarget {
	isDestroyed(): boolean;
	isMaximized(): boolean;
	minimize(): void;
	maximize(): void;
	unmaximize(): void;
	close(): void;
}

/** One caption action, one IPC channel. */
export type WindowControlAction = "minimize" | "maximize" | "close";

/**
 * The IPC channel names shared by `main.ts` and `preload.ts`. Preload runs in
 * a sandboxed renderer and cannot require this module, so
 * `scripts/window-controls.test.mjs` pins both sides to these exact strings.
 */
export const WINDOW_CONTROL_CHANNELS = {
	minimize: "pi:window-minimize",
	maximize: "pi:window-maximize",
	close: "pi:window-close",
	state: "pi:window-state",
} as const;

/**
 * The live window, or null. App code keeps a nullable `mainWindow` that goes
 * stale while the window is closing; every IPC call re-checks this instead of
 * trusting the reference.
 */
export function liveWindow(win: WindowControlTarget | null): WindowControlTarget | null {
	if (win === null || win.isDestroyed()) return null;
	return win;
}

/** Run one caption action; a missing/destroyed window is a no-op, not a throw. */
export function runWindowControl(win: WindowControlTarget | null, action: WindowControlAction): void {
	const target = liveWindow(win);
	if (target === null) return;
	switch (action) {
		case "minimize":
			target.minimize();
			return;
		case "maximize":
			// One button toggles both directions, matching native captions.
			if (target.isMaximized()) target.unmaximize();
			else target.maximize();
			return;
		case "close":
			// Main's `close` handler applies the minimize-to-tray policy.
			target.close();
			return;
	}
}

/** Payload for `pi:window-state`; a closed window reports `false`. */
export function windowState(win: WindowControlTarget | null): { maximized: boolean } {
	const target = liveWindow(win);
	return { maximized: target !== null && target.isMaximized() };
}

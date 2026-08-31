import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

interface DesktopOpenTarget {
	id: string;
	label: string;
}

/**
 * Renderer bridge for desktop-only capabilities. The web-ui feature-detects
 * `window.piDesktop` and degrades to browser fallbacks when absent (plain
 * browser tab, or any non-desktop embedding).
 */
const api = {
	/** Open the OS directory picker; resolves to the chosen path or null on cancel. */
	selectDirectory: (startPath?: string): Promise<string | null> => ipcRenderer.invoke("pi:select-directory", startPath),
	/** Host-defined open targets; IDs are opaque to the renderer. */
	getOpenTargets: (): Promise<DesktopOpenTarget[]> => ipcRenderer.invoke("pi:open-targets"),
	/** Opens only a gateway-authorized directory through a host-defined target. */
	openTarget: (targetId: string, gatewayPath: { path: string; token: string }): Promise<void> =>
		ipcRenderer.invoke("pi:open-target", targetId, gatewayPath),

	// -------------------------------------------------------------------------
	// Self-drawn titlebar (frameless window on all platforms)
	// -------------------------------------------------------------------------

	/** Minimize the window. */
	minimize: (): Promise<void> => ipcRenderer.invoke("pi:window-minimize"),
	/** Toggle between maximized and restored. */
	maximize: (): Promise<void> => ipcRenderer.invoke("pi:window-maximize"),
	/** Close the window — the main process still applies minimize-to-tray. */
	close: (): Promise<void> => ipcRenderer.invoke("pi:window-close"),
	/** Query whether the window is currently maximized. */
	isMaximized: (): Promise<boolean> =>
		ipcRenderer.invoke("pi:window-state").then((state: unknown) => Boolean((state as { maximized?: boolean } | null)?.maximized)),
	/**
	 * Subscribe to window-state changes (maximize / restore / full screen).
	 * Returns an unsubscribe function.
	 */
	onWindowState: (callback: (state: { maximized: boolean }) => void): (() => void) => {
		const listener = (_event: IpcRendererEvent, state: { maximized: boolean }): void => callback(state);
		ipcRenderer.on("pi:window-state", listener);
		return () => ipcRenderer.removeListener("pi:window-state", listener);
	},
};

export type PiDesktopApi = typeof api;

contextBridge.exposeInMainWorld("piDesktop", api);

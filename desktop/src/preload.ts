import { contextBridge, ipcRenderer } from "electron";

/**
 * Renderer bridge for desktop-only capabilities. The web-ui feature-detects
 * `window.piDesktop` and degrades to browser fallbacks when absent (plain
 * browser tab, or any non-desktop embedding).
 */
const api = {
	/** Open the OS directory picker; resolves to the chosen path or null on cancel. */
	selectDirectory: (startPath?: string): Promise<string | null> => ipcRenderer.invoke("pi:select-directory", startPath),
};

export type PiDesktopApi = typeof api;

contextBridge.exposeInMainWorld("piDesktop", api);

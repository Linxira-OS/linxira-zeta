/** IPC surface for the desktop terminal + recording bridge. */

import { BrowserWindow, dialog, ipcMain } from "electron";
import { TerminalBridge, type TerminalCreateInput } from "./bridge";

export interface TerminalIpcOptions {
	readonly userData: string;
	readonly localBase: () => string;
	readonly remoteBase: (targetId: string) => string | undefined;
}

function terminalId(value: unknown): string {
	if (typeof value !== "string" || value === "") throw new Error("Invalid terminal id");
	return value;
}

export function registerTerminalBridge(options: TerminalIpcOptions): TerminalBridge {
	const broadcast = (channel: string, payload: unknown): void => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(channel, payload);
		}
	};
	const bridge = new TerminalBridge({
		userData: options.userData,
		localBase: options.localBase,
		remoteBase: options.remoteBase,
		data: (id, data) => broadcast("pi:terminal-data", { id, data }),
		exit: id => broadcast("pi:terminal-exit", { id }),
	});

	ipcMain.handle("pi:terminal-create", (_event, input: unknown) => bridge.create((input ?? {}) as TerminalCreateInput));
	ipcMain.handle("pi:terminal-write", (_event, id: unknown, data: unknown) => {
		if (typeof data !== "string") throw new Error("Invalid terminal data");
		bridge.write(terminalId(id), data);
	});
	ipcMain.handle("pi:terminal-resize", (_event, id: unknown, cols: unknown, rows: unknown) =>
		bridge.resize(terminalId(id), Number(cols), Number(rows)),
	);
	ipcMain.handle("pi:terminal-dispose", (_event, id: unknown) => bridge.dispose(terminalId(id)));
	ipcMain.handle("pi:terminal-profiles", (_event, targetId: unknown) => bridge.profiles(typeof targetId === "string" ? targetId : undefined));
	ipcMain.handle("pi:terminal-list", (_event, targetId: unknown) => bridge.list(typeof targetId === "string" ? targetId : undefined));
	ipcMain.handle("pi:terminal-recording-start", (_event, input: unknown) => {
		if (input === null || typeof input !== "object" || !("id" in input) || typeof input.id !== "string") {
			throw new Error("Invalid terminal id");
		}
		return bridge.recordingStart({
			id: input.id,
			...("workspaceId" in input && typeof input.workspaceId === "string" ? { workspaceId: input.workspaceId } : {}),
			...("sessionId" in input && typeof input.sessionId === "string" ? { sessionId: input.sessionId } : {}),
		});
	});
	ipcMain.handle("pi:terminal-recording-stop", (_event, id: unknown) => bridge.recordingStop(terminalId(id)));
	ipcMain.handle("pi:terminal-recording-status", (_event, id: unknown) => bridge.recordingStatus(terminalId(id)));
	ipcMain.handle("pi:terminal-recording-export", async (_event, artifactId: unknown) => {
		if (typeof artifactId !== "string") throw new Error("Invalid artifact id");
		const result = await dialog.showSaveDialog({
			title: "Export terminal recording",
			defaultPath: `${artifactId}.studiocast`,
			filters: [{ name: "Zeta terminal recording", extensions: ["studiocast", "zetacast"] }],
		});
		if (result.canceled || !result.filePath) return { exported: false };
		bridge.recordingExport(artifactId, result.filePath);
		return { exported: true, path: result.filePath };
	});
	return bridge;
}

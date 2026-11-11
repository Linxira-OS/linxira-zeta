/**
 * IPC surface for the SSH execution-target bridge.
 *
 * The renderer calls these through `globalThis.zetaStudioRemote` (preload
 * `contextBridge`). Main never accepts a path to execute or a password to
 * persist: profiles are validated by `RemoteProfileStore`, and credentials
 * exist only inside one connect call.
 */

import { BrowserWindow, ipcMain } from "electron";
import { RemoteBridge } from "./bridge";
import type { RemoteConnectionDraft, RemoteCredentials } from "./protocol";

function stringField(value: unknown, name: string): string {
	if (typeof value !== "string" || value === "") throw new Error(`Invalid ${name}`);
	return value;
}

function credentials(value: unknown): RemoteCredentials {
	if (value === null || typeof value !== "object" || !("password" in value)) return {};
	return typeof value.password === "string" && value.password !== "" ? { password: value.password } : {};
}

function draft(value: unknown): RemoteConnectionDraft {
	if (value === null || typeof value !== "object") throw new Error("Invalid SSH profile");
	// IPC payload: validated field by field below; the record type only makes
	// the property reads expressible before each `typeof` narrows it.
	const row = value as Record<string, unknown>;
	if (typeof row.name !== "string" || typeof row.host !== "string") throw new Error("Invalid SSH profile");
	return {
		name: row.name,
		host: row.host,
		authMode: row.authMode === "password" ? "password" : "agent",
		networkMode: row.networkMode === "remote-only" || row.networkMode === "local-only" ? row.networkMode : "remote-first",
		...(typeof row.id === "string" ? { id: row.id } : {}),
		...(typeof row.user === "string" ? { user: row.user } : {}),
		...(typeof row.port === "number" ? { port: row.port } : {}),
		...(typeof row.installRoot === "string" ? { installRoot: row.installRoot } : {}),
		...(typeof row.localProxyUrl === "string" ? { localProxyUrl: row.localProxyUrl } : {}),
	};
}

export interface RemoteIpcOptions {
	readonly userData: string;
	readonly log: (message: string) => void;
}

export function registerRemoteBridge(options: RemoteIpcOptions): RemoteBridge {
	const broadcast = (channel: string, payload: unknown): void => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(channel, payload);
		}
	};
	const bridge = new RemoteBridge({
		userData: options.userData,
		log: options.log,
		changed: inventory => broadcast("pi:remote-changed", inventory),
		event: envelope => broadcast("pi:remote-event", envelope),
	});

	ipcMain.handle("pi:remote-list", () => bridge.inventory());
	ipcMain.handle("pi:remote-save", (_event, value: unknown) => bridge.save(draft(value)));
	ipcMain.handle("pi:remote-remove", (_event, id: unknown) => bridge.remove(stringField(id, "id")));
	ipcMain.handle("pi:remote-connect", (_event, id: unknown, value: unknown) => bridge.connect(stringField(id, "id"), credentials(value)));
	ipcMain.handle("pi:remote-disconnect", (_event, id: unknown) => bridge.disconnect(stringField(id, "id")));
	ipcMain.handle("pi:remote-approve", (_event, id: unknown) => bridge.approveDeployment(stringField(id, "id")));
	ipcMain.handle("pi:remote-select", (_event, id: unknown) => bridge.select(id === null ? null : stringField(id, "id")));
	ipcMain.handle("pi:remote-directories", (_event, id: unknown, path: unknown) => bridge.directories(stringField(id, "id"), typeof path === "string" ? path : undefined));
	ipcMain.handle("pi:remote-register", (_event, id: unknown, path: unknown) => bridge.register(stringField(id, "id"), stringField(path, "path")));
	ipcMain.handle("pi:remote-bootstrap", (_event, id: unknown) => bridge.bootstrap(stringField(id, "id")));
	ipcMain.handle("pi:remote-query", (_event, id: unknown, request: unknown) => bridge.query(stringField(id, "id"), request));
	ipcMain.handle("pi:remote-command", (_event, id: unknown, request: unknown) => bridge.command(stringField(id, "id"), request));
	ipcMain.handle("pi:remote-install-runtime", (_event, id: unknown) => bridge.installRuntime(stringField(id, "id")));
	ipcMain.handle("pi:remote-retry-network", (_event, id: unknown) => bridge.retryNetwork(stringField(id, "id")));
	return bridge;
}

/** Window-owned IPC for the Host PTY transport and desktop recordings. */
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import type { DesktopHostConnection } from "../host-http";
import { TerminalBridge } from "./bridge";
import { parseTerminalCreate, terminalDimension, terminalString } from "./validation";

export interface TerminalIpcOptions {
	readonly ipc: Pick<IpcMain, "handle">;
	readonly pickExport: (name: string) => Promise<string | undefined>;
	readonly userData: string;
	readonly connection: (targetId?: string) => DesktopHostConnection;
	readonly isTrustedSender: (sender: WebContents) => boolean;
}

export function registerTerminalBridge(options: TerminalIpcOptions): TerminalBridge {
	const owners = new Map<string, { sender: WebContents; teardown(): void }>();
	const documents = new Map<WebContents, { sender: WebContents; teardown(): void }>();
	const trusted = (event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">) => {
		const { sender, senderFrame } = event;
		if (sender.isDestroyed() || senderFrame !== sender.mainFrame || !options.isTrustedSender(sender)) throw new Error("Untrusted terminal request");
		const existing = documents.get(sender);
		if (existing) return existing;
		const document = { sender, teardown() {
			if (documents.get(sender) !== document) return;
			documents.delete(sender);
			sender.removeListener("destroyed", document.teardown);
			sender.removeListener("did-navigate", document.teardown);
			sender.removeListener("render-process-gone", document.teardown);
			sender.removeListener("did-start-navigation", navigate);
			for (const [id, owner] of owners) if (owner === document) { bridge.detach(id); owners.delete(id); }
		} };
		const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (mainFrame && !inPlace) document.teardown(); };
		documents.set(sender, document);
		sender.once("destroyed", document.teardown);
		sender.once("did-navigate", document.teardown);
		sender.once("render-process-gone", document.teardown);
		sender.on("did-start-navigation", navigate);
		return document;
	};
	const owned = (event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">, value: unknown): string => {
		const document = trusted(event);
		const id = terminalString(value, "terminal id", 64);
		if (owners.get(id) !== document) throw new Error("Terminal is not owned by this window");
		return id;
	};
	const send = (id: string, channel: string, payload: unknown): void => {
		const document = owners.get(id), sender = document?.sender;
		if (sender && documents.get(sender) === document && !sender.isDestroyed() && options.isTrustedSender(sender)) sender.send(channel, payload);
	};
	const bridge = new TerminalBridge({
		userData: options.userData,
		connection: options.connection,
		data: (id, data, bytes) => send(id, "pi:terminal-data", { id, data, bytes }),
		exit: id => send(id, "pi:terminal-exit", { id }),
	});

	options.ipc.handle("pi:terminal-create", async (event, value: unknown) => {
		const document = trusted(event), sender = document.sender;
		const info = await bridge.create(parseTerminalCreate(value), id => {
			if (sender.isDestroyed() || documents.get(sender) !== document || !options.isTrustedSender(sender)) throw new Error("Terminal window closed");
			const owner = owners.get(id);
			if (owner && owner !== document) throw new Error("Terminal is already owned by another window");
			owners.set(id, document);
		});
		if (sender.isDestroyed() || documents.get(sender) !== document || !options.isTrustedSender(sender)) throw new Error("Terminal window closed");
		return info;
	});
	options.ipc.handle("pi:terminal-write", (event, id: unknown, data: unknown) => {
		const terminal = owned(event, id);
		if (typeof data !== "string" || Buffer.byteLength(data, "utf8") > 65_536) throw new Error("Invalid terminal data");
		bridge.write(terminal, data);
	});
	options.ipc.handle("pi:terminal-resize", (event, id: unknown, cols: unknown, rows: unknown) =>
		bridge.resize(owned(event, id), terminalDimension(cols, "cols"), terminalDimension(rows, "rows")),
	);
	options.ipc.handle("pi:terminal-dispose", async (event, id: unknown) => {
		const terminal = owned(event, id);
		try { await bridge.dispose(terminal); }
		finally { owners.delete(terminal); }
	});
	for (const kind of ["profiles", "list"] as const) options.ipc.handle(`pi:terminal-${kind}`, (event, targetId: unknown) => {
		trusted(event);
		return bridge[kind](targetId === undefined ? undefined : terminalString(targetId, "target id"));
	});
	options.ipc.handle("pi:terminal-recording-start", (event, input: unknown) => {
		if (!input || typeof input !== "object" || Array.isArray(input) || !("id" in input) || Object.keys(input).some(key => !["id", "workspaceId", "sessionId"].includes(key))) throw new Error("Invalid terminal recording");
		return bridge.recordingStart({
			id: owned(event, input.id),
			...("workspaceId" in input && input.workspaceId !== undefined ? { workspaceId: terminalString(input.workspaceId, "workspace id") } : {}),
			...("sessionId" in input && input.sessionId !== undefined ? { sessionId: terminalString(input.sessionId, "session id") } : {}),
		});
	});
	options.ipc.handle("pi:terminal-recording-stop", (event, id: unknown) => bridge.recordingStop(owned(event, id)));
	options.ipc.handle("pi:terminal-recording-status", (event, id: unknown) => bridge.recordingStatus(owned(event, id)));
	options.ipc.handle("pi:terminal-recording-export", async (event, artifactId: unknown) => {
		const document = trusted(event);
		const artifact = terminalString(artifactId, "artifact id", 160);
		if (!bridge.artifactPath(artifact)) throw new Error("Recording not found");
		const destination = await options.pickExport(artifact);
		if (!destination) return { exported: false };
		if (documents.get(event.sender) !== document || event.sender.isDestroyed() || !options.isTrustedSender(event.sender)) throw new Error("Terminal window closed");
		bridge.recordingExport(artifact, destination);
		return { exported: true };
	});
	return bridge;
}

import { randomUUID } from "node:crypto";
import type { IpcMain, WebContents, WebFrameMain } from "electron";
import { FILE_RESOURCE_CHANNELS as channels } from "./file-resources-shared";
import type { FileResources } from "./file-resources";

interface FileDocument { sender: WebContents; frame: WebFrameMain; dirty: number; teardown(): void }
export interface FileViewerHandle {
	hasDirty(): boolean;
	requestClose(owner?: number): Promise<boolean>;
	allowsRequest(url: string, sender: WebContents, frame: WebFrameMain | null | undefined, resourceType: string): boolean;
	dispose(): void;
}

/** Leases and close decisions belong to the document that opened them. */
export function registerFileViewerIpc(options: {
	ipc: Pick<IpcMain, "handle" | "removeHandler">;
	trusted(sender: WebContents): boolean;
	resources: FileResources;
	pickExport(name: string): Promise<string | undefined>;
	show(owner: number): void;
}): FileViewerHandle {
	const documents = new Map<number, FileDocument>();
	const requests = new Map<string, { owner: number; resolve(allow: boolean): void; timer: NodeJS.Timeout }>();
	const finish = (id: string, allow: boolean) => {
		const pending = requests.get(id);
		if (pending) { clearTimeout(pending.timer); requests.delete(id); pending.resolve(allow); }
	};
	const register = (channel: string, action: (document: FileDocument, ...args: unknown[]) => unknown) => {
		options.ipc.handle(channel, ({ sender, senderFrame }, ...args: unknown[]) => {
			if (sender.isDestroyed() || senderFrame !== sender.mainFrame || !options.trusted(sender)) throw new Error("Untrusted file viewer request");
			let document = documents.get(sender.id);
			if (!document) {
				document = { sender, frame: sender.mainFrame, dirty: 0, teardown() {
					if (documents.get(sender.id) !== document) return;
					documents.delete(sender.id);
					options.resources.releaseOwner(sender.id);
					sender.removeListener("destroyed", document!.teardown);
					sender.removeListener("did-navigate", document!.teardown);
					sender.removeListener("render-process-gone", document!.teardown);
					sender.removeListener("did-start-navigation", navigate);
					for (const [id, pending] of requests) if (pending.owner === sender.id) finish(id, false);
				} };
				documents.set(sender.id, document);
				const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (mainFrame && !inPlace) document!.teardown(); };
				sender.on("did-start-navigation", navigate);
				sender.once("destroyed", document.teardown);
				sender.once("did-navigate", document.teardown);
				sender.once("render-process-gone", document.teardown);
			}
			return action(document, ...args);
		});
	};
	const open = async (document: FileDocument, input: unknown) => {
		const resource = await options.resources.open(input, document.sender.id);
		if (document.sender.isDestroyed() || documents.get(document.sender.id) !== document || !options.trusted(document.sender)) {
			options.resources.release(resource.id, document.sender.id);
			throw new Error("File window closed");
		}
		return resource;
	};
	register(channels.open, open);
	register(channels.release, (document, id) => {
		if (typeof id !== "string") throw new Error("Invalid file resource id");
		options.resources.release(id, document.sender.id);
	});
	register(channels.export, async (document, input) => {
		const resource = await open(document, input);
		try {
			const name = resource.file.name.replace(/[\\/<>:"|?*\u0000-\u001f]/g, "_").slice(0, 200) || "download";
			const destination = await options.pickExport(name);
			if (!destination) return false;
			options.resources.get(resource.id, document.sender.id);
			await options.resources.copy(resource.id, destination);
			return true;
		} finally { options.resources.release(resource.id, document.sender.id); }
	});
	register(channels.dirty, (document, count) => {
		if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > 10_000) throw new Error("Invalid dirty file count");
		document.dirty = count;
	});
	register(channels.finishClose, (document, id, allow) => {
		if (typeof id !== "string" || typeof allow !== "boolean") throw new Error("Invalid file close decision");
		if (requests.get(id)?.owner === document.sender.id) finish(id, allow);
	});
	return {
		hasDirty: () => [...documents.values()].some(document => document.dirty > 0 && !document.sender.isDestroyed()),
		allowsRequest(url, sender, frame, resourceType) {
			const document = documents.get(sender.id);
			if (!document || document.sender !== sender || document.frame !== sender.mainFrame || !options.trusted(sender) || !options.resources.allowsRequest(url, sender.id) || resourceType === "mainFrame") return false;
			if (frame === document.frame) return true;
			// A sandboxed file frame may only continue reading its own lease. Its
			// scripts never gain access to another lease owned by the same window.
			return frame?.parent === document.frame && (frame.url === url || resourceType === "subFrame" && frame.url === "about:blank");
		},
		async requestClose(owner) {
			const dirty = [...documents.values()].filter(document => document.dirty > 0 && !document.sender.isDestroyed() && (owner === undefined || document.sender.id === owner));
			const answers = await Promise.all(dirty.map(document => {
				const { promise, resolve } = Promise.withResolvers<boolean>();
				const id = randomUUID();
				const timer = setTimeout(() => finish(id, false), 60_000);
				requests.set(id, { owner: document.sender.id, resolve, timer });
				options.show(document.sender.id);
				document.sender.send(channels.closeRequested, id);
				return promise;
			}));
			return answers.every(Boolean);
		},
		dispose() {
			for (const channel of Object.values(channels)) if (channel !== channels.closeRequested) options.ipc.removeHandler(channel);
			for (const document of [...documents.values()]) document.teardown();
			options.resources.dispose();
		},
	};
}

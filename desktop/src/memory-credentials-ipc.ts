import type { IpcMain, WebContents } from "electron";
import type { DesktopHostConnection } from "./host-http";
import type { MemoryCredentialStore } from "./memory-credentials";
const channels = { status: "zeta-studio:memory-credential-status", set: "zeta-studio:memory-credential-set", remove: "zeta-studio:memory-credential-remove" } as const;
const route = "/api/v1/memory/credentials";
const key = (target: string | null) => target === null ? "local" : `ssh:${target}`;
export type MemoryCredentialResult = { ok: true; configured: boolean; syncSupported: boolean } | { ok: false; message: string };
export function registerMemoryCredentialIpc(options: {
	ipc: Pick<IpcMain, "handle" | "removeHandler">;
	trusted(sender: WebContents): boolean;
	store: MemoryCredentialStore;
	activeTarget(): string | null;
	connection(targetId?: string): DesktopHostConnection;
	connectedTargets(): readonly (string | null)[];
}) {
	let disposed = false;
	const queues = new Map<string, Promise<void>>();
	const sync = (target: string | null, captured?: DesktopHostConnection): Promise<void> => {
		const id = key(target);
		let connection: DesktopHostConnection;
		try { connection = captured ?? options.connection(target ?? undefined); } catch (error) { return Promise.reject(error); }
		const pending = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
			if (disposed) throw new Error("Memory credential service stopped");
			const entries = await options.store.list(id);
			const status = await connection.gateway<{ supported?: boolean }>(route);
			if (status.supported !== true) throw new Error("Host does not support memory credentials");
			if (disposed) throw new Error("Memory credential service stopped");
			await connection.gateway(route, { method: "POST", body: JSON.stringify(entries) });
		}).finally(() => { if (queues.get(id) === pending) queues.delete(id); });
		queues.set(id, pending);
		return pending;
	};
	const refresh = () => { for (const target of options.connectedTargets()) void sync(target).catch(() => {}); };
	const timer = setInterval(refresh, 30_000);
	timer.unref();
	for (const action of ["status", "set", "remove"] as const) {
		options.ipc.handle(channels[action], async ({ sender, senderFrame }, raw: unknown): Promise<MemoryCredentialResult> => {
			if (disposed || sender.isDestroyed() || senderFrame !== sender.mainFrame || !options.trusted(sender)) throw new Error("Untrusted memory credential request");
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "Invalid memory credential request" };
			const input = raw as Record<string, unknown>;
			if (Object.keys(input).some(field => !["targetId", "url", ...(action === "set" ? ["token"] : [])].includes(field)) || typeof input.url !== "string" || input.url.length > 4096 || input.targetId !== options.activeTarget()) return { ok: false, message: "Execution target changed; refresh settings" };
			const target = input.targetId as string | null;
			let captured: DesktopHostConnection | undefined;
			try { captured = options.connection(target ?? undefined); } catch { /* A disconnected target can still save its encrypted local entry. */ }
			try {
				if (action === "set") {
					if (typeof input.token !== "string") return { ok: false, message: "Enter a token" };
					await options.store.set(key(target), input.url, input.token);
				} else if (action === "remove") await options.store.set(key(target), input.url, undefined);
				let supported = false;
				try { if (captured) { await sync(target, captured); supported = true; } } catch { /* Saved locally; reconnect the exact target to deliver it. */ }
				return { ok: true, configured: await options.store.has(key(target), input.url), syncSupported: supported };
			} catch { return { ok: false, message: "Secure storage is unavailable or the service URL is invalid" }; }
		});
	}
	return { refresh, dispose() { disposed = true; clearInterval(timer); for (const channel of Object.values(channels)) options.ipc.removeHandler(channel); } };
}

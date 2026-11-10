/**
 * Browser implementation of the Studio terminal surface, backed by the
 * gateway's PTY routes. The Electron preload keeps its own implementation;
 * nothing here requires Electron or a native shell in the renderer.
 */

import {
	gatewayTerminal,
	type GatewayTerminalInfo,
	type TerminalConnection,
	type TerminalProfileCatalog,
} from "./gatewayTerminal";
import type { StudioTerminalApi, StudioTerminalCreateInput, StudioTerminalSessionInfo } from "./api";

interface AttachedConnection {
	connection: TerminalConnection;
	info: GatewayTerminalInfo;
	ended: boolean;
}

export interface BrowserTerminalApi extends StudioTerminalApi {
	profiles(): Promise<TerminalProfileCatalog>;
	list(): Promise<{ terminals: Array<Record<string, unknown>> }>;
}

export function createBrowserTerminalApi(): BrowserTerminalApi {
	const connections = new Map<string, AttachedConnection>();
	const dataListeners = new Set<(event: { id: string; data: string }) => void>();
	const exitListeners = new Set<(event: { id: string }) => void>();
	let sequence = 0;

	const emitExit = (id: string): void => {
		for (const listener of exitListeners) listener({ id });
	};

	const attach = (info: GatewayTerminalInfo): void => {
		const connection = gatewayTerminal.connect(info, {
			onData: data => {
				for (const listener of dataListeners) listener({ id: info.id, data });
			},
			onControl: frame => {
				if (frame.event === "exit" || frame.event === "session_ended") {
					const attached = connections.get(info.id);
					if (attached) attached.ended = true;
					emitExit(info.id);
				}
			},
			onError: message => {
				// A dropped socket is surfaced as an exit only after reconnect gives
				// up; the gateway client already retries with a fresh ticket.
				console.warn(`[terminal ${info.id}] ${message}`);
			},
		});
		connections.set(info.id, { connection, info, ended: false });
	};

	return {
		async create(input: StudioTerminalCreateInput = {}): Promise<StudioTerminalSessionInfo> {
			sequence += 1;
			const instanceId = input.instanceId ?? `studio-${Date.now().toString(36)}-${sequence}`;
			const info = await gatewayTerminal.ensure({
				cols: input.cols ?? 80,
				rows: input.rows ?? 24,
				instanceId,
				...(input.profileId ? { profileId: input.profileId } : {}),
				...(input.cwd ? { cwd: input.cwd } : {}),
			});
			attach(info);
			return {
				id: info.id,
				name: info.shell,
				cwd: info.cwd,
				profile: info.profile,
				instance: info.instance,
				reused: info.reused ?? false,
			};
		},
		write(id: string, data: string): void {
			connections.get(id)?.connection.send(data);
		},
		resize(id: string, cols: number, rows: number): Promise<void> {
			return gatewayTerminal.resize(id, cols, rows).then(() => undefined);
		},
		async dispose(id: string): Promise<void> {
			const attached = connections.get(id);
			connections.delete(id);
			attached?.connection.dispose();
			await gatewayTerminal.remove(id);
		},
		onData(listener): () => void {
			dataListeners.add(listener);
			return () => dataListeners.delete(listener);
		},
		onExit(listener): () => void {
			exitListeners.add(listener);
			return () => exitListeners.delete(listener);
		},
		profiles(): Promise<TerminalProfileCatalog> {
			return gatewayTerminal.listProfiles();
		},
		list(): Promise<{ terminals: Array<Record<string, unknown>> }> {
			return gatewayTerminal.list() as unknown as Promise<{ terminals: Array<Record<string, unknown>> }>;
		},
	};
}

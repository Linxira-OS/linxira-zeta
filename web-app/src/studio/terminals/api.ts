/**
 * The terminal surface Work Studio consumes.
 *
 * Two implementations satisfy it: the Electron preload bridge
 * (`window.zetaStudioTerminal`, unchanged) and the browser gateway client
 * (`browserTerminalApi.ts`). React code talks to this interface only, so the
 * panel does not know which one is present.
 */

import type { TerminalProfileCatalog } from "./gatewayTerminal";

export interface StudioTerminalCreateInput {
	cols?: number;
	rows?: number;
	targetId?: string;
	workspaceId?: string;
	instanceId?: string;
	profileId?: string;
	cwd?: string;
}

export interface StudioTerminalSessionInfo {
	readonly id: string;
	readonly name: string;
	readonly cwd: string;
	readonly profile?: string | null;
	readonly instance?: string;
	readonly reused?: boolean;
}

export interface StudioTerminalApi {
	create(input?: StudioTerminalCreateInput): Promise<StudioTerminalSessionInfo>;
	write(id: string, data: string): Promise<void> | void;
	resize(id: string, cols: number, rows: number): Promise<void> | void;
	dispose(id: string): Promise<void> | void;
	onData(listener: (event: { id: string; data: string }) => void): () => void;
	onExit(listener: (event: { id: string }) => void): () => void;
	/** Browser-only: local shell catalog for the picker. */
	profiles?(): Promise<TerminalProfileCatalog>;
	list?(): Promise<{ terminals: Array<Record<string, unknown>> }>;
}

/** Adapt the Electron preload object (no profiles, no list) to the surface. */
export function preloadTerminalApi(bridge: NonNullable<typeof globalThis.zetaStudioTerminal>): StudioTerminalApi {
	return {
		create: input => bridge.create(input),
		write: (id, data) => bridge.write(id, data),
		resize: (id, cols, rows) => bridge.resize(id, cols, rows),
		dispose: id => bridge.dispose(id),
		onData: listener => bridge.onData(listener),
		onExit: listener => bridge.onExit(listener),
	};
}

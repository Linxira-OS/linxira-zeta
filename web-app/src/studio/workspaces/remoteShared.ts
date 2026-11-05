/**
 * Type surface for the desktop SSH bridge (`globalThis.zetaStudioRemote`).
 *
 * The renderer was ported from Studio's own app, where these types lived in
 * `desktop/src/remote/shared` (the Electron main-process module that owns the
 * SSH connections). Zeta's build ships only the renderer, so the bridge is a
 * type-only boundary here: the preload exposes an object with exactly this
 * shape, and the renderer never imports the desktop implementation.
 */
import type {
	ClientBootstrap,
	ClientCommandAccepted,
	ClientCommandRequest,
	ClientEvent,
	ClientQueryRequest,
	ClientQueryResponse,
	CommandName,
	QueryName,
	Unsubscribe,
} from "@linxiraos/studio-contract";

/** Target OS reported by the remote probe; unknown systems leave it unset. */
export type RemotePlatform = "win32" | "darwin" | "linux";

/** How the desktop authenticates to the remote host. */
export type RemoteAuthMode = "agent" | "password";

/** Egress policy for the remote install/runtime downloads. */
export type RemoteNetworkMode = "remote-first" | "remote-only" | "local-only";

/** Connection lifecycle reported by the desktop main process. */
export type RemoteConnectionState =
	| "disconnected"
	| "connecting"
	| "awaiting-approval"
	| "recovering"
	| "degraded"
	| "synchronizing"
	| "connected"
	| "failed";

/** Stage of the one-time remote environment preparation. */
export type RemotePreparationStage =
	| "probe"
	| "confirmation"
	| "download"
	| "upload"
	| "install"
	| "verify"
	| "configure"
	| "connect";

/** A saved SSH connection. */
export interface RemoteConnectionProfile {
	readonly id: string;
	readonly name: string;
	readonly host: string;
	readonly user?: string | undefined;
	readonly port?: number | undefined;
	readonly authMode: RemoteAuthMode;
	readonly networkMode?: RemoteNetworkMode | undefined;
	readonly platform: RemotePlatform;
	readonly installRoot?: string | undefined;
	readonly localProxyUrl?: string | undefined;
	/** Last directory registered on this host, used to prefill the picker. */
	readonly lastDirectory?: string | undefined;
}

/** Editable fields sent back to the desktop when saving a connection. */
export interface RemoteConnectionDraft {
	readonly id?: string | undefined;
	readonly name: string;
	readonly host: string;
	readonly authMode: RemoteAuthMode;
	readonly networkMode: RemoteNetworkMode;
	readonly installRoot?: string | undefined;
	readonly localProxyUrl?: string | undefined;
	readonly user?: string | undefined;
	readonly port?: number | undefined;
}

/** Credentials handed to the desktop only for the duration of a connect call. */
export interface RemoteCredentials {
	password: string;
}

/** Live state of one connection, streamed by the desktop. */
export interface RemoteConnectionStatus {
	readonly id: string;
	readonly state: RemoteConnectionState;
	/** Background work that blocks writes even while connected. */
	readonly operation?: "installing-runtime" | undefined;
	readonly generation?: number | undefined;
	readonly message?: string | undefined;
	readonly stage?: RemotePreparationStage | undefined;
	readonly platform?: RemotePlatform | undefined;
	readonly arch?: string | undefined;
	readonly installRoot?: string | undefined;
	readonly receivedBytes?: number | undefined;
	readonly totalBytes?: number | undefined;
	readonly attempt?: number | undefined;
	readonly maxAttempts?: number | undefined;
	readonly retryAt?: string | undefined;
	readonly hostRestarted?: boolean | undefined;
	readonly networkMessage?: string | undefined;
}

/** Every saved connection plus the live status of each. */
export interface RemoteInventory {
	readonly profiles: readonly RemoteConnectionProfile[];
	readonly statuses: readonly RemoteConnectionStatus[];
	/** Connection currently selected by the user, or null for this computer. */
	readonly activeId?: string | null | undefined;
}

/** One browsable remote directory listing. */
export interface RemoteDirectoryList {
	readonly path: string;
	readonly parent: string;
	readonly directories: readonly { readonly name: string; readonly path: string }[];
}

/** An event pushed by the desktop for one remote runtime. */
export interface RemoteEventEnvelope {
	readonly id: string;
	readonly generation: number;
	readonly event: ClientEvent;
}

/**
 * The `globalThis.zetaStudioRemote` bridge. Every operation is keyed by the
 * connection id, so one renderer can drive several remotes at once.
 */
export interface RemoteApi {
	list(): Promise<RemoteInventory>;
	onChanged(listener: () => void): Unsubscribe;
	save(draft: RemoteConnectionDraft): Promise<RemoteConnectionProfile>;
	remove(id: string): Promise<void>;
	connect(id: string, credentials?: RemoteCredentials): Promise<void>;
	disconnect(id: string): Promise<void>;
	approveDeployment(id: string): Promise<void>;
	select(id: string | null): Promise<void>;
	directories(id: string, path?: string): Promise<RemoteDirectoryList>;
	register(id: string, path: string): Promise<void>;
	bootstrap(id: string): Promise<ClientBootstrap>;
	query<TName extends QueryName>(id: string, request: ClientQueryRequest<TName>): Promise<ClientQueryResponse<TName>>;
	command<TName extends CommandName>(id: string, request: ClientCommandRequest<TName>): Promise<ClientCommandAccepted<TName>>;
	onEvent(listener: (envelope: RemoteEventEnvelope) => void): Unsubscribe;
	installRuntime(id: string): Promise<{ readonly installed: boolean }>;
	retryNetwork(id: string): Promise<void>;
}

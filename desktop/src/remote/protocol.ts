/**
 * Desktop SSH execution-target contract.
 *
 * Mirrors `web-app/src/studio/workspaces/remoteShared.ts`; the renderer treats
 * `globalThis.zetaStudioRemote` as this shape and never imports the desktop
 * implementation. Every operation is keyed by a saved connection id so one
 * renderer can drive several remotes without sharing state.
 *
 * Trust boundary: the remote is reached only through `ssh -L` to its loopback
 * Studio host. A disconnected or reconnecting generation must never fall back
 * to the local service; callers get `RESYNC_REQUIRED` instead.
 */

export type RemotePlatform = "win32" | "darwin" | "linux";
export type RemoteAuthMode = "agent" | "password";
export type RemoteNetworkMode = "remote-first" | "remote-only" | "local-only";

export type RemoteConnectionState =
	| "disconnected"
	| "connecting"
	| "awaiting-approval"
	| "recovering"
	| "degraded"
	| "synchronizing"
	| "connected"
	| "failed";

export type RemotePreparationStage =
	| "probe"
	| "confirmation"
	| "download"
	| "upload"
	| "install"
	| "verify"
	| "configure"
	| "connect";

export interface RemoteConnectionProfile {
	readonly id: string;
	readonly name: string;
	readonly host: string;
	readonly user?: string;
	readonly port?: number;
	readonly authMode: RemoteAuthMode;
	readonly networkMode?: RemoteNetworkMode;
	readonly platform: RemotePlatform;
	readonly installRoot?: string;
	readonly localProxyUrl?: string;
	readonly lastDirectory?: string;
}

export interface RemoteConnectionDraft {
	readonly id?: string;
	readonly name: string;
	readonly host: string;
	readonly authMode: RemoteAuthMode;
	readonly networkMode: RemoteNetworkMode;
	readonly installRoot?: string;
	readonly localProxyUrl?: string;
	readonly user?: string;
	readonly port?: number;
}

/** Credentials live only for the duration of one connect call. */
export interface RemoteCredentials {
	readonly password?: string;
}

export interface RemoteConnectionStatus {
	readonly id: string;
	readonly state: RemoteConnectionState;
	readonly operation?: "installing-runtime";
	readonly generation?: number;
	readonly message?: string;
	readonly stage?: RemotePreparationStage;
	readonly platform?: RemotePlatform;
	readonly arch?: string;
	readonly installRoot?: string;
	readonly receivedBytes?: number;
	readonly totalBytes?: number;
	readonly attempt?: number;
	readonly maxAttempts?: number;
	readonly retryAt?: string;
	readonly hostRestarted?: boolean;
	readonly networkMessage?: string;
}

export interface RemoteInventory {
	readonly profiles: readonly RemoteConnectionProfile[];
	readonly statuses: readonly RemoteConnectionStatus[];
	readonly activeId?: string | null;
}

export interface RemoteDirectoryList {
	readonly path: string;
	readonly parent: string;
	readonly directories: readonly { readonly name: string; readonly path: string }[];
}

export interface RemoteEventEnvelope {
	readonly id: string;
	readonly generation: number;
	readonly event: unknown;
}

/** Stable error code the renderer maps to "resync, do not retry locally". */
export const RESYNC_REQUIRED = "RESYNC_REQUIRED";

/** Reject an ssh operand that could be parsed as an option or config escape. */
export function safeSshToken(value: string, what: string): string {
	const token = value.trim();
	if (token === "" || token.startsWith("-") || /[\r\n\0]/.test(token)) {
		throw new Error(`Invalid ${what}: ${JSON.stringify(value)}`);
	}
	return token;
}

/** `host` accepts a DNS name, IPv4/IPv6 literal, or an ~/.ssh/config alias. */
export function normalizeHost(host: string): string {
	const value = host.trim();
	if (value === "" || value.startsWith("-") || /[\s\r\n\0]/.test(value)) {
		throw new Error(`Invalid SSH host: ${JSON.stringify(host)}`);
	}
	return value;
}

export function normalizePort(port: number | undefined): number | undefined {
	if (port === undefined) return undefined;
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SSH port must be 1-65535");
	return port;
}

export function profilePlatform(value: unknown): RemotePlatform {
	return value === "win32" || value === "darwin" ? value : "linux";
}

/** Platform id from a remote `uname -s` / `uname -o` answer. */
export function platformFromProbe(system: string): RemotePlatform {
	const value = system.toLowerCase();
	if (value.includes("darwin") || value.includes("mac")) return "darwin";
	if (value.includes("mingw") || value.includes("msys") || value.includes("cygwin") || value.includes("windows")) return "win32";
	return "linux";
}

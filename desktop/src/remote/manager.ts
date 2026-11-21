/**
 * Minimal remote-manager surface consumed by the tmux control client.
 *
 * The Electron shell owns the actual SSH bridge; tmux only needs a read-only
 * view of the connected profile and a peer request channel. This adapter keeps
 * the shared tmux code typed without creating a second remote authority.
 */
import type { RemoteConnectionProfile, RemoteCredentials } from "./protocol.js";

export interface RemotePeer {
  request<T>(operation: string, input: unknown): Promise<T>;
}

export interface RemoteSessionView {
  readonly environment: { readonly platform: "win32" | "darwin" | "linux" };
  readonly transport: { readonly peer: RemotePeer };
}

export interface RemoteConnectionManager {
  profile(targetId: string): RemoteConnectionProfile;
  authentication(targetId: string): RemoteCredentials | undefined;
  assertWritable(targetId: string): void;
  get(targetId: string): RemoteSessionView;
}

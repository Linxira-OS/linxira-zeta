import type { RemoteConnectionProfile, RemoteCredentials } from "./protocol.js";

/** One-shot SSH askpass environment; absent means key/agent auth. */
export interface SshAuthentication {
  readonly env: NodeJS.ProcessEnv;
  dispose(): void;
}

/**
 * Password authentication is deliberately not retained by the Electron remote
 * bridge. tmux uses key/agent auth, or the caller supplies a fresh one-shot
 * helper through its own spawn environment.
 */
export function sshAuthenticationRequest(
  _profile: RemoteConnectionProfile,
  _credentials: RemoteCredentials | undefined,
): SshAuthentication | undefined {
  return undefined;
}

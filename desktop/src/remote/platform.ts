import { posix, win32 } from "node:path";
import type { RemoteConnectionProfile } from "./protocol.js";

export interface SshConnection {
  readonly profile: RemoteConnectionProfile;
}

export function systemSshExecutable(): string {
  return process.env.ZETA_SSH_BINARY?.trim() || "ssh";
}

/** Args for an interactive SSH command on the selected remote. */
export function sshArguments(profile: RemoteConnectionProfile): string[] {
  const args = [
    "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "StrictHostKeyChecking=yes",
  ];
  if (profile.port !== undefined) args.push("-p", String(profile.port));
  args.push("--", `${profile.user ? `${profile.user}@` : ""}${profile.host}`);
  return args;
}

export function remotePathJoin(directory: string, child?: string): string {
  const join = directory.includes("\\") ? win32.join : posix.join;
  return child === undefined ? directory : join(directory, child);
}

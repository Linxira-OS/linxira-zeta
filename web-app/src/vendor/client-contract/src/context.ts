import type { SessionId, WorkspaceId } from "./ids.js";

/** Opaque workspace and optional session identity for an independent context. */
export interface ClientContextScope {
  readonly workspaceId: WorkspaceId;
  readonly sessionId?: SessionId;
}

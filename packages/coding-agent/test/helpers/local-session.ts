import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { type AgentSessionHandle, isLocalAgentSession } from "@linxiraos/zeta/session/agent-session-handle";

/** Narrow a registry/lifecycle/reviver session handle to the in-process session it is in these tests. */
export function localSession(session: AgentSessionHandle | null | undefined): AgentSession {
	if (!session || !isLocalAgentSession(session)) throw new Error("Expected a live session homed on this thread");
	return session;
}

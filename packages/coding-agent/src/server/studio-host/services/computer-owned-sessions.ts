import { AgentRegistry, type AgentRef } from "../../../registry/agent-registry";
import type { AgentSession } from "../../../session/agent-session";
import type { AgentSessionHandle } from "../../../session/agent-session-handle";
import { computerSessionId } from "../../../tools/computer/session-runtime";

/** Identity and parent links come from the native registry; names and persisted history confer no authority. */
export function ownedComputerSessions(session: AgentSession, disposing = false): AgentSessionHandle[] {
	if (session.isDisposed && !disposing) return [];
	const registry = AgentRegistry.global();
	const refs = registry.list();
	const root = refs.find(ref => ref.session?.instanceKey === session.instanceKey);
	const result: AgentSessionHandle[] = [session];
	if (!root) return result;
	for (const candidate of refs) {
		if (
			!candidate.session ||
			candidate.session.instanceKey === session.instanceKey ||
			Reflect.get(candidate.session, "isDisposed") === true ||
			candidate.status === "parked" ||
			candidate.status === "aborted"
		)
			continue;
		const seen = new Set<string>();
		let ancestor: AgentRef | undefined = candidate;
		while (ancestor && !seen.has(ancestor.id)) {
			if (ancestor === root) {
				result.push(candidate.session);
				break;
			}
			seen.add(ancestor.id);
			ancestor = ancestor.parentId ? registry.get(ancestor.parentId) : undefined;
		}
	}
	return result;
}

export function ownedComputerAgent(session: AgentSession, sessionId: string): AgentRef | undefined {
	const owned = new Set(ownedComputerSessions(session).map(candidate => candidate.instanceKey));
	return AgentRegistry.global()
		.list()
		.find(ref => !!ref.session && owned.has(ref.session.instanceKey) && computerSessionId(ref.session) === sessionId);
}

import { isAgentViewSession, type AgentViewSession } from "../../../session/agent-session-handle";
import { AgentRegistry } from "../../../registry/agent-registry";
import type { AgentSession } from "../../../session/agent-session";

/** Registry-proven descendants plus the actual main, never an unrelated resident. */
export function ownedStudioSessions(session: AgentSession): AgentViewSession[] {
	if (session.isDisposed) return [];
	const registry = AgentRegistry.global();
	const refs = registry.list();
	const main = refs.find(
		ref => ref.session === session || (!!session.instanceKey && ref.session?.instanceKey === session.instanceKey),
	);
	const result = new Map<string, AgentViewSession>([[session.sessionId, session]]);
	if (!main) return [...result.values()];
	for (const candidate of refs) {
		if (!candidate.session || Reflect.get(candidate.session, "isDisposed") === true) continue;
		const seen = new Set<string>();
		let ref = candidate;
		while (!seen.has(ref.id)) {
			if (ref.id === main.id) {
				if (candidate.session && isAgentViewSession(candidate.session))
					result.set(candidate.session.sessionId, candidate.session);
				break;
			}
			seen.add(ref.id);
			const parent = ref.parentId ? registry.get(ref.parentId) : undefined;
			if (!parent) break;
			ref = parent;
		}
	}
	return [...result.values()];
}

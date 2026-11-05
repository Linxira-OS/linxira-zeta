/**
 * Agent Hub ↔ Zeta gateway handler map.
 *
 * Both reads the hub renders are Studio *queries*, and both have a Zeta route:
 *
 *   `session.agents.list`   → `GET /api/agent/:id/subagents`
 *   `agent.transcript.read` → `GET /api/agent/:id/subagents/:subId/transcript?fromByte=`
 *
 * Commands are deliberately absent. Steering, cancelling, reviving and
 * releasing a child have no gateway route (`agent.send` / `agent.kill` /
 * `agent.revive` / `agent.release`), so leaving them unmapped is what makes
 * those buttons disappear instead of failing behind a fixture. `jobs.inspect`
 * and `job.*` stay unmapped too: the gateway publishes no job surface.
 */

import type { QueryHandler, StudioClientImpl } from "@/lib/studio-client";
import type { QueryName, SessionId } from "@/lib/studio-protocol/contract";
import type { AgentTranscriptPage, StudioAgentSnapshot } from "@/lib/studio-protocol/protocol";
import { fetchRoster, fetchTranscript, type GetJson } from "./gateway";

export function createAgentHubQueries(client: StudioClientImpl): Partial<Record<QueryName, QueryHandler>> {
	const get = client.get as GetJson;
	return {
		"session.agents.list": (async (input: { sessionId: SessionId }) => {
			const agents: StudioAgentSnapshot[] = await fetchRoster(input.sessionId, get);
			return { sessionId: input.sessionId, agents };
		}) as unknown as QueryHandler,

		"agent.transcript.read": (async (input: { agentId: string; cursor?: string; limit?: number }) => {
			const sessionId = client.sessionId;
			if (!sessionId) throw new Error("No active agent session for this transcript");
			// Zeta's reader pages forward from a byte offset; `cursor` is that offset.
			const fromByte = input.cursor === undefined ? 0 : Number(input.cursor);
			if (!Number.isFinite(fromByte)) throw new Error(`Invalid transcript cursor: ${input.cursor}`);
			const page: AgentTranscriptPage = await fetchTranscript(sessionId, input.agentId, fromByte, get);
			return page;
		}) as unknown as QueryHandler,
	};
}

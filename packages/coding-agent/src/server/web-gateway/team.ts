/**
 * Web Gateway — live main-agent facts for the Team graph.
 *
 * `GET /api/agents` is the read face the Studio `team.graph.get` operation uses
 * to learn which top-level agents exist in this process. It deliberately stays
 * a fact route: the graph projection (clusters, edges, gaps) lives in
 * `studio-host/ops/team.ts`, while subagent parentage/assignment continues to
 * come from the existing roster family (`api/agent/[id]/subagents*`).
 *
 * Only root refs register (`AgentRegistry.isRootAgentRef`: `kind === "main"`,
 * no parent). Subagents are never returned here. The registry is
 * process-global, so a host in another process is not visible; that limit is
 * part of the graph's declared gaps rather than papered over here.
 */

import { logger } from "@linxiraos/pi-utils";
import { AgentRegistry, isRootAgentRef, type AgentRef } from "../../registry/agent-registry";
import { readSessionHeaderId } from "../../session/session-loader";

/** Concrete-session fields the handle interface does not expose. */
interface RootSessionExtras {
	readonly sessionName?: string | undefined;
	getVibeModeState?: () => { enabled?: boolean } | undefined;
}

export interface TeamRootAgentFact {
	readonly id: string;
	/** Transcript id the roster route resolves; absent when no transcript exists. */
	readonly sessionId?: string;
	readonly displayName: string;
	readonly status: AgentRef["status"];
	readonly createdAt: number;
	readonly lastActivity: number;
	readonly live: boolean;
	readonly hasTranscript: boolean;
	readonly vibeEnabled: boolean;
	/** Internal hop only: `ops/team.ts` hashes it into a Studio WorkspaceId. */
	readonly cwd?: string;
	readonly activity?: string;
}

async function rootFact(ref: AgentRef): Promise<TeamRootAgentFact> {
	const session = ref.session;
	const extras = session === null ? undefined : (session as unknown as RootSessionExtras);
	let sessionId = session?.sessionManager.getSessionId();
	if (!sessionId && ref.sessionFile) {
		sessionId = await readSessionHeaderId(ref.sessionFile).catch(error => {
			logger.debug("web-gateway: team graph session header read failed", { error: String(error) });
			return undefined;
		});
	}
	const cwd = session?.sessionManager.getCwd();
	return {
		id: ref.id,
		...(sessionId ? { sessionId } : {}),
		displayName: extras?.sessionName?.trim() || ref.displayName,
		status: ref.status,
		createdAt: ref.createdAt,
		lastActivity: ref.lastActivity,
		live: session !== null,
		hasTranscript: ref.sessionFile !== null,
		vibeEnabled: extras?.getVibeModeState?.()?.enabled === true,
		...(cwd ? { cwd } : {}),
		...(ref.activity ? { activity: ref.activity } : {}),
	};
}

/** `GET /api/agents` → every live/recent root agent in this process. */
export async function handleTeamAgentsGet(): Promise<Response> {
	try {
		const roots = AgentRegistry.global()
			.list()
			.filter(isRootAgentRef)
			.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
		const agents = await Promise.all(roots.map(rootFact));
		return Response.json({ agents }, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		logger.error("web-gateway: team agents read failed", { error: String(error) });
		return Response.json({ error: String(error) }, { status: 500 });
	}
}

/**
 * Studio operations — Team relationship graph.
 *
 * Operation → gateway route:
 * - `team.graph.get` → `GET /api/agents` (live root agents, `web-gateway/team.ts`)
 *   plus `GET /api/agent/:sessionId/subagents` (existing spawn roster, through
 *   `readSessionAgents`) and `GET /api/projects` (workspace display names,
 *   through `readWorkspaceNames`). The pure projection lives in
 *   `team-projection.ts`.
 *
 * Only facts that have a producer become nodes and edges:
 * - mains are process root refs, so a host in another process is not visible;
 * - subagents come from the root-scoped roster (live + persisted rows);
 * - spawn edges are registry parentage;
 * - execution mode is read from the live session's vibe state.
 *
 * PM / engineer / secretary roles, PM→main assignments, rooms and the PM↔PM
 * peer group have no producer. They stay absent: the read model names them in
 * `gaps`, and nothing is synthesized to fill the picture.
 */
import { logger } from "@linxiraos/pi-utils";
import type { TeamGraphReadModel, TeamNodeLifetime, WorkspaceId } from "../contract/index.js";
import type { StudioAgentSnapshot } from "../protocol/index.js";
import { gatewayJson, invalid } from "../gateway.js";
import type { StudioFamily } from "../registry.js";
import { readSessionAgents } from "./session.js";
import { LIFETIMES, TEAM_STATUS, projectTeamGraph, type TeamGraphQuery, type TeamMainFact } from "./team-projection.js";
import { readWorkspaceNames } from "./workspace.js";

const AGENTS_ROUTE = "/api/agents";

function mainFact(value: unknown): TeamMainFact | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const record = value as Readonly<Record<string, unknown>>;
	const id = typeof record.id === "string" && record.id !== "" ? record.id : undefined;
	const displayName = typeof record.displayName === "string" ? record.displayName.trim() : undefined;
	const status = typeof record.status === "string" ? TEAM_STATUS[record.status] : undefined;
	const createdAt = record.createdAt;
	const lastActivity = record.lastActivity;
	if (
		id === undefined ||
		displayName === undefined ||
		displayName === "" ||
		status === undefined ||
		typeof createdAt !== "number" ||
		!Number.isFinite(createdAt) ||
		typeof lastActivity !== "number" ||
		!Number.isFinite(lastActivity)
	) {
		return undefined;
	}
	const sessionId = typeof record.sessionId === "string" && record.sessionId !== "" ? record.sessionId : undefined;
	const cwd = typeof record.cwd === "string" && record.cwd !== "" ? record.cwd : undefined;
	const activity = typeof record.activity === "string" && record.activity !== "" ? record.activity : undefined;
	return {
		id,
		...(sessionId ? { sessionId } : {}),
		displayName,
		status,
		createdAt,
		lastActivity,
		live: record.live === true,
		hasTranscript: record.hasTranscript === true,
		vibeEnabled: record.vibeEnabled === true,
		...(cwd ? { cwd } : {}),
		...(activity ? { activity } : {}),
	};
}

/** `GET /api/agents` → validated root facts; undefined rows are dropped, not guessed. */
async function readMains(): Promise<TeamMainFact[]> {
	const body = await gatewayJson<unknown>(AGENTS_ROUTE);
	if (typeof body !== "object" || body === null || !("agents" in body) || !Array.isArray(body.agents)) {
		throw invalid(`${AGENTS_ROUTE} did not return an agents array`);
	}
	const mains: TeamMainFact[] = [];
	for (const value of body.agents) {
		const fact = mainFact(value);
		if (fact !== undefined) mains.push(fact);
	}
	return mains;
}

async function readTeamGraph(input: unknown): Promise<TeamGraphReadModel> {
	if (typeof input !== "object" || input === null || Array.isArray(input)) throw invalid("input must be an object");
	const record = input as Readonly<Record<string, unknown>>;
	if (record.workspaceId !== undefined && typeof record.workspaceId !== "string") {
		throw invalid("workspaceId must be a string");
	}
	if (record.clusterId !== undefined && (typeof record.clusterId !== "string" || record.clusterId === "")) {
		throw invalid("clusterId must be a non-empty string");
	}
	const lifetime = record.lifetime;
	if (lifetime !== undefined && !(LIFETIMES as readonly unknown[]).includes(lifetime)) {
		throw invalid(`lifetime must be one of: ${LIFETIMES.join(", ")}`);
	}

	const [mains, workspaceNames] = await Promise.all([
		readMains(),
		readWorkspaceNames().catch(error => {
			logger.debug("studio-host: team graph workspace names unavailable", { error: String(error) });
			return new Map<WorkspaceId, string>();
		}),
	]);
	const rosters = new Map<string, readonly StudioAgentSnapshot[]>();
	const incompleteMainIds: string[] = [];
	await Promise.all(
		mains.flatMap(main => {
			if (main.sessionId === undefined) return [];
			const sessionId = main.sessionId;
			return [
				readSessionAgents(sessionId)
					.then(rows => {
						rosters.set(sessionId, rows);
					})
					.catch(error => {
						logger.warn("studio-host: team graph roster unavailable", { sessionId, error: String(error) });
						incompleteMainIds.push(main.id);
					}),
			];
		}),
	);

	const query: TeamGraphQuery = {
		...(record.workspaceId !== undefined ? { workspaceId: record.workspaceId as WorkspaceId } : {}),
		...(lifetime !== undefined ? { lifetime: lifetime as TeamNodeLifetime } : {}),
		...(record.clusterId !== undefined ? { clusterId: record.clusterId as string } : {}),
	};
	const graph = projectTeamGraph({ mains, rosters, workspaceNames, generatedAt: new Date() }, query);
	// A failed roster read is reported, not hidden: the page still shows the
	// mains it could read and names the teams whose spawn tree is missing.
	return incompleteMainIds.length === 0 ? graph : { ...graph, incompleteMainIds };
}

/** Team family: the relationship graph read model. */
export const teamOps: StudioFamily = {
	id: "team",
	queries: {
		"team.graph.get": readTeamGraph,
	},
};

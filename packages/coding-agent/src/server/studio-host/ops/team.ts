/**
 * Studio operations — Team relationship graph.
 *
 * Operation → gateway route:
 * - `team.graph.get` → `GET /api/agents` (live root agents, `web-gateway/team.ts`)
 *   plus `GET /api/agent/:sessionId/subagents` (existing spawn roster, through
 *   `readSessionAgents`) and `GET /api/projects` (workspace display names,
 *   through `readWorkspaceNames`). The pure projection lives in
 *   `team-projection.ts`.
 * - The global Team DB (`~/.zeta/data/zeta.db`) supplies the structural rows:
 *   teams, PM workspaces, base repos, bindings, engineers, worktrees, rooms,
 *   room members and PM-owned persistent agents. `team-db.ts` reads one
 *   snapshot; a missing database is an empty inventory, not an error.
 *
 * Every node and edge has a producer:
 * - mains are process root refs, so a host in another process is not visible;
 * - subagents come from the root-scoped roster (live + persisted rows);
 * - a live main whose cwd is a PM workspace or engineer worktree is attached
 *   to that DB record; a DB record with no attached session is `offline`;
 * - spawn edges are registry parentage or a PM-owned Secretary row;
 * - bindings, assignments, room membership and worktree edges are Team DB rows.
 */
import { logger } from "@linxiraos/pi-utils";
import type { TeamGraphReadModel, TeamNodeLifetime, WorkspaceId } from "../contract/index.js";
import type { StudioAgentSnapshot } from "../protocol/index.js";
import { gatewayJson, invalid } from "../gateway.js";
import type { StudioFamily } from "../registry.js";
import { readSessionAgents } from "./session.js";
import { emptyTeamDbFacts, readTeamDbFacts } from "./team-db.js";
import { LIFETIMES, TEAM_STATUS, projectTeamGraph, type TeamGraphQuery, type TeamMainFact } from "./team-projection.js";
import { readWorkspaceNames } from "./workspace.js";
import { teamWorkspaceCommands, teamWorkspaceQueries } from "./team-workspace.js";

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

	let teamDb = emptyTeamDbFacts();
	try {
		teamDb = readTeamDbFacts();
	} catch (error) {
		// A corrupt or locked DB must not hide the live agents the gateway read.
		logger.warn("studio-host: team graph Team DB unavailable", { error: String(error) });
	}

	const query: TeamGraphQuery = {
		...(record.workspaceId !== undefined ? { workspaceId: record.workspaceId as WorkspaceId } : {}),
		...(lifetime !== undefined ? { lifetime: lifetime as TeamNodeLifetime } : {}),
		...(record.clusterId !== undefined ? { clusterId: record.clusterId as string } : {}),
	};
	const graph = projectTeamGraph({ mains, rosters, workspaceNames, teamDb, generatedAt: new Date() }, query);
	// A failed roster read is reported, not hidden: the page still shows the
	// mains it could read and names the teams whose spawn tree is missing.
	return incompleteMainIds.length === 0 ? graph : { ...graph, incompleteMainIds };
}

/** Team family: graph plus the workspace operations used by the Studio pane. */
export const teamOps: StudioFamily = {
	id: "team",
	queries: {
		"team.graph.get": readTeamGraph,
		...teamWorkspaceQueries,
	},
	commands: {
		...teamWorkspaceCommands,
	},
};

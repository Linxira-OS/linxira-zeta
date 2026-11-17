/** Active Team graph reads mesh room membership, Vibe worker views and registry mains.
 * Legacy Super Team operations remain callable but never supply graph facts. */
import { logger } from "@linxiraos/pi-utils";
import type { TeamGraphReadModel, TeamNodeLifetime, WorkspaceId } from "../contract/index.js";
import { AgentRegistry } from "../../../registry/agent-registry.js";
import { VibeSessionRegistry } from "../../../vibe/runtime.js";
import { listTeamSnapshots } from "../../../vibe/team-rooms.js";
import { projectActiveTeamHub } from "../../../vibe/team-hub-data.js";
import { readSessionInfo } from "../../../session/session-listing.js";
import { gatewayJson, invalid } from "../gateway.js";
import type { StudioFamily } from "../registry.js";
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
		teamEnabled: record.teamEnabled === true,
		modeKnown: record.modeKnown === true,
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
	const registry = AgentRegistry.global();
	const vibe = VibeSessionRegistry.global();
	const teams = await Promise.all(
		listTeamSnapshots({ limit: 100 }).map(async rooms => {
			const source = rooms.ownerScope;
			const root = registry.get(source.ownerId);
			const cwd =
				root?.session?.sessionManager.getSessionId() === source.parentSessionId
					? root.session.sessionManager.getCwd()
					: source.parentSessionFile
						? (await readSessionInfo(source.parentSessionFile))?.cwd
						: undefined;
			return {
				snapshot: projectActiveTeamHub(rooms, vibe.view(source), registry),
				sourceSessionId: source.parentSessionId,
				...(cwd ? { cwd } : {}),
			};
		}),
	);

	const query: TeamGraphQuery = {
		...(record.workspaceId !== undefined ? { workspaceId: record.workspaceId as WorkspaceId } : {}),
		...(lifetime !== undefined ? { lifetime: lifetime as TeamNodeLifetime } : {}),
		...(record.clusterId !== undefined ? { clusterId: record.clusterId as string } : {}),
	};
	return projectTeamGraph({ mains, teams, workspaceNames, generatedAt: new Date() }, query);
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

/**
 * Team graph read model: projection from real facts and the host query path.
 *
 * The projection is pure, so these cases pin the topology rules (cluster per
 * main, nested spawn parentage, derived lifetime, mode) without a running
 * session. The query cases pin the contract shape and the honest empty state.
 */
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AgentRegistry } from "../src/registry/agent-registry.js";
import type { StudioAgentSnapshot } from "../src/server/studio-host/protocol/index.js";
import { engineerRowId, pmRowId, repoRowId, roomRowId, TeamDb, worktreeRowId } from "../src/team/db.js";
import { emptyTeamDbFacts, readTeamDbFacts } from "../src/server/studio-host/ops/team-db.js";
import {
	projectTeamGraph,
	type TeamGraphFacts,
	type TeamMainFact,
} from "../src/server/studio-host/ops/team-projection.js";
import { StudioOperations, type StudioHostContext } from "../src/server/studio-host/registry.js";
import { workspaceIdFor } from "../src/server/studio-host/ops/workspace-id.js";
import { handleTeamAgentsGet } from "../src/server/web-gateway/team.js";

const MAIN: TeamMainFact = {
	id: "Main",
	sessionId: "s1",
	displayName: "Main",
	status: "running",
	createdAt: 1_700_000_000_000,
	lastActivity: 1_700_000_500_000,
	live: true,
	hasTranscript: true,
	vibeEnabled: true,
	cwd: "/repo",
};

function subagent(
	overrides: Omit<Partial<StudioAgentSnapshot>, "agentId" | "parentAgentId"> & {
		agentId: string;
		parentAgentId?: string;
	},
): StudioAgentSnapshot {
	return {
		generation: 0,
		kind: "sub",
		displayName: String(overrides.agentId),
		status: "idle",
		updatedAt: "2023-11-14T22:15:00.000Z",
		hasLiveSession: false,
		hasTranscript: true,
		unreadCount: 0,
		activeJobIds: [],
		...overrides,
	} as StudioAgentSnapshot;
}

function facts(overrides: Partial<TeamGraphFacts> = {}): TeamGraphFacts {
	return {
		mains: [MAIN],
		rosters: new Map([
			[
				"s1",
				[
					subagent({ agentId: "Child", assignment: "fix the flaky test", startedAt: "2023-11-14T22:10:00.000Z" }),
					subagent({
						agentId: "Grandchild",
						parentAgentId: "Child",
						hasTranscript: false,
						startedAt: "2023-11-14T22:11:00.000Z",
					}),
					// Observability-only rows are never part of the graph.
					subagent({ agentId: "Advisor", kind: "advisor" }),
				],
			],
		]),
		workspaceNames: new Map([[workspaceIdFor("/repo"), "zeta"]]),
		teamDb: emptyTeamDbFacts(),
		generatedAt: new Date("2023-11-14T22:16:00.000Z"),
		...overrides,
	};
}

interface TeamSeed {
	readonly scratch: string;
	readonly dbPath: string;
	readonly teamRoot: string;
	readonly pmPath: string;
	readonly homePath: string;
	readonly taskPath: string;
	readonly repoPath: string;
	readonly pmId: string;
	readonly repoId: string;
	readonly engineerId: string;
	readonly homeId: string;
	readonly taskId: string;
	readonly roomId: string;
	readonly secretaryId: string;
}

/** Real temporary SQLite database, seeded through the production TeamDb API. */
function seedTeamDb(): TeamSeed {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-team-graph-"));
	const teamRoot = path.join(scratch, "acme-team");
	const dbPath = path.join(scratch, "team.db");
	const pmPath = path.join(teamRoot, "pms", "core");
	const repoPath = path.join(teamRoot, "repos", "api");
	const homePath = path.join(teamRoot, "worktrees", "api", "core", "alice", "home");
	const taskPath = path.join(teamRoot, "worktrees", "api", "core", "alice", "T-101");
	const createdAt = 1_700_000_000;
	const pmId = pmRowId("acme", "core");
	const repoId = repoRowId("acme", "api");
	const engineerId = engineerRowId("acme", "core", "alice");
	const homeId = worktreeRowId("acme", "api", "core", "alice", "home", "home");
	const taskId = worktreeRowId("acme", "api", "core", "alice", "task", "T-101");
	const roomId = roomRowId("acme", "core");
	const secretaryId = "secretary-core";

	const db = new TeamDb(dbPath);
	try {
		db.insertTeam({ id: "acme", name: "Acme", rootPath: teamRoot, createdAt });
		db.insertPm({ id: pmId, teamId: "acme", name: "core", workspacePath: pmPath, createdAt });
		db.insertRepo({
			id: repoId,
			teamId: "acme",
			name: "api",
			basePath: repoPath,
			remoteUrl: null,
			defaultBranch: "main",
			createdAt,
		});
		db.insertBinding(repoId, pmId);
		db.insertEngineer({ id: engineerId, teamId: "acme", pmId, name: "alice", execution: "vibe", createdAt });
		db.insertWorktree({
			id: homeId,
			teamId: "acme",
			repoId,
			pmId,
			engineerId,
			kind: "home",
			name: "home",
			path: homePath,
			branch: "team/acme/core/alice/integration",
			baseBranch: "main",
			createdAt,
		});
		db.insertWorktree({
			id: taskId,
			teamId: "acme",
			repoId,
			pmId,
			engineerId,
			kind: "task",
			name: "T-101",
			path: taskPath,
			branch: "team/acme/core/alice/T-101",
			baseBranch: "main",
			createdAt,
		});
		db.insertRoom({ id: roomId, teamId: "acme", pmId, name: "core", kind: "pm", createdAt });
		db.insertRoomMember({ roomId, agentId: pmId, role: "pm", createdAt });
		db.insertRoomMember({ roomId, agentId: engineerId, role: "engineer", createdAt });
		db.insertRoomMember({ roomId, agentId: secretaryId, role: "secretary", createdAt });
		db.insertAgent({
			id: secretaryId,
			teamId: "acme",
			pmId,
			role: "secretary",
			persistence: "persistent",
			parentAgentId: pmId,
			sessionId: "sec-session",
			sessionFile: "sec.jsonl",
			state: "idle",
			createdAt,
			updatedAt: createdAt + 5,
		});
	} finally {
		db.close();
	}
	return {
		scratch,
		dbPath,
		teamRoot,
		pmPath,
		homePath,
		taskPath,
		repoPath,
		pmId,
		repoId,
		engineerId,
		homeId,
		taskId,
		roomId,
		secretaryId,
	};
}

describe("projectTeamGraph", () => {
	test("clusters one main with nested spawn parentage and a real assignment", () => {
		const graph = projectTeamGraph(facts(), {});
		expect(graph.nodes.map(node => node.nodeId)).toEqual(["Main", "Child", "Grandchild"]);
		expect(graph.nodes[0]).toMatchObject({
			kind: "agent",
			role: "unknown",
			executionMode: "vibe",
			lifetime: "persistent",
			clusterId: "unassigned",
			status: "running",
			workspaceId: workspaceIdFor("/repo"),
			workspaceName: "zeta",
		});
		expect(graph.nodes[1]).toMatchObject({
			kind: "subagent",
			executionMode: "normal",
			lifetime: "persistent",
			parentNodeId: "Main",
			assignment: "fix the flaky test",
		});
		expect(graph.nodes[2]).toMatchObject({ kind: "subagent", parentNodeId: "Child", lifetime: "ephemeral" });
		expect(graph.edges.map(edge => [edge.kind, edge.from, edge.to])).toEqual([
			["spawn", "Main", "Child"],
			["spawn", "Child", "Grandchild"],
		]);
		expect(graph.edges[0]?.label).toBe("fix the flaky test");
		expect(graph.clusters).toEqual([{ clusterId: "unassigned", kind: "unassigned", memberCount: 3 }]);
		expect(graph.gaps).toEqual([]);
		expect(graph.generatedAt).toBe("2023-11-14T22:16:00.000Z");
	});

	test("an empty host returns empty arrays and no fabricated gaps", () => {
		const graph = projectTeamGraph(facts({ mains: [], rosters: new Map() }), {});
		expect(graph.nodes).toEqual([]);
		expect(graph.edges).toEqual([]);
		expect(graph.clusters).toEqual([]);
		expect(graph.gaps).toEqual([]);
	});

	test("Team DB rows produce the boundary, objects and every real relation", () => {
		const seed = seedTeamDb();
		try {
			const teamDb = readTeamDbFacts(seed.dbPath);
			const pmMain: TeamMainFact = {
				...MAIN,
				id: "PMMain",
				displayName: "core PM",
				sessionId: "s-pm",
				cwd: seed.pmPath,
				vibeEnabled: false,
			};
			const engineerMain: TeamMainFact = {
				...MAIN,
				id: "EngMain",
				displayName: "alice-main",
				sessionId: "s-eng",
				cwd: seed.homePath,
				vibeEnabled: true,
			};
			const graph = projectTeamGraph(
				facts({
					mains: [pmMain, engineerMain],
					rosters: new Map([
						["s-pm", [subagent({ agentId: "PMChild", assignment: "plan the sprint" })]],
						["s-eng", [subagent({ agentId: "EngChild" })]],
					]),
					teamDb,
				}),
				{},
			);

			const pmNodeId = `pm:${seed.pmId}`;
			const repoNodeId = `repo:${seed.repoId}`;
			const engineerNodeId = `engineer:${seed.engineerId}`;
			const homeNodeId = `worktree:${seed.homeId}`;
			const taskNodeId = `worktree:${seed.taskId}`;
			const roomNodeId = `room:${seed.roomId}`;
			const nodeIds = new Set(graph.nodes.map(node => node.nodeId));

			// The ownerless Team is a cluster plus real object nodes; no Team root
			// agent and no unmatched main once both paths match DB records.
			expect(graph.clusters).toEqual([
				{ clusterId: "team:acme", kind: "team", teamId: "acme", label: "Acme", memberCount: graph.nodes.length },
			]);
			expect(graph.nodes.some(node => node.kind === "agent")).toBe(false);
			expect(graph.nodes.some(node => node.displayName === "Acme")).toBe(false);
			expect(graph.nodes.find(node => node.nodeId === pmNodeId)).toMatchObject({
				kind: "pm-workspace",
				objectId: seed.pmId,
				agentId: "PMMain",
				sessionId: "s-pm",
				status: "running",
				executionMode: "normal",
				lifetime: "persistent",
			});
			expect(graph.nodes.find(node => node.nodeId === repoNodeId)).toMatchObject({
				kind: "git-repo",
				objectId: seed.repoId,
				displayName: "api",
			});
			expect(graph.nodes.find(node => node.nodeId === engineerNodeId)).toMatchObject({
				kind: "engineer",
				objectId: seed.engineerId,
				agentId: "EngMain",
				status: "running",
				executionMode: "vibe",
				lifetime: "persistent",
				workspaceId: workspaceIdFor(seed.homePath),
			});
			expect(graph.nodes.find(node => node.nodeId === homeNodeId)).toMatchObject({
				kind: "linked-worktree",
				worktreeKind: "home",
				branch: "team/acme/core/alice/integration",
			});
			expect(graph.nodes.find(node => node.nodeId === taskNodeId)).toMatchObject({
				kind: "linked-worktree",
				worktreeKind: "task",
				displayName: "T-101",
			});
			expect(graph.nodes.find(node => node.nodeId === roomNodeId)).toMatchObject({
				kind: "db-room",
				displayName: "#core",
			});
			expect(graph.nodes.find(node => node.nodeId === seed.secretaryId)).toMatchObject({
				kind: "subagent",
				role: "secretary",
				status: "idle",
				lifetime: "persistent",
				parentNodeId: pmNodeId,
			});

			const edge = (kind: string, from: string, to: string) =>
				graph.edges.some(candidate => candidate.kind === kind && candidate.from === from && candidate.to === to);
			expect(edge("binding", pmNodeId, repoNodeId)).toBe(true);
			expect(edge("assignment", pmNodeId, engineerNodeId)).toBe(true);
			expect(edge("worktree-of", repoNodeId, homeNodeId)).toBe(true);
			expect(edge("worktree-of", repoNodeId, taskNodeId)).toBe(true);
			expect(edge("contains", homeNodeId, engineerNodeId)).toBe(true);
			expect(edge("contains", taskNodeId, engineerNodeId)).toBe(true);
			expect(edge("room", pmNodeId, roomNodeId)).toBe(true);
			expect(edge("room", engineerNodeId, roomNodeId)).toBe(true);
			expect(edge("room", seed.secretaryId, roomNodeId)).toBe(true);
			expect(edge("spawn", pmNodeId, seed.secretaryId)).toBe(true);
			expect(edge("spawn", pmNodeId, "PMChild")).toBe(true);
			expect(edge("spawn", engineerNodeId, "EngChild")).toBe(true);
			expect(graph.edges.every(candidate => nodeIds.has(candidate.from) && nodeIds.has(candidate.to))).toBe(true);
		} finally {
			fs.rmSync(seed.scratch, { recursive: true, force: true });
		}
	});

	test("a Team DB record without a live session is offline, never a fake agent", () => {
		const seed = seedTeamDb();
		try {
			const teamDb = readTeamDbFacts(seed.dbPath);
			const graph = projectTeamGraph(facts({ mains: [], rosters: new Map(), teamDb }), {});
			expect(graph.nodes.some(node => node.kind === "agent")).toBe(false);
			expect(graph.nodes.find(node => node.nodeId === `pm:${seed.pmId}`)).toMatchObject({
				kind: "pm-workspace",
				status: "offline",
				executionMode: "unknown",
				lifetime: "persistent",
			});
			expect(graph.nodes.find(node => node.nodeId === `engineer:${seed.engineerId}`)).toMatchObject({
				kind: "engineer",
				status: "offline",
				executionMode: "vibe",
			});
			expect(graph.nodes.find(node => node.nodeId === `engineer:${seed.engineerId}`)?.agentId).toBeUndefined();
			// The Secretary row keeps its durable state; it is not downgraded.
			expect(graph.nodes.find(node => node.nodeId === seed.secretaryId)).toMatchObject({ status: "idle" });
		} finally {
			fs.rmSync(seed.scratch, { recursive: true, force: true });
		}
	});

	test("a partial Team DB keeps the boundary and row that exist", () => {
		const teamRoot = path.join(os.tmpdir(), "zeta-partial-team");
		const pmId = pmRowId("acme", "core");
		const graph = projectTeamGraph(
			facts({
				mains: [],
				rosters: new Map(),
				teamDb: {
					teams: [{ id: "acme", name: "Acme", rootPath: teamRoot, createdAt: 1_700_000_000 }],
					pms: [
						{
							id: pmId,
							teamId: "acme",
							name: "core",
							workspacePath: path.join(teamRoot, "pms", "core"),
							createdAt: 1_700_000_000,
						},
					],
					repos: [],
					bindings: [],
					engineers: [],
					worktrees: [],
					rooms: [],
					roomMembers: [],
					agents: [],
				},
			}),
			{},
		);
		expect(graph.nodes.map(node => [node.kind, node.displayName])).toEqual([["pm-workspace", "core"]]);
		expect(graph.edges).toEqual([]);
		expect(graph.clusters).toEqual([
			{ clusterId: "team:acme", kind: "team", teamId: "acme", label: "Acme", memberCount: 1 },
		]);
		expect(graph.gaps).toEqual([]);
	});

	test("a missing Team DB is an empty inventory", () => {
		const missing = path.join(os.tmpdir(), `zeta-missing-team-${Date.now()}.db`);
		expect(readTeamDbFacts(missing)).toEqual({
			teams: [],
			pms: [],
			repos: [],
			bindings: [],
			engineers: [],
			worktrees: [],
			rooms: [],
			roomMembers: [],
			agents: [],
		});
	});

	test("an unattached main reports unknown mode instead of guessing", () => {
		const graph = projectTeamGraph(facts({ mains: [{ ...MAIN, live: false, vibeEnabled: false }] }), {});
		expect(graph.nodes[0]).toMatchObject({ kind: "agent", executionMode: "unknown" });
	});

	test("lifetime filter keeps mains and never leaves an edge to a dropped node", () => {
		const graph = projectTeamGraph(facts(), { lifetime: "ephemeral" });
		expect(graph.nodes.map(node => node.nodeId)).toEqual(["Main", "Grandchild"]);
		// Child is persistent and filtered out; its edge to Grandchild goes with it.
		expect(graph.edges).toEqual([]);
		expect(graph.clusters[0]?.memberCount).toBe(2);
		expect(graph.nodes[0]?.kind).toBe("agent");
	});

	test("workspace and cluster filters select whole clusters", () => {
		const other: TeamMainFact = { ...MAIN, id: "Second", sessionId: "s2", displayName: "Second", cwd: "/other" };
		const graph = projectTeamGraph(
			facts({ mains: [MAIN, other], rosters: new Map([["s1", facts().rosters.get("s1")!]]) }),
			{ workspaceId: workspaceIdFor("/repo") },
		);
		expect(graph.clusters.map(cluster => cluster.clusterId)).toEqual(["unassigned"]);
		expect(graph.nodes.every(node => node.workspaceId === workspaceIdFor("/repo"))).toBe(true);
		expect(projectTeamGraph(facts(), { clusterId: "other" }).clusters).toEqual([]);
	});
});

const operations = new StudioOperations();

function context(): StudioHostContext {
	return { capabilities: operations.capabilities().manifest };
}

afterEach(() => {
	AgentRegistry.resetGlobalForTests();
});

describe("team.graph.get", () => {
	test("is advertised and answers the empty state from an empty registry", async () => {
		expect(operations.queries).toContain("team.graph.get");
		process.env.ZETA_TEAM_DB = path.join(os.tmpdir(), `zeta-empty-team-${Date.now()}.db`);
		try {
			const response = await operations.query({ queryName: "team.graph.get", input: {} }, context());
			expect(response.ok).toBe(true);
			if (!response.ok) return;
			expect(response.result.nodes).toEqual([]);
			expect(response.result.clusters).toEqual([]);
			expect(response.result.gaps).toEqual([]);
		} finally {
			delete process.env.ZETA_TEAM_DB;
		}
	});

	test("reads the global Team DB through the environment override", async () => {
		const seed = seedTeamDb();
		process.env.ZETA_TEAM_DB = seed.dbPath;
		try {
			const response = await operations.query({ queryName: "team.graph.get", input: {} }, context());
			expect(response.ok).toBe(true);
			if (!response.ok) return;
			expect(response.result.clusters).toContainEqual({
				clusterId: "team:acme",
				kind: "team",
				teamId: "acme",
				label: "Acme",
				memberCount: response.result.nodes.length,
			});
			expect(response.result.nodes.map(node => node.kind)).toContain("pm-workspace");
			expect(response.result.nodes.map(node => node.kind)).toContain("db-room");
			expect(response.result.gaps).toEqual([]);
		} finally {
			delete process.env.ZETA_TEAM_DB;
			fs.rmSync(seed.scratch, { recursive: true, force: true });
		}
	});

	test("refuses an unknown lifetime before touching the gateway", async () => {
		const response = await operations.query(
			{ queryName: "team.graph.get", input: { lifetime: "forever" as never } },
			context(),
		);
		expect(response.ok).toBe(false);
		if (!response.ok) expect(response.error.code).toBe("INVALID_ARGUMENT");
	});
});

describe("GET /api/agents facts", () => {
	test("returns roots only, with honest defaults for a detached ref", async () => {
		AgentRegistry.global().register({
			id: "Main",
			displayName: "Coordinator",
			kind: "main",
			status: "idle",
			session: null,
			sessionFile: null,
			createdAt: 10,
			lastActivity: 20,
		});
		AgentRegistry.global().register({
			id: "Child",
			displayName: "Child",
			kind: "sub",
			parentId: "Main",
			status: "idle",
			session: null,
			sessionFile: null,
		});
		const response = await handleTeamAgentsGet();
		expect(response.status).toBe(200);
		const body = (await response.json()) as { agents: Array<Record<string, unknown>> };
		expect(body.agents).toHaveLength(1);
		expect(body.agents[0]).toMatchObject({
			id: "Main",
			displayName: "Coordinator",
			status: "idle",
			live: false,
			hasTranscript: false,
			vibeEnabled: false,
		});
	});
});

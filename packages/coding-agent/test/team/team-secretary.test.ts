/**
 * PM-owned persistent Secretary: bundled definition and tool surface, spawn
 * idempotence, database ownership, durable session reference, send/follow-up,
 * room membership, and registry-loss re-registration.
 *
 * The executor boundary is mocked (the real model stream is not the subject);
 * the Team database, registry, and bundled definition are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { unregisterCustomApis } from "@linxiraos/pi-ai/api-registry";
import { createMockModel, registerMockApi } from "@linxiraos/pi-ai/providers/mock";
import { closeModelCache } from "@linxiraos/pi-catalog/model-cache";
import { Settings } from "../../src/config/settings";
import { ModelRegistry } from "../../src/config/model-registry";
import { AgentLifecycleManager } from "../../src/registry/agent-lifecycle";
import { AgentRegistry } from "../../src/registry/agent-registry";
import { createInMemoryAuthStorage } from "../helpers/agent-session-setup";
import { localSession } from "../helpers/local-session";
import type { SingleResult } from "@linxiraos/pi-tui/tools/task";
import { getBundledAgent } from "../../src/task/agents";
import * as executorModule from "../../src/task/executor";
import * as structuredSubagent from "../../src/task/structured-subagent";
import type { StructuredSubagentResult } from "../../src/task/structured-subagent";
import { resolveBuiltinToolPlan } from "../../src/tools";
import type { ToolSession } from "../../src/tools";
import { TeamDb } from "../../src/team/db";
import type { LeadWorkspace } from "../../src/team/lead";
import { createRoom } from "../../src/team/rooms";
import {
	SECRETARY_ROLE,
	listSecretary,
	secretaryAgentId,
	sendSecretary,
	spawnSecretary,
} from "../../src/team/secretary";
import { addPm, initTeam } from "../../src/team/service";

function singleResult(output: string, id = "secretary"): SingleResult {
	return {
		index: 0,
		id,
		agent: "secretary",
		agentSource: "bundled",
		task: "secretary",
		exitCode: 0,
		output,
		stderr: "",
		truncated: false,
		durationMs: 1,
		tokens: 0,
		requests: 1,
	};
}

function structuredResult(output: string): StructuredSubagentResult {
	return {
		result: singleResult(output),
		policy: {} as StructuredSubagentResult["policy"],
		mergeSummary: "",
		changesApplied: false,
		artifactsDir: "",
		temporaryArtifacts: false,
	};
}

function toolSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		settings: Settings.isolated({ "task.maxRecursionDepth": 2 }),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		getSessionAgents: () => [],
		getAgentId: () => "main",
		getPlanModeState: () => undefined,
	} as unknown as ToolSession;
}

function memberIds(db: TeamDb, roomId: string): string[] {
	return db.listRoomMembers(roomId).map(member => member.agentId);
}

describe("PM-owned Secretary", () => {
	let scratch: string;
	let teamRoot: string;
	let pmRoot: string;
	let dbPath: string;
	let workspace: LeadWorkspace;

	beforeEach(async () => {
		AgentRegistry.resetGlobalForTests();
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-secretary-"));
		teamRoot = path.join(scratch, "acme-team");
		dbPath = path.join(scratch, "team.db");
		process.env.ZETA_TEAM_DB = dbPath;
		await initTeam({ name: "Acme", root: teamRoot, dbPath });
		await addPm({ pm: "core", teamRoot, dbPath });
		pmRoot = path.join(teamRoot, "pms", "core");
		workspace = {
			teamRoot,
			teamId: "acme",
			teamName: "Acme",
			pmRoot,
			pmId: "acme:core",
			pmName: "core",
		};
	});

	afterEach(() => {
		AgentRegistry.resetGlobalForTests();
		delete process.env.ZETA_TEAM_DB;
		vi.restoreAllMocks();
		try {
			fs.rmSync(scratch, { recursive: true, force: true });
		} catch {
			// Windows may still hold the SQLite handle; the temp directory is disposable.
		}
	});

	it("bundles a secretary with only notes, schedule, board, and room-read tools", async () => {
		const definition = getBundledAgent("secretary");
		expect(definition).toBeDefined();
		expect(definition?.structured).toBe(false);
		const tools = definition?.tools ?? [];
		for (const name of ["read", "todo", "calendar", "board", "room_read"]) {
			expect(tools).toContain(name);
		}
		for (const name of ["edit", "write", "bash", "grep", "glob", "task", "vibe_spawn", "channel_send"]) {
			expect(tools).not.toContain(name);
		}

		const plan = await resolveBuiltinToolPlan(toolSession(pmRoot), tools);
		for (const name of ["read", "todo", "calendar", "board", "room_read"]) {
			expect(plan.names).toContain(name);
		}
		for (const name of ["edit", "write", "bash", "grep", "glob", "task", "vibe_spawn", "channel_send"]) {
			expect(plan.names).not.toContain(name);
		}
	});

	it("spawns once, persists PM ownership and the transcript, and returns the existing Secretary", async () => {
		const childFile = path.join(pmRoot, "secretary.jsonl");
		const run = vi.spyOn(structuredSubagent, "runStructuredSubagent").mockImplementation(async request => {
			AgentRegistry.global().register({
				id: request.identity?.id ?? "secretary",
				displayName: "Secretary",
				kind: "sub",
				parentId: "main",
				session: null,
				sessionFile: childFile,
				status: "parked",
			});
			return structuredResult("Notes recorded.");
		});
		const session = toolSession(pmRoot);

		const first = await spawnSecretary(session, workspace, "Draft today's standup.");
		expect(first.created).toBe(true);
		expect(first.output).toContain("Notes recorded.");
		expect(first.record).toMatchObject({
			id: secretaryAgentId("acme:core"),
			teamId: "acme",
			pmId: "acme:core",
			parentAgentId: "acme:core",
			role: SECRETARY_ROLE,
			persistence: "persistent",
			sessionFile: childFile,
			state: "parked",
		});
		expect(run).toHaveBeenCalledTimes(1);
		expect(run.mock.calls[0][0]).toMatchObject({
			agent: "secretary",
			assignment: "Draft today's standup.",
			keepAlive: true,
			structured: false,
			enableIrc: false,
			identity: { id: secretaryAgentId("acme:core"), label: "Secretary" },
		});

		const second = await spawnSecretary(session, workspace, "Duplicate?");
		expect(second.created).toBe(false);
		expect(second.record.id).toBe(first.record.id);
		expect(run).toHaveBeenCalledTimes(1);

		const db = new TeamDb(dbPath);
		try {
			const stored = db.getAgentForPm("acme", "acme:core", "secretary");
			expect(stored).toMatchObject({
				id: secretaryAgentId("acme:core"),
				pmId: "acme:core",
				parentAgentId: "acme:core",
				sessionFile: childFile,
			});
			expect(db.listAgents("acme")).toHaveLength(1);
		} finally {
			db.close();
		}
	});

	it("continues the same Secretary after registry loss and keeps the durable lookup", async () => {
		const childFile = path.join(pmRoot, "secretary.jsonl");
		vi.spyOn(structuredSubagent, "runStructuredSubagent").mockImplementation(async request => {
			AgentRegistry.global().register({
				id: request.identity?.id ?? "secretary",
				displayName: "Secretary",
				kind: "sub",
				parentId: "main",
				session: null,
				sessionFile: childFile,
				status: "parked",
			});
			return structuredResult("First.");
		});
		const session = toolSession(pmRoot);
		const spawned = await spawnSecretary(session, workspace, "First turn.");
		AgentRegistry.global().unregister(spawned.record.id);

		const followUp = vi
			.spyOn(executorModule, "runSubagentFollowUpTurn")
			.mockResolvedValue(singleResult("Standup: T-101 is blocked."));
		const sent = await sendSecretary(session, workspace, "Summarize rooms.");
		expect(sent.output).toContain("T-101 is blocked");
		expect(followUp.mock.calls[0][0]).toMatchObject({
			id: spawned.record.id,
			message: "Summarize rooms.",
			structured: false,
			agent: expect.objectContaining({ name: "secretary" }),
		});

		// A resumed PM sees the same durable record without a live ref.
		const resumed = listSecretary(toolSession(pmRoot), workspace);
		expect(resumed?.record.id).toBe(spawned.record.id);
		expect(resumed?.record.sessionFile).toBe(childFile);
		expect(resumed?.live?.status).toBe("parked");
	});

	it("adds a spawned Secretary to its PM room and coordination defaults", async () => {
		vi.spyOn(structuredSubagent, "runStructuredSubagent").mockResolvedValue(structuredResult("Ready."));
		const session = toolSession(pmRoot);
		const spawned = await spawnSecretary(session, workspace, "Start.");
		const db = new TeamDb(dbPath);
		try {
			const pmRoom = await createRoom({ name: "core", pm: "core", teamRoot, dbPath });
			expect(memberIds(db, pmRoom.room.id)).toContain(spawned.record.id);

			const shared = await createRoom({ name: "shared", shared: true, teamRoot, dbPath });
			expect(memberIds(db, shared.room.id)).toContain(spawned.record.id);

			const explicit = await createRoom({
				name: "explicit",
				kind: "room",
				members: "core,secretary,core/secretary",
				teamRoot,
				dbPath,
			});
			expect(memberIds(db, explicit.room.id).filter(id => id === spawned.record.id)).toHaveLength(1);
		} finally {
			db.close();
		}
	});

	it("reports no Secretary before spawn and refuses send without one", async () => {
		const session = toolSession(pmRoot);
		expect(listSecretary(session, workspace)).toBeNull();
		await expect(sendSecretary(session, workspace, "hello")).rejects.toThrow(/no Secretary yet/);
	});

	it("runs a real keep-alive subagent, parks it, and revives it on send", async () => {
		const source = "test/team-secretary-executor";
		registerMockApi(source);
		const authStorage = createInMemoryAuthStorage();
		authStorage.keys.setRuntime("mock", "test-key");
		const modelRegistry = new ModelRegistry(authStorage);
		const mock = createMockModel({ handler: () => ({ content: ["Standing by."] }) });
		vi.spyOn(modelRegistry, "getAvailable").mockReturnValue([mock]);
		const sessionDir = path.join(pmRoot, "sessions");
		fs.mkdirSync(sessionDir, { recursive: true });
		const parentFile = path.join(sessionDir, "main.jsonl");
		await createRoom({ name: "core", pm: "core", teamRoot, dbPath });
		const session: ToolSession = {
			cwd: pmRoot,
			hasUI: false,
			settings: Settings.isolated({
				"task.agentIdleTtlMs": 0,
				"async.enabled": false,
				"compaction.enabled": false,
				"retry.enabled": false,
				"todo.enabled": true,
				"advisor.enabled": false,
				modelRoles: { default: "mock/mock-model", task: "mock/mock-model" },
			}),
			agentRegistry: AgentRegistry.global(),
			authStorage,
			modelRegistry,
			getSessionFile: () => parentFile,
			getArtifactsDir: () => sessionDir,
			getSessionSpawns: () => "*",
			getSessionAgents: () => [],
			getAgentId: () => "main",
			getActiveModelString: () => "mock/mock-model",
			getPlanModeState: () => undefined,
			enableMCP: false,
			enableLsp: false,
		} as unknown as ToolSession;
		try {
			const spawned = await spawnSecretary(session, workspace, "Draft a short note.");
			expect(spawned.output).toContain("Standing by.");
			const ref = AgentRegistry.global().get(spawned.record.id);
			expect(ref?.status).toBe("idle");
			expect(ref?.sessionFile).toBeTruthy();
			expect(spawned.record.sessionFile).toBe(ref?.sessionFile ?? null);
			expect(fs.existsSync(spawned.record.sessionFile!)).toBe(true);
			const childTools = localSession(ref?.session ?? null).getEnabledToolNames();
			for (const name of ["read", "todo", "calendar", "board", "room_read"]) {
				expect(childTools).toContain(name);
			}
			for (const name of ["edit", "write", "bash", "grep", "glob", "task", "vibe_spawn", "channel_send"]) {
				expect(childTools).not.toContain(name);
			}
			const roomTool = localSession(ref?.session ?? null).getToolByName("room_read");
			if (!roomTool) throw new Error("Expected the child room_read tool");
			const roomResult = await roomTool.execute("room-read", {});
			const roomText = roomResult.content.find(part => part.type === "text");
			expect(roomText?.type === "text" ? roomText.text : "").toContain("#core");

			await AgentLifecycleManager.global().park(spawned.record.id);
			expect(AgentRegistry.global().get(spawned.record.id)).toMatchObject({ status: "parked", session: null });

			const sent = await sendSecretary(session, workspace, "Confirm the schedule.");
			expect(sent.output).toContain("Standing by.");
			expect(AgentRegistry.global().get(spawned.record.id)?.status).toBe("idle");
		} finally {
			await AgentLifecycleManager.global().dispose();
			AgentLifecycleManager.resetGlobalForTests();
			authStorage.close();
			unregisterCustomApis(source);
			closeModelCache();
		}
	}, 60_000);
});

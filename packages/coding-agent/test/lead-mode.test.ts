/**
 * Lead (PM) mode contracts:
 *
 * 1. `/lead` enters only from a registered PM workspace and rejects any other cwd.
 * 2. The active toolset becomes read + optional todo + board/calendar/channel_send
 *    when available + room_read/room_post, and removes coding and vibe tools.
 * 3. Room tools use the real Team database: listing, reading, and posting as the
 *    PM, with membership enforced by the room service.
 * 4. Exiting restores the exact prior toolset and clears the persisted mode.
 * 5. A saved `lead` mode rehydrates when the session is reopened.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type } from "@linxiraos/zeta-schema";
import { Agent, type AgentTool } from "@linxiraos/pi-agent-core";
import { initTheme } from "@linxiraos/pi-tui/theme";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { resetSettingsForTest, Settings } from "@linxiraos/zeta/config/settings";
import { InteractiveMode } from "@linxiraos/zeta/modes/interactive-mode";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import type { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { convertToLlm } from "@linxiraos/zeta/session/messages";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { FileSessionStorage } from "@linxiraos/zeta/session/session-storage";
import { TeamDb } from "@linxiraos/zeta/team/db";
import { resolveLeadWorkspace } from "@linxiraos/zeta/team/lead";
import { addPm, initTeam } from "@linxiraos/zeta/team/service";
import { createRoom } from "@linxiraos/zeta/team/rooms";
import type { ToolSession } from "@linxiraos/zeta/tools";
import { createRoomTools, ROOM_TOOL_NAMES } from "@linxiraos/zeta/tools/room";
import { EventBus } from "@linxiraos/zeta/utils/event-bus";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

function stubTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `${name} tool`,
		parameters: type({ value: "string" }),
		strict: true,
		async execute() {
			return { content: [{ type: "text", text: `${name} executed` }] };
		},
	};
}

const CODING_TOOLS = [
	"read",
	"todo",
	"edit",
	"write",
	"bash",
	"grep",
	"glob",
	"task",
	"vibe_spawn",
	"vibe_send",
	"vibe_wait",
	"vibe_kill",
	"vibe_list",
];
const LEAD_TOOLS = ["board", "calendar", "channel_send", "read", "room_post", "room_read", "todo"];

interface Fixture {
	scratch: string;
	teamRoot: string;
	pmRoot: string;
	dbPath: string;
}

async function makeFixture(prefix: string): Promise<Fixture> {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	const teamRoot = path.join(scratch, "acme-team");
	const dbPath = path.join(scratch, "team.db");
	process.env.ZETA_TEAM_DB = dbPath;
	await initTeam({ name: "Acme", root: teamRoot, dbPath });
	await addPm({ pm: "core", teamRoot, dbPath });
	await createRoom({ name: "core", pm: "core", teamRoot, dbPath });
	await createRoom({ name: "empty", kind: "room", teamRoot, dbPath });
	return { scratch, teamRoot, pmRoot: path.join(teamRoot, "pms", "core"), dbPath };
}

describe("Lead (PM) mode", () => {
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let fixture: Fixture;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(async () => {
		await initTheme();
		authStorage = createInMemoryAuthStorage();
		modelRegistry = new ModelRegistry(authStorage);
	});

	beforeEach(async () => {
		resetSettingsForTest();
		fixture = await makeFixture("zeta-lead-");
		await Settings.init({ inMemory: true, cwd: fixture.pmRoot });
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 to exist in registry");
		vi.spyOn(modelRegistry, "getApiKey").mockResolvedValue("test-key");

		const registryTools = [...new Set([...CODING_TOOLS, "board", "calendar", "channel_send"])].map(stubTool);
		session = new AgentSession({
			agent: new Agent({
				initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
				convertToLlm,
				streamFn: () => {
					throw new Error("No model call expected in lead-mode tests");
				},
			}),
			sessionManager: SessionManager.create(fixture.pmRoot, fixture.pmRoot, new FileSessionStorage()),
			settings: Settings.isolated({}),
			modelRegistry,
			toolRegistry: new Map(registryTools.map(tool => [tool.name, tool])),
			builtInToolNames: registryTools.map(tool => tool.name),
			createLeadTools: () => createRoomTools({ cwd: fixture.pmRoot } as ToolSession),
		});
		await session.setActiveToolsByName(CODING_TOOLS);
		mode = new InteractiveMode(session, "test", undefined, undefined, undefined, new EventBus());
	});

	afterEach(async () => {
		mode?.stop();
		await session?.dispose();
		delete process.env.ZETA_TEAM_DB;
		vi.restoreAllMocks();
		resetSettingsForTest();
		try {
			fs.rmSync(fixture.scratch, { recursive: true, force: true });
		} catch {
			// Windows may still hold a SQLite handle; the OS temp dir is disposable.
		}
	});

	afterAll(() => {
		authStorage.close();
	});

	it("enters from a PM workspace with only coordination tools and restores the prior set", async () => {
		expect(session.getActiveToolNames().toSorted()).toEqual(CODING_TOOLS.toSorted());

		await mode.handleLeadModeCommand();
		expect(mode.leadModeEnabled).toBe(true);
		expect(session.getActiveToolNames().toSorted()).toEqual(LEAD_TOOLS.toSorted());
		for (const name of [
			"edit",
			"write",
			"bash",
			"grep",
			"glob",
			"task",
			"vibe_spawn",
			"vibe_send",
			"vibe_wait",
			"vibe_kill",
			"vibe_list",
		]) {
			expect(session.getActiveToolNames()).not.toContain(name);
		}
		expect(session.getLeadModeState()).toMatchObject({
			enabled: true,
			teamId: "acme",
			pmId: "acme:core",
			pmName: "core",
		});
		expect(
			session.sessionManager.getEntries().some(entry => entry.type === "mode_change" && entry.mode === "lead"),
		).toBe(true);

		await mode.handleLeadModeCommand();
		expect(mode.leadModeEnabled).toBe(false);
		expect(session.getActiveToolNames().toSorted()).toEqual(CODING_TOOLS.toSorted());
		for (const name of ROOM_TOOL_NAMES) {
			expect(session.getToolByName(name)).toBeUndefined();
		}
		const lastMode = [...session.sessionManager.getEntries()].reverse().find(entry => entry.type === "mode_change");
		expect(lastMode?.type === "mode_change" ? lastMode.mode : undefined).toBe("none");
	});

	it("resolves only the PM workspace, not the team root or an engineer worktree", async () => {
		const worktree = path.join(fixture.teamRoot, "worktrees", "api", "core", "alice", "home");
		fs.mkdirSync(worktree, { recursive: true });
		expect(await resolveLeadWorkspace(fixture.pmRoot)).toMatchObject({
			teamId: "acme",
			pmId: "acme:core",
			pmName: "core",
		});
		await expect(resolveLeadWorkspace(fixture.teamRoot)).rejects.toThrow(/PM workspace/);
		await expect(resolveLeadWorkspace(worktree)).rejects.toThrow(/PM workspace/);
	});

	it("refuses to enter while plan or goal mode is active", async () => {
		const showWarning = vi.spyOn(mode, "showWarning").mockImplementation(() => {});
		mode.planModeEnabled = true;
		await mode.handleLeadModeCommand();
		expect(mode.leadModeEnabled).toBe(false);
		expect(showWarning).toHaveBeenCalled();

		mode.planModeEnabled = false;
		mode.goalModeEnabled = true;
		await mode.handleLeadModeCommand();
		expect(mode.leadModeEnabled).toBe(false);
		expect(showWarning).toHaveBeenCalledTimes(2);
		expect(session.getLeadModeState()).toBeUndefined();
	});

	it("rejects a cwd that is not a registered PM workspace", async () => {
		const outside = new AgentSession({
			agent: new Agent({
				initialState: {
					model: modelRegistry.find("anthropic", "claude-sonnet-4-5")!,
					systemPrompt: ["Test"],
					tools: [],
					messages: [],
				},
				convertToLlm,
				streamFn: () => {
					throw new Error("No model call expected in lead-mode tests");
				},
			}),
			sessionManager: SessionManager.create(fixture.scratch, fixture.scratch, new FileSessionStorage()),
			settings: Settings.isolated({}),
			modelRegistry,
			toolRegistry: new Map(CODING_TOOLS.map(name => [name, stubTool(name)])),
			builtInToolNames: CODING_TOOLS,
			createLeadTools: () => createRoomTools({ cwd: fixture.scratch } as ToolSession),
		});
		const outsideMode = new InteractiveMode(outside, "test", undefined, undefined, undefined, new EventBus());
		const showError = vi.spyOn(outsideMode, "showError").mockImplementation(() => {});
		try {
			await outside.setActiveToolsByName(CODING_TOOLS);
			await expect(outside.enterLeadMode()).rejects.toThrow(/PM workspace/);

			await outsideMode.handleLeadModeCommand();
			expect(outsideMode.leadModeEnabled).toBe(false);
			expect(outside.getActiveToolNames().toSorted()).toEqual(CODING_TOOLS.toSorted());
			expect(showError).toHaveBeenCalledWith(expect.stringContaining("PM workspace"));
		} finally {
			outsideMode.stop();
			await outside.dispose();
		}
	});

	it("reads rooms and posts as the PM against the real Team database", async () => {
		const tools = createRoomTools({ cwd: fixture.pmRoot } as ToolSession);
		const readRoom = tools.find(tool => tool.name === "room_read");
		const postRoom = tools.find(tool => tool.name === "room_post");
		if (!readRoom || !postRoom) throw new Error("Expected room tools");

		const listed = await readRoom.execute("read-list", {});
		const details = listed.details as { rooms?: { name: string }[] };
		expect(details.rooms?.map(room => room.name).toSorted()).toEqual(["core", "empty"]);

		const posted = await postRoom.execute("post-1", { room: "#core", body: "@alice please take T-101" });
		const postDetails = posted.details as { event: { seq: number; senderAgentId: string } };
		expect(postDetails.event.senderAgentId).toBe("acme:core");
		expect(postDetails.event.seq).toBeGreaterThan(0);

		const shown = await readRoom.execute("read-core", { room: "core" });
		const showDetails = shown.details as { events?: { body: string; seq: number }[] };
		expect(showDetails.events?.map(event => event.body)).toContain("@alice please take T-101");

		const db = new TeamDb(fixture.dbPath);
		try {
			const stored = db.listRoomEvents("acme:core");
			expect(stored).toHaveLength(1);
			expect(stored[0]).toMatchObject({
				senderAgentId: "acme:core",
				body: "@alice please take T-101",
				mentions: ["alice"],
			});
		} finally {
			db.close();
		}

		await expect(postRoom.execute("post-2", { room: "empty", body: "nobody is here" })).rejects.toThrow(
			/not a member/,
		);
	});

	it("rehydrates a saved lead mode when the session is reopened", async () => {
		await mode.init({ suppressWelcomeIntro: true });
		await mode.handleLeadModeCommand();
		await session.sessionManager.ensureOnDisk();
		const file = session.sessionFile;
		if (!file) throw new Error("Expected a persisted session file");
		mode.stop();
		await session.dispose();

		const reopened = new AgentSession({
			agent: new Agent({
				initialState: {
					model: modelRegistry.find("anthropic", "claude-sonnet-4-5")!,
					systemPrompt: ["Test"],
					tools: [],
					messages: [],
				},
				convertToLlm,
				streamFn: () => {
					throw new Error("No model call expected in lead-mode tests");
				},
			}),
			sessionManager: SessionManager.create(fixture.pmRoot, fixture.pmRoot, new FileSessionStorage()),
			settings: Settings.isolated({}),
			modelRegistry,
			toolRegistry: new Map(
				[...CODING_TOOLS, "board", "calendar", "channel_send"].map(name => [name, stubTool(name)]),
			),
			builtInToolNames: [...CODING_TOOLS, "board", "calendar", "channel_send"],
			createLeadTools: () => createRoomTools({ cwd: fixture.pmRoot } as ToolSession),
		});
		const reopenedMode = new InteractiveMode(reopened, "test", undefined, undefined, undefined, new EventBus());
		try {
			await reopenedMode.init({ suppressWelcomeIntro: true });
			await reopened.setActiveToolsByName(CODING_TOOLS);
			expect(await reopened.switchSession(file)).toBe(true);
			expect(reopenedMode.leadModeEnabled).toBe(true);
			expect(reopened.getActiveToolNames().toSorted()).toEqual(LEAD_TOOLS.toSorted());

			await reopenedMode.handleLeadModeCommand();
			expect(reopenedMode.leadModeEnabled).toBe(false);
			expect(reopened.getActiveToolNames()).not.toContain("room_read");
			expect(reopened.getActiveToolNames()).toContain("edit");
		} finally {
			reopenedMode.stop();
			await reopened.dispose();
		}
	});
});

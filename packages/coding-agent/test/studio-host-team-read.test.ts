import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AgentRegistry } from "../src/registry/agent-registry";
import type { AgentSessionHandle } from "../src/session/agent-session-handle";
import { RoomService } from "../src/rooms/service";
import { roomRuntime } from "../src/rooms/transport";
import { ensureTeam, resetTeamRoomsForTests } from "../src/vibe/team-rooms";
import { TeamDb } from "../src/team/db";
import { StudioOperations } from "../src/server/studio-host/registry";
import { handleTeamAgentsGet } from "../src/server/web-gateway/team";
import { holdTeamDbEnv } from "./test-db-env";

afterEach(() => {
	resetTeamRoomsForTests();
	AgentRegistry.resetGlobalForTests();
});

describe("Studio active Team read path", () => {
	test("reads existing mesh Team rooms and ignores legacy TeamDb structural rows", async () => {
		const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-active-team-read-"));
		const release = await holdTeamDbEnv(path.join(scratch, "legacy.db"));
		const legacy = new TeamDb(path.join(scratch, "legacy.db"));
		legacy.insertTeam({ id: "legacy-only", name: "Must not appear", rootPath: scratch, createdAt: 1 });
		legacy.close();
		const rooms = new RoomService(path.join(scratch, "rooms.db"));
		resetTeamRoomsForTests();
		roomRuntime(() => rooms);
		const file = path.join(scratch, "source.jsonl");
		AgentRegistry.global().register({
			id: "Main",
			displayName: "Actual owner",
			kind: "main",
			status: "idle",
			sessionFile: file,
			session: {
				sessionManager: { getSessionId: () => "source", getSessionFile: () => file, getCwd: () => scratch },
				getTeamModeState: () => ({ enabled: true }),
				getVibeModeState: () => undefined,
			} as unknown as AgentSessionHandle,
		});
		const expected = ensureTeam({ ownerId: "Main", parentSessionId: "source", parentSessionFile: file });
		try {
			const operations = new StudioOperations();
			const result = await operations.query(
				{ queryName: "team.graph.get", input: {} },
				{ capabilities: operations.capabilities().manifest },
			);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.result.clusters).toContainEqual(expect.objectContaining({ teamId: expected.teamKey }));
			expect(result.result.nodes.filter(node => node.kind === "db-room")).toHaveLength(2);
			expect(result.result.nodes.find(node => node.kind === "agent")).toMatchObject({
				executionMode: "team",
				status: "idle",
			});
			expect(JSON.stringify(result.result)).not.toContain("Must not appear");
		} finally {
			rooms.close();
			resetTeamRoomsForTests();
			release();
			fs.rmSync(scratch, { recursive: true, force: true });
		}
	});
	test("detached root facts are not advertised as live or Team-enabled", async () => {
		AgentRegistry.global().register({
			id: "Main",
			displayName: "Detached",
			kind: "main",
			status: "parked",
			session: null,
			sessionFile: null,
			createdAt: 10,
			lastActivity: 20,
		});
		AgentRegistry.global().register({
			id: "task",
			displayName: "Task",
			kind: "sub",
			parentId: "Main",
			status: "running",
			session: null,
		});
		const response = await handleTeamAgentsGet();
		const body = (await response.json()) as { agents: unknown[] };
		expect(body.agents).toHaveLength(1);
		expect(body.agents[0]).toMatchObject({ live: false, teamEnabled: false, vibeEnabled: false, status: "parked" });
	});
});

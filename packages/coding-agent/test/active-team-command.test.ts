import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AgentRegistry } from "../src/registry/agent-registry";
import { RoomService } from "../src/rooms/service";
import { roomRuntime } from "../src/rooms/transport";
import { ensureTeam, resetTeamRoomsForTests } from "../src/vibe/team-rooms";
import { BUILTIN_ZETA_SLASH_COMMANDS } from "../src/slash-commands/builtin-zeta";
import type { SlashCommandRuntime } from "../src/slash-commands/types";
import type { AgentSessionHandle } from "../src/session/agent-session-handle";

afterEach(() => {
	resetTeamRoomsForTests();
	AgentRegistry.resetGlobalForTests();
});

describe("active /team hub text command", () => {
	test("reads active source rooms without requiring a legacy Team root or database", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-active-team-command-"));
		const file = path.join(dir, "source.jsonl");
		resetTeamRoomsForTests();
		const rooms = new RoomService(path.join(dir, "rooms.db"));
		roomRuntime(() => rooms);
		const session = {
			getTeamModeState: () => ({ enabled: true }),
			getAgentId: () => "Main",
			sessionManager: { getSessionId: () => "source", getSessionFile: () => file },
		};
		AgentRegistry.global().register({
			id: "Main",
			displayName: "Actual main",
			kind: "main",
			status: "idle",
			session: session as unknown as AgentSessionHandle,
			sessionFile: file,
		});
		ensureTeam({ ownerId: "Main", parentSessionId: "source", parentSessionFile: file });
		const output: string[] = [];
		const runtime = {
			session,
			sessionManager: session.sessionManager,
			cwd: dir,
			output: async (value: string) => {
				output.push(value);
			},
		} as unknown as SlashCommandRuntime;
		try {
			const command = BUILTIN_ZETA_SLASH_COMMANDS.find(command => command.name === "team")!;
			await command.handle!({ args: "hub" } as never, runtime);
			expect(output.join("\n")).toContain("Team ·");
			expect(output.join("\n")).toContain("#Team");
			expect(output.join("\n")).not.toContain("PM/engineer");
		} finally {
			rooms.close();
			resetTeamRoomsForTests();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

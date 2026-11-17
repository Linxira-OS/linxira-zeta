import { afterEach, beforeAll, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initTheme } from "@linxiraos/pi-tui/theme";
import type { ActiveTeamHubOverlayComponent } from "@linxiraos/pi-tui/overlays/active-team-hub";
import type { TUI } from "@linxiraos/pi-tui";
import {
	showActiveTeamHub,
	closeActiveTeamHub,
	type ActiveTeamHubHost,
} from "../../../src/modes/controllers/active-team-hub";
import { AgentRegistry } from "../../../src/registry/agent-registry";
import type { AgentSessionHandle } from "../../../src/session/agent-session-handle";
import { RoomService } from "../../../src/rooms/service";
import { roomRuntime } from "../../../src/rooms/transport";
import { ensureTeam, resetTeamRoomsForTests } from "../../../src/vibe/team-rooms";

beforeAll(async () => {
	await initTheme();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("active Team Hub observer host", () => {
	test("keeps one mounted Hub hidden during observer focus and restores its filter/selection", async () => {
		const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-team-hub-host-"));
		const file = path.join(scratch, "source.jsonl");
		resetTeamRoomsForTests();
		AgentRegistry.resetGlobalForTests();
		const rooms = new RoomService(path.join(scratch, "rooms.db"));
		roomRuntime(() => rooms);
		const registry = AgentRegistry.global();
		registry.register({
			id: "Main",
			displayName: "Main",
			kind: "main",
			status: "idle",
			sessionFile: file,
			session: {
				sessionManager: { getSessionId: () => "source", getSessionFile: () => file },
			} as unknown as AgentSessionHandle,
		});
		ensureTeam({ ownerId: "Main", parentSessionId: "source", parentSessionFile: file });
		let hub: ActiveTeamHubOverlayComponent | undefined;
		let focused: string | undefined;
		const setHidden = vi.fn(),
			hide = vi.fn(),
			setFocus = vi.fn();
		const ui = {
			terminal: { rows: 30 },
			requestRender() {},
			setFocus,
			showOverlay: vi.fn((component: ActiveTeamHubOverlayComponent) => {
				hub = component;
				return { setHidden, hide, isHidden: () => false };
			}),
		} as unknown as TUI;
		const host: ActiveTeamHubHost = {
			ui,
			agentRegistry: registry,
			session: { getTeamModeState: () => ({ enabled: true }), getAgentId: () => "Main" },
			sessionManager: { getSessionId: () => "source", getSessionFile: () => file },
			get focusedAgentId() {
				return focused;
			},
			focusAgentSession: async id => {
				focused = id;
			},
			showWarning() {},
		};
		try {
			vi.useFakeTimers();
			showActiveTeamHub(host);
			await hub!.ready;
			hub!.handleInput("/");
			hub!.handleInput("Main");
			hub!.handleInput("\r");
			hub!.handleInput("j");
			hub!.handleInput("j");
			hub!.handleInput("\r");
			for (let index = 0; index < 6; index++) await Promise.resolve();
			expect(setHidden).toHaveBeenCalledWith(true);
			focused = undefined;
			vi.advanceTimersByTime(220);
			expect(setHidden).toHaveBeenLastCalledWith(false);
			expect(hub!.selectedId).toBe("agent:Main");
			expect(hub!.searchQuery).toBe("Main");
			showActiveTeamHub(host);
			expect(ui.showOverlay).toHaveBeenCalledTimes(1);
		} finally {
			closeActiveTeamHub(ui);
			rooms.close();
			resetTeamRoomsForTests();
			AgentRegistry.resetGlobalForTests();
			fs.rmSync(scratch, { recursive: true, force: true });
		}
		expect(hide).toHaveBeenCalledTimes(1);
	});
});

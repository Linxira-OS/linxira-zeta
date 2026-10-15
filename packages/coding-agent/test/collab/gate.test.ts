/**
 * Contract: collaboration is off unless the user opts in, and when they do
 * they must name the relay themselves.
 *
 * `/collab` and `/join` are real-time session sharing over an end-to-end
 * encrypted relay. The shipped default pointed every install at a relay we do
 * not operate, so the surface is now gated: `collab.enabled` (default false)
 * hides both commands from the palette and the splash tip, and
 * `collab.relayUrl` (default empty) has no fallback — a configured run dials
 * exactly the endpoint the user set.
 *
 * The assertions below drive the real public surfaces: the TUI palette built
 * from the slash-command registry, `executeBuiltinSlashCommand` dispatch, the
 * `WelcomeComponent` splash tip, and the real `CollabController`/`CollabHost`
 * over the in-memory relay. Nothing here inspects source text.
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { closeModelCache } from "@linxiraos/pi-catalog/model-cache";
import * as utils from "@linxiraos/pi-utils";
import { setTuiTipFilter, TIP_CATALOGUE_KEYS, WelcomeComponent } from "@linxiraos/pi-tui/prompt/welcome";
import { initTheme } from "@linxiraos/pi-tui/theme";
import { CollabController } from "@linxiraos/zeta/collab/controller";
import { CollabGuestLink } from "@linxiraos/zeta/collab/guest";
import { resolveCollabJoinLink } from "@linxiraos/zeta/collab/join-link";
import { DEFAULT_RELAY_URL } from "@linxiraos/zeta/collab/protocol";
import * as registry from "@linxiraos/zeta/collab/registry";
import {
	cfgCollabEnabled,
	cfgCollabRelayUrl,
	COLLAB_DISABLED_MESSAGE,
	COLLAB_RELAY_MISSING_MESSAGE,
} from "@linxiraos/zeta/collab/settings";
import { installCollabTipsGate } from "@linxiraos/zeta/collab/tips";
import { Settings } from "@linxiraos/zeta/config/settings";
import type { InteractiveModeContext } from "@linxiraos/zeta/modes/types";
import {
	type BuiltinSlashCommandRuntime,
	buildTuiBuiltinSlashCommands,
	executeBuiltinSlashCommand,
} from "@linxiraos/zeta/slash-commands/builtin-registry";
import { FakeWebSocket, installInMemoryRelay, uninstallInMemoryRelay } from "./helpers/in-memory-relay";

const GATED_COMMANDS = ["collab", "join"];

interface GateContextState {
	settings: Settings;
	status: string[];
	errors: string[];
	controller: CollabController;
}

/**
 * Minimal `InteractiveModeContext` for the collab slash handler: the real
 * settings instance under test, the observable status/error sinks, and a real
 * `CollabController` so a permitted invocation reaches the relay client.
 */
function makeGateContext(overrides: Record<string, unknown>): {
	ctx: InteractiveModeContext;
	runtime: BuiltinSlashCommandRuntime;
	state: GateContextState;
} {
	const settings = Settings.isolated(overrides);
	const state: GateContextState = { settings, status: [], errors: [], controller: undefined as never };
	const ctx = {
		settings,
		sessionManager: {
			getSessionId: () => "sess-collab-gate",
			getCwd: () => "/tmp/collab-gate-test",
			snapshotForReplication: () => ({
				header: {
					type: "session",
					id: "sess-collab-gate",
					timestamp: "2026-07-20T00:00:00Z",
					cwd: "/tmp/collab-gate-test",
				},
				entries: [],
			}),
			onEntryAppended: undefined,
		},
		session: {
			isSessionTransitioning: false,
			waitForSessionTransition: async () => {},
			isStreaming: false,
			queuedMessageCount: 0,
			sessionName: "collab-gate-test",
			model: { provider: "test-provider", id: "test-model" },
			thinkingLevel: undefined,
			subscribe: () => () => {},
			emitNotice: () => {},
			promptCustomMessage: () => Promise.resolve(),
			abort: () => Promise.resolve(),
			registerSessionChangeCallback: () => () => {},
		},
		eventBus: undefined,
		editor: { setText: () => {} },
		statusLine: {
			setCollabStatus: () => {},
			invalidate: () => {},
			getCachedContextBreakdown: () => ({ usedTokens: 0, contextWindow: 0 }),
		},
		ui: { requestRender: () => {} },
		present: () => {},
		showStatus: (message: string) => {
			state.status.push(message);
		},
		showError: (message: string) => {
			state.errors.push(message);
		},
		collabHost: undefined,
	};
	const interactive = ctx as unknown as InteractiveModeContext;
	state.controller = new CollabController(interactive);
	interactive.collabController = state.controller;
	return { ctx: interactive, runtime: { ctx: interactive } as BuiltinSlashCommandRuntime, state };
}

/**
 * The palette runtime: `buildTuiBuiltinSlashCommands` derives render-time copy
 * by calling into the context for a few specs, so unrelated reads resolve to a
 * self-returning callable while `settings` stays the real instance under test.
 */
function paletteRuntime(settings: Settings): BuiltinSlashCommandRuntime {
	const shadow: unknown = new Proxy(() => shadow, {
		get: (_target, property) => (property === Symbol.toPrimitive ? () => "" : shadow),
		apply: () => shadow,
		ownKeys: () => [],
		getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: shadow }),
	});
	const base = { settings };
	const ctx = new Proxy(base, {
		get: (target, property) => (Object.hasOwn(target, property) ? Reflect.get(target, property) : shadow),
	});
	return { ctx: ctx as unknown as InteractiveModeContext };
}

/** Every tip the splash can show, sweeping the weighted picker's whole range. */
function tipsAcrossRolls(count = 64): string[] {
	const random = spyOn(Math, "random");
	const seen: string[] = [];
	try {
		for (let i = 0; i < count; i++) {
			random.mockReturnValue((i + 0.5) / count);
			const tip = new WelcomeComponent("1.0.0").tip;
			if (tip !== undefined) seen.push(tip);
		}
	} finally {
		random.mockRestore();
	}
	return seen;
}

let tmp: string;
let publishSpy: Mock<typeof registry.publishCollabHost>;
let dialed: string[];
let liveControllers: CollabController[];

beforeEach(async () => {
	await initTheme(false);
	tmp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-collab-gate-"));
	utils.setAgentDir(path.join(tmp, "agent"));
	installInMemoryRelay();
	// Record the exact URL the relay client dials, then hand the socket to the
	// in-memory relay so the real host/guest handshake still runs.
	dialed = [];
	const Recording = class extends FakeWebSocket {
		constructor(url: string) {
			super(url);
			dialed.push(url);
		}
	};
	globalThis.WebSocket = Recording as unknown as typeof WebSocket;
	const real = registry.publishCollabHost;
	publishSpy = spyOn(registry, "publishCollabHost").mockImplementation((source, options) =>
		real(source, { ...options, dir: tmp }),
	);
	liveControllers = [];
});

afterEach(async () => {
	for (const controller of liveControllers.splice(0)) await controller.shutdown("test cleanup").catch(() => {});
	uninstallInMemoryRelay();
	publishSpy?.mockRestore();
	setTuiTipFilter(undefined);
	utils.__resetDirsFromEnvForTests();
	closeModelCache();
	await fs.rm(tmp, { recursive: true, force: true });
});

describe("collab gate: default is off", () => {
	it("does not offer /collab or /join in the TUI palette", () => {
		const names = buildTuiBuiltinSlashCommands(paletteRuntime(Settings.isolated({}))).map(command => command.name);
		for (const command of GATED_COMMANDS) expect(names).not.toContain(command);
		expect(names).toContain("leave");
	});

	it("refuses /collab with the enable hint and never reaches the controller", async () => {
		const { runtime, state } = makeGateContext({});
		const start = spyOn(CollabController.prototype, "start");
		const handled = await executeBuiltinSlashCommand("/collab", runtime);
		expect(handled).toBe(true);
		expect(state.errors).toEqual([COLLAB_DISABLED_MESSAGE]);
		expect(state.errors[0]).toContain("collab.enabled");
		expect(state.errors[0]).toContain("collab.relayUrl");
		expect(start).not.toHaveBeenCalled();
		expect(dialed).toEqual([]);
	});

	it("refuses /join with the enable hint", async () => {
		const { runtime, state } = makeGateContext({});
		const handled = await executeBuiltinSlashCommand("/join wss://relay.example.com/r/abc#key", runtime);
		expect(handled).toBe(true);
		expect(state.errors).toEqual([COLLAB_DISABLED_MESSAGE]);
		expect(dialed).toEqual([]);
	});

	it("keeps the splash from advertising /collab or /join", () => {
		installCollabTipsGate(Settings.isolated({}));
		expect(TIP_CATALOGUE_KEYS).toContain("tip25");
		const shown = tipsAcrossRolls();
		expect(shown.length).toBeGreaterThan(0);
		expect(shown.some(tip => tip.includes("/collab") || tip.includes("/join"))).toBe(false);
	});

	it("restores the tip once the gate is switched on", () => {
		installCollabTipsGate(Settings.isolated({ "collab.enabled": true }));
		expect(tipsAcrossRolls().some(tip => tip.includes("/collab"))).toBe(true);
	});
});

describe("collab gate: enabled", () => {
	it("offers /collab and /join in the TUI palette", () => {
		const names = buildTuiBuiltinSlashCommands(paletteRuntime(Settings.isolated({ "collab.enabled": true }))).map(
			command => command.name,
		);
		for (const command of GATED_COMMANDS) expect(names).toContain(command);
	});

	it("without a relay reports the missing configuration instead of dialing anything", async () => {
		const { runtime, state } = makeGateContext({ "collab.enabled": true, "collab.relayUrl": "" });
		await executeBuiltinSlashCommand("/collab", runtime);
		const reported = [...state.errors, ...state.status].join("\n");
		expect(reported).toContain(COLLAB_RELAY_MISSING_MESSAGE);
		expect(reported).toContain("collab.relayUrl");
		expect(reported).not.toContain("my.omp.sh");
		expect(dialed).toEqual([]);
	});

	it("dials the configured relay and never the shared upstream host", async () => {
		const { runtime, state } = makeGateContext({
			"collab.enabled": true,
			"collab.relayUrl": "wss://relay.example.com",
		});
		liveControllers.push(state.controller);
		await executeBuiltinSlashCommand("/collab", runtime);
		await state.controller.idle();

		const host = state.controller.host;
		expect(host).toBeDefined();
		expect(dialed[0]).toStartWith("wss://relay.example.com/r/");
		expect(dialed.every(url => !url.includes("my.omp.sh"))).toBe(true);
		expect(host?.link).toStartWith("relay.example.com/r/");
		expect(host?.link).not.toContain("my.omp.sh");
	});
});

describe("collab gate: a host-less join link resolves against the configured relay", () => {
	const BARE = "abcdefghij.KEYKEY";

	it("resolves a bare link against collab.relayUrl, inferring wss", () => {
		expect(resolveCollabJoinLink(BARE, "wss://relay.example.com")).toBe(
			"wss://relay.example.com/r/abcdefghij.KEYKEY",
		);
		expect(resolveCollabJoinLink(BARE, "relay.example.com")).toBe("wss://relay.example.com/r/abcdefghij.KEYKEY");
	});

	it("refuses a bare link when no relay is configured", () => {
		expect(() => resolveCollabJoinLink(BARE, "")).toThrow(COLLAB_RELAY_MISSING_MESSAGE);
	});

	it("passes a full link through untouched", () => {
		const full = "relay.example.com/r/abcdefghij.KEYKEY";
		expect(resolveCollabJoinLink(full, "wss://other.example.com")).toBe(full);
	});

	it("refuses the join on the real guest surface without dialing anything", async () => {
		const ctx = {
			settings: Settings.isolated({ "collab.enabled": true, "collab.relayUrl": "" }),
		} as unknown as InteractiveModeContext;
		await expect(new CollabGuestLink(ctx).join(BARE)).rejects.toThrow(COLLAB_RELAY_MISSING_MESSAGE);
		expect(dialed).toEqual([]);
	});
});

describe("collab gate: no silent upstream default", () => {
	it("ships collab disabled with no relay endpoint", () => {
		const settings = Settings.isolated({});
		expect(cfgCollabEnabled.get(settings)).toBe(false);
		expect(cfgCollabRelayUrl.get(settings)).toBe("");
		expect(cfgCollabRelayUrl.definition.default).not.toBe(DEFAULT_RELAY_URL);
		expect(String(cfgCollabRelayUrl.definition.default)).not.toContain("omp.sh");
	});

	it("rejects an inline relay fallback to the upstream host when hosting is left unconfigured", () => {
		// The guard the settings default relies on: nothing re-supplies the
		// upstream relay as an implicit value for a fresh install.
		expect(DEFAULT_RELAY_URL).toBe("wss://my.omp.sh");
		expect(cfgCollabRelayUrl.get(Settings.isolated({}))).not.toBe(DEFAULT_RELAY_URL);
	});
});

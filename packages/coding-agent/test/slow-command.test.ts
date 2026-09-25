import { afterEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import type { Api } from "@linxiraos/pi-ai";
import { buildModel } from "@linxiraos/pi-catalog/build";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { anthropicSlowModeLanes } from "@linxiraos/zeta/session/anthropic-slow-mode";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { cfgProvidersAnthropicSlowMode } from "@linxiraos/zeta/session/settings";
import { BUILTIN_MODE_SLASH_COMMANDS } from "@linxiraos/zeta/slash-commands/builtin-modes";
import type { SlashCommandRuntime } from "@linxiraos/zeta/slash-commands/types";
import { TempDir } from "@linxiraos/pi-utils";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

const LANE = "cred:slow-command-test";

describe("/slow", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		for (const cleanup of cleanups.splice(0)) cleanup();
		anthropicSlowModeLanes.lane(LANE).reset();
	});

	function createSession(provider: string, api: Api): AgentSession {
		const tempDir = TempDir.createSync("@slow-command-");
		const authStorage = createInMemoryAuthStorage();
		cleanups.push(() => {
			authStorage.close();
			tempDir.removeSync();
		});
		const model = buildModel({
			id: "test-model",
			name: "test-model",
			api,
			provider,
			baseUrl: "https://example.invalid",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8192,
			maxTokens: 2048,
		});
		return new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: ["test"], tools: [] } }),
			sessionManager: SessionManager.inMemory(tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry: new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml")),
		});
	}

	async function slow(session: AgentSession, args: string): Promise<string> {
		const command = BUILTIN_MODE_SLASH_COMMANDS.find(spec => spec.name === "slow");
		if (!command?.handle) throw new Error("/slow is not registered");
		const outputs: string[] = [];
		const runtime = {
			session,
			settings: session.settings,
			output: async (text: string) => {
				outputs.push(text);
			},
		} as unknown as SlashCommandRuntime;
		await command.handle({ name: "slow", args, text: `/slow ${args}` }, runtime);
		return outputs.join("\n");
	}

	it("switches OpenAI models to the flex tier and leaves a priority tier alone on off", async () => {
		const session = createSession("openai", "openai-responses");

		await slow(session, "on");
		expect(session.serviceTierByFamily).toEqual({ openai: "flex" });
		expect(await slow(session, "status")).toContain("on (flex tier)");

		await slow(session, "");
		expect(session.serviceTierByFamily).toEqual({});

		session.setServiceTierFamily("openai", "priority");
		await slow(session, "off");
		expect(session.serviceTierByFamily).toEqual({ openai: "priority" });
	});

	it("maps Anthropic on/off to slowMode auto/off and enters or stops an offered window", async () => {
		const session = createSession("anthropic", "anthropic-messages");
		const resetsAtSec = Math.floor(Date.now() / 1000) + 3_600;
		// Record an offer without taking it, as a declined auto-accept gate would.
		await anthropicSlowModeLanes.hooks({ canAutoAccept: () => false }).onFailure({
			lane: LANE,
			httpStatus: 429,
			overloaded: false,
			sentSlow: false,
			waitedMs: 0,
			attempts: 0,
			signal: {
				offer: "treatment",
				unifiedResetAtSec: resetsAtSec,
				unifiedLimitClaim: true,
				overageInUse: false,
			},
		});
		session.noteAnthropicSlowModeLane(LANE);
		const lane = anthropicSlowModeLanes.lane(LANE);
		expect(lane.isActive()).toBe(false);

		expect(await slow(session, "on")).toContain("continuing at lower priority");
		expect(cfgProvidersAnthropicSlowMode.get(session.settings)).toBe("auto");
		expect(lane.activeResetsAtSec()).toBe(resetsAtSec);

		await slow(session, "off");
		expect(cfgProvidersAnthropicSlowMode.get(session.settings)).toBe("off");
		expect(lane.isActive()).toBe(false);
		expect(session.serviceTierByFamily).toEqual({});
	});

	it("reports models without a slow mode and leaves settings untouched", async () => {
		const session = createSession("mistral", "openai-completions");

		expect(await slow(session, "on")).toContain("no slow mode");
		expect(session.serviceTierByFamily).toEqual({});
		expect(cfgProvidersAnthropicSlowMode.get(session.settings)).toBe("off");
		expect(await slow(session, "sideways")).toContain("Usage: /slow");
	});
});

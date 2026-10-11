import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { type } from "@linxiraos/pi-omptype";
import { Agent, type AgentTool } from "@linxiraos/pi-agent-core";
import type { AssistantMessage } from "@linxiraos/pi-ai";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { AssistantMessageEventStream } from "@linxiraos/pi-ai/utils/event-stream";
import { TempDir } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { convertToLlm } from "@linxiraos/zeta/session/messages";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { TIME_INJECT_NOTICE_TYPE, toggleDynamicTool } from "@linxiraos/zeta/tools/dynamic-tools";

const zeroUsage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
} satisfies AssistantMessage["usage"];

const TIMESTAMP_LINE = /^\[发送时间: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}\]$/;

describe("AgentSession periodic time injection", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession | undefined;

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-time-inject-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		authStorage.keys.setRuntime("openai", "openai-test-key");
	});

	afterEach(async () => {
		await session?.dispose();
		authStorage.close();
		tempDir.removeSync();
	});

	/**
	 * Script a session that issues `toolCalls` `tick` calls (each a separate
	 * model step) then stops. `enabled` toggles the time injection feature.
	 */
	async function runTickTurn(toolCalls: number, interval: number, enabled: boolean): Promise<AgentSession> {
		const model = createMockModel({ provider: "openai", id: "gpt-test" }).model;
		const modelRegistry = new ModelRegistry(authStorage);
		let modelCall = 0;
		const tick: AgentTool = {
			name: "tick",
			label: "Tick",
			description: "Ticks",
			parameters: type({}),
			execute: async () => ({ content: [{ type: "text", text: "tick" }] }),
		};
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [tick], messages: [] },
			convertToLlm,
			streamFn: () => {
				const usesTool = modelCall++ < toolCalls;
				const message: AssistantMessage = {
					role: "assistant",
					content: usesTool
						? [{ type: "toolCall", id: `tc-${modelCall}`, name: "tick", arguments: {} }]
						: [{ type: "text", text: "Done." }],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: zeroUsage,
					stopReason: usesTool ? "toolUse" : "stop",
					timestamp: Date.now(),
				};
				const stream = new AssistantMessageEventStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: message });
					stream.push({ type: "done", reason: usesTool ? "toolUse" : "stop", message });
				});
				return stream;
			},
		});
		const settings = Settings.isolated({
			"compaction.enabled": false,
			"todo.enabled": false,
			"session.timeInjectEvery": interval,
		});
		if (enabled) toggleDynamicTool(settings, "time on");
		settings.setModelRole("default", `${model.provider}/${model.id}`);
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir.path()),
			settings,
			modelRegistry,
			toolRegistry: new Map([[tick.name, tick]]),
		});
		await session.prompt("go");
		return session;
	}

	/** Text content of every persisted time-injection custom message, in order. */
	function timeInjections(s: AgentSession): string[] {
		const contents: string[] = [];
		for (const entry of s.sessionManager.getEntries()) {
			if (entry.type !== "custom_message" || entry.customType !== TIME_INJECT_NOTICE_TYPE) continue;
			if (typeof entry.content === "string") contents.push(entry.content);
		}
		return contents;
	}

	it("injects the timestamp as it reaches the interval, then resets", async () => {
		// Four tool calls at an interval of two fire exactly twice: the counter
		// resets after the first injection, so the second lands on call four.
		const run = await runTickTurn(4, 2, true);
		expect(timeInjections(run).length).toBe(2);

		// Three calls below an interval of four never fire.
		const quiet = await runTickTurn(3, 4, true);
		expect(timeInjections(quiet).length).toBe(0);
	});

	it("injects a time-only line with no urging or task language", async () => {
		const run = await runTickTurn(1, 1, true);
		const [line] = timeInjections(run);
		expect(line).toBeDefined();
		expect(line).toMatch(TIMESTAMP_LINE);
	});

	it("does not inject when the feature is off", async () => {
		const run = await runTickTurn(3, 1, false);
		expect(timeInjections(run).length).toBe(0);
	});
});

/**
 * `{type:"continue"}` on `/api/agent/:id`: the Studio `core.continue` route.
 *
 * The command drives `AgentSession.resume()` (the operator's `.`/`c` shortcut):
 * recovery re-runs an unanswered prompt ("restored"), otherwise the hidden
 * synthetic continue is sent ("continue"), an empty conversation is "none", and
 * a running turn is interrupted and resumed ("restored"). Asserting the
 * synthetic flag is the contract guarantee that the operator's continue never
 * becomes a user message.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as path from "node:path";
import { Agent, type AgentMessage } from "@linxiraos/pi-agent-core";
import { createMockModel, type MockHandler, type MockModel } from "@linxiraos/pi-ai/providers/mock";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { TempDir } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentSession, type PromptOptions } from "@linxiraos/zeta/session/agent-session";
import { convertToLlm } from "@linxiraos/zeta/session/messages";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { AgentSessionWrapper } from "../../src/server/web-gateway/agents";
import { createInMemoryAuthStorage } from "../helpers/agent-session-setup";

/** A response that stalls until aborted; `started` resolves once the request is in flight. */
function stalledResponse(): { handler: MockHandler; started: Promise<void> } {
	const started = Promise.withResolvers<void>();
	return {
		started: started.promise,
		handler: () => {
			started.resolve();
			return { content: ["too late"], delayMs: 60_000 };
		},
	};
}

describe("web-gateway continue command", () => {
	let tempDir: TempDir;
	let session: AgentSession | undefined;

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-continue-");
	});

	afterEach(async () => {
		await session?.dispose();
		session = undefined;
		tempDir.removeSync();
	});

	function createHarness(responses: MockHandler[] = []): {
		readonly wrapper: AgentSessionWrapper;
		readonly session: AgentSession;
		readonly mock: MockModel;
	} {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected a bundled anthropic model");
		const authStorage = createInMemoryAuthStorage();
		authStorage.keys.setRuntime("anthropic", "test-key");
		const mock = createMockModel({ responses });
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [] },
			convertToLlm,
			streamFn: mock.stream,
		});
		const created = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
			modelRegistry: new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml")),
		});
		session = created;
		return { wrapper: new AgentSessionWrapper(created, "sess-continue", null), session: created, mock };
	}

	/** Record every prompt's options while still delivering the real prompt. */
	function capturePromptOptions(target: AgentSession): PromptOptions[] {
		const options: PromptOptions[] = [];
		const original = target.prompt.bind(target);
		target.prompt = (text, promptOptions) => {
			options.push(promptOptions ?? {});
			return original(text, promptOptions);
		};
		return options;
	}

	function messageRoles(messages: readonly AgentMessage[]): string[] {
		return messages.map(message => message.role);
	}

	test("reports nothing to resume for an empty conversation", async () => {
		const { wrapper, mock } = createHarness();

		const result = await wrapper.send({ type: "continue" });

		expect(result).toEqual({ started: false, mode: "none" });
		expect(mock.calls).toHaveLength(0);
	});

	test("sends the synthetic continue once without adding a user message", async () => {
		const { wrapper, session: created, mock } = createHarness([{ content: ["done"] }, { content: ["more"] }]);
		const promptOptions = capturePromptOptions(created);
		await created.prompt("do the thing");

		const result = await wrapper.send({ type: "continue" });
		await created.waitForIdle();

		expect(result).toEqual({ started: true, mode: "continue" });
		// Only the model calls: the first prompt plus the hidden continue.
		expect(mock.calls).toHaveLength(2);
		expect(promptOptions.filter(options => options.synthetic === true)).toHaveLength(1);
		const roles = messageRoles(created.agent.state.messages);
		expect(roles.filter(role => role === "user")).toHaveLength(1);
		expect(roles).toEqual(["user", "assistant", "developer", "assistant"]);
	});

	test("interrupts a running turn and resumes it", async () => {
		const stall = stalledResponse();
		const { wrapper, session: created, mock } = createHarness([stall.handler, { content: ["host answer"] }]);
		const running = created.prompt("long turn");
		await stall.started;

		// The operator's continue on a live turn is an interrupt-and-resume, not a refusal.
		await expect(wrapper.send({ type: "continue" })).resolves.toEqual({ started: true, mode: "restored" });
		await running;
		await created.waitForIdle();

		// The interrupted call plus its answered rerun.
		expect(mock.calls).toHaveLength(2);
	});

	test("resume reports the recovery branch as restored", async () => {
		const stall = stalledResponse();
		const { session: created, mock } = createHarness([stall.handler, { content: ["answer"] }]);
		const running = created.prompt("do the thing");
		await stall.started;
		await created.abort();
		await running;
		await created.waitForIdle();

		await expect(created.resume()).resolves.toBe("restored");
		await created.waitForIdle();

		expect(mock.calls).toHaveLength(2);
	});
});

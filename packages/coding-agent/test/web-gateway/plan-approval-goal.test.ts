/**
 * Web-gateway goal-directed plan approval, end to end through the real
 * `AgentSessionWrapper` command dispatch:
 *
 * 1. `plan_approve` arms goal mode under the task stated at plan entry and the
 *    approved execution turn already carries the goal context.
 * 2. The gateway drives goal continuation itself (hidden `goal-continuation`
 *    turn) for `goal.continuationModes: ["web"]`, and not for an RPC-only list.
 * 3. A host abort stops continuation before the aborted turn yields.
 *
 * Kept separate from `plan-flow.test.ts` (plan drafting/get_state/approve) so
 * the goal half has its own fixture and can evolve independently.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Agent, type AgentTool } from "@linxiraos/pi-agent-core";
import { createMockModel, type MockModel, type MockResponse } from "@linxiraos/pi-ai/providers/mock";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { type } from "@linxiraos/pi-omptype";
import { TempDir, withTimeout } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { resolveLocalUrlToPath } from "@linxiraos/zeta/internal-urls";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { convertToLlm } from "@linxiraos/zeta/session/messages";
import type { CustomMessageEntry } from "@linxiraos/zeta/session/session-entries";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { AgentSessionWrapper, type AgentEvent } from "../../src/server/web-gateway/agents";

function makeTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `Fake ${name}`,
		parameters: type({}),
		async execute() {
			return { content: [{ type: "text" as const, text: "ok" }] };
		},
	};
}

/** Concatenate the text blocks of a provider message. */
function messageText(message: { content?: unknown }): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block): block is { type: "text"; text: string } =>
				typeof block === "object" && block !== null && "type" in block && block.type === "text" && "text" in block,
		)
		.map(block => block.text)
		.join("\n");
}

/** A text-only model response (no tool activity → no goal progress). */
function textResponse(text: string): MockResponse {
	return { content: [text] };
}

/** Hidden goal-continuation turns recorded in the session transcript. */
function goalContinuations(session: AgentSession): CustomMessageEntry[] {
	return session.sessionManager
		.getEntries()
		.filter(
			(entry): entry is CustomMessageEntry =>
				entry.type === "custom_message" && entry.customType === "goal-continuation",
		);
}

/** Flush the goal scheduler's own macrotasks (setImmediate + promise continuations). */
async function nextMacrotask(): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setImmediate(resolve);
	await promise;
}

interface PlanState {
	planModeEnabled?: boolean;
	planFilePath?: string | null;
	planContent?: string | null;
}

interface GoalState {
	modes?: { goal?: { enabled?: boolean; goal?: { objective?: string; status?: string } } };
}

interface GatewayHarness {
	session: AgentSession;
	wrapper: AgentSessionWrapper;
	model: MockModel;
	events: AgentEvent[];
}

describe("web-gateway plan approval → goal", () => {
	let tempDir: TempDir;
	let authDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let session: AgentSession | undefined;

	beforeAll(async () => {
		authDir = TempDir.createSync("@pi-plan-goal-auth-");
		authStorage = await AuthStorage.create(authDir.join("auth.db"));
		authStorage.keys.setRuntime("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage, authDir.join("models.yml"));
	});

	afterAll(() => {
		authStorage.close();
		authDir.removeSync();
	});

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-plan-goal-");
	});

	afterEach(async () => {
		try {
			await session?.dispose();
		} finally {
			session = undefined;
			await tempDir?.remove();
		}
	});

	/** A real `AgentSession` under a gateway wrapper, with the write/propose + ask/read tools. */
	async function startSession(options: {
		key: string;
		responses: MockResponse[];
		settings?: Record<string, unknown>;
	}): Promise<GatewayHarness> {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled anthropic model to exist");

		const askTool = makeTool("ask");
		const readTool = makeTool("read");
		// The write tool is built before the session exists; the holder (a const)
		// carries it in without a reassigned binding.
		const sessionRef: { current?: AgentSession } = {};
		// Goal-mode runs never draft a plan here: the approval path is what this
		// fixture owns, so `write` only needs to land a plan file on disk.
		const writeTool: AgentTool = {
			name: "write",
			label: "write",
			description: "Fake write",
			parameters: type({}),
			async execute(_toolCallId, input) {
				const target = String((input as { path?: unknown }).path ?? "");
				const content = String((input as { content?: unknown }).content ?? "");
				const resolved = resolveLocalUrlToPath(target, {
					getArtifactsDir: () => sessionRef.current!.sessionManager.getArtifactsDir(),
					getSessionId: () => sessionRef.current!.sessionManager.getSessionId(),
				});
				await Bun.write(resolved, content);
				return { content: [{ type: "text" as const, text: `Wrote ${target}` }] };
			},
		};

		const mock = createMockModel({ responses: options.responses });
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [askTool, writeTool, readTool],
				messages: [],
			},
			streamFn: mock.stream,
			convertToLlm,
		});
		const created = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({
				"compaction.enabled": false,
				"retry.enabled": false,
				...options.settings,
			}),
			modelRegistry,
			toolRegistry: new Map<string, AgentTool>([
				["ask", askTool],
				["write", writeTool],
				["read", readTool],
			]),
			builtInToolNames: ["ask", "write", "read"],
			advisorTools: [],
		});
		sessionRef.current = created;
		session = created;

		const wrapper = new AgentSessionWrapper(created, options.key, null);
		const events: AgentEvent[] = [];
		wrapper.onEvent(event => events.push(event));
		return { session: created, wrapper, model: mock, events };
	}

	it("approval arms goal mode under the stated task and the session continues it", async () => {
		const harness = await startSession({
			key: "sess-plan-goal",
			responses: [
				// The approved execution turn, then the hidden goal-continuation turn.
				textResponse("Executing the approved plan."),
				textResponse("Still working."),
			],
		});
		const { wrapper, model } = harness;

		const continued = Promise.withResolvers<void>();
		let agentEnds = 0;
		wrapper.onEvent(event => {
			// agent_end #1 = approved execution, #2 = goal continuation.
			if (event.type === "agent_end" && ++agentEnds === 2) continued.resolve();
		});

		// web-ui `/plan <task>`: plan mode carrying the operator's task, which is
		// what seeds the goal objective. Entered without an initial prompt so no
		// drafting turn competes with the approval (that chain, and its queue-drain
		// timing, belongs to the plan-flow tests); the stated task is put on the
		// plan state exactly as `/plan <task>` does.
		await wrapper.send({ type: "mode_enter", mode: "plan" });
		const planState = harness.session.getPlanModeState();
		if (!planState) throw new Error("plan mode did not arm");
		harness.session.setPlanModeState({ ...planState, objective: "Draft the web plan" });
		const planFilePath = "local://web-plan.md";
		await Bun.write(
			resolveLocalUrlToPath(planFilePath, {
				getArtifactsDir: () => harness.session.sessionManager.getArtifactsDir(),
				getSessionId: () => harness.session.sessionManager.getSessionId(),
			}),
			"# Web plan\n\nImplement it.",
		);

		const proposedState = (await wrapper.send({ type: "get_state" })) as PlanState;
		expect(proposedState.planModeEnabled).toBe(true);

		const approval = (await wrapper.send({
			type: "plan_approve",
			planFilePath,
			mode: "preserve",
		})) as { approved: boolean; error?: string };
		expect(approval.error).toBeUndefined();
		expect(approval.approved).toBe(true);

		const approvedState = (await wrapper.send({ type: "get_state" })) as PlanState;
		expect(approvedState.planModeEnabled).toBe(false);

		// The stated task became the goal objective; goal mode survives the
		// approval (the goal is active until the agent completes it).
		const goalState = (await wrapper.send({ type: "get_state" })) as GoalState;
		expect(goalState.modes?.goal?.enabled).toBe(true);
		expect(goalState.modes?.goal?.goal?.objective).toBe("Draft the web plan");

		// The execution turn already carried the goal context: goal mode is armed
		// before the synthetic prompt, not after the first turn.
		const executionCall = model.calls.find(call =>
			call.context.messages.some(message => messageText(message).includes("Plan approved.")),
		);
		expect(executionCall).toBeDefined();
		expect((executionCall?.context.messages ?? []).map(messageText).join("\n")).toContain("Draft the web plan");

		// The gateway continues the goal by itself: the execution turn's
		// `agent_end` starts a hidden `goal-continuation` turn (default
		// `goal.continuationModes` covers web sessions).
		await withTimeout(continued.promise, 20_000, "the web session never continued the approved plan's goal");
		const continuations = goalContinuations(harness.session);
		expect(continuations).toHaveLength(1);
		expect(String(continuations[0]!.content)).toContain("Draft the web plan");

		// That turn produced no new activity, so continuation stops after one
		// hidden turn (the same no-progress gate the TUI and RPC hosts use):
		// 1 approved execution + 1 continuation, and no more.
		await nextMacrotask();
		await nextMacrotask();
		expect(model.calls).toHaveLength(2);
		expect(harness.session.getGoalModeState()?.goal.status).toBe("active");
	}, 30_000);

	it("a web session continues an active goal; an RPC-only mode list does not", async () => {
		const web = await startSession({
			key: "sess-goal-web",
			responses: [textResponse("Starting."), textResponse("Step two.")],
			settings: { "goal.continuationModes": ["web"] },
		});
		const secondTurn = Promise.withResolvers<void>();
		let agentEnds = 0;
		web.wrapper.onEvent(event => {
			if (event.type === "agent_end" && ++agentEnds === 2) secondTurn.resolve();
		});
		// web-ui `/goal <objective>`: arm goal mode, then submit the objective as
		// the first goal-mode turn (`mode_enter` + prompt).
		await web.wrapper.send({ type: "mode_enter", mode: "goal", options: { objective: "Ship the release" } });
		await web.wrapper.send({ type: "prompt", message: "Ship the release" });

		await withTimeout(secondTurn.promise, 20_000, "the web session never continued the active goal");
		const continuations = goalContinuations(web.session);
		expect(continuations).toHaveLength(1);
		expect(String(continuations[0]!.content)).toContain("Ship the release");
		await nextMacrotask();
		await nextMacrotask();
		expect(web.model.calls).toHaveLength(2);

		const rpcOnly = await startSession({
			key: "sess-goal-rpc",
			responses: [textResponse("Starting.")],
			settings: { "goal.continuationModes": ["rpc"] },
		});
		await rpcOnly.wrapper.send({ type: "mode_enter", mode: "goal", options: { objective: "Ship the release" } });
		await rpcOnly.wrapper.send({ type: "prompt", message: "Ship the release" });
		await nextMacrotask();
		await nextMacrotask();
		expect(goalContinuations(rpcOnly.session)).toHaveLength(0);
		expect(rpcOnly.model.calls).toHaveLength(1);
	}, 30_000);

	it("a host abort stops goal continuation before the aborted turn yields", async () => {
		const harness = await startSession({
			key: "sess-goal-abort",
			responses: [textResponse("Starting."), textResponse("Step two.")],
			settings: { "goal.continuationModes": ["web"] },
		});
		await harness.wrapper.send({ type: "mode_enter", mode: "goal", options: { objective: "Ship the release" } });
		// The abort lands before the turn yields: its own `agent_end` must not
		// re-arm the goal, so the turn that follows never continues itself.
		await harness.wrapper.send({ type: "abort" });
		await harness.wrapper.send({ type: "prompt", message: "Ship the release" });
		await nextMacrotask();
		await nextMacrotask();
		expect(goalContinuations(harness.session)).toHaveLength(0);
		expect(harness.model.calls).toHaveLength(1);
	}, 30_000);
});

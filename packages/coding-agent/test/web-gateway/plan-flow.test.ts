/**
 * Web-gateway plan chain, end to end through the real `AgentSessionWrapper`
 * command dispatch: enter plan mode with a task → the plan-mode context opens
 * the turn → the agent drafts `local://<slug>-plan.md` and proposes it →
 * `get_state` reports the REAL plan path/content → `plan_approve` succeeds.
 *
 * The write tool reproduces the internal-URL `write` scheme's device dispatch
 * (`dispatchResolutionDevice`), so the `details.xdev` envelope the gateway and
 * the session key off is the production shape, not a hand-rolled literal.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Agent, type AgentTool } from "@linxiraos/pi-agent-core";
import type { Message } from "@linxiraos/pi-ai";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { type } from "@linxiraos/pi-omptype";
import { PROPOSE_DEVICE_NAME } from "@linxiraos/pi-tui/tools/resolve";
import { TempDir } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { resolveLocalUrlToPath } from "@linxiraos/zeta/internal-urls";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { convertToLlm } from "@linxiraos/zeta/session/messages";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { AgentSessionWrapper, type AgentEvent } from "../../src/server/web-gateway/agents";
import type { ToolSession } from "../../src/tools";
import { dispatchResolutionDevice, PROPOSE_DEVICE_PATH } from "../../src/tools/resolve";

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
		.filter((block): block is { type: "text"; text: string } => (block as { type?: string }).type === "text")
		.map(block => block.text)
		.join("\n");
}

interface PlanFlowState {
	planModeEnabled?: boolean;
	planFilePath?: string | null;
	planContent?: string | null;
}

describe("web-gateway plan chain", () => {
	let tempDir: TempDir;
	let authDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let session: AgentSession | undefined;

	beforeAll(async () => {
		authDir = TempDir.createSync("@pi-plan-flow-auth-");
		authStorage = await AuthStorage.create(authDir.join("auth.db"));
		authStorage.keys.setRuntime("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage, authDir.join("models.yml"));
	});

	afterAll(() => {
		authStorage.close();
		authDir.removeSync();
	});

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-plan-flow-");
	});

	afterEach(async () => {
		try {
			await session?.dispose();
		} finally {
			session = undefined;
			await tempDir?.remove();
		}
	});

	it("enter → propose → get_state → approve", async () => {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled anthropic model to exist");

		const askTool = makeTool("ask");
		const readTool = makeTool("read");
		// The closure references `created`, declared below: tools only execute
		// once the session exists, same pattern as the convergence harness.
		const writeTool: AgentTool = {
			name: "write",
			label: "write",
			description: "Fake write",
			parameters: type({}),
			async execute(_toolCallId, input) {
				const target = String((input as { path?: unknown }).path ?? "");
				const content = String((input as { content?: unknown }).content ?? "");
				if (target === PROPOSE_DEVICE_PATH) {
					// The internal-URL `write` scheme's propose branch.
					const { result, xdev } = await dispatchResolutionDevice(
						{
							peekPlanProposalHandler: () => created.peekPlanProposalHandler(),
						} as unknown as ToolSession,
						PROPOSE_DEVICE_NAME,
						content,
					);
					return { content: result.content, details: { xdev }, isError: result.isError };
				}
				const resolved = resolveLocalUrlToPath(target, {
					getArtifactsDir: () => created.sessionManager.getArtifactsDir(),
					getSessionId: () => created.sessionManager.getSessionId(),
				});
				await Bun.write(resolved, content);
				return { content: [{ type: "text" as const, text: `Wrote ${target}` }] };
			},
		};

		const mock = createMockModel({
			responses: [
				// The plan turn drafts the file, then submits it for approval.
				{
					content: [
						{
							type: "toolCall",
							name: "write",
							arguments: { path: "local://web-plan.md", content: "# Web plan\n\nImplement it.\n" },
						},
					],
				},
				{ content: [{ type: "toolCall", name: "write", arguments: { path: PROPOSE_DEVICE_PATH, content: "web" } }] },
				{ content: ["Plan submitted."] },
				{ content: ["Executing the approved plan."] },
			],
		});
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
			settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
			modelRegistry,
			toolRegistry: new Map<string, AgentTool>([
				["ask", askTool],
				["write", writeTool],
				["read", readTool],
			]),
			builtInToolNames: ["ask", "write", "read"],
			advisorTools: [],
		});
		session = created;

		const wrapper = new AgentSessionWrapper(created, "sess-plan-flow", null);
		const events: AgentEvent[] = [];
		const proposed = Promise.withResolvers<void>();
		wrapper.onEvent(event => {
			events.push(event);
			if (event.type === "plan_proposed") proposed.resolve();
		});

		// 1. Enter plan mode with the task, exactly like web-ui `/plan <task>`.
		await wrapper.send({
			type: "mode_enter",
			mode: "plan",
			options: { initialPrompt: "Draft the web plan" },
		});

		// 2. The propose lands and is broadcast as a plan-ready event.
		await proposed.promise;
		expect(events.filter(event => event.type === "mode_changed" && event.mode === "plan").length).toBeGreaterThan(0);

		// The turn opened with the plan-mode context before the task (the CLI's
		// `/plan <prompt>` prompt-path injection, mirrored on the steer path).
		const firstRequest: readonly Message[] = mock.calls[0]?.context.messages ?? [];
		const contextIndex = firstRequest.findIndex(message => messageText(message).includes("Plan mode active."));
		const taskIndex = firstRequest.findIndex(
			message => message.role === "user" && messageText(message).includes("Draft the web plan"),
		);
		expect(contextIndex).toBeGreaterThanOrEqual(0);
		expect(taskIndex).toBeGreaterThan(contextIndex);

		// 3. get_state reports the file the agent actually wrote.
		const proposedState = (await wrapper.send({ type: "get_state" })) as PlanFlowState;
		expect(proposedState.planModeEnabled).toBe(true);
		expect(proposedState.planFilePath).toBe("local://web-plan.md");
		expect(proposedState.planContent).toContain("Implement it.");

		// 5. Approval executes the plan and leaves plan mode.
		const approval = (await wrapper.send({
			type: "plan_approve",
			planFilePath: proposedState.planFilePath!,
			mode: "preserve",
		})) as { approved: boolean; error?: string };
		expect(approval.error).toBeUndefined();
		expect(approval.approved).toBe(true);

		const finalState = (await wrapper.send({ type: "get_state" })) as PlanFlowState;
		expect(finalState.planModeEnabled).toBe(false);
	});
});

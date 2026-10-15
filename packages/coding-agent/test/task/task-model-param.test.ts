/**
 * The task wire contract for a subagent's model. Dispatch never chooses a
 * child's model — it comes from the agent definition, or the parent's own — so
 * the wire shape carries no `model` field at all and a hand-written one is
 * rejected rather than silently dropped. Switching a child's model is a
 * per-subagent capability that opens once it has completed a model response;
 * that half is covered by model-switch.test.ts and wake-model-override.test.ts.
 *
 * The internal `StructuredSubagentRequest.model` seam (used by the eval bridge)
 * keeps working and is covered here.
 */
import { afterEach, describe, expect, it, vi } from "bun:test";
import type { Api, Model } from "@linxiraos/pi-ai";
import { type } from "@linxiraos/pi-omptype";
import type { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentStorage } from "@linxiraos/zeta/session/agent-storage";
import * as executorModule from "@linxiraos/zeta/task/executor";
import { modelFailureLedgerForSession, resetModelFailureLedgers } from "@linxiraos/zeta/task/model-switch";
import { runStructuredSubagent, type StructuredSubagentRequest } from "@linxiraos/zeta/task/structured-subagent";
import type { AgentDefinition } from "@linxiraos/zeta/task/types";
import { taskSchema } from "@linxiraos/zeta/task/types";
import { TaskTool } from "@linxiraos/zeta/task";
import type { SingleResult } from "@linxiraos/pi-tui/tools/task";
import type { ToolSession } from "@linxiraos/zeta/tools";
import { getTestModel } from "../helpers/model-fixtures";

const PRIMARY = getTestModel("openai") as Model<Api>;
const SECONDARY = getTestModel("anthropic") as Model<Api>;
const PRIMARY_SELECTOR = `${PRIMARY.provider}/${PRIMARY.id}`;
const SECONDARY_SELECTOR = `${SECONDARY.provider}/${SECONDARY.id}`;
const PARENT_SESSION_FILE = "/tmp/model-param-parent.jsonl";

const AGENT: AgentDefinition = {
	name: "worker",
	description: "Test worker",
	systemPrompt: "Do the assigned work.",
	source: "bundled",
};

const USAGE_LIMIT_ERROR = "Usage limit reached for this account. Your limit will reset at 2026-10-15 09:00:00";

function modelRegistry(): ModelRegistry {
	const models = [PRIMARY, SECONDARY];
	return {
		getAvailable: () => models,
		hasConfiguredAuth: () => true,
	} as unknown as ModelRegistry;
}

function testSession(settings: Settings, options: { agentModel?: string[] } = {}): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		settings,
		modelRegistry: modelRegistry(),
		getSessionFile: () => PARENT_SESSION_FILE,
		getSessionSpawns: () => "*",
		getSessionAgents: () => [options.agentModel ? { ...AGENT, model: options.agentModel } : AGENT],
	} as unknown as ToolSession;
}

function settledResult(overrides: Partial<SingleResult> = {}): SingleResult {
	return {
		index: 0,
		id: "Worker",
		agent: "worker",
		agentSource: "bundled",
		task: "Inspect the target.",
		exitCode: 0,
		output: "done",
		stderr: "",
		truncated: false,
		durationMs: 1,
		tokens: 0,
		requests: 1,
		...overrides,
	};
}

/** Captured `ExecutorOptions` for every dispatched child. */
function captureDispatches(result: SingleResult): executorModule.ExecutorOptions[] {
	const dispatched: executorModule.ExecutorOptions[] = [];
	vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
		dispatched.push(options);
		return result;
	});
	return dispatched;
}

async function executeText(session: ToolSession, params: unknown): Promise<string> {
	const tool = await TaskTool.create(session);
	const result = await tool.execute("tool-call", params);
	return result.content.find(part => part.type === "text")?.text ?? "";
}

afterEach(() => {
	vi.restoreAllMocks();
	resetModelFailureLedgers();
	AgentStorage.close();
});

describe("task wire schema", () => {
	it("never advertises a `model` field", () => {
		const parsed = taskSchema({
			agent: "worker",
			task: "Inspect the target.",
			solutionSpace: "one fix",
			model: PRIMARY_SELECTOR,
		});
		expect(parsed instanceof type.errors).toBe(false);
		if (!(parsed instanceof type.errors)) expect("model" in parsed).toBe(false);
	});
});

describe("task dispatch model rejection", () => {
	it("rejects a flat call that names a model", async () => {
		const text = await executeText(testSession(Settings.isolated({ "task.batch": false })), {
			agent: "worker",
			task: "Inspect the target.",
			solutionSpace: "one fix",
			model: PRIMARY_SELECTOR,
		});
		expect(text).toContain("cannot set `model`");
	});

	it("rejects a batch item that names a model", async () => {
		const text = await executeText(testSession(Settings.isolated({ "task.batch": true })), {
			context: "shared",
			tasks: [{ task: "Inspect the target.", solutionSpace: "one fix", model: SECONDARY_SELECTOR }],
		});
		expect(text).toContain("cannot set `model`");
	});

	it("still dispatches a call that names only an effort", async () => {
		captureDispatches(settledResult());
		const text = await executeText(testSession(Settings.isolated({ "task.batch": false })), {
			agent: "worker",
			task: "Inspect the target.",
			solutionSpace: "one fix",
			effort: "hi",
		});
		expect(text).not.toContain("cannot set `model`");
	});
});

describe("internal spawn model seam", () => {
	function request(overrides: Partial<StructuredSubagentRequest> = {}) {
		return {
			session: testSession(Settings.isolated({ "task.isolation.enabled": false })),
			invocationKind: "task" as const,
			assignment: "Inspect the target.",
			agent: "worker",
			retainArtifacts: false,
			...overrides,
		};
	}

	it("resolves the requested model at the top of the chain and audits the switch", async () => {
		const dispatched = captureDispatches(settledResult({ resolvedModel: SECONDARY_SELECTOR }));

		const settled = await runStructuredSubagent(request({ model: SECONDARY_SELECTOR }));

		expect(dispatched[0]?.modelOverride).toEqual([SECONDARY_SELECTOR]);
		expect(settled.result.modelChange).toEqual({ source: "spawn-param", to: SECONDARY_SELECTOR });
	});

	it("keeps the inherited model when no model is passed", async () => {
		const dispatched = captureDispatches(settledResult({ resolvedModel: PRIMARY_SELECTOR }));

		const settled = await runStructuredSubagent(
			request({
				session: testSession(Settings.isolated({ "task.isolation.enabled": false }), {
					agentModel: [PRIMARY_SELECTOR],
				}),
			}),
		);

		expect(dispatched[0]?.modelOverride).toEqual([PRIMARY_SELECTOR]);
		expect(settled.result.modelChange).toBeUndefined();
	});

	it("annotates a failed run that named no model — the bookkeeping is unconditional", async () => {
		const parent = testSession(Settings.isolated({ "task.isolation.enabled": false }), {
			agentModel: [PRIMARY_SELECTOR],
		});
		const dispatched = captureDispatches(
			settledResult({
				exitCode: 1,
				output: "",
				stderr: `[${PRIMARY_SELECTOR}] ${USAGE_LIMIT_ERROR}`,
				resolvedModel: PRIMARY_SELECTOR,
			}),
		);

		const settled = await runStructuredSubagent({
			session: parent,
			invocationKind: "task",
			assignment: "Inspect the target.",
			agent: "worker",
		});

		expect(settled.result.failureClass).toBe("usage-limit");
		expect(settled.result.fallbackCandidates).toBeDefined();
		expect(modelFailureLedgerForSession(PARENT_SESSION_FILE).exhaustedRecord(PRIMARY_SELECTOR)).toBeDefined();
		expect(dispatched).toHaveLength(1);
	});

	it("reports the failure class, the candidates, and records the dry route", async () => {
		const parent = testSession(Settings.isolated({ "task.isolation.enabled": false }), {
			agentModel: [PRIMARY_SELECTOR],
		});
		const dispatched = captureDispatches(
			settledResult({
				exitCode: 1,
				output: "",
				stderr: `[${SECONDARY_SELECTOR}] ${USAGE_LIMIT_ERROR}`,
				resolvedModel: SECONDARY_SELECTOR,
			}),
		);

		const settled = await runStructuredSubagent({
			session: parent,
			invocationKind: "task",
			assignment: "Inspect the target.",
			agent: "worker",
			model: SECONDARY_SELECTOR,
		});

		expect(settled.result.failureClass).toBe("usage-limit");
		expect(settled.result.fallbackCandidates).toContain(PRIMARY_SELECTOR);
		expect(modelFailureLedgerForSession(PARENT_SESSION_FILE).exhaustedRecord(SECONDARY_SELECTOR)).toBeDefined();
		expect(dispatched).toHaveLength(1);
	});
});

/**
 * The per-spawn `model` parameter behind `task.enableModelParam`: the wire
 * field is absent (and a hand-written one rejected) while the setting is off,
 * forwards into the child's model resolution when it is on, and cannot re-hit
 * a model this session already watched fail hard.
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
import { getTaskSchema, taskSchema } from "@linxiraos/zeta/task/types";
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
	it("strips `model` from the default shape", () => {
		const parsed = taskSchema({
			agent: "worker",
			task: "Inspect the target.",
			solutionSpace: "one fix",
			model: PRIMARY_SELECTOR,
		});
		expect(parsed instanceof type.errors).toBe(false);
		if (!(parsed instanceof type.errors)) expect("model" in parsed).toBe(false);
	});

	it("keeps `model` on every shape once task.enableModelParam is on", () => {
		/** Reflective read: the dynamic task schemas validate to `unknown`. */
		function readField(parsed: unknown, key: string): unknown {
			return parsed !== null && typeof parsed === "object" ? Reflect.get(parsed, key) : undefined;
		}

		/** Same, for `tasks[<index>]` in the batch shape. */
		function readItemField(parsed: unknown, index: number, key: string): unknown {
			const tasks = readField(parsed, "tasks");
			return Array.isArray(tasks) ? readField(tasks[index], key) : undefined;
		}

		const single = getTaskSchema({ isolationEnabled: false, batchEnabled: false, modelParamEnabled: true });
		const parsedSingle = single({
			agent: "worker",
			task: "Inspect the target.",
			solutionSpace: "one fix",
			model: PRIMARY_SELECTOR,
		});
		expect(readField(parsedSingle, "model")).toBe(PRIMARY_SELECTOR);

		const batch = getTaskSchema({ isolationEnabled: false, batchEnabled: true, modelParamEnabled: true });
		const parsedBatch = batch({
			context: "shared",
			tasks: [{ task: "Inspect the target.", solutionSpace: "one fix", model: SECONDARY_SELECTOR }],
		});
		expect(readItemField(parsedBatch, 0, "model")).toBe(SECONDARY_SELECTOR);
	});
});

describe("task spawn model parameter", () => {
	it("rejects a model selector while task.enableModelParam is off", async () => {
		const text = await executeText(
			testSession(Settings.isolated({ "task.enableModelParam": false, "task.batch": false })),
			{ agent: "worker", task: "Inspect the target.", solutionSpace: "one fix", model: PRIMARY_SELECTOR },
		);
		expect(text).toContain("cannot set `model` while task.enableModelParam is false");
	});

	it("rejects an empty selector", async () => {
		const text = await executeText(
			testSession(Settings.isolated({ "task.enableModelParam": true, "task.batch": false })),
			{ agent: "worker", task: "Inspect the target.", solutionSpace: "one fix", model: "  " },
		);
		expect(text).toContain("empty `model` selector");
	});

	it("refuses a model inside its hard-failure cooldown without dispatching", async () => {
		const session = testSession(Settings.isolated({ "task.enableModelParam": true, "task.batch": false }));
		modelFailureLedgerForSession(PARENT_SESSION_FILE).noteFailure({
			selector: PRIMARY_SELECTOR,
			failureClass: "usage-limit",
			agent: "worker",
		});
		const dispatched = captureDispatches(settledResult());

		const text = await executeText(session, {
			agent: "worker",
			task: "Inspect the target.",
			solutionSpace: "one fix",
			model: PRIMARY_SELECTOR,
		});

		expect(text).toContain(`Model \`${PRIMARY_SELECTOR}\` is in cooldown after a usage-limit failure`);
		expect(text).toContain(SECONDARY_SELECTOR);
		expect(dispatched).toHaveLength(0);
	});

	it("never re-hits a model that failed hard in the same session", async () => {
		const session = testSession(Settings.isolated({ "task.enableModelParam": true, "task.batch": false }));
		const dispatched = captureDispatches(
			settledResult({
				exitCode: 1,
				output: "",
				stderr: `[${PRIMARY_SELECTOR}] ${USAGE_LIMIT_ERROR}`,
				resolvedModel: PRIMARY_SELECTOR,
			}),
		);
		const params = {
			agent: "worker",
			task: "Inspect the target.",
			solutionSpace: "one fix",
			model: PRIMARY_SELECTOR,
		};

		const first = await executeText(session, params);
		expect(first).toContain('<failure class="usage-limit" />');
		expect(dispatched).toHaveLength(1);

		// The parent (or a retry) asking for the same model again must not reach
		// the provider: the first request already proved that route is dry.
		const second = await executeText(session, params);
		expect(second).toContain(`Model \`${PRIMARY_SELECTOR}\` is in cooldown after a usage-limit failure`);
		expect(dispatched).toHaveLength(1);
	});
});

describe("per-spawn model resolution", () => {
	function request(overrides: Partial<StructuredSubagentRequest> = {}) {
		return {
			session: testSession(Settings.isolated({ "task.enableModelParam": true, "task.isolation.enabled": false })),
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
				session: testSession(
					Settings.isolated({ "task.enableModelParam": true, "task.isolation.enabled": false }),
					{ agentModel: [PRIMARY_SELECTOR] },
				),
			}),
		);

		expect(dispatched[0]?.modelOverride).toEqual([PRIMARY_SELECTOR]);
		expect(settled.result.modelChange).toBeUndefined();
	});

	it("leaves an off-gate session's results and ledger untouched", async () => {
		const parent = testSession(
			Settings.isolated({ "task.enableModelParam": false, "task.isolation.enabled": false }),
			{
				agentModel: [PRIMARY_SELECTOR],
			},
		);
		const dispatched = captureDispatches(settledResult({ resolvedModel: PRIMARY_SELECTOR }));

		const settled = await runStructuredSubagent({
			session: parent,
			invocationKind: "task",
			assignment: "Inspect the target.",
			agent: "worker",
		});

		expect(dispatched[0]?.modelOverride).toEqual([PRIMARY_SELECTOR]);
		expect(settled.result.failureClass).toBeUndefined();
		expect(settled.result.fallbackCandidates).toBeUndefined();
		expect(settled.result.modelChange).toBeUndefined();
		expect(modelFailureLedgerForSession(PARENT_SESSION_FILE).exhausted()).toHaveLength(0);
	});

	it("reports the failure class, the candidates, and blocks the same-model re-dispatch", async () => {
		const parent = testSession(
			Settings.isolated({ "task.enableModelParam": true, "task.isolation.enabled": false }),
			{
				agentModel: [PRIMARY_SELECTOR],
			},
		);
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

import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Model } from "@linxiraos/pi-ai";
import { unregisterCustomApis } from "@linxiraos/pi-ai/api-registry";
import { createMockModel, registerMockApi } from "@linxiraos/pi-ai/providers/mock";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentRegistry } from "@linxiraos/zeta/registry/agent-registry";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import * as discovery from "@linxiraos/zeta/task/discovery";
import { runStructuredSubagent } from "@linxiraos/zeta/task/structured-subagent";
import type { ToolSession } from "@linxiraos/zeta/tools";

const cleanups: (() => Promise<void>)[] = [];
let runs = 0;

function scenarioSettings(model: Model, failClosed = true): Settings {
	return Settings.isolated({
		"task.maxRecursionDepth": 2,
		"task.isolation.enabled": false,
		"compaction.enabled": false,
		"retry.enabled": false,
		// The per-agent identity supplies the model; the scenario must constrain it.
		modelAgents: { worker: { model: `mock/${model.id}` } },
		modelScenarios: {
			"local-only": { allowedAgents: ["worker"], boundary: "local", failClosed },
		},
	});
}

function fallbackScenarioSettings(primaryId: string, fallbackId: string): Settings {
	return Settings.isolated({
		"task.maxRecursionDepth": 2,
		"task.isolation.enabled": false,
		"compaction.enabled": false,
		"retry.enabled": false,
		modelAgents: { worker: { model: `mock/${primaryId}`, fallback: [`mock/${fallbackId}`] } },
		modelScenarios: {
			"local-only": { allowedAgents: ["worker"], boundary: "local", failClosed: true },
		},
	});
}

/** Run a bundled worker through the real executor with `model` as the registry entry. */
async function runWorker(model: Model, failClosed = true, options: { models?: Model[]; settings?: Settings } = {}) {
	const available = options.models ?? [model];
	const run = ++runs;
	const sourceId = `executor-scenario-boundary-${run}`;
	const agentId = `ScenarioBoundary${run}`;
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-executor-scenario-boundary-"));
	const authStorage = await AuthStorage.create(":memory:");
	cleanups.push(async () => {
		await AgentRegistry.global().get(agentId)?.session?.dispose();
		AgentRegistry.global().unregister(agentId);
		unregisterCustomApis(sourceId);
		authStorage.close();
		await fs.rm(cwd, { recursive: true, force: true });
	});
	authStorage.keys.setRuntime("mock", "test-key");
	registerMockApi(sourceId);
	const modelRegistry = new ModelRegistry(authStorage, path.join(cwd, "models.yml"));
	const find = modelRegistry.find.bind(modelRegistry);
	vi.spyOn(modelRegistry, "find").mockImplementation(
		(provider, id) => available.find(entry => entry.provider === provider && entry.id === id) ?? find(provider, id),
	);
	vi.spyOn(modelRegistry, "getAvailable").mockImplementation(() => available);
	vi.spyOn(modelRegistry, "getAll").mockImplementation(() => available);
	vi.spyOn(discovery, "discoverAgents").mockResolvedValue({
		agents: [{ name: "worker", description: "test", systemPrompt: "test", source: "bundled", tools: ["read"] }],
		projectAgentsDir: null,
	});
	const session = {
		cwd,
		hasUI: false,
		settings: options.settings ?? scenarioSettings(model, failClosed),
		authStorage,
		modelRegistry,
		restrictToolNames: true,
		enableMCP: false,
		enableLsp: false,
		enableIrc: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		getSessionAgents: () => [],
	} as unknown as ToolSession;
	const execution = await runStructuredSubagent({
		session,
		invocationKind: "task",
		assignment: "Answer the question.",
		agent: "worker",
		structured: false,
		identity: { id: agentId },
		keepAlive: false,
	});
	return execution.result;
}

const failure = (result: { error?: string; stderr: string; output: string }) =>
	`${result.error ?? ""}${result.stderr}${result.output}`;

describe("subagent scenario boundary", () => {
	afterEach(async () => {
		vi.restoreAllMocks();
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	it("runs an in-boundary model", async () => {
		const model = createMockModel({
			id: "local-worker",
			baseUrl: "http://127.0.0.1:11434/v1",
			handler: () => ({ content: ["Local answer."] }),
		});
		const result = await runWorker(model);
		expect(result.exitCode).toBe(0);
		expect(result.output).toBe("Local answer.");
		expect(model.calls).toHaveLength(1);
	});

	it("refuses an out-of-boundary model under failClosed", async () => {
		const model = createMockModel({
			id: "public-worker",
			baseUrl: "https://api.example.com/v1",
			handler: () => ({ content: ["Should not run."] }),
		});
		const result = await runWorker(model);
		expect(result.exitCode).not.toBe(0);
		expect(failure(result)).toContain("scenario_boundary");
		expect(failure(result)).toContain("local");
		// The refused spawn never created a child session or dispatched a request.
		expect(model.calls).toHaveLength(0);
	});

	it("uses an in-boundary fallback instead of an out-of-boundary primary", async () => {
		const publicModel = createMockModel({
			id: "public-primary",
			baseUrl: "https://api.example.com/v1",
			handler: () => ({ content: ["Public should not run."] }),
		});
		const localModel = createMockModel({
			id: "local-fallback",
			baseUrl: "http://127.0.0.1:11434/v1",
			handler: () => ({ content: ["Local fallback."] }),
		});
		const result = await runWorker(publicModel, true, {
			models: [publicModel, localModel],
			settings: fallbackScenarioSettings(publicModel.id, localModel.id),
		});
		expect(result.exitCode).toBe(0);
		expect(result.output).toBe("Local fallback.");
		expect(publicModel.calls).toHaveLength(0);
		expect(localModel.calls).toHaveLength(1);
	});
});

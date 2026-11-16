import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { buildModel } from "@linxiraos/pi-catalog/build";
import { AssistantMessageEventStream } from "@linxiraos/pi-ai/utils/event-stream";
import type { AssistantMessage } from "@linxiraos/pi-ai";
import { runIfBench } from "../src/if-bench/runner";
import { applyActions, initialArray, makeActions } from "../src/if-bench/actions";
import { Settings } from "../src/config/settings";
import type { AgentSession } from "../src/session/agent-session";
import type { ToolSession } from "../src/tools";
import { StudioEvaluationWorkspaceService } from "../src/server/studio-host/services/evaluation-workspace-service";
import { EvaluationCoordinator, type EvaluationWorker } from "../src/server/studio-host/services/evaluation-coordinator";
import { EvaluationExportStore } from "../src/server/studio-host/services/evaluation-export-store";
import { EvaluationInteractionPort } from "../src/server/studio-host/services/evaluation-interactions";
import { EvaluationPublicProjection } from "../src/server/studio-host/services/evaluation-public";
import { evaluationOffset, validateEvaluationSpec } from "../src/server/studio-host/services/evaluation-limits";
import { installStudioRatchetBoundary } from "../src/server/studio-host/services/ratchet-boundary";
import { createRatchetPrelude } from "../src/ratchet/prelude-definition";
import { getJudgmentBatch, runEvalJudgmentBatch } from "../src/eval/judgment-batch-bridge";
import type { EvaluationNativeSnapshot, EvaluationWorkspaceOperation, EvaluationSpec } from "../src/server/studio-host/protocol/contracts/evaluation-workspace";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function directory(): Promise<string> { const root = await mkdtemp(path.join(tmpdir(), "zeta-studio-evaluation-")); directories.push(root); return root; }
const spec = { kind: "benchmark", profile: "chat", models: ["test/model"], runs: 2 } satisfies EvaluationSpec;

describe("durable evaluation reports", () => {
	test("retains revised rows and complete paged exports without replaying native requests", async () => {
		const root = await directory();
		let starts = 0, revision = 1;
		const rowSet = Array.from({ length: 245 }, (_, index) => ({ key: String(index), data: { value: index } }));
		const worker: EvaluationWorker = {
			sessionId: "session-a", runtimeVersion: "test", pending: () => undefined, respond: async () => {}, release: async () => {},
			context: async () => ({ available: true, models: [] }), subscribe: () => () => {},
			async invoke(operation: EvaluationWorkspaceOperation) {
				if (operation.kind === "evaluation.runtime.plan") return { spec: operation.spec, requests: 2, upperBound: false, phases: [], notes: [] };
				if (operation.kind === "evaluation.runtime.start") starts++;
				if (operation.kind === "evaluation.runtime.rows") {
					const rows = revision === 1 ? [{ key: "0", data: { value: "partial" } }] : rowSet;
					const offset = operation.offset ?? 0, page = rows.slice(offset, offset + (operation.limit ?? 100));
					return { rows: page, offset, nextOffset: offset + page.length, total: rows.length };
				}
				if (operation.kind === "evaluation.runtime.report") { const text = JSON.stringify(rowSet); return { text, total: text.length, nextOffset: text.length }; }
				return { state: revision === 1 ? "running" : "completed", completed: revision === 1 ? 1 : 245, total: 245, failed: 0, cost: 0.02, metrics: [], detail: {}, revision } satisfies EvaluationNativeSnapshot;
			},
		};
		const store = new EvaluationExportStore(path.join(root, "exports"));
		let coordinator = new EvaluationCoordinator(root, { open: async () => worker }, store, "session-a");
		try {
			const record = await coordinator.start({ workspaceId: "workspace", title: "Rows", spec });
			revision = 2;
			await coordinator.control({ id: record.id, action: "cancel" });
			expect((await coordinator.rows({ id: record.id, offset: 200 })).rows).toHaveLength(45);
			expect((await coordinator.rows({ id: record.id })).rows[0]?.data).toEqual({ value: 0 });
			await coordinator.shutdown();
			coordinator = new EvaluationCoordinator(root, { open: async () => { throw new Error("history must not execute"); } }, store, "session-a");
			expect((await coordinator.read(record.id)).state).toBe("completed");
			expect(starts).toBe(1);
			const exported = await coordinator.export({ id: record.id, format: "csv" });
			const resolved = await store.resolve(exported.artifactId);
			const csv = await readFile(resolved.path, "utf8");
			expect(csv.split("\r\n")).toHaveLength(246);
			expect(csv).toContain("244");
			const chunk = await coordinator.exportChunk({ artifactId: exported.artifactId, offset: 5 });
			expect(Buffer.from(chunk.data, "base64").toString("utf8")).toBe(csv.slice(5));
			const foreign = new EvaluationExportStore(path.join(root, "foreign"));
			await expect(foreign.resolve(exported.artifactId)).rejects.toThrow("not found");
		} finally { await coordinator.shutdown(); }
	});

	test("clears a transient native error when the next snapshot recovers", async () => {
		const root = await directory();
		let reads = 0;
		const worker: EvaluationWorker = {
			sessionId: "session-a", runtimeVersion: "test", pending: () => undefined, respond: async () => {}, release: async () => {},
			context: async () => ({ available: true, models: [] }), subscribe: () => () => {},
			async invoke(operation: EvaluationWorkspaceOperation) {
				if (operation.kind === "evaluation.runtime.plan") return { spec: operation.spec, requests: 1, upperBound: false, phases: [], notes: [] };
				if (operation.kind === "evaluation.runtime.rows") return { rows: [], offset: 0, nextOffset: 0, total: 0 };
				if (operation.kind === "evaluation.runtime.report") { const text = "{}"; return { text, nextOffset: text.length, total: text.length }; }
				if (operation.kind === "evaluation.runtime.start") return { state: "running", completed: 0, total: 1, failed: 0, cost: 0, metrics: [], detail: {}, revision: 0 } satisfies EvaluationNativeSnapshot;
				if (operation.kind === "evaluation.runtime.control") return { state: "running", completed: 0, total: 1, failed: 0, cost: 0, metrics: [], detail: {}, revision: 1 } satisfies EvaluationNativeSnapshot;
				reads++;
				const base = { state: "running" as const, completed: 0, total: 1, failed: 0, cost: 0, metrics: [], detail: {} };
				return reads === 1 ? { ...base, revision: 1, error: "Unexpected end of JSON input" } : { ...base, revision: 2 };
			},
		};
		const coordinator = new EvaluationCoordinator(root, { open: async () => worker }, new EvaluationExportStore(path.join(root, "exports")), "session-a");
		try {
			const record = await coordinator.start({ workspaceId: "workspace", title: "Recovery", spec });
			expect(record.error).toBe("Unexpected end of JSON input");
			await coordinator.control({ id: record.id, action: "cancel" });
			expect(record.error).toBeUndefined();
		} finally { await coordinator.shutdown(); }
	});

	test("a view revoked during planning never starts paid work", async () => {
		const root = await directory();
		const planning = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
		let live = true, starts = 0, released = 0;
		const worker: EvaluationWorker = {
			sessionId: "a", runtimeVersion: "test", context: async () => ({ available: true, models: [] }), pending: () => undefined, respond: async () => {}, subscribe: () => () => {}, release: async () => { released++; },
			async invoke(operation) { if (operation.kind === "evaluation.runtime.plan") { planning.resolve(); await finish.promise; return { spec: operation.spec }; } starts++; return {}; },
		};
		const coordinator = new EvaluationCoordinator(root, { open: async () => worker }, new EvaluationExportStore(path.join(root, "exports")), "a");
		try {
			const start = coordinator.start({ workspaceId: "w", title: "revocation", spec }, () => { if (!live) throw new Error("view closed"); });
			await planning.promise; live = false; finish.resolve();
			await expect(start).rejects.toThrow("view closed");
			expect(starts).toBe(0); expect(released).toBe(1);
		} finally { await coordinator.shutdown(); }
	});

	test("revocation after planning prevents input preservation and returns no prepared spec", async () => {
		const root = await directory();
		const planning = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
		let live = true, copied = 0;
		const worker: EvaluationWorker = {
			sessionId: "a", runtimeVersion: "test", context: async () => ({ available: true, models: [] }), pending: () => undefined, respond: async () => {}, subscribe: () => () => {}, release: async () => {},
			async invoke(operation) { if (operation.kind !== "evaluation.runtime.plan") throw new Error("Only planning is allowed"); planning.resolve(); await finish.promise; return { spec: operation.spec }; },
			async preserveInputs(input) { copied++; return input; },
		};
		const coordinator = new EvaluationCoordinator(root, { open: async () => worker }, new EvaluationExportStore(path.join(root, "exports")), "a");
		try {
			const prepared = coordinator.prepare({ workspaceId: "w", spec }, () => { if (!live) throw new Error("view closed"); });
			await planning.promise;
			live = false;
			finish.resolve();
			await expect(prepared).rejects.toThrow("view closed");
			expect(copied).toBe(0);
		} finally { await coordinator.shutdown(); }
	});
});

describe("native execution and review", () => {
	test("missing provider credentials are retained as failures without invoking a model", async () => {
		const model = buildModel({ provider: "test", id: "model", name: "model", api: "openai-completions", baseUrl: "https://provider.invalid", input: ["text"], reasoning: false, maxTokens: 4096, contextWindow: 128000, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } });
		const session = { settings: Settings.isolated(), getEvalToolSession: () => undefined, modelRegistry: { getAll: () => [model], getAvailable: () => [model], getApiKey: async () => undefined } } as unknown as AgentSession;
		const service = new StudioEvaluationWorkspaceService(session);
		const id = crypto.randomUUID();
		await service.execute({ kind: "evaluation.runtime.start", id, title: "No credentials", spec });
		await service.settled();
		const snapshot = await service.execute({ kind: "evaluation.runtime.read", id }) as EvaluationNativeSnapshot;
		expect(snapshot.state).toBe("failed"); expect(snapshot.failed).toBe(1);
		const page = await service.execute({ kind: "evaluation.runtime.rows", id }) as { rows: Array<{ data: { error?: string } }> };
		expect(page.rows[0]?.data.error).toContain("credentials");
		service.release();
	});

	test("cancel aborts the active native benchmark request and retains completed rows", async () => {
		const model = buildModel({ provider: "test", id: "model", name: "model", api: "openai-completions", baseUrl: "https://provider.invalid", input: ["text"], reasoning: false, maxTokens: 4096, contextWindow: 128000, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } });
		const requested = Promise.withResolvers<void>();
		let requests = 0, signal: AbortSignal | undefined;
		const session = { settings: Settings.isolated(), getEvalToolSession: () => undefined, modelRegistry: { getAll: () => [model], getAvailable: () => [model], getApiKey: async () => "test-key", resolver: () => async () => "test-key" } } as unknown as AgentSession;
		const service = new StudioEvaluationWorkspaceService(session, { streamSimple: (_model, _context, options) => {
			requests++; signal = options?.signal;
			const stream = new AssistantMessageEventStream();
			signal?.addEventListener("abort", () => stream.fail(new Error("Request cancelled")), { once: true });
			requested.resolve();
			return stream;
		} });
		const id = crypto.randomUUID();
		await service.execute({ kind: "evaluation.runtime.start", id, title: "Cancel", spec: { ...spec, concurrency: 1 } });
		await requested.promise;
		await service.execute({ kind: "evaluation.runtime.control", id, action: "cancel" });
		await service.settled();
		const snapshot = await service.execute({ kind: "evaluation.runtime.read", id }) as EvaluationNativeSnapshot;
		expect(signal?.aborted).toBe(true); expect(requests).toBe(1);
		expect(snapshot.state).toBe("cancelled"); expect(snapshot.completed).toBe(1);
		const rows = await service.execute({ kind: "evaluation.runtime.rows", id }) as { total: number };
		expect(rows.total).toBe(1);
		service.release();
	});

	test("instruction cancellation stops later turns and retains the completed model report", async () => {
		const model = buildModel({ provider: "test", id: "model", name: "model", api: "openai-completions", baseUrl: "https://provider.invalid", input: ["text"], reasoning: false, maxTokens: 4096, contextWindow: 128000, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } });
		const controller = new AbortController();
		let requests = 0;
		const runtime = { modelRegistry: { getAll: () => [model], getAvailable: () => [model], getApiKey: async () => "test-key", resolver: () => async () => "test-key" } };
		const result = await runIfBench({
			targets: [{ selector: "test/model", model, thinking: undefined }], runtime,
			maxTurns: 4, arrayLength: 24, nyaMax: 8, maxTokens: 4096, par: 1,
			signal: controller.signal, now: () => 0, randomSessionId: () => "instruction-test",
			stream: () => {
				requests++;
				const response = `<${applyActions(initialArray(24), makeActions(24, 0, 1))}> nya`;
				const stream = new AssistantMessageEventStream();
				const message = { role: "assistant", content: [{ type: "text", text: response }], stopReason: "stop", usage: { input: 10, output: 5, cost: { total: 0.01 } }, duration: 10 } as unknown as AssistantMessage;
				stream.push({ type: "done", reason: "stop", message });
				return stream;
			},
			observer: { turnFinished: () => controller.abort() },
		});
		expect(requests).toBe(1); expect(result.models[0]?.turns).toHaveLength(1);
		expect(result.models[0]?.turns[0]?.passed).toBe(true);
	});

	test("renderer reconnect invalidates the old review lease without cancelling native review", async () => {
		const session = { getEvalToolSession: () => undefined, buildAskReanswerContext: (ui: unknown) => ({ ui, hasUI: true }) } as unknown as AgentSession;
		const port = new EvaluationInteractionPort(session, () => {});
		port.claim("old");
		const pendingAnswer = port.context().ui!.askDialog!([{ id: "inputs", question: "Inspect inputs", options: [{ label: "Approve" }, { label: "Revise" }] }]);
		const stale = port.pending()!;
		port.release("old"); port.claim("new");
		await expect(port.respond({ interactionId: stale.request.interactionId, leaseGeneration: stale.leaseGeneration, decision: "submit", value: { results: [{ id: "inputs", selectedOptions: ["0"] }] } })).rejects.toThrow("stale");
		const current = port.pending()!;
		await port.respond({ interactionId: current.request.interactionId, leaseGeneration: current.leaseGeneration, decision: "submit", value: { results: [{ id: "inputs", selectedOptions: ["1"], note: "Fix cases" }] } });
		expect(await pendingAnswer).toMatchObject({ kind: "submit", results: [{ selectedOptions: ["Revise"], note: "Fix cases" }] });
		port.close();
	});

	test("gateway UI theme getter does not block the evaluation review context", () => {
		const themeError = new Error("Theme access is not supported by the web gateway");
		const baseUi = Object.defineProperty({}, "theme", { enumerable: true, get() { throw themeError; } });
		const session = {
			getEvalToolSession: () => ({ getToolContext: () => ({ ui: baseUi }) }),
			buildAskReanswerContext: (ui: unknown) => ({ ui, hasUI: true }),
		} as unknown as AgentSession;
		const port = new EvaluationInteractionPort(session, () => {});
		try {
			const context = port.context();
			expect(typeof context.ui?.askDialog).toBe("function");
			expect(() => context.ui?.theme).toThrow("Theme access is not supported by the web gateway");
		} finally { port.close(); }
	});

	test("native Ratchet prelude cannot execute a baseline during preparation", async () => {
		const root = await directory();
		const release = installStudioRatchetBoundary(root, "flow", 2, () => false, undefined, true);
		const session = { cwd: root, settings: Settings.isolated(), modelRegistry: { getAll: () => [] } } as unknown as ToolSession;
		try { await expect(createRatchetPrelude(session).invoke({ action: "check", flow: "flow", variant: "baseline" }, { session, toolCallId: "test" })).rejects.toThrow("Start the approved evaluation"); }
		finally { release(); }
	});

	test("observer pages do not consume the native judgment drain cursor", async () => {
		const session = { getAgentId: () => "owner", getSessionId: () => "a" } as unknown as ToolSession;
		const created = await runEvalJudgmentBatch({ op: "create", items: [{ key: "a", state: "one" }, { key: "b", state: "two" }], questions: { good: { type: "bool", instructions: "Correct?" } }, concurrency: 1, retries: 0 }, { session });
		if (!("id" in created)) throw new Error("Expected native batch status");
		const batch = getJudgmentBatch(created.id, session)!;
		const drained = await batch.drain(100, undefined);
		expect(batch.readItems(0, 50)).toHaveLength(2);
		expect(drained).toHaveLength(2);
		expect(getJudgmentBatch(batch.id, { ...session, getSessionId: () => "b" })).toBeUndefined();
		await runEvalJudgmentBatch({ op: "close", id: batch.id }, { session });
	});
});

test("public reports retain measurements and remove private fields in nested errors", () => {
	const projection = new EvaluationPublicProjection(["C:/private/repo"]);
	const report = projection.value({ workspace: "C:/private/repo", maxTokens: 2048, inputTokens: 10, apiKey: "secret", detail: { error: "request https://127.0.0.1:1234/private token=hidden C:/private/repo/file" } });
	expect(report.maxTokens).toBe(2048); expect(report.inputTokens).toBe(10);
	const text = JSON.stringify(report); expect(text).not.toContain("hidden"); expect(text).not.toContain("127.0.0.1"); expect(text).not.toContain("C:/private"); expect(text).not.toContain('"secret"');
	expect(() => evaluationOffset(-1)).toThrow();
	expect(() => validateEvaluationSpec({ ...spec, runs: 10000 })).toThrow();
});

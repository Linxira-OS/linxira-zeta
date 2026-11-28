/**
 * Agent page workflow executor.
 *
 * Pins the DAG contract: a two-step dependency edge propagates a typed value,
 * independent steps share a bounded concurrency budget, cycles are rejected
 * before execution, a missing grant stops the run before any step touches the
 * page, and an aborted signal rejects with `cancelled`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AGENT_PAGE_SCHEMA,
	AgentPageError,
	planAgentPageWorkflow,
	runAgentPageWorkflow,
	parseAgentPageManifest,
	type AgentPageFetch,
	type AgentPageManifest,
	type AgentPageWorkflow,
} from "../../src/agent-pages";

let pageRoot: string;

beforeAll(async () => {
	pageRoot = await mkdtemp(join(tmpdir(), "zeta-agent-pages-executor-"));
	await mkdir(join(pageRoot, "data"), { recursive: true });
	await mkdir(join(pageRoot, "out"), { recursive: true });
	await writeFile(join(pageRoot, "data", "input.txt"), "inside");
});

afterAll(async () => {
	await rm(pageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
});

function makeManifest(workflows: AgentPageWorkflow[], permissions: Record<string, unknown> = {}): AgentPageManifest {
	return parseAgentPageManifest({
		schema: AGENT_PAGE_SCHEMA,
		id: "demo",
		name: "Demo",
		entry: "index.html",
		permissions,
		workflows,
	});
}

async function rejection(promise: Promise<unknown>): Promise<AgentPageError> {
	try {
		await promise;
	} catch (error) {
		if (!(error instanceof AgentPageError)) throw error;
		return error;
	}
	throw new Error("expected the workflow to reject");
}

describe("DAG execution", () => {
	test("runs a two-step DAG and propagates the typed output", async () => {
		const manifest = makeManifest([
			{
				id: "hello",
				steps: [
					// Declared before its dependency on purpose: the executor must
					// start in topological order, not manifest order.
					{ id: "message", kind: "template", template: "{{text}} world", inputs: { text: "seed" } },
					{ id: "seed", kind: "constant", value: "hello" },
				],
			},
		]);
		const result = await runAgentPageWorkflow({ manifest, pageRoot, workflowId: "hello" });
		expect(result.order).toEqual(["seed", "message"]);
		expect(result.outputs.seed).toEqual({ stepId: "seed", type: "text", value: "hello" });
		expect(result.outputs.message).toEqual({ stepId: "message", type: "text", value: "hello world" });
		expect(result.pageId).toBe("demo");
		expect(typeof result.durationMs).toBe("number");
	});

	test("reads and writes page files only with declared grants", async () => {
		const manifest = makeManifest(
			[
				{
					id: "files",
					steps: [
						{ id: "input", kind: "read", path: "data/input.txt" },
						{ id: "message", kind: "template", template: "{{value}}!", inputs: { value: "input" } },
						{ id: "output", kind: "write", path: "out/result.txt", input: "message" },
					],
				},
			],
			{ read: ["data/"], write: ["out/"] },
		);
		const result = await runAgentPageWorkflow({ manifest, pageRoot, workflowId: "files" });
		expect(result.outputs.input).toEqual({ stepId: "input", type: "text", value: "inside" });
		expect(result.outputs.output).toEqual({ stepId: "output", type: "text", value: "out/result.txt" });
		expect(await readFile(join(pageRoot, "out", "result.txt"), "utf8")).toBe("inside!");
	});

	test("bounds concurrent step execution", async () => {
		let active = 0;
		let maxActive = 0;
		let started = 0;
		const startedTwo = Promise.withResolvers<void>();
		const startedFour = Promise.withResolvers<void>();
		let releases: Array<() => void> = [];
		const fakeFetch: AgentPageFetch = async input => {
			const gate = Promise.withResolvers<void>();
			releases.push(gate.resolve);
			active += 1;
			maxActive = Math.max(maxActive, active);
			started += 1;
			if (started === 2) startedTwo.resolve();
			if (started === 4) startedFour.resolve();
			await gate.promise;
			active -= 1;
			return new Response(`ok:${String(input)}`);
		};
		const manifest = makeManifest(
			[
				{
					id: "parallel",
					steps: [
						{ id: "one", kind: "fetch", url: "https://api.example.test/one" },
						{ id: "two", kind: "fetch", url: "https://api.example.test/two" },
						{ id: "three", kind: "fetch", url: "https://api.example.test/three" },
						{ id: "four", kind: "fetch", url: "https://api.example.test/four" },
					],
				},
			],
			{ network: ["api.example.test"] },
		);
		const result = runAgentPageWorkflow({
			manifest,
			pageRoot,
			workflowId: "parallel",
			concurrency: 2,
			fetchImpl: fakeFetch,
		});
		await startedTwo.promise;
		const firstWave = releases;
		releases = [];
		for (const release of firstWave) release();
		await startedFour.promise;
		for (const release of releases) release();
		const completed = await result;
		expect(maxActive).toBeLessThanOrEqual(2);
		expect(completed.outputs.one?.type).toBe("text");
		expect(completed.outputs.four?.value).toContain("/four");
	});
});

describe("workflow validation", () => {
	test("rejects a dependency cycle before running any step", async () => {
		const workflow: AgentPageWorkflow = {
			id: "cycle",
			steps: [
				{ id: "a", kind: "constant", value: 1, dependsOn: ["b"] },
				{ id: "b", kind: "constant", value: 2, dependsOn: ["a"] },
			],
		};
		expect(() => planAgentPageWorkflow(workflow)).toThrow(AgentPageError);
		const manifest = makeManifest([workflow]);
		const error = await rejection(runAgentPageWorkflow({ manifest, pageRoot, workflowId: "cycle" }));
		expect(error.code).toBe("cycle");
	});

	test("rejects a step outside the manifest permissions", async () => {
		const manifest = makeManifest([
			{
				id: "read",
				steps: [{ id: "input", kind: "read", path: "data/input.txt" }],
			},
		]);
		const error = await rejection(runAgentPageWorkflow({ manifest, pageRoot, workflowId: "read" }));
		expect(error.code).toBe("permission_denied");
	});
});

describe("cancellation", () => {
	test("aborts an in-flight fetch and reports cancelled", async () => {
		const started = Promise.withResolvers<void>();
		const fakeFetch: AgentPageFetch = async (_input, init) => {
			const pending = Promise.withResolvers<Response>();
			const signal = init?.signal;
			const onAbort = () => pending.reject(new DOMException("Aborted", "AbortError"));
			if (signal?.aborted === true) onAbort();
			else signal?.addEventListener("abort", onAbort, { once: true });
			started.resolve();
			return pending.promise;
		};
		const manifest = makeManifest(
			[{ id: "slow", steps: [{ id: "wait", kind: "fetch", url: "https://api.example.test/slow" }] }],
			{ network: ["api.example.test"] },
		);
		const controller = new AbortController();
		const run = runAgentPageWorkflow({
			manifest,
			pageRoot,
			workflowId: "slow",
			signal: controller.signal,
			fetchImpl: fakeFetch,
		});
		await started.promise;
		controller.abort();
		const error = await rejection(run);
		expect(error.code).toBe("cancelled");
	});
});

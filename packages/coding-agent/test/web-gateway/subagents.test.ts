/**
 * Subagent roster read face (`document/web-gateway.md`) — snapshot, SSE deltas,
 * byte-paged transcript and published output.
 *
 * The handlers are exercised through their real signatures with a real
 * `SubagentSink` driven by fabricated `task:subagent:*` bus frames, so the
 * contract under test is the one the gateway serves (registry refs +
 * `AgentProgress` frames + on-disk artifacts), not a re-implementation.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils/dirs";
import { AgentSessionWrapper, sessions } from "../../src/server/web-gateway/agents";
import {
	handleSubagentEvents,
	handleSubagentOutput,
	handleSubagentRoster,
	handleSubagentTranscript,
	SubagentSink,
} from "../../src/server/web-gateway/subagents";
import { AgentRegistry } from "../../src/registry/agent-registry";
import { TASK_SUBAGENT_LIFECYCLE_CHANNEL, TASK_SUBAGENT_PROGRESS_CHANNEL } from "../../src/task";
import { EventBus } from "../../src/utils/event-bus";

const AGENT_DIR_ENV = "ZETA_CODING_AGENT_DIR";
const savedEnv = process.env[AGENT_DIR_ENV];
const cleanups: Array<() => Promise<void>> = [];

let rootDir: string;
let rootSessionFile: string;
let artifactRoot: string;

async function setup(): Promise<void> {
	const agentDir = await mkdtemp(join(tmpdir(), "zeta-subagents-"));
	process.env[AGENT_DIR_ENV] = agentDir;
	refreshDirsFromEnv();
	cleanups.push(async () => {
		await rm(agentDir, { recursive: true, force: true });
	});
	rootDir = join(agentDir, "sessions");
	rootSessionFile = join(rootDir, "rootsess.jsonl");
	artifactRoot = join(rootDir, "rootsess");
	await mkdir(artifactRoot, { recursive: true });
}

function subagentSessionFile(id: string): string {
	return join(artifactRoot, `${id}.jsonl`);
}

/** A wrapper standing in for a live gateway session; the sink is wired the same way. */
function makeSession(sessionId: string): { wrapper: AgentSessionWrapper; bus: EventBus; sink: SubagentSink } {
	const wrapper = new AgentSessionWrapper(
		{ sessionManager: {}, subscribe: () => () => {}, settings: undefined } as never,
		sessionId,
		rootSessionFile,
	);
	const bus = new EventBus();
	const sink = new SubagentSink(bus, () => wrapper.sessionFile);
	wrapper.subagentSink = sink;
	sessions.set(sessionId, wrapper);
	cleanups.push(async () => {
		sink.dispose();
		sessions.delete(sessionId);
	});
	return { wrapper, bus, sink };
}

function registerRef(args: {
	id: string;
	status?: "running" | "idle" | "parked" | "aborted";
	parentId?: string;
	sessionFile?: string | null;
	live?: boolean;
	activity?: string;
	lifecycle?: { responseAt?: number; acceptedAt?: number; terminalAt?: number };
	history?: { metrics?: { tokens: number; requests: number; tools: number; cost: number; durationMs: number } };
	/** Override the attached session object (e.g. one exposing `getSessionStats`). */
	session?: unknown;
}): void {
	AgentRegistry.global().register({
		id: args.id,
		displayName: args.id,
		kind: "sub",
		parentId: args.parentId ?? "Main",
		session:
			args.session !== undefined ? (args.session as never) : args.live ? ({ isStreaming: true } as never) : null,
		sessionFile: args.sessionFile === undefined ? subagentSessionFile(args.id) : args.sessionFile,
		status: args.status ?? "running",
		activity: args.activity,
		lifecycle: args.lifecycle,
		history: args.history,
	});
}

const AGENT_SOURCE = "builtin" as never;

function emitLifecycle(
	bus: EventBus,
	payload: { id: string; status: "started" | "completed" | "failed" | "aborted"; index?: number },
): void {
	bus.emit(TASK_SUBAGENT_LIFECYCLE_CHANNEL, {
		id: payload.id,
		agent: "task",
		agentSource: AGENT_SOURCE,
		status: payload.status,
		index: payload.index ?? 0,
		parentToolCallId: "tc-1",
		sessionFile: subagentSessionFile(payload.id),
		description: `${payload.id} task`,
	});
}

function emitProgress(bus: EventBus, id: string, overrides: Record<string, unknown> = {}): void {
	bus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, {
		index: 0,
		agent: "task",
		agentSource: AGENT_SOURCE,
		task: "inspect the repo",
		parentToolCallId: "tc-1",
		sessionFile: subagentSessionFile(id),
		progress: {
			index: 0,
			id,
			agent: "task",
			agentSource: AGENT_SOURCE,
			status: "running",
			task: "inspect the repo",
			recentTools: [],
			recentOutput: ["first line", "second line"],
			toolCount: 3,
			requests: 2,
			tokens: 1200,
			cost: 0.25,
			durationMs: 4200,
			currentTool: "read",
			lastIntent: "inspecting",
			contextTokens: 900,
			contextWindow: 200_000,
			...overrides,
		},
	});
}

type SseFrame = Record<string, unknown>;

/**
 * Collected SSE frames plus an event-driven waiter: `until` resolves the moment
 * the predicate holds (no polling sleeps), with a timer only as a failure bound.
 */
function makeFrameCollector(): {
	frames: SseFrame[];
	push(frame: SseFrame): void;
	until(predicate: (frames: SseFrame[]) => boolean, timeoutMs?: number): Promise<void>;
} {
	const frames: SseFrame[] = [];
	const waiters = new Set<() => void>();
	return {
		frames,
		push(frame) {
			frames.push(frame);
			// Set iteration tolerates the deletions a resolving waiter performs.
			for (const waiter of waiters) waiter();
		},
		until(predicate, timeoutMs = 5000) {
			if (predicate(frames)) return Promise.resolve();
			return new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					waiters.delete(waiter);
					reject(new Error(`timed out waiting for SSE frame: ${JSON.stringify(frames.map(f => f.type))}`));
				}, timeoutMs);
				const waiter = (): void => {
					if (!predicate(frames)) return;
					clearTimeout(timer);
					waiters.delete(waiter);
					resolve();
				};
				waiters.add(waiter);
			});
		},
	};
}

/** Pump an SSE response body into a frame collector; returns a stop function. */
function pumpFrames(response: Response, collector: ReturnType<typeof makeFrameCollector>): () => Promise<void> {
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const done = (async () => {
		for (;;) {
			const { done: finished, value } = await reader.read();
			if (finished) return;
			buffer += decoder.decode(value, { stream: true });
			const parts = buffer.split("\n\n");
			buffer = parts.pop() ?? "";
			for (const part of parts) {
				const line = part.split("\n").find(candidate => candidate.startsWith("data: "));
				if (!line) continue; // heartbeat comment frame
				collector.push(JSON.parse(line.slice("data: ".length)) as SseFrame);
			}
		}
	})();
	return async () => {
		await reader.cancel();
		await done;
	};
}

beforeEach(async () => {
	await setup();
	AgentRegistry.resetGlobalForTests();
});

afterEach(async () => {
	AgentRegistry.resetGlobalForTests();
	if (savedEnv === undefined) delete process.env[AGENT_DIR_ENV];
	else process.env[AGENT_DIR_ENV] = savedEnv;
	refreshDirsFromEnv();
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

describe("GET /api/agent/:id/subagents", () => {
	test("projects registry rows in this session tree, richest row first", async () => {
		const { bus } = makeSession("sess-snap");
		registerRef({ id: "Worker", live: true, activity: "editing", lifecycle: { responseAt: 5, acceptedAt: 6 } });
		registerRef({
			id: "Parked",
			status: "parked",
			history: { metrics: { tokens: 7, requests: 1, tools: 2, cost: 0.5, durationMs: 10 } },
		});
		registerRef({ id: "Dead", status: "aborted", parentId: "Worker", live: true });
		// Another root's agent sharing the process-global registry.
		registerRef({ id: "Stranger", sessionFile: join(rootDir, "other", "Stranger.jsonl"), live: true });
		emitLifecycle(bus, { id: "Worker", status: "started" });
		emitProgress(bus, "Worker");

		const response = await handleSubagentRoster(
			new Request("http://localhost/api/agent/sess-snap/subagents"),
			"sess-snap",
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			subagents: Array<Record<string, unknown>>;
			maxConcurrency: number;
			generatedAt: number;
		};

		// Status-rank order (running → idle → parked → aborted), then recency.
		expect(body.subagents.map(row => row.id)).toEqual(["Worker", "Parked", "Dead"]);
		expect(typeof body.maxConcurrency).toBe("number");
		expect(body.maxConcurrency).toBeGreaterThan(0);
		expect(typeof body.generatedAt).toBe("number");

		const worker = body.subagents[0]!;
		expect(worker.status).toBe("running");
		expect(worker.taskStatus).toBe("running");
		expect(worker.persisted).toBe(false);
		expect(worker.activity).toBe("editing");
		expect(worker.createdAt).toBeGreaterThan(0);
		expect(worker.lastActivity).toBeGreaterThan(0);
		expect(worker.lifecycle).toEqual({ responseAt: 5, acceptedAt: 6 });
		expect(worker.depth).toBe(0);
		// Row metrics carry the DTO's shape only — no aggregation bookkeeping.
		expect(Object.keys(worker.metrics as object).sort()).toEqual([
			"contextTokens",
			"contextWindow",
			"cost",
			"durationKind",
			"durationMs",
			"requests",
			"tokens",
			"tools",
		]);
		expect(worker.progress).toMatchObject({
			currentTool: "read",
			lastIntent: "inspecting",
			toolCount: 3,
			tokens: 1200,
			cost: 0.25,
			recentOutput: ["first line", "second line"],
		});

		const parked = body.subagents[1]!;
		expect(parked.status).toBe("parked");
		expect(parked.persisted).toBe(true);
		expect(parked.metrics).toMatchObject({ tokens: 7, cost: 0.5 });
		expect(parked.progress).toBeUndefined();

		// Registry status wins over observer status: the observer still says
		// "running" while the ref already terminalized (aborted is terminal).
		const dead = body.subagents[2]!;
		expect(dead.status).toBe("aborted");
		expect(dead.parentId).toBe("Worker");
		expect(dead.depth).toBe(1);

		// Scope: a transcript from another root never leaks into this roster.
		expect(body.subagents.some(row => row.id === "Stranger")).toBe(false);
	});

	test("cold start: restores parked rows from disk with hydrated metrics and output", async () => {
		// No live refs at all — everything below comes from the artifacts tree.
		makeSession("sess-cold");
		const transcript = [
			{ type: "session", id: "s1", timestamp: "2026-01-01T00:00:00.000Z", version: 1, cwd: "/tmp" },
			{
				type: "session_init",
				id: "i1",
				parentId: "s1",
				timestamp: "2026-01-01T00:00:01.000Z",
				task: "probe the roster",
				agent: "scout",
				systemPrompt: ["You are scout"],
			},
			{
				type: "message",
				id: "a1",
				parentId: "i1",
				timestamp: "2026-01-01T00:00:05.000Z",
				message: {
					role: "assistant",
					timestamp: 1767225605000,
					provider: "probe",
					model: "probe-1",
					stopReason: "stop",
					content: [{ type: "text", text: "done" }],
					usage: { input: 100, output: 50, cacheWrite: 10, totalTokens: 160, cost: { total: 0.75 } },
				},
			},
		]
			.map(entry => JSON.stringify(entry))
			.join("\n");
		await writeFile(subagentSessionFile("Old"), `${transcript}\n`);
		await writeFile(join(artifactRoot, "Old.md"), "old result\n");

		const response = await handleSubagentRoster(
			new Request("http://localhost/api/agent/sess-cold/subagents"),
			"sess-cold",
		);
		const body = (await response.json()) as { subagents: Array<Record<string, unknown>> };
		expect(body.subagents).toHaveLength(1);
		const row = body.subagents[0]!;
		expect(row).toMatchObject({
			id: "Old",
			status: "parked",
			persisted: true,
			sessionFile: subagentSessionFile("Old"),
			outputPath: join(artifactRoot, "Old.md"),
			activity: "probe the roster",
		});
		// Hydrated from the transcript: usage plus the run's wall-clock span.
		expect(row.metrics).toMatchObject({
			tokens: 160,
			requests: 1,
			tools: 0,
			cost: 0.75,
			durationMs: 5000,
			durationKind: "span",
		});
	});

	test("keeps usage on a finished row through the live-session fallback read", async () => {
		makeSession("sess-metrics");
		// The observer prunes terminal rows, so an `idle` ref has no progress
		// frame left; the row's usage then comes from the session's own stats —
		// the TUI's fallback read, same aggregation code.
		registerRef({
			id: "Done",
			status: "idle",
			session: {
				isStreaming: false,
				getSessionStats: () => ({
					tokens: { input: 100, output: 40, cacheWrite: 10 },
					assistantMessages: 2,
					toolCalls: 3,
					cost: 0.5,
					contextUsage: { tokens: 150, contextWindow: 4096 },
				}),
			},
		});

		const response = await handleSubagentRoster(
			new Request("http://localhost/api/agent/sess-metrics/subagents"),
			"sess-metrics",
		);
		const body = (await response.json()) as { subagents: Array<Record<string, unknown>> };
		const metrics = body.subagents[0]!.metrics as Record<string, unknown>;
		expect(metrics).toEqual({
			tokens: 150,
			requests: 2,
			tools: 3,
			cost: 0.5,
			durationMs: 0,
			durationKind: "unknown",
		});
	});

	test("404s an unknown session id", async () => {
		const response = await handleSubagentRoster(new Request("http://localhost/api/agent/nope/subagents"), "nope");
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "Unknown session: nope" });
	});
});

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

describe("GET /api/agent/:id/subagents/events", () => {
	test("opens with a snapshot frame, then pushes progress and terminal frames", async () => {
		const { bus } = makeSession("sess-sse-sub");
		registerRef({ id: "Worker", live: true });
		registerRef({ id: "Helper", live: true });
		emitLifecycle(bus, { id: "Worker", status: "started" });
		emitLifecycle(bus, { id: "Helper", status: "started" });

		const server = Bun.serve({
			port: 0,
			fetch: request => handleSubagentEvents(request, "sess-sse-sub"),
		});
		cleanups.push(async () => {
			server.stop(true);
		});

		const response = await fetch(new URL("/subagents/events", server.url));
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const collector = makeFrameCollector();
		const stop = pumpFrames(response, collector);

		await collector.until(frames => frames.length > 0);
		expect(collector.frames[0]!.type).toBe("subagent_snapshot");
		expect((collector.frames[0]!.subagents as Array<Record<string, unknown>>).map(row => row.id).sort()).toEqual([
			"Helper",
			"Worker",
		]);

		// A live progress frame for one subagent and a terminal lifecycle frame
		// for another, pushed while the client is connected.
		emitProgress(bus, "Worker");
		emitLifecycle(bus, { id: "Helper", status: "completed" });

		await collector.until(frames => frames.some(frame => frame.type === "subagent_progress"));
		await collector.until(frames => frames.some(frame => frame.type === "subagent_removed"));

		const types = collector.frames.map(frame => frame.type);
		expect(types).toContain("subagent_lifecycle");
		expect(types).toContain("subagent_progress");
		expect(types).toContain("subagent_removed");
		const lifecycle = collector.frames.find(frame => frame.type === "subagent_lifecycle")!;
		expect(lifecycle.payload).toMatchObject({ id: "Helper", status: "completed" });
		const progress = collector.frames.find(frame => frame.type === "subagent_progress")!;
		expect(progress.payload).toMatchObject({ parentToolCallId: "tc-1", progress: { id: "Worker" } });
		expect(collector.frames.find(frame => frame.type === "subagent_removed")).toEqual({
			type: "subagent_removed",
			id: "Helper",
		});

		await stop();
	});

	test("pushes registry status flips as authoritative rows", async () => {
		const { bus } = makeSession("sess-sse-status");
		registerRef({ id: "Worker", live: true });
		emitLifecycle(bus, { id: "Worker", status: "started" });

		const server = Bun.serve({
			port: 0,
			fetch: request => handleSubagentEvents(request, "sess-sse-status"),
		});
		cleanups.push(async () => {
			server.stop(true);
		});
		const response = await fetch(new URL("/subagents/events", server.url));
		const collector = makeFrameCollector();
		const stop = pumpFrames(response, collector);
		await collector.until(frames => frames.some(frame => frame.type === "subagent_snapshot"));

		AgentRegistry.global().setStatus("Worker", "idle");
		await collector.until(frames => frames.some(frame => frame.type === "subagent_status"));
		const statusFrame = collector.frames.find(frame => frame.type === "subagent_status")!;
		expect(statusFrame.subagent).toMatchObject({ id: "Worker", status: "idle" });

		await stop();
	});
});

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

describe("GET /api/agent/:id/subagents/:subId/transcript", () => {
	test("pages by byte offset, drops the trailing partial line, and replays", async () => {
		makeSession("sess-tx");
		registerRef({ id: "Worker" });
		const transcript = subagentSessionFile("Worker");
		const line = (id: string): string =>
			`${JSON.stringify({
				id,
				parentId: null,
				timestamp: new Date().toISOString(),
				type: "message",
				message: { role: "user", content: [{ type: "text", text: id }], timestamp: Date.now() },
			})}\n`;
		await writeFile(transcript, line("e1") + line("e2") + line("e3") + '{"id":"partial"');

		const first = await handleSubagentTranscript(
			new Request("http://localhost/api/agent/sess-tx/subagents/Worker/transcript?fromByte=0"),
			"sess-tx",
			"Worker",
		);
		expect(first.status).toBe(200);
		const page1 = (await first.json()) as {
			subagentId: string;
			sessionFile: string;
			fromByte: number;
			nextByte: number;
			reset: boolean;
			entries: Array<{ id: string }>;
			messages: unknown[];
		};
		expect(page1.subagentId).toBe("Worker");
		expect(page1.sessionFile).toBe(transcript);
		expect(page1.fromByte).toBe(0);
		expect(page1.reset).toBe(false);
		expect(page1.entries.map(entry => entry.id)).toEqual(["e1", "e2", "e3"]);
		expect(page1.messages).toHaveLength(3);
		// The trailing half-line is withheld, so the cursor stops at the last
		// complete line and the partial record can never be parsed as a page.
		expect(page1.nextByte).toBeLessThan(Buffer.byteLength(line("e1") + line("e2") + line("e3") + '{"id":"partial"'));

		// Tailing from the cursor is empty until new complete lines land…
		const idle = await handleSubagentTranscript(
			new Request(`http://localhost/api/agent/sess-tx/subagents/Worker/transcript?fromByte=${page1.nextByte}`),
			"sess-tx",
			"Worker",
		);
		const page2 = (await idle.json()) as { entries: unknown[]; nextByte: number; reset: boolean };
		expect(page2.entries).toHaveLength(0);
		expect(page2.nextByte).toBe(page1.nextByte);
		expect(page2.reset).toBe(false);

		// …then replays exactly the delta, advancing the cursor.
		await writeFile(transcript, line("e1") + line("e2") + line("e3") + line("e4"), { flag: "w" });
		const tail = await handleSubagentTranscript(
			new Request(`http://localhost/api/agent/sess-tx/subagents/Worker/transcript?fromByte=${page1.nextByte}`),
			"sess-tx",
			"Worker",
		);
		const page3 = (await tail.json()) as { entries: Array<{ id: string }>; nextByte: number; fromByte: number };
		expect(page3.fromByte).toBe(page1.nextByte);
		expect(page3.entries.map(entry => entry.id)).toEqual(["e4"]);
		expect(page3.nextByte).toBeGreaterThan(page1.nextByte);

		// A cursor past EOF restarts the page.
		const overshoot = await handleSubagentTranscript(
			new Request(`http://localhost/api/agent/sess-tx/subagents/Worker/transcript?fromByte=999999`),
			"sess-tx",
			"Worker",
		);
		const page4 = (await overshoot.json()) as { reset: boolean; fromByte: number; entries: unknown[] };
		expect(page4.reset).toBe(true);
		expect(page4.fromByte).toBe(0);
		expect(page4.entries).toHaveLength(4);
	});

	test("resolves a persisted transcript on disk and 404s an unknown id", async () => {
		makeSession("sess-tx2");
		await writeFile(
			subagentSessionFile("Persisted"),
			'{"id":"p1","parentId":null,"type":"message","message":{"role":"user","content":[{"type":"text","text":"hi"}],"timestamp":1}}\n',
		);
		const found = await handleSubagentTranscript(
			new Request("http://localhost/api/agent/sess-tx2/subagents/Persisted/transcript"),
			"sess-tx2",
			"Persisted",
		);
		expect(found.status).toBe(200);
		const missing = await handleSubagentTranscript(
			new Request("http://localhost/api/agent/sess-tx2/subagents/Ghost/transcript"),
			"sess-tx2",
			"Ghost",
		);
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual({ error: "Unknown subagent: Ghost" });
	});
});

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

describe("GET /api/agent/:id/subagents/:subId/output", () => {
	test("returns the published result, its sidecar, and a progress view when unpublished", async () => {
		const { bus } = makeSession("sess-out");
		registerRef({ id: "Worker" });
		emitLifecycle(bus, { id: "Worker", status: "started" });
		emitProgress(bus, "Worker");
		await writeFile(join(artifactRoot, "Worker.md"), "# Result\n\nAll done.\n");
		await writeFile(join(artifactRoot, "Worker.json"), JSON.stringify({ status: "ok", files: 2 }));

		const published = await handleSubagentOutput(
			new Request("http://localhost/api/agent/sess-out/subagents/Worker/output"),
			"sess-out",
			"Worker",
		);
		expect(published.status).toBe(200);
		const body = (await published.json()) as Record<string, unknown>;
		expect(body.published).toBe(true);
		expect(body.outputPath).toBe(join(artifactRoot, "Worker.md"));
		expect(body.content).toBe("# Result\n\nAll done.\n");
		expect(body.size).toBe(Buffer.byteLength("# Result\n\nAll done.\n", "utf-8"));
		expect(body.status).toBe("running");
		expect(body.sidecar).toBeUndefined();

		const withSidecar = await handleSubagentOutput(
			new Request("http://localhost/api/agent/sess-out/subagents/Worker/output?json=1"),
			"sess-out",
			"Worker",
		);
		expect(((await withSidecar.json()) as Record<string, unknown>).sidecar).toEqual({ status: "ok", files: 2 });

		// Unpublished: an explicit `published: false` plus the live progress view.
		registerRef({ id: "Pending", live: true });
		emitLifecycle(bus, { id: "Pending", status: "started" });
		emitProgress(bus, "Pending");
		const pending = await handleSubagentOutput(
			new Request("http://localhost/api/agent/sess-out/subagents/Pending/output"),
			"sess-out",
			"Pending",
		);
		expect(pending.status).toBe(200);
		const pendingBody = (await pending.json()) as Record<string, unknown>;
		expect(pendingBody.published).toBe(false);
		expect(pendingBody.message).toBe("No published output for Pending (status: running)");
		expect(pendingBody.progress).toMatchObject({ currentTool: "read" });
		expect(pendingBody.metrics).toMatchObject({ tokens: 1200 });

		// A `?json=1` request for a subagent without a sidecar is an error.
		const noSidecar = await handleSubagentOutput(
			new Request("http://localhost/api/agent/sess-out/subagents/Pending/output?json=1"),
			"sess-out",
			"Pending",
		);
		expect(noSidecar.status).toBe(404);

		const unknown = await handleSubagentOutput(
			new Request("http://localhost/api/agent/sess-out/subagents/Ghost/output"),
			"sess-out",
			"Ghost",
		);
		expect(unknown.status).toBe(404);
		expect(await unknown.json()).toEqual({ error: "Unknown subagent: Ghost" });
	});

	test("reads a parked subagent's published output after the live session is gone", async () => {
		makeSession("sess-out2");
		registerRef({ id: "Done", status: "parked" });
		await writeFile(join(artifactRoot, "Done.md"), "finished\n");
		const response = await handleSubagentOutput(
			new Request("http://localhost/api/agent/sess-out2/subagents/Done/output"),
			"sess-out2",
			"Done",
		);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body).toMatchObject({ published: true, status: "parked", content: "finished\n" });
	});
});

// ---------------------------------------------------------------------------
// Sink unit surface
// ---------------------------------------------------------------------------

describe("SubagentSink", () => {
	test("coalesces progress to the latest frame per subagent", async () => {
		const { bus, sink } = makeSession("sess-sink");
		registerRef({ id: "Worker", live: true });
		emitLifecycle(bus, { id: "Worker", status: "started" });
		const frames: Array<{ type: string; payload?: { progress?: { toolCount?: number } } }> = [];
		const collector = makeFrameCollector();
		sink.subscribe(frame => {
			frames.push(frame as never);
			collector.push({ type: (frame as { type: string }).type });
		});
		emitProgress(bus, "Worker", { toolCount: 1 });
		emitProgress(bus, "Worker", { toolCount: 2 });
		emitProgress(bus, "Worker", { toolCount: 3 });
		expect(frames).toHaveLength(0);
		await collector.until(() => frames.length > 0);
		expect(frames).toHaveLength(1);
		expect(frames[0]!.payload!.progress!.toolCount).toBe(3);
	});

	test("tracks only refs inside its own root artifacts tree", () => {
		const { sink } = makeSession("sess-scope");
		registerRef({ id: "Mine", live: true });
		registerRef({ id: "Theirs", sessionFile: join(rootDir, "other", "Theirs.jsonl"), live: true });
		expect(sink.buildRow(AgentRegistry.global().get("Mine")!)?.id).toBe("Mine");
		expect(sink.buildRow(AgentRegistry.global().get("Theirs")!)).toBeUndefined();

		// The registry event path uses the same filter: another root's status
		// flip must not surface as a `subagent_status` frame here.
		const frames: string[] = [];
		sink.subscribe(frame => frames.push(frame.type));
		AgentRegistry.global().setStatus("Theirs", "idle");
		AgentRegistry.global().setStatus("Mine", "idle");
		expect(frames).toEqual(["subagent_status"]);
	});
});

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import { AssistantMessageEventStream } from "@linxiraos/pi-ai/utils/event-stream";
import { unregisterCustomApis } from "@linxiraos/pi-ai/api-registry";
import { TempDir, refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { ModelRegistry, type ProviderConfigInput } from "../src/config/model-registry";
import { getMainSessionId, registerMainSessionId } from "../src/channels";
import { getJudgmentBatch, runEvalJudgmentBatch } from "../src/eval/judgment-batch-bridge";
import { resetSettingsForTest, Settings } from "../src/config/settings";
import { WebConfig } from "../src/config/web-config";
import { DeviceRegistry, setDeviceRegistryForTest } from "../src/server/auth/device-registry";
import type { DeviceBinding } from "../src/server/auth/binding";
import { SessionStore, setSessionStoreForTest } from "../src/server/auth/session-store";
import type {
	ClientEvent,
	CommandInput,
	CommandName,
	CommandResult,
	QueryInput,
	QueryName,
	QueryResult,
} from "../src/server/studio-host/contract";
import { evaluationsOps } from "../src/server/studio-host/ops/evaluations";
import { workspaceIdFor } from "../src/server/studio-host/ops/workspace-id";
import { StudioOperations } from "../src/server/studio-host/registry";
import { runWithStudioSelection } from "../src/server/studio-host/selection";
import { StudioHost, type StudioWsData } from "../src/server/studio-host/server";
import { evaluationRuntime, shutdownStudioEvaluations } from "../src/server/studio-host/services/evaluation-runtime";
import type { EvaluationCoordinator } from "../src/server/studio-host/services/evaluation-coordinator";
import { StudioEvaluationWorkspaceService } from "../src/server/studio-host/services/evaluation-workspace-service";
import type {
	EvaluationRecord,
	EvaluationSpec,
	RatchetEvaluationSpec,
} from "../src/server/studio-host/protocol/contracts/evaluation-workspace";
import { AgentSessionWrapper, sessions } from "../src/server/web-gateway/agents";
import { resetRemoteAccessForTests } from "../src/server/web-gateway/remote-access";
import { AgentSession } from "../src/session/agent-session";
import { AgentStorage } from "../src/session/agent-storage";
import type { AuthStorage } from "../src/session/auth-storage";
import { HistoryStorage } from "../src/session/history-storage";
import { convertToLlm } from "../src/session/messages";
import { closeSessionIndex } from "../src/session/session-index";
import { SessionManager } from "../src/session/session-manager";
import type { ToolSession } from "../src/tools";
import { createAssistantMessage, createInMemoryAuthStorage } from "./helpers/agent-session-setup";

const origin = "http://127.0.0.1";
let directory: TempDir;
let previousAgentDir: string | undefined;
let previousWorkspace: string | undefined;
let previousMainSessionId: string | null;
let host: StudioHost;
let operations: StudioOperations;
let store: SessionStore;
let devices: DeviceRegistry;
let workspaceId: string;
const runtimes: AgentSession[] = [];
const authStores: AuthStorage[] = [];
const issuedDevices: string[] = [];
let providerSequence = 0;

beforeEach(async () => {
	directory = TempDir.createSync("zeta-evaluation-binding-");
	previousAgentDir = process.env.ZETA_CODING_AGENT_DIR;
	previousWorkspace = process.env.ZETA_DEFAULT_WORKSPACE;
	previousMainSessionId = getMainSessionId();
	process.env.ZETA_CODING_AGENT_DIR = directory.join("agent");
	process.env.ZETA_DEFAULT_WORKSPACE = directory.join("workspace");
	await mkdir(directory.join("workspace"), { recursive: true });
	workspaceId = workspaceIdFor(directory.join("workspace"));
	refreshDirsFromEnv();
	resetSettingsForTest();
	WebConfig.resetShared();
	resetRemoteAccessForTests();
	store = new SessionStore(directory.join("sessions.json"));
	devices = new DeviceRegistry(directory.join("devices.json"));
	setSessionStoreForTest(store);
	setDeviceRegistryForTest(devices);
	operations = new StudioOperations([evaluationsOps]);
	host = new StudioHost(operations);
});

afterEach(async () => {
	host.dropDeviceSessions("local");
	for (const id of issuedDevices.splice(0)) host.dropDeviceSessions(id);
	await shutdownStudioEvaluations();
	for (const session of runtimes) session.modelRegistry.unregisterProvider(session.agent.state.model!.provider);
	for (const session of runtimes.splice(0)) {
		sessions.delete(session.sessionId);
		await session.dispose();
	}
	for (const auth of authStores.splice(0)) auth.close();
	unregisterCustomApis("test://studio-evaluation-binding");
	registerMainSessionId(previousMainSessionId);
	if (previousAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = previousAgentDir;
	if (previousWorkspace === undefined) delete process.env.ZETA_DEFAULT_WORKSPACE;
	else process.env.ZETA_DEFAULT_WORKSPACE = previousWorkspace;
	setSessionStoreForTest(undefined);
	setDeviceRegistryForTest(undefined);
	refreshDirsFromEnv();
	resetSettingsForTest();
	WebConfig.resetShared();
	resetRemoteAccessForTests();
	AgentStorage.close();
	HistoryStorage.close();
	closeSessionIndex();
	await directory.remove();
});

interface Caller {
	cookie: string;
	csrf: string;
	remote?: string;
}
interface View {
	owner: Caller;
	id: string;
	key: string;
	events: ClientEvent[];
	peer: { send(value: string): void; close(): void };
}
function request(route: string, owner?: Caller, body?: unknown, contextId?: string): Request {
	return new Request(origin + route, {
		method: body === undefined ? "GET" : "POST",
		headers: {
			origin,
			...(owner ? { cookie: owner.cookie, "x-studio-csrf": owner.csrf } : {}),
			...(body === undefined ? {} : { "content-type": "application/json" }),
			...(contextId ? { "x-studio-context": contextId } : {}),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}
function handle(route: string, owner?: Caller, body?: unknown, contextId?: string) {
	return host.handle(request(route, owner, body, contextId), owner?.remote ?? "127.0.0.1");
}
async function caller(): Promise<Caller> {
	const response = await handle("/api/v1/bootstrap");
	expect(response.status).toBe(200);
	return { cookie: response.headers.get("set-cookie")!.split(";")[0]!, csrf: response.headers.get("x-studio-csrf")! };
}
async function boundCaller(binding: DeviceBinding, readOnly = false): Promise<Caller> {
	const issued = await devices.issue({
		label: "Evaluation fixture",
		binding,
		scopes: readOnly ? ["read"] : ["read", "write"],
	});
	issuedDevices.push(issued.device.id);
	const live = await store.create({ deviceId: issued.device.id, binding });
	return { cookie: `studio_session=${live.id}`, csrf: live.csrf };
}
async function open(owner: Caller, session?: AgentSession): Promise<string> {
	const response = await handle("/api/v1/context/open", owner, {
		workspaceId,
		...(session ? { sessionId: session.sessionId } : {}),
	});
	expect(response.status).toBe(200);
	return ((await response.json()) as { contextId: string }).contextId;
}
async function connect(owner: Caller, id: string): Promise<View> {
	let data: StudioWsData | undefined;
	const upgraded = await host.upgrade(
		request(`/api/v1/events${id ? `?contextId=${id}` : ""}`, owner),
		{
			upgrade: (_request, options) => {
				data = options.data;
				return true;
			},
		},
		owner.remote ?? "127.0.0.1",
	);
	expect(upgraded).toBeNull();
	const events: ClientEvent[] = [];
	const peer = {
		send: (value: string) => {
			events.push(JSON.parse(value));
		},
		close() {},
	};
	host.attachSocket(data!.sessionId, peer);
	return { owner, id, key: data!.sessionId, events, peer };
}
async function query<K extends QueryName>(view: View, name: K, input: QueryInput<K>): Promise<QueryResult<K>> {
	const response = await handle("/api/v1/query", view.owner, { queryName: name, input }, view.id);
	expect(response.status).toBe(200);
	const envelope = (await response.json()) as { ok: boolean; result: QueryResult<K>; error?: { message: string } };
	if (!envelope.ok) throw new Error(envelope.error?.message ?? "Query failed");
	return envelope.result;
}
async function dispatch<K extends CommandName>(view: View, name: K, input: CommandInput<K>, owner = view.owner) {
	const requestId = crypto.randomUUID();
	const response = await handle(
		"/api/v1/command",
		owner,
		{ commandName: name, input, requestId, idempotencyKey: requestId },
		view.id,
	);
	const event = view.events.findLast(
		event => event.kind === "command.receipt" && event.receipt.requestId === requestId,
	);
	return { response, receipt: event?.kind === "command.receipt" ? event.receipt : undefined };
}
async function command<K extends CommandName>(view: View, name: K, input: CommandInput<K>): Promise<CommandResult<K>> {
	const { response, receipt } = await dispatch(view, name, input);
	expect(response.status).toBe(202);
	if (receipt?.status !== "completed")
		throw new Error(receipt && "error" in receipt ? receipt.error?.message : "Command did not complete");
	return receipt.result as CommandResult<K>;
}
async function coordinatorFor(session: AgentSession): Promise<EvaluationCoordinator> {
	const selection = { workspaceId, sessionId: session.sessionId, closed: false };
	return (
		await runWithStudioSelection(selection, () =>
			evaluationRuntime(workspaceId, {
				capabilities: operations.capabilities().manifest,
				selection,
				privateOwner: {
					id: `fixture-observer:${session.sessionId}`,
					expiresAt: Number.MAX_SAFE_INTEGER,
					isLive: () => true,
				},
			}),
		)
	).coordinator;
}
async function until<T>(
	coordinator: EvaluationCoordinator,
	read: () => Promise<T>,
	ready: (value: T) => boolean,
): Promise<T> {
	for (;;) {
		const changed = Promise.withResolvers<void>();
		const release = coordinator.subscribe(changed.resolve);
		try {
			const value = await read();
			if (ready(value)) return value;
			await changed.promise;
		} finally {
			release();
		}
	}
}

/** Registered deterministic provider exercises native runners without paid-service claims. */
function runtime() {
	const provider = `evaluation-fixture-${++providerSequence}`;
	const api = `custom-${provider}`;
	const auth = createInMemoryAuthStorage();
	authStores.push(auth);
	auth.keys.setRuntime(provider, "evaluation-fixture-credential");
	const registry = new ModelRegistry(auth, directory.join(`${provider}.yml`), {
		fetch: async () => {
			throw new Error("Network disabled in evaluation binding fixture");
		},
	});
	const requests: Array<{ stream: AssistantMessageEventStream; signal?: AbortSignal }> = [];
	const waiters = new Set<() => void>();
	const streamSimple: NonNullable<ProviderConfigInput["streamSimple"]> = (_model, _context, options) => {
		const stream = new AssistantMessageEventStream();
		const signal = options?.signal;
		signal?.addEventListener("abort", () => stream.fail(new Error("Evaluation fixture request cancelled")), {
			once: true,
		});
		requests.push({ stream, signal });
		for (const changed of waiters) changed();
		return stream;
	};
	registry.registerProvider(
		provider,
		{
			api,
			baseUrl: "https://evaluation-fixture.invalid/v1",
			apiKey: "evaluation-fixture-credential",
			streamSimple,
			models: [
				{
					id: "model",
					name: "Evaluation fixture model",
					input: ["text"],
					reasoning: false,
					contextWindow: 128000,
					maxTokens: 4096,
					cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
				},
			],
		},
		"test://studio-evaluation-binding",
	);
	const settings = Settings.isolated({ "compaction.enabled": false, "retry.enabled": false });
	const manager = SessionManager.inMemory(directory.join("workspace"));
	const tools: ToolSession = {
		cwd: manager.getCwd(),
		hasUI: false,
		settings,
		modelRegistry: registry,
		sessionManager: manager,
		getSessionFile: () => manager.getSessionFile() ?? null,
		getSessionSpawns: () => null,
		getAgentId: () => session.sessionId,
		getSessionId: () => session.sessionId,
	};
	const session = new AgentSession({
		agent: new Agent({
			initialState: { model: registry.find(provider, "model")!, systemPrompt: ["Test"], tools: [] },
			getApiKey: () => "evaluation-fixture-credential",
			convertToLlm,
		}),
		sessionManager: manager,
		settings,
		modelRegistry: registry,
		evalToolSession: tools,
	});
	runtimes.push(session);
	sessions.set(session.sessionId, new AgentSessionWrapper(session, session.sessionId, null));
	return {
		session,
		registry,
		requests,
		async requested(count: number) {
			while (requests.length < count) {
				const changed = Promise.withResolvers<void>();
				waiters.add(changed.resolve);
				try {
					await changed.promise;
				} finally {
					waiters.delete(changed.resolve);
				}
			}
		},
		spec: {
			kind: "benchmark",
			profile: "chat",
			models: [`${provider}/model`],
			runs: 2,
			concurrency: 1,
		} satisfies EvaluationSpec,
		finish(index: number) {
			requests[index]!.stream.push({
				type: "done",
				reason: "stop",
				message: {
					...createAssistantMessage("Evaluation fixture response"),
					api,
					provider,
					model: "model",
					ttft: 1,
					duration: 4,
				},
			});
		},
	};
}

test("native evaluation commands, rows and exports stay with their authenticated conversation across reconnect", async () => {
	const native = runtime(),
		foreignNative = runtime();
	const owner = await caller();
	let view = await connect(owner, await open(owner, native.session));
	// Cold activity/history must resolve the selected workspace without a preceding context query.
	expect(await query(view, "evaluations.list", { limit: 200 })).toEqual({ records: [], total: 0 });
	const context = await query(view, "evaluations.context", { workspaceId });
	expect(context.available).toBe(true);
	expect(context.models.some(model => model.selector === native.spec.models[0])).toBe(true);
	const plan = await command(view, "evaluations.prepare", { workspaceId, spec: native.spec });
	expect(plan.requests).toBe(2);
	const record = await command(view, "evaluations.start", { workspaceId, title: "Owned native run", spec: plan.spec });
	const coordinator = await coordinatorFor(native.session);
	await native.requested(1);
	host.detachSocket(view.key, view.peer);
	expect(native.requests[0]!.signal?.aborted).toBe(false);
	view = await connect(owner, view.id);
	expect((await query(view, "evaluations.read", { id: record.id })).id).toBe(record.id);
	native.finish(0);
	await native.requested(2);
	await command(view, "evaluations.control", { id: record.id, action: "cancel" });
	expect(native.requests[1]!.signal?.aborted).toBe(true);
	await until(
		coordinator,
		() => query(view, "evaluations.read", { id: record.id }),
		value => value.state === "cancelled",
	);
	const rows = await query(view, "evaluations.rows", { id: record.id });
	expect(rows.total).toBe(2);
	const exported = await command(view, "evaluations.export", { id: record.id, format: "csv" });
	const chunk = await query(view, "evaluations.exportChunk", { artifactId: exported.artifactId });
	expect(Buffer.from(chunk.data, "base64").toString("utf8")).toContain(native.spec.models[0]);
	const restored = await connect(owner, await open(owner, native.session));
	expect((await query(restored, "evaluations.list", {})).records.map(row => row.id)).toEqual([record.id]);
	expect((await query(restored, "evaluations.rows", { id: record.id })).total).toBe(2);
	const foreign = await connect(owner, await open(owner, foreignNative.session));
	expect((await query(foreign, "evaluations.list", {})).records).toEqual([]);
	for (const [queryName, input] of [
		["evaluations.read", { id: record.id }],
		["evaluations.exportChunk", { artifactId: exported.artifactId }],
	] as const) {
		const denied = await handle("/api/v1/query", owner, { queryName, input }, foreign.id);
		expect(await denied.json()).toMatchObject({ ok: false });
	}
	expect(native.requests).toHaveLength(2);
	expect(foreign.events.filter(event => event.kind === "command.receipt")).toEqual([]);
	const publicData = JSON.stringify([context, record, chunk, view.events]);
	expect(publicData).not.toContain(directory.path());
	expect(publicData).not.toContain("evaluation-fixture-credential");
	expect(publicData).not.toContain("https://evaluation-fixture.invalid");
});

test("cold root activity derives the real selected workspace from existing gateway authority", async () => {
	const native = runtime();
	registerMainSessionId(native.session.sessionId);
	const owner = await caller();
	const view = await connect(owner, "");
	expect(await query(view, "evaluations.list", {})).toEqual({ records: [], total: 0 });
	expect(native.requests).toHaveLength(0);
});

test("session-bound evaluation requests use context identity while CSRF, cookies and workspace binding remain authoritative", async () => {
	const native = runtime(),
		other = runtime();
	const owner = await boundCaller({ workspaceId, sessionId: native.session.sessionId });
	const view = await connect(owner, await open(owner, native.session));
	expect((await query(view, "evaluations.context", { workspaceId })).available).toBe(true);
	expect((await query(view, "evaluations.list", {})).records).toEqual([]);
	const badCsrf = await dispatch(
		view,
		"evaluations.prepare",
		{ workspaceId, spec: native.spec },
		{ ...owner, csrf: "" },
	);
	expect(badCsrf.response.status).toBe(401);
	const foreign = await caller();
	expect((await handle("/api/v1/query", foreign, { queryName: "evaluations.list", input: {} }, view.id)).status).toBe(
		404,
	);
	expect(
		(
			await handle(
				"/api/v1/query",
				owner,
				{ queryName: "evaluations.context", input: { workspaceId: "another-workspace" } },
				view.id,
			)
		).status,
	).toBe(403);
	expect(
		(await handle("/api/v1/context/open", owner, { workspaceId, sessionId: other.session.sessionId })).status,
	).toBe(403);
	await handle("/api/v1/context/close", owner, {}, view.id);
	expect((await handle("/api/v1/query", owner, { queryName: "evaluations.list", input: {} }, view.id)).status).toBe(
		404,
	);
	expect(native.requests).toHaveLength(0);
});

test("a real read-only device can inspect its evaluation context but cannot prepare paid work", async () => {
	const native = runtime();
	await mkdir(directory.join("agent"), { recursive: true });
	await writeFile(directory.join("agent", "web.yml"), "remote:\n  token: evaluation-fixture-machine-token\n");
	WebConfig.resetShared();
	const owner = {
		...(await boundCaller({ workspaceId, sessionId: native.session.sessionId }, true)),
		remote: "203.0.113.8",
	};
	const view = await connect(owner, await open(owner, native.session));
	expect((await query(view, "evaluations.context", { workspaceId })).available).toBe(true);
	expect((await dispatch(view, "evaluations.prepare", { workspaceId, spec: native.spec })).response.status).toBe(403);
	expect(native.requests).toHaveLength(0);
});

test.each(["evaluations.prepare", "evaluations.start"] as const)(
	"disconnect and reconnect during asynchronous %s cannot revive an old command owner",
	async operationName => {
		const native = runtime();
		const owner = await caller();
		const view = await connect(owner, await open(owner, native.session));
		const entered = Promise.withResolvers<void>(),
			resume = Promise.withResolvers<void>();
		const original = StudioEvaluationWorkspaceService.prototype.execute;
		const delayed = spyOn(StudioEvaluationWorkspaceService.prototype, "execute").mockImplementation(
			async function (this: StudioEvaluationWorkspaceService, operation, authorize) {
				if (operation.kind === "evaluation.runtime.plan") {
					entered.resolve();
					await resume.promise;
				}
				return original.call(this, operation, authorize);
			},
		);
		try {
			const pending = dispatch(view, operationName, {
				workspaceId,
				title: "Revoked before execution",
				spec: native.spec,
			});
			await entered.promise;
			host.detachSocket(view.key, view.peer);
			const next = await connect(owner, view.id);
			resume.resolve();
			const outcome = await pending;
			expect(outcome.response.status).toBe(202);
			expect(outcome.receipt?.status).not.toBe("completed");
			expect(native.requests).toHaveLength(0);
			expect((await query(next, "evaluations.list", {})).records).toEqual([]);
		} finally {
			resume.resolve();
			delayed.mockRestore();
		}
	},
);

test("native judgment history retains failed inputs and rejects a batch owned by another conversation", async () => {
	const native = runtime(),
		foreign = runtime();
	const tools = { ...native.session.getEvalToolSession()!, modelRegistry: undefined };
	const created = await runEvalJudgmentBatch(
		{
			op: "create",
			items: [
				{ key: "a", state: "first" },
				{ key: "b", state: { second: true } },
			],
			questions: { correct: { type: "bool", instructions: "Is the result correct?" } },
			concurrency: 1,
			retries: 0,
		},
		{ session: tools },
	);
	if (!("id" in created)) throw new Error("Expected native judgment status");
	const batch = getJudgmentBatch(created.id, tools)!;
	const owner = await caller();
	const view = await connect(owner, await open(owner, native.session));
	const foreignView = await connect(owner, await open(owner, foreign.session));
	const spec: EvaluationSpec = {
		kind: "judgment",
		items: [],
		questions: {},
		attachId: created.id,
		attachSessionId: native.session.sessionId,
	};
	const denied = await dispatch(foreignView, "evaluations.start", {
		workspaceId,
		title: "Foreign native batch",
		spec,
	});
	expect(denied.response.status === 400 || denied.receipt?.status === "failed").toBe(true);
	const record = await command(view, "evaluations.start", { workspaceId, title: "Retained native judgment", spec });
	const coordinator = await coordinatorFor(native.session);
	await until(
		coordinator,
		() => query(view, "evaluations.read", { id: record.id }),
		value => value.state === "failed",
	);
	expect((await query(view, "evaluations.rows", { id: record.id })).total).toBe(2);
	const retry = await query(view, "evaluations.retrySpec", { id: record.id });
	expect(retry).toMatchObject({
		kind: "judgment",
		items: [
			{ key: "a", state: "first" },
			{ key: "b", state: { second: true } },
		],
		questions: { correct: { type: "bool", instructions: "Is the result correct?" } },
	});
	expect(batch.readItems(0, 50)).toHaveLength(2);
	expect(await batch.drain(0, undefined)).toHaveLength(2);
	expect(native.requests).toHaveLength(0);
	await runEvalJudgmentBatch({ op: "close", id: created.id }, { session: tools });
});

test("evaluation access refuses empty, expired and replaced session owners", async () => {
	const native = runtime();
	const owner = await caller(),
		empty = await connect(owner, await open(owner));
	const noSession = await handle("/api/v1/query", owner, { queryName: "evaluations.list", input: {} }, empty.id);
	expect(await noSession.json()).toMatchObject({
		ok: false,
		error: { message: "no session in this conversation context" },
	});
	const selection = { workspaceId, sessionId: native.session.sessionId, closed: false };
	let live = true;
	const context = {
		capabilities: operations.capabilities().manifest,
		selection,
		privateOwner: { id: "evaluation-direct-owner", expiresAt: Date.now() + 60_000, isLive: () => live },
	};
	const access = await runWithStudioSelection(selection, () => evaluationRuntime(undefined, context));
	live = false;
	expect(() => access.assert()).toThrow("view changed");
	live = true;
	const replacement = runtime();
	sessions.set(native.session.sessionId, new AgentSessionWrapper(replacement.session, native.session.sessionId, null));
	try {
		expect(() => access.assert()).toThrow("session or view changed");
	} finally {
		sessions.set(native.session.sessionId, new AgentSessionWrapper(native.session, native.session.sessionId, null));
	}
	const expired = { ...context, privateOwner: { ...context.privateOwner, expiresAt: Date.now() - 1 } };
	await expect(runWithStudioSelection(selection, () => evaluationRuntime(workspaceId, expired))).rejects.toThrow(
		"live authenticated view",
	);
});

test("evaluation reads reject requests without a live authenticated event owner", async () => {
	const native = runtime(),
		owner = await caller();
	const id = await open(owner, native.session);
	const response = await handle(
		"/api/v1/query",
		owner,
		{ queryName: "evaluations.context", input: { workspaceId } },
		id,
	);
	expect(await response.json()).toMatchObject({
		ok: false,
		error: { message: "evaluations require a live authenticated view" },
	});
	expect(native.requests).toHaveLength(0);
});

test.each(["dispose", "shutdown"] as const)(
	"native evaluation cancellation retains its record on %s",
	async transition => {
		const native = runtime();
		const owner = await caller(),
			view = await connect(owner, await open(owner, native.session));
		const record = await command(view, "evaluations.start", {
			workspaceId,
			title: "Native lifecycle",
			spec: native.spec,
		});
		await native.requested(1);
		if (transition === "dispose") await native.session.dispose();
		await shutdownStudioEvaluations();
		expect(native.requests[0]!.signal?.aborted).toBe(true);
		const saved = JSON.parse(
			await readFile(
				directory.join(
					"agent",
					"studio",
					"evaluations",
					"v1",
					createHash("sha256").update(native.session.sessionId).digest("hex"),
					`${record.id}.record.json`,
				),
				"utf8",
			),
		) as EvaluationRecord;
		expect(["cancelled", "interrupted"]).toContain(saved.state);
		expect(saved.id).toBe(record.id);
	},
);

test("native Ratchet review survives reconnect and only its current view lease may answer", async () => {
	const cwd = directory.join("workspace");
	await mkdir(path.join(cwd, "eval"), { recursive: true });
	await mkdir(path.join(cwd, "src"), { recursive: true });
	await writeFile(
		path.join(cwd, "eval/cases.jsonl"),
		["a", "b", "c", "d"].map(id => JSON.stringify({ id })).join("\n"),
	);
	await writeFile(path.join(cwd, "eval/run.ts"), "// Native approval fixture; execution is never requested.\n");
	await writeFile(path.join(cwd, "src/prompt.txt"), "Route the request.\n");
	execFileSync("git", ["init", "-q", cwd], { windowsHide: true });
	execFileSync("git", ["-C", cwd, "add", "."], { windowsHide: true });
	execFileSync(
		"git",
		[
			"-C",
			cwd,
			"-c",
			"user.name=Evaluation Fixture",
			"-c",
			"user.email=evaluation@example.invalid",
			"commit",
			"-qm",
			"Native evaluation fixture",
		],
		{ windowsHide: true },
	);
	const native = runtime();
	const owner = await caller();
	const first = await connect(owner, await open(owner, native.session));
	const second = await connect(owner, await open(owner, native.session));
	const spec: RatchetEvaluationSpec = {
		kind: "ratchet",
		flow: "review",
		objective: "Review real native materials",
		cases: ["eval/cases.jsonl"],
		harness: ["eval/run.ts"],
		change: ["src/prompt.txt"],
		offLimits: [],
		command: "bun eval/run.ts",
		cohorts: { a: "all", b: "all", c: "all", d: "all" },
		metric: "quality",
		direction: "higher",
		seed: 7,
	};
	const record = await command(first, "evaluations.start", { workspaceId, title: "Native review", spec });
	const coordinator = await coordinatorFor(native.session);
	const ready = await until(
		coordinator,
		() => query(first, "evaluations.read", { id: record.id }),
		value => value.state === "ready" || value.state === "failed",
	);
	expect(ready.error).toBeUndefined();
	expect(ready.state).toBe("ready");
	await command(first, "evaluations.control", { id: record.id, action: "approve", stage: "inputs" });
	const original = await until(
		coordinator,
		() => query(first, "evaluations.read", { id: record.id }),
		value => !!value.clientInteraction,
	);
	await query(second, "evaluations.rows", { id: record.id });
	const unchanged = await query(first, "evaluations.read", { id: record.id });
	expect(unchanged.clientInteraction?.leaseGeneration).toBe(original.clientInteraction!.leaseGeneration);
	const claimed = await query(second, "evaluations.read", { id: record.id });
	const interaction = claimed.clientInteraction!;
	expect(interaction.leaseGeneration).toBeGreaterThan(original.clientInteraction!.leaseGeneration);
	const answer = {
		id: record.id,
		interactionId: interaction.interactionId,
		leaseGeneration: interaction.leaseGeneration,
		decision: "submit" as const,
		value: { results: [{ id: "inputs", selectedOptions: ["0"] }] },
	};
	const crossed = await dispatch(first, "evaluations.respond", answer);
	expect(crossed.receipt?.status).toBe("failed");
	// Failed foreign-view response and observer reads must not reclaim or advance the lease.
	await query(first, "evaluations.rows", { id: record.id });
	expect((await query(second, "evaluations.read", { id: record.id })).clientInteraction?.leaseGeneration).toBe(
		interaction.leaseGeneration,
	);
	host.detachSocket(second.key, second.peer);
	const reconnected = await connect(owner, second.id);
	const stale = await dispatch(reconnected, "evaluations.respond", answer);
	expect(stale.receipt?.status).not.toBe("completed");
	const renewed = (await query(reconnected, "evaluations.read", { id: record.id })).clientInteraction!;
	expect(renewed.interactionId).toBe(interaction.interactionId);
	expect(renewed.leaseGeneration).toBeGreaterThan(interaction.leaseGeneration);
	await command(reconnected, "evaluations.respond", { ...answer, leaseGeneration: renewed.leaseGeneration });
	const approved = await until(
		coordinator,
		() => query(reconnected, "evaluations.read", { id: record.id }),
		value => (value.detail.approvals as Record<string, string> | undefined)?.inputs === "current",
	);
	expect(approved.clientInteraction).toBeUndefined();
	expect(native.requests).toHaveLength(0);
	expect(await readFile(path.join(cwd, "src/prompt.txt"), "utf8")).toBe("Route the request.\n");
	expect(JSON.stringify([approved, reconnected.events])).not.toContain(directory.path());
}, 30_000);

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import * as path from "node:path";
import { TempDir, refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { resetSettingsForTest, Settings } from "../src/config/settings";
import { WebConfig } from "../src/config/web-config";
import { SessionStore, setSessionStoreForTest } from "../src/server/auth/session-store";
import { StudioHost, type StudioWsData } from "../src/server/studio-host/server";
import { StudioOperations } from "../src/server/studio-host/registry";
import { currentStudioSelection, selectStudioSession } from "../src/server/studio-host/selection";
import { workspaceIdFor } from "../src/server/studio-host/ops/workspace-id";
import { resetRemoteAccessForTests } from "../src/server/web-gateway/remote-access";
import { SessionManager } from "../src/session/session-manager";
import { AgentStorage } from "../src/session/agent-storage";
import { HistoryStorage } from "../src/session/history-storage";
import { closeSessionIndex } from "../src/session/session-index";
import { handleProjectsPut } from "../src/server/web-gateway/projects";
import { cacheSessionPath, invalidateSessionListCache } from "../src/server/web-gateway/sessions";
import { Agent } from "@linxiraos/pi-agent-core";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { ModelRegistry } from "../src/config/model-registry";
import { AgentSession } from "../src/session/agent-session";
import { convertToLlm } from "../src/session/messages";
import { AgentSessionWrapper, sessions } from "../src/server/web-gateway/agents";
import type { ClientEvent } from "../src/server/studio-host/contract";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";
import { getTabsMapForTest, type TabSession } from "../src/tools/browser/tab-supervisor";
import { studioTabIdentity } from "../src/tools/browser/studio-control";
import { studioPrivateResources } from "../src/server/studio-host/private-resources";
import { STUDIO_FAMILIES } from "../src/server/studio-host/ops";
import { HindsightApi } from "../src/hindsight/client";
import { privateMemoryCredential } from "../src/hindsight/private-credentials";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { type } from "@linxiraos/zeta-schema";

const origin = "http://127.0.0.1";
let directory: TempDir;
let previousAgentDir: string | undefined;
let previousWorkspace: string | undefined;
let store: SessionStore;
let host: StudioHost;
let workspaceId: string;
const runtimes: AgentSession[] = [];

beforeEach(async () => {
	directory = TempDir.createSync("zeta-studio-contexts-");
	previousAgentDir = process.env.ZETA_CODING_AGENT_DIR;
	previousWorkspace = process.env.ZETA_DEFAULT_WORKSPACE;
	process.env.ZETA_CODING_AGENT_DIR = directory.join("agent");
	process.env.ZETA_DEFAULT_WORKSPACE = directory.join("workspace");
	await mkdir(directory.join("workspace"), { recursive: true });
	workspaceId = workspaceIdFor(directory.join("workspace"));
	refreshDirsFromEnv();
	resetSettingsForTest();
	WebConfig.resetShared();
	resetRemoteAccessForTests();
	store = new SessionStore(directory.join("sessions.json"));
	setSessionStoreForTest(store);
	host = new StudioHost(new StudioOperations([{
		id: "context-test",
		queries: { "environment.get": async () => ({ workspaceId: currentStudioSelection()?.workspaceId, sessionId: currentStudioSelection()?.sessionId }) },
		commands: { "core.abort": async () => { await Promise.resolve(); selectStudioSession("selected-by-command"); return { workspaceId: currentStudioSelection()?.workspaceId }; } },
	} as never]));
});

afterEach(async () => {
	host.dropDeviceSessions("local");
	for (const session of runtimes.splice(0)) { sessions.delete(session.sessionId); await session.dispose(); }
	if (previousAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = previousAgentDir;
	if (previousWorkspace === undefined) delete process.env.ZETA_DEFAULT_WORKSPACE;
	else process.env.ZETA_DEFAULT_WORKSPACE = previousWorkspace;
	setSessionStoreForTest(undefined);
	refreshDirsFromEnv();
	resetSettingsForTest();
	WebConfig.resetShared();
	resetRemoteAccessForTests();
	AgentStorage.close();
	HistoryStorage.close();
	closeSessionIndex();
	await directory.remove();
});

interface Caller { cookie: string; csrf: string }
function request(path: string, caller?: Caller, body?: unknown, contextId?: string): Request {
	return new Request(origin + path, {
		method: body === undefined ? "GET" : "POST",
		headers: { origin, ...(caller ? { cookie: caller.cookie, "x-studio-csrf": caller.csrf } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...(contextId ? { "x-studio-context": contextId } : {}) },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}
async function caller(): Promise<Caller> {
	const response = await host.handle(request("/api/v1/bootstrap"), "127.0.0.1");
	return { cookie: response.headers.get("set-cookie")!.split(";")[0]!, csrf: response.headers.get("x-studio-csrf")! };
}
async function open(owner: Caller): Promise<string> {
	const response = await host.handle(request("/api/v1/context/open", owner, { workspaceId }), "127.0.0.1");
	expect(response.status).toBe(200);
	return ((await response.json()) as { contextId: string }).contextId;
}
async function socket(owner: Caller, id: string) {
	let data: StudioWsData | undefined;
	const response = await host.upgrade(request(`/api/v1/events?contextId=${id}`, owner), { upgrade: (_req, options) => { data = options.data; return true; } }, "127.0.0.1");
	expect(response).toBeNull();
	const events: unknown[] = [];
	let closed = false;
	host.attachSocket(data!.sessionId, { send: value => events.push(JSON.parse(value)), close: () => { closed = true; } });
	return { events, closed: () => closed, key: data!.sessionId };
}

test("private memory credentials require owner CSRF and leave public responses while native config wins", async () => {
	const owner = await caller();
	const ownerSocket = { send() {} };
	const contextId = await open(owner);
	const contextSocket = { send() {} };
	host.attachSocket(`context:${contextId}`, contextSocket);
	host.attachSocket(owner.cookie.slice("studio_session=".length), ownerSocket);
	let authorization: string | null = null;
	const memory = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) { authorization = req.headers.get("authorization"); return Response.json({ results: [] }); } });
	const url = `http://127.0.0.1:${memory.port}`;
	const client = new HindsightApi({ baseUrl: url });
	try {
		const entries = [{ url, token: "private-test-token" }];
		expect((await host.handle(request("/api/v1/memory/credentials", { ...owner, csrf: "wrong" }, entries), "127.0.0.1")).status).toBe(401);
		const response = await host.handle(request("/api/v1/memory/credentials", owner, entries), "127.0.0.1");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ supported: true });
		await client.recall("bank", "first");
		expect(authorization === "Bearer private-test-token").toBe(true);
		host.detachSocket(owner.cookie.slice("studio_session=".length), ownerSocket);
		await client.recall("bank", "context-still-connected");
		expect(authorization === "Bearer private-test-token").toBe(true);
		await new HindsightApi({ baseUrl: url, apiKey: "native-config-token" }).recall("bank", "native");
		expect(authorization === "Bearer native-config-token").toBe(true);
		expect(privateMemoryCredential(url + "/other")).toBeUndefined();
		const other = await caller();
		const otherId = other.cookie.slice("studio_session=".length);
		const otherSocket = { send() {} };
		host.attachSocket(otherId, otherSocket);
		expect((await host.handle(request("/api/v1/memory/credentials", other, [{ url, token: "foreign-token" }]), "127.0.0.1")).status).toBe(400);
		const bound = await store.create({ deviceId: "local", binding: { workspaceId } });
		expect((await host.handle(request("/api/v1/memory/credentials", { cookie: `studio_session=${bound.id}`, csrf: bound.csrf }, entries), "127.0.0.1")).status).toBe(403);
		expect((await host.handle(request("/api/v1/memory/credentials", undefined, entries), "127.0.0.1")).status).toBe(401);
		await host.handle(request("/api/v1/memory/credentials", owner, []), "127.0.0.1");
		await client.recall("bank", "removed");
		expect(authorization).toBeNull();
		await host.handle(request("/api/v1/memory/credentials", owner, entries), "127.0.0.1");
		await host.handle(request("/api/v1/session/revoke", owner, {}), "127.0.0.1");
		await client.recall("bank", "revoked");
		expect(authorization).toBeNull();
		await host.handle(request("/api/v1/memory/credentials", other, entries), "127.0.0.1");
		host.detachSocket(otherId, otherSocket);
		await client.recall("bank", "disconnected");
		expect(authorization).toBeNull();
	} finally { host.dropDeviceSessions("local"); memory.stop(true); }
});


test("contexts isolate session selection and receipts under the same authenticated cookie", async () => {
	const owner = await caller();
	const first = await open(owner), second = await open(owner);
	const a = await socket(owner, first), b = await socket(owner, second);
	const accepted = await host.handle(request("/api/v1/command", owner, { commandName: "core.abort", input: {}, requestId: "abort-a", idempotencyKey: "abort-a" }, first), "127.0.0.1");
	expect(accepted.status).toBe(202);
	expect(a.events).toMatchObject([{ kind: "command.receipt", receipt: { requestId: "abort-a", status: "completed" } }]);
	expect(b.events).toEqual([]);
	const firstBoot = await host.handle(request("/api/v1/bootstrap", owner, undefined, first), "127.0.0.1");
	const secondBoot = await host.handle(request("/api/v1/bootstrap", owner, undefined, second), "127.0.0.1");
	expect(await firstBoot.json()).toMatchObject({ selected: { workspaceId, sessionId: "selected-by-command" } });
	expect(await secondBoot.json()).toMatchObject({ selected: { workspaceId } });
	await host.handle(request("/api/v1/context/close", owner, {}, first), "127.0.0.1");
	expect(a.closed()).toBe(true);
	expect(b.closed()).toBe(false);
	await host.handle(request("/api/v1/session/revoke", owner, {}), "127.0.0.1");
	expect(b.closed()).toBe(true);
});

test("foreign cookies, absent CSRF, nested targets and closed handles cannot fall back to root", async () => {
	const owner = await caller(), foreign = await caller();
	const id = await open(owner);
	const wrongOwner = await host.handle(request("/api/v1/bootstrap", foreign, undefined, id), "127.0.0.1");
	expect(wrongOwner.status).toBe(404);
	const noCsrf = await host.handle(request("/api/v1/context/open", { ...owner, csrf: "" }, { workspaceId }), "127.0.0.1");
	expect(noCsrf.status).toBe(401);
	const crossed = await host.handle(request("/api/v1/query", owner, { queryName: "conversation.open", input: { target: { kind: "session", sessionId: "foreign-session" } } }, id), "127.0.0.1");
	expect(crossed.status).toBe(403);
	await host.handle(request("/api/v1/context/close", owner, {}, id), "127.0.0.1");
	const closed = await host.handle(request("/api/v1/query", owner, { queryName: "environment.get", input: {} }, id), "127.0.0.1");
	expect(closed.status).toBe(404);
	host.dropDeviceSessions("local");
});

test("expired session cleanup closes context sockets and never creates a replacement cookie", async () => {
	const owner = await caller();
	const id = await open(owner);
	const attached = await socket(owner, id);
	const now = Date.now();
	const clock = spyOn(Date, "now").mockReturnValue(now + 3_600_001);
	try {
		const response = await host.handle(request("/api/v1/bootstrap", owner, undefined, id), "127.0.0.1");
		expect(response.status).toBe(401);
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(attached.closed()).toBe(true);
	} finally { clock.mockRestore(); }
});

test("a workspace-bound cookie cannot open another workspace context", async () => {
	const live = await store.create({ deviceId: "local", binding: { workspaceId: "other-workspace" } });
	const owner = { cookie: `studio_session=${live.id}`, csrf: live.csrf };
	const response = await host.handle(request("/api/v1/context/open", owner, { workspaceId }), "127.0.0.1");
	expect(response.status).toBe(403);
	expect(await response.json()).toEqual({ error: "binding_scope" });
});

test("real workspace file queries and saves remain inside the caller's context and device binding", async () => {
	host = new StudioHost(new StudioOperations());
	await writeFile(directory.join("workspace", "notes.txt"), "local-file");
	const cwdB = directory.join("files-other");
	await mkdir(cwdB);
	await writeFile(directory.join("files-other", "notes.txt"), "foreign-file");
	await handleProjectsPut(new Request(origin + "/api/projects", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: cwdB }) }));
	const owner = await caller(), contextId = await open(owner);
	const input = { workspaceId, path: "notes.txt" };
	const response = await host.handle(request("/api/v1/query", owner, { queryName: "workspace.file.readText", input }, contextId), "127.0.0.1");
	expect(response.status).toBe(200);
	const result = await response.json() as { ok: boolean; result: { text: string; file: { version: string } } };
	expect(result.ok).toBe(true);
	expect(result.result.text).toBe("local-file");
	const crossed = await host.handle(request("/api/v1/query", owner, { queryName: "workspace.file.inspect", input: { ...input, workspaceId: workspaceIdFor(cwdB) } }, contextId), "127.0.0.1");
	expect(crossed.status).toBe(403);
	const live = await store.create({ deviceId: "files-bound", binding: { workspaceId } });
	const bound = { cookie: `studio_session=${live.id}`, csrf: live.csrf };
	const denied = await host.handle(request("/api/v1/query", bound, { queryName: "workspace.file.readChunk", input: { workspaceId: workspaceIdFor(cwdB), path: "notes.txt", version: result.result.file.version, offset: 0, length: 5 } }), "127.0.0.1");
	expect(denied.status).toBe(403);
	const write = { commandName: "workspace.file.writeText", input: { ...input, expectedVersion: result.result.file.version, text: "saved-file", encoding: "utf8", bom: false, lineEnding: "lf" }, requestId: "file-save", idempotencyKey: "file-save" };
	expect((await host.handle(request("/api/v1/command", { ...owner, csrf: "" }, write, contextId), "127.0.0.1")).status).toBe(401);
	expect((await host.handle(request("/api/v1/command", owner, write, contextId), "127.0.0.1")).status).toBe(202);
	const reread = await host.handle(request("/api/v1/query", owner, { queryName: "workspace.file.readText", input }, contextId), "127.0.0.1");
	expect(await reread.json()).toMatchObject({ ok: true, result: { text: "saved-file" } });
});

test("a socket accepted before context close cannot attach after close", async () => {
	const owner = await caller();
	const id = await open(owner);
	const attached = await socket(owner, id);
	await host.handle(request("/api/v1/context/close", owner, {}, id), "127.0.0.1");
	let closed = false;
	host.attachSocket(attached.key, { send: () => {}, close: () => { closed = true; } });
	expect(closed).toBe(true);
});

test("real persisted sessions remain in their own workspace and conversation", async () => {
	const cwdA = directory.join("workspace"), cwdB = directory.join("other-workspace");
	await mkdir(cwdB);
	const managers = [SessionManager.create(cwdA), SessionManager.create(cwdB)];
	for (const [index, manager] of managers.entries()) {
		manager.appendMessage({ role: "user", content: `workspace-${index}-private-message`, timestamp: Date.now() });
		await manager.ensureOnDisk();
		await manager.close();
		cacheSessionPath(manager.getSessionId(), manager.getSessionFile()!);
	}
	await handleProjectsPut(new Request(origin + "/api/projects", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: cwdB }) }));
	invalidateSessionListCache();
	host = new StudioHost(new StudioOperations());
	const owner = await caller();
	const ids: string[] = [];
	for (const [index, manager] of managers.entries()) {
		const response = await host.handle(request("/api/v1/context/open", owner, { workspaceId: workspaceIdFor(index === 0 ? cwdA : cwdB), sessionId: manager.getSessionId() }), "127.0.0.1");
		expect(response.status).toBe(200);
		ids.push(((await response.json()) as { contextId: string }).contextId);
	}
	for (const [index, id] of ids.entries()) {
		const response = await host.handle(request("/api/v1/query", owner, { queryName: "session.transcript.read", input: {} }, id), "127.0.0.1");
		const body = JSON.stringify(await response.json());
		expect(body).toContain(`workspace-${index}-private-message`);
		expect(body).not.toContain(`workspace-${1 - index}-private-message`);
	}
});

test("empty conversation Home preserves workspace facts without borrowing a root session", async () => {
	host = new StudioHost(new StudioOperations());
	const owner = await caller();
	const id = await open(owner);
	const response = await host.handle(request("/api/v1/query", owner, { queryName: "home.get", input: {} }, id), "127.0.0.1");
	const body = await response.json() as { ok: boolean; result: { snapshot?: unknown; recentWorkspaces: Array<{ workspaceId: string }> } };
	expect(body.ok).toBe(true);
	expect(body.result).not.toHaveProperty("snapshot");
	expect(body.result.recentWorkspaces.some(workspace => workspace.workspaceId === workspaceId)).toBe(true);
	const session = await host.handle(request("/api/v1/query", owner, { queryName: "session.state", input: {} }, id), "127.0.0.1");
	expect(await session.json()).toMatchObject({ ok: false, error: { code: "UNAVAILABLE", message: "no session in this conversation context" } });
});

test("authenticated contexts deliver interleaved real runtime streams with contiguous private cursors", async () => {
	host = new StudioHost(new StudioOperations());
	const createRuntime = (answer: string) => {
		const auth = createInMemoryAuthStorage();
		auth.keys.setRuntime("anthropic", "test-key");
		const mock = createMockModel({ responses: [{ content: [answer] }, { content: [answer + "-again"] }] });
		const agent = new Agent({ initialState: { model: getBundledModel("anthropic", "claude-sonnet-4-5"), systemPrompt: ["Test"], tools: [] }, getApiKey: () => "test-key", convertToLlm, streamFn: mock.stream });
		const session = new AgentSession({ agent, sessionManager: SessionManager.inMemory(directory.join("workspace")), settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }), modelRegistry: new ModelRegistry(auth, directory.join("models.yml")) });
		runtimes.push(session);
		sessions.set(session.sessionId, new AgentSessionWrapper(session, session.sessionId, null));
		return session;
	};
	const a = createRuntime("private-answer-a"), b = createRuntime("private-answer-b");
	const owner = await caller();
	const ids: string[] = [];
	for (const session of [a, b]) {
		const response = await host.handle(request("/api/v1/context/open", owner, { workspaceId, sessionId: session.sessionId }), "127.0.0.1");
		expect(response.status).toBe(200);
		ids.push((await response.json() as { contextId: string }).contextId);
	}
	const sockets = [await socket(owner, ids[0]!), await socket(owner, ids[1]!)];
	const settingsOnlyA = await host.handle(request("/api/v1/command", owner, { commandName: "runtime.settings.set", input: { key: "hindsight.apiUrl", value: "https://session-a-memory.example", persist: false }, requestId: "settings-a", idempotencyKey: "settings-a" }, ids[0]), "127.0.0.1");
	expect(settingsOnlyA.status).toBe(202);
	const memorySettings = await import("../src/hindsight/settings");
	expect(memorySettings.cfgHindsightApiUrl.get(a.settings)).toBe("https://session-a-memory.example");
	expect(memorySettings.cfgHindsightApiUrl.get(b.settings)).not.toBe("https://session-a-memory.example");
	const draftSettings = await open(owner);
	const draftSocket = await socket(owner, draftSettings);
	await host.handle(request("/api/v1/command", owner, { commandName: "runtime.settings.set", input: { key: "hindsight.apiUrl", value: "https://must-not-persist.example", persist: false }, requestId: "settings-draft", idempotencyKey: "settings-draft" }, draftSettings), "127.0.0.1");
	expect(draftSocket.events).toMatchObject([{ kind: "command.receipt", receipt: { status: "failed", error: { code: "UNAVAILABLE" } } }]);
	await Promise.all([a.prompt("question-a"), b.prompt("question-b")]);
	for (const [index, session] of [a, b].entries()) {
		const events = sockets[index]!.events as ClientEvent[];
		expect(events.map(event => Number(event.cursor))).toEqual(events.map((_, i) => i + 1));
		const updates = events.filter(event => event.kind === "conversation.changed");
		expect(updates.some(event => event.update.kind === "conversation.message.delta" && event.update.delta === `private-answer-${index === 0 ? "a" : "b"}`)).toBe(true);
		expect(updates.every(event => event.sessionId === session.sessionId)).toBe(true);
		expect(JSON.stringify(updates)).not.toContain(index === 0 ? "private-answer-b" : "private-answer-a");
	}
	await host.handle(request("/api/v1/context/close", owner, {}, ids[0]), "127.0.0.1");
	const count = sockets[0]!.events.length;
	await a.prompt("question-after-close");
	expect(sockets[0]!.events.length).toBe(count);
	expect(sockets[0]!.closed()).toBe(true);

	const draft = await open(owner);
	const boot = await host.handle(request("/api/v1/bootstrap", owner, undefined, draft), "127.0.0.1");
	const catalog = await host.handle(request("/api/v1/query", owner, { queryName: "commands.getManifest", input: {} }, draft), "127.0.0.1");
	expect((await boot.json() as { commandManifestHash: string }).commandManifestHash).toBe((await catalog.json() as { result: { hash: string } }).result.hash);
});

test.each(["close", "revoke", "expiry", "disconnect", "dispose", "selection"] as const)("browser descriptors follow authenticated view lifecycle: %s", async transition => {
	host = new StudioHost(new StudioOperations([...STUDIO_FAMILIES, {
		id: "selection-transition-test",
		commands: { "core.abort": async () => { selectStudioSession("other-session"); } },
	}]));
	const auth = createInMemoryAuthStorage();
	const session = new AgentSession({
		agent: new Agent({ initialState: { model: getBundledModel("anthropic", "claude-sonnet-4-5"), systemPrompt: ["Test"], tools: [] }, getApiKey: () => "test-key", convertToLlm }),
		sessionManager: SessionManager.inMemory(directory.join("workspace")),
		settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
		modelRegistry: new ModelRegistry(auth, directory.join("models.yml")),
	});
	runtimes.push(session);
	sessions.set(session.sessionId, new AgentSessionWrapper(session, session.sessionId, null));
	const tab = { name: `view-${session.sessionId}`, backend: "worker", state: "alive", pending: new Map(), info: { title: "Owned", url: "about:blank" }, kindTag: "headless", ownerSessionId: session.getEvalKernelOwnerId(), frozen: false } as unknown as TabSession;
	getTabsMapForTest().set(tab.name, tab);
	const watchers: Array<ReturnType<typeof watch>> = [];
	let clock: ReturnType<typeof spyOn> | undefined;
	try {
		const owner = await caller(), foreign = await caller();
		const opened = await host.handle(request("/api/v1/context/open", owner, { workspaceId, sessionId: session.sessionId }), "127.0.0.1");
		expect(opened.status).toBe(200);
		const id = (await opened.json() as { contextId: string }).contextId;
		const received: Array<{ kind: string; receipt?: { requestId: string; status: string; result?: { result: { observationId?: string; descriptorId?: string } } } }> = [];
		const peer = { send: (value: string) => received.push(JSON.parse(value)), close: () => {} };
		host.attachSocket(`context:${id}`, peer);
		const command = { commandName: "browser.observe.prepare", input: { sessionId: session.sessionId, tabId: studioTabIdentity(tab) }, requestId: "prepare", idempotencyKey: "prepare" };
		expect((await host.handle(request("/api/v1/command", { ...owner, csrf: "" }, command, id), "127.0.0.1")).status).toBe(401);
		expect((await host.handle(request("/api/v1/command", foreign, command, id), "127.0.0.1")).status).toBe(404);
		expect((await host.handle(request("/api/v1/command", owner, command, id), "127.0.0.1")).status).toBe(202);
		const receipt = received.find(event => event.receipt?.requestId === "prepare")?.receipt;
		expect(receipt?.status).toBe("completed");
		const media = await studioPrivateResources();
		const descriptor = path.join(media.mediaDirectory, "browser", receipt!.result!.result.observationId + ".json");
		const managed = { commandName: "browser.managed.prepare", input: { sessionId: session.sessionId }, requestId: "managed", idempotencyKey: "managed" };
		expect((await host.handle(request("/api/v1/command", owner, managed, id), "127.0.0.1")).status).toBe(202);
		const managedReceipt = received.find(event => event.receipt?.requestId === "managed")?.receipt;
		expect(managedReceipt?.status).toBe("completed");
		const managedDescriptor = path.join(media.mediaDirectory, "managed-browser", managedReceipt!.result!.result.descriptorId!);
		expect(existsSync(managedDescriptor)).toBe(true);
		expect(existsSync(descriptor)).toBe(true);
		expect(JSON.stringify(received)).not.toContain(media.mediaDirectory);
		expect(JSON.stringify(received)).not.toContain('"token"');
		const removed = [descriptor, managedDescriptor].map(file => {
			const deleted = Promise.withResolvers<void>();
			watchers.push(watch(path.dirname(file), () => { if (!existsSync(file)) deleted.resolve(); }));
			return deleted.promise;
		});
		if (transition === "close") await host.handle(request("/api/v1/context/close", owner, {}, id), "127.0.0.1");
		else if (transition === "revoke") await host.handle(request("/api/v1/session/revoke", owner, {}), "127.0.0.1");
		else if (transition === "expiry") {
			clock = spyOn(Date, "now").mockReturnValue(Date.now() + 3_600_001);
			expect((await host.handle(request("/api/v1/bootstrap", owner, undefined, id), "127.0.0.1")).status).toBe(401);
		} else if (transition === "disconnect") host.detachSocket(`context:${id}`, peer);
		else if (transition === "dispose") await session.dispose();
		else {
			// A context selecting another session cannot keep the prior private resource alive.
			const response = await host.handle(request("/api/v1/command", owner, { commandName: "core.abort", input: {}, requestId: "switch", idempotencyKey: "switch" }, id), "127.0.0.1");
			expect(response.status).toBe(202);
		}
		await Promise.all(removed);
		expect(existsSync(descriptor)).toBe(false);
		expect(existsSync(managedDescriptor)).toBe(false);
	} finally {
		for (const watcher of watchers) watcher.close();
		clock?.mockRestore();
		getTabsMapForTest().delete(tab.name);
	}
});

test("Time Travel captures without a view and restores files and exact conversation through owned Host commands", async () => {
	host = new StudioHost(new StudioOperations());
	const cwd = directory.join("workspace");
	execFileSync("git", ["init", "-q", cwd], { windowsHide: true });
	const auth = createInMemoryAuthStorage(); auth.keys.setRuntime("anthropic", "test-key");
	let revision = 0;
	const mock = createMockModel({ handler: async () => { await writeFile(path.join(cwd, "answer.txt"), String(++revision)); return { content: ["done"] }; } });
	const agent = new Agent({ initialState: { model: getBundledModel("anthropic", "claude-sonnet-4-5"), systemPrompt: [], tools: [] }, getApiKey: () => "test-key", convertToLlm, streamFn: mock.stream });
	const session = new AgentSession({ agent, sessionManager: SessionManager.inMemory(cwd), settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false, "todo.enabled": false }), modelRegistry: new ModelRegistry(auth, directory.join("models.yml")) });
	runtimes.push(session); sessions.set(session.sessionId, new AgentSessionWrapper(session, session.sessionId, null));
	const owner = await caller();
	const opened = await host.handle(request("/api/v1/context/open", owner, { workspaceId, sessionId: session.sessionId }), "127.0.0.1");
	const id = (await opened.json() as { contextId: string }).contextId;
	const peer = { send(value: string) { received.push(JSON.parse(value)); }, close() {} };
	const received: Array<{ kind: string; receipt?: { requestId: string; status: string; result?: unknown } }> = [];
	host.attachSocket(`context:${id}`, peer);
	const command = (name: string, input: unknown, contextId = id, callerValue = owner) => host.handle(request("/api/v1/command", callerValue, { commandName: name, input, requestId: name, idempotencyKey: name }, contextId), "127.0.0.1");
	const query = async (name: string, input: unknown, contextId = id): Promise<unknown> => (await host.handle(request("/api/v1/query", owner, { queryName: name, input }, contextId), "127.0.0.1")).json();
	try {
		expect((await command("timeTravel.settings.set", { enabled: true }, id, { ...owner, csrf: "bad" })).status).toBe(401);
		expect((await command("timeTravel.settings.set", { enabled: true })).status).toBe(202);
		host.detachSocket(`context:${id}`, peer);
		await session.prompt("first"); await session.prompt("second");
		host.attachSocket(`context:${id}`, peer);
		const timeline = type({ ok: "true", result: { points: type({ id: "string", leafId: "string | null", phase: "'before' | 'after' | 'restore-backup'" }).array() } }).assert(await query("timeTravel.timeline.read", { sessionId: session.sessionId }));
		expect(timeline.result.points.map(point => point.phase)).toEqual(["before", "after", "before", "after"]);
		const point = timeline.result.points[1]!;
		const preview = type({ ok: "true", result: { revision: "string" } }).assert(await query("timeTravel.restore.preview", { sessionId: session.sessionId, snapshotId: point.id }));
		expect((await command("timeTravel.restore", { sessionId: session.sessionId, leafId: point.leafId, mode: "both", snapshotId: point.id, expectedRevision: preview.result.revision })).status).toBe(202);
		const restored = received.find(event => event.receipt?.requestId === "timeTravel.restore")?.receipt;
		expect(restored).toMatchObject({ status: "completed", result: { codeRestored: true, conversationRestored: true } });
		expect(await readFile(path.join(cwd, "answer.txt"), "utf8")).toBe("1");
		expect(session.messages.filter(message => message.role === "user")).toHaveLength(1);
		const other = await open(owner); await socket(owner, other);
		const foreign = await host.handle(request("/api/v1/query", owner, { queryName: "timeTravel.timeline.read", input: { sessionId: "foreign" } }, id), "127.0.0.1");
		expect(foreign.status).toBe(403);
		expect(JSON.stringify(timeline)).not.toContain(directory.path());
	} finally { auth.close(); }
}, 30_000);

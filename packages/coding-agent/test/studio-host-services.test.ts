import { afterEach, beforeEach, expect, spyOn, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { TempDir, refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { getMainSessionId, registerMainSessionId } from "../src/channels";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings, resetSettingsForTest } from "../src/config/settings";
import { WebConfig } from "../src/config/web-config";
import { startDaemonBrokerFromEnvironment } from "../src/launch/broker";
import * as brokerClients from "../src/launch/client";
import { DAEMON_PROJECT_DIR_ENV, DAEMON_RUNTIME_DIR_ENV } from "../src/launch/protocol";
import { startService } from "../src/launch/services";
import { SessionStore, setSessionStoreForTest } from "../src/server/auth/session-store";
import type { ClientEvent, CommandInput, CommandResult } from "../src/server/studio-host/contract";
import { servicesOps } from "../src/server/studio-host/ops/services";
import { workspaceIdFor } from "../src/server/studio-host/ops/workspace-id";
import { StudioOperations } from "../src/server/studio-host/registry";
import { StudioHost } from "../src/server/studio-host/server";
import type { ServiceKind } from "../src/server/studio-host/services/project-services";
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
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

const origin = "http://127.0.0.1";
let directory: TempDir;
let previousEnv: Array<[string, string | undefined]>;
let previousMain: string | null;
let previousTitle: string;
let host: StudioHost;
let store: SessionStore;
let client: brokerClients.DaemonBrokerClient;
let broker: Promise<void>;
let auth: AuthStorage;
let session: AgentSession;
let tools: ToolSession;
let workspaceId: string;
const disposers: Array<() => void> = [];

beforeEach(async () => {
	directory = TempDir.createSync(path.resolve(import.meta.dir, "../../../temp/zeta-studio-host-services-"));
	previousEnv = [
		"ZETA_CODING_AGENT_DIR",
		"ZETA_DEFAULT_WORKSPACE",
		DAEMON_PROJECT_DIR_ENV,
		DAEMON_RUNTIME_DIR_ENV,
	].map(key => [key, process.env[key]]);
	previousMain = getMainSessionId();
	previousTitle = process.title;
	await fs.mkdir(directory.join("workspace"));
	process.env.ZETA_CODING_AGENT_DIR = directory.join("profile");
	process.env.ZETA_DEFAULT_WORKSPACE = directory.join("workspace");
	refreshDirsFromEnv();
	resetSettingsForTest();
	WebConfig.resetShared();
	resetRemoteAccessForTests();
	store = new SessionStore(directory.join("cookies.json"));
	setSessionStoreForTest(store);
	workspaceId = workspaceIdFor(directory.join("workspace"));
	host = new StudioHost(new StudioOperations([servicesOps]));
	client = await brokerClients.createDaemonBrokerClient(directory.join("workspace"), {
		runtimeDir: directory.join("runtime"),
		idleGraceMs: 5000,
	});
	process.env[DAEMON_PROJECT_DIR_ENV] = directory.join("workspace");
	process.env[DAEMON_RUNTIME_DIR_ENV] = directory.join("runtime");
	const listening = Promise.withResolvers<void>();
	broker = startDaemonBrokerFromEnvironment({ onListening: () => listening.resolve() });
	await listening.promise;
	spyOn(brokerClients, "daemonClientForProject").mockResolvedValue(client);
	auth = createInMemoryAuthStorage();
	const manager = SessionManager.inMemory(directory.join("workspace"));
	const settings = Settings.isolated({ "compaction.enabled": false, "retry.enabled": false, "todo.enabled": false });
	tools = {
		cwd: manager.getCwd(),
		hasUI: false,
		settings,
		sessionManager: manager,
		getSessionFile: () => null,
		getSessionSpawns: () => null,
		getSessionId: () => session.sessionId,
		getAgentId: () => "Main",
		registerDisposeCallback: callback => {
			disposers.push(callback);
		},
	};
	session = new AgentSession({
		agent: new Agent({
			initialState: { model: getBundledModel("anthropic", "claude-sonnet-4-5"), systemPrompt: [], tools: [] },
			convertToLlm,
		}),
		sessionManager: manager,
		settings,
		evalToolSession: tools,
		modelRegistry: new ModelRegistry(auth, directory.join("models.yml")),
	});
	sessions.set(session.sessionId, new AgentSessionWrapper(session, session.sessionId, null));
});

afterEach(async () => {
	host.dropDeviceSessions("local");
	for (const dispose of disposers.splice(0)) dispose();
	const listed = await client.request({ op: "list" });
	if (listed.op === "list")
		for (const row of listed.daemons) await client.request({ op: "stop", name: row.name, timeoutMs: 1000 });
	await client.request({ op: "shutdown" });
	client.close();
	await broker;
	sessions.delete(session.sessionId);
	await session.dispose();
	auth.close();
	vi.restoreAllMocks();
	registerMainSessionId(previousMain);
	process.title = previousTitle;
	for (const [key, value] of previousEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
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

interface Caller {
	cookie: string;
	csrf: string;
}
interface View {
	owner: Caller;
	id: string;
	events: ClientEvent[];
	peer: { send(value: string): void; close(): void };
}
function request(route: string, owner?: Caller, body?: unknown, contextId?: string) {
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
async function view(): Promise<View> {
	const bootstrap = await host.handle(request("/api/v1/bootstrap"), "127.0.0.1");
	const owner = {
		cookie: bootstrap.headers.get("set-cookie")!.split(";")[0]!,
		csrf: bootstrap.headers.get("x-studio-csrf")!,
	};
	const opened = await host.handle(
		request("/api/v1/context/open", owner, { workspaceId, sessionId: session.sessionId }),
		"127.0.0.1",
	);
	expect(opened.status).toBe(200);
	const id = ((await opened.json()) as { contextId: string }).contextId;
	const events: ClientEvent[] = [];
	const peer = {
		send: (value: string) => {
			events.push(JSON.parse(value));
		},
		close() {},
	};
	host.attachSocket(`context:${id}`, peer);
	return { owner, id, events, peer };
}
async function dispatch<K extends ServiceKind>(view: View, kind: K, input: CommandInput<K>, owner = view.owner) {
	const id = crypto.randomUUID();
	const response = await host.handle(
		request("/api/v1/command", owner, { commandName: kind, input, requestId: id, idempotencyKey: id }, view.id),
		"127.0.0.1",
	);
	const event = view.events.findLast(event => event.kind === "command.receipt" && event.receipt.requestId === id);
	return { response, receipt: event?.kind === "command.receipt" ? event.receipt : undefined };
}
async function command<K extends ServiceKind>(view: View, kind: K, input: CommandInput<K>): Promise<CommandResult<K>> {
	const result = await dispatch(view, kind, input);
	expect(result.response.status).toBe(202);
	if (result.receipt?.status !== "completed") throw new Error(JSON.stringify(result.receipt));
	return result.receipt.result as CommandResult<K>;
}

const spec = {
	name: "worker",
	command: "echo studio-ready; read answer",
	pty: false,
	mode: "session" as const,
	ready: { log: "studio-ready", timeoutMs: 5000 },
};

test("authenticated service receipts control the real broker and reject stale launches", async () => {
	const live = await view();
	const started = (await command(live, "services.start", { spec })).result.service;
	const ready = await client.request({ op: "wait", name: spec.name, for: "ready", timeoutMs: 5000 });
	expect(ready.op === "wait" && ready.timedOut).toBe(false);
	const list = (await command(live, "services.list", {})).result;
	expect(list.services.map(row => [row.name, row.state, row.ownerId])).toEqual([
		["worker", "ready", session.sessionId],
	]);
	const logs = (await command(live, "services.logs", { name: spec.name, instanceId: started.instanceId })).result;
	expect(logs.text).toContain("studio-ready");
	const changed = (await command(live, "services.restart", { name: spec.name, instanceId: started.instanceId })).result
		.service;
	expect(changed.instanceId).not.toBe(started.instanceId);
	const stale = await dispatch(live, "services.stop", { name: spec.name, instanceId: started.instanceId });
	expect(stale.receipt).toMatchObject({
		status: "failed",
		error: { message: expect.stringContaining("instance changed") },
	});
	const persisted = (
		await command(live, "services.mode.set", { name: spec.name, instanceId: changed.instanceId, mode: "persist" })
	).result.service;
	expect(persisted.mode).toBe("persist");
	await command(live, "services.send", { name: spec.name, instanceId: changed.instanceId, text: "done\n" });
	const ended = await client.request({ op: "wait", name: spec.name, for: "exit", timeoutMs: 5000 });
	expect(ended.op === "wait" && ended.daemon.state).toBe("exited");
}, 20000);

test("declared native previews reach Host rows without exposing launch secrets", async () => {
	const live = await view();
	await startService(tools, {
		...spec,
		ready: { log: "studio-ready", timeout: 5 },
		previewUrl: "HTTP://LOCALHOST:4100/a/../",
		env: { ZETA_TEST_SERVICE_SECRET: "private-launch-secret" },
	});
	const result = (await command(live, "services.list", {})).result;
	expect(result.services[0]?.previewUrl).toBe("http://localhost:4100/");
	expect(result.services[0]?.ownerId).toBe(session.sessionId);
	expect(result.services[0]?.pid).toBeGreaterThan(0);
	const publicData = JSON.stringify(result);
	for (const value of ["private-launch-secret", directory.path(), spec.command, '"env"', '"args"', '"spec"'])
		expect(publicData).not.toContain(value);
}, 15000);

test("CSRF, foreign context and closed views cannot mutate services; cwd symlinks stay confined", async () => {
	const live = await view();
	const before = await dispatch(live, "services.start", { spec }, { ...live.owner, csrf: "wrong" });
	expect(before.response.status).toBe(401);
	const foreign = await host.handle(request("/api/v1/bootstrap"), "127.0.0.1");
	const other = {
		cookie: foreign.headers.get("set-cookie")!.split(";")[0]!,
		csrf: foreign.headers.get("x-studio-csrf")!,
	};
	expect((await dispatch(live, "services.start", { spec }, other)).response.status).toBe(404);
	const privateSpec = { ...spec, detached: true };
	const rejected = await dispatch(live, "services.start", { spec: privateSpec });
	expect(rejected.response.status).toBe(400);
	expect(await rejected.response.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
	await fs.mkdir(directory.join("outside"));
	await fs.symlink(
		directory.join("outside"),
		directory.join("workspace", "escape"),
		process.platform === "win32" ? "junction" : "dir",
	);
	const escaped = await dispatch(live, "services.start", { spec: { ...spec, cwd: "escape" } });
	expect(escaped.response.status).toBe(400);
	expect(await escaped.response.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
	host.detachSocket(`context:${live.id}`, live.peer);
	expect((await dispatch(live, "services.start", { spec })).receipt).toBeUndefined();
	const list = await client.request({ op: "list" });
	expect(list.op === "list" && list.daemons).toEqual([]);
}, 15000);

test("view loss while opening a broker client prevents the queued start", async () => {
	const live = await view();
	const entered = Promise.withResolvers<void>(),
		resume = Promise.withResolvers<void>();
	let reads = 0;
	spyOn(brokerClients, "daemonClientForProject").mockImplementation(async () => {
		if (++reads === 2) {
			entered.resolve();
			await resume.promise;
		}
		return client;
	});
	const pending = dispatch(live, "services.start", { spec });
	await entered.promise;
	host.detachSocket(`context:${live.id}`, live.peer);
	resume.resolve();
	await pending;
	const list = await client.request({ op: "list" });
	expect(list.op === "list" && list.daemons).toEqual([]);
}, 15000);

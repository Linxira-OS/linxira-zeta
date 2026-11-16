import { afterEach, beforeEach, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as path from "node:path";
import { once } from "node:events";
import { Agent } from "@linxiraos/pi-agent-core";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { TempDir, refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings, resetSettingsForTest } from "../src/config/settings";
import { WebConfig } from "../src/config/web-config";
import { SessionStore, setSessionStoreForTest } from "../src/server/auth/session-store";
import type { ClientEvent, CommandInput, CommandName } from "../src/server/studio-host/contract";
import { predictionOps } from "../src/server/studio-host/ops/prediction";
import { workspaceIdFor } from "../src/server/studio-host/ops/workspace-id";
import { studioPrivateResources } from "../src/server/studio-host/private-resources";
import { StudioOperations } from "../src/server/studio-host/registry";
import { StudioHost } from "../src/server/studio-host/server";
import { AgentSessionWrapper, sessions } from "../src/server/web-gateway/agents";
import { resetRemoteAccessForTests } from "../src/server/web-gateway/remote-access";
import { AgentSession } from "../src/session/agent-session";
import { AgentStorage } from "../src/session/agent-storage";
import type { AuthStorage } from "../src/session/auth-storage";
import { HistoryStorage } from "../src/session/history-storage";
import { convertToLlm } from "../src/session/messages";
import { closeSessionIndex } from "../src/session/session-index";
import { SessionManager } from "../src/session/session-manager";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

let root: TempDir, session: AgentSession, host: StudioHost, auth: AuthStorage;
let prior: Array<[string, string | undefined]>;
const origin = "http://127.0.0.1";
beforeEach(async () => {
	root = TempDir.createSync(path.resolve(import.meta.dir, "../../../temp/studio-host-prediction-"));
	prior = ["ZETA_CODING_AGENT_DIR", "ZETA_DEFAULT_WORKSPACE"].map(key => [key, process.env[key]]);
	await fs.mkdir(root.join("workspace"));
	process.env.ZETA_CODING_AGENT_DIR = root.join("profile");
	process.env.ZETA_DEFAULT_WORKSPACE = root.join("workspace");
	refreshDirsFromEnv(); resetSettingsForTest(); WebConfig.resetShared(); resetRemoteAccessForTests();
	setSessionStoreForTest(new SessionStore(root.join("cookies.json")));
	auth = createInMemoryAuthStorage();
	const manager = SessionManager.inMemory(root.join("workspace"));
	session = new AgentSession({
		agent: new Agent({ initialState: { model: getBundledModel("anthropic", "claude-sonnet-4-5"), systemPrompt: [], tools: [] }, convertToLlm }),
		sessionManager: manager,
		settings: Settings.isolated({ "composer.predictions": false, "compaction.enabled": false, "retry.enabled": false }),
		modelRegistry: new ModelRegistry(auth, root.join("models.yml")),
	});
	sessions.set(session.sessionId, new AgentSessionWrapper(session, session.sessionId, null));
	host = new StudioHost(new StudioOperations([predictionOps]));
});
afterEach(async () => {
	host.dropDeviceSessions("local");
	sessions.delete(session.sessionId); await session.dispose(); auth.close(); vi.restoreAllMocks();
	setSessionStoreForTest(undefined);
	AgentStorage.close(); HistoryStorage.close(); closeSessionIndex();
	for (const [key, value] of prior) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
	refreshDirsFromEnv(); resetSettingsForTest(); WebConfig.resetShared(); resetRemoteAccessForTests();
	await root.remove();
});
interface View { cookie: string; csrf: string; id: string; events: ClientEvent[]; peer: { send(value: string): void; close(): void } }
function request(route: string, owner?: Pick<View, "cookie" | "csrf">, body?: unknown, contextId?: string, csrf = owner?.csrf) {
	return new Request(origin + route, { method: body === undefined ? "GET" : "POST", headers: { origin, ...(owner ? { cookie: owner.cookie, ...(csrf ? { "x-studio-csrf": csrf } : {}) } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...(contextId ? { "x-studio-context": contextId } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function view(): Promise<View> {
	const bootstrap = await host.handle(request("/api/v1/bootstrap"), "127.0.0.1");
	const owner = { cookie: bootstrap.headers.get("set-cookie")!.split(";")[0]!, csrf: bootstrap.headers.get("x-studio-csrf")! };
	const response = await host.handle(request("/api/v1/context/open", owner, { workspaceId: workspaceIdFor(root.join("workspace")), sessionId: session.sessionId }), "127.0.0.1");
	expect(response.status).toBe(200);
	const opened: unknown = await response.json();
	if (!opened || typeof opened !== "object" || !("contextId" in opened) || typeof opened.contextId !== "string") throw new Error("Context did not open");
	const id = opened.contextId;
	const events: ClientEvent[] = [], peer = { send(value: string) { events.push(JSON.parse(value)); }, close() {} };
	host.attachSocket(`context:${id}`, peer);
	return { ...owner, id, events, peer };
}
async function command<K extends CommandName>(owner: View, kind: K, input: CommandInput<K>) {
	const requestId = crypto.randomUUID();
	const response = await host.handle(request("/api/v1/command", owner, { commandName: kind, input, requestId, idempotencyKey: requestId }, owner.id), "127.0.0.1");
	const event = owner.events.findLast(event => event.kind === "command.receipt" && event.receipt.requestId === requestId);
	return { response, receipt: event?.kind === "command.receipt" ? event.receipt : undefined };
}
async function until(predicate: () => boolean) {
	const deadline = Date.now() + 3000;
	while (!predicate() && Date.now() < deadline) await Bun.sleep(5);
	expect(predicate()).toBe(true);
}
function completedSettings(value: unknown): { method: string; source: string } {
	if (!value || typeof value !== "object" || !("result" in value)) throw new Error("Prediction settings missing");
	const result = value.result;
	if (!result || typeof result !== "object" || !("method" in result) || typeof result.method !== "string" || !("source" in result) || typeof result.source !== "string") throw new Error("Prediction settings malformed");
	return { method: result.method, source: result.source };
}

test("prepared prediction channels are view-owned and last-socket disconnect revokes private input", async () => {
	const first = await view(), second = await view();
	const prepared = await command(first, "prediction.prepare", { sessionId: session.sessionId, protocolVersion: 2 });
	expect(prepared.response.status).toBe(202);
	if (prepared.receipt?.status !== "completed") throw new Error(JSON.stringify(prepared.receipt));
	const envelope = prepared.receipt.result;
	if (!envelope || typeof envelope !== "object" || !("result" in envelope)) throw new Error("Prediction channel missing");
	const result = envelope.result;
	if (!result || typeof result !== "object" || !("channelId" in result) || typeof result.channelId !== "string" || !("protocolVersion" in result)) throw new Error("Prediction channel malformed");
	expect(result.protocolVersion).toBe(2);
	const resources = await studioPrivateResources();
	const file = path.join(resources.mediaDirectory, "prediction", result.channelId + ".json");
	const descriptor = await Bun.file(file).json() as { endpoint: string; token: string };
	expect(JSON.stringify(prepared.receipt)).not.toContain(descriptor.endpoint);
	expect(JSON.stringify(prepared.receipt)).not.toContain(descriptor.token);
	await command(second, "prediction.release", { sessionId: session.sessionId, channelId: result.channelId });
	expect(await Bun.file(file).exists()).toBe(true);
	const socket = net.createConnection(descriptor.endpoint);
	try {
		await once(socket, "connect", { signal: AbortSignal.timeout(3000) });
		let authenticated = false;
		socket.on("data", chunk => { if (chunk.toString().includes("OK\n")) authenticated = true; });
		socket.on("error", () => {});
		socket.write(descriptor.token + "\n"); await until(() => authenticated);
		host.detachSocket(`context:${first.id}`, first.peer);
		await until(() => socket.destroyed);
		expect(await Bun.file(file).exists()).toBe(false);
		const status = await command(second, "prediction.status", { sessionId: session.sessionId });
		expect(status.receipt?.status).toBe("completed");
	} finally { socket.destroy(); }
});

test("HTTP prediction settings preserve native session overrides and reject malformed or unprotected mutations", async () => {
	const live = await view();
	const input = { sessionId: session.sessionId, method: "off" as const, scope: "session" as const };
	const configured = await command(live, "prediction.configure", input);
	if (configured.receipt?.status !== "completed") throw new Error("Prediction configuration did not complete");
	const configuration = completedSettings(configured.receipt?.result);
	expect(configuration.method).toBe("off");
	expect(configuration.source).toBe("runtime");
	const restored = await command(live, "prediction.clearOverride", { sessionId: session.sessionId });
	if (restored.receipt?.status !== "completed") throw new Error("Prediction override was not cleared");
	expect(completedSettings(restored.receipt?.result).method).toBe("auto");
	const malformed = await command(live, "prediction.prepare", { sessionId: session.sessionId, protocolVersion: 3 } as unknown as CommandInput<"prediction.prepare">);
	expect(malformed.response.status).toBe(400);
	const csrf = await host.handle(request("/api/v1/command", live, { commandName: "prediction.configure", input, requestId: "blocked", idempotencyKey: "blocked" }, live.id, ""), "127.0.0.1");
	expect(csrf.status).toBe(401);
});

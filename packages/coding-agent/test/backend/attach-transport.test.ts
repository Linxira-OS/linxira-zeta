/**
 * Backend attach transport:
 * 1. a second client attaches to a live gateway session, sends a prompt and
 *    observes the streamed assistant reply, then detaches without stopping
 *    the backend;
 * 2. a missing backend resolves to the in-process path instead of throwing.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { FileSessionStorage } from "@linxiraos/zeta/session/session-storage";
import { AgentSessionWrapper, sessions as gatewaySessions } from "../../src/server/web-gateway/agents";
import { cacheSessionPath } from "../../src/server/web-gateway/sessions";
import { startWebGateway } from "../../src/server/web-gateway";
import { BackendClient, pickMostRecentSessionForCwd, sortSessionsNewestFirst } from "../../src/backend/client";
import { resolveStartupTransport } from "../../src/backend/attach-intent";
import { runBackendPrintMode } from "../../src/backend/print";
import { createInMemoryAuthStorage } from "../helpers/agent-session-setup";

const cleanups: Array<() => Promise<void>> = [];
let agentDir: string;
let previousAgentDir: string | undefined;
let previousRegistry: string | undefined;

beforeEach(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "zeta-backend-attach-"));
	previousAgentDir = process.env.ZETA_CODING_AGENT_DIR;
	previousRegistry = process.env.ZETA_SERVE_REGISTRY;
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	process.env.ZETA_SERVE_REGISTRY = join(agentDir, "serve.json");
	cleanups.push(async () => {
		if (previousAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
		else process.env.ZETA_CODING_AGENT_DIR = previousAgentDir;
		if (previousRegistry === undefined) delete process.env.ZETA_SERVE_REGISTRY;
		else process.env.ZETA_SERVE_REGISTRY = previousRegistry;
		await rm(agentDir, { recursive: true, force: true });
	});
});

afterEach(async () => {
	// Reverse insertion order: the temp-root removal was registered first and
	// must run after the sessions/server that live inside it are torn down.
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Real AgentSession over a mock provider, persisted in a temp session dir. */
async function createMockBackendSession(cwd: string, sessionDir: string, reply: string) {
	const settings = Settings.isolated({ "compaction.enabled": false });
	const model = createMockModel({ handler: { content: [reply] } });
	const authStorage = createInMemoryAuthStorage();
	authStorage.keys.setRuntime(model.model.provider, "test-key");
	const modelRegistry = new ModelRegistry(authStorage);
	const sessionManager = SessionManager.create(cwd, sessionDir, new FileSessionStorage(), { client: "cli" });
	// Force the file to exist before the gateway resolves it from disk.
	sessionManager.appendMessage({
		role: "user",
		content: "seed",
		timestamp: Date.now(),
	} as never);
	const session = new AgentSession({
		agent: new Agent({
			initialState: { model: model.model, systemPrompt: ["test"], tools: [], messages: [] },
			streamFn: model.stream,
		}),
		sessionManager,
		settings,
		modelRegistry,
	});
	const sessionId = sessionManager.getSessionId();
	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile) throw new Error("mock session did not create a file");
	const wrapper = new AgentSessionWrapper(session, sessionId, sessionFile);
	gatewaySessions.set(sessionId, wrapper);
	cacheSessionPath(sessionId, sessionFile);
	cleanups.push(async () => {
		gatewaySessions.delete(sessionId);
		wrapper.destroy();
		await session.dispose().catch(() => undefined);
	});
	return { sessionId, wrapper };
}

describe("backend attach transport", () => {
	test("a second client streams a reply and detaches without stopping the backend", async () => {
		const cwd = join(agentDir, "workspace");
		await mkdir(cwd, { recursive: true });
		const { sessionId } = await createMockBackendSession(cwd, join(agentDir, "sessions"), "hello from the backend");
		// `startWebGateway` rejects port 0; reserve a free loopback port first.
		const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("probe") });
		const port = probe.port ?? 0;
		await probe.stop(true);
		const server = await startWebGateway(port);
		cleanups.push(() => server.shutdown());

		const client = new BackendClient(server.url);
		const abort = new AbortController();
		const iterator = client.events(sessionId, { signal: abort.signal });
		const first = await iterator.next();
		expect(first.done).toBe(false);
		expect(first.value?.type).toBe("connected");

		const reply = (async () => {
			const seen: Array<Record<string, unknown>> = [];
			let text = "";
			while (true) {
				const next = await iterator.next();
				if (next.done) break;
				const event = next.value;
				seen.push(event);
				if (event.type === "message_end") {
					const message = event.message;
					if (message && typeof message === "object" && "role" in message && message.role === "assistant") {
						const content = "content" in message ? message.content : undefined;
						if (Array.isArray(content)) {
							for (const block of content) {
								if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
									text += block.text;
								}
							}
						}
					}
				}
				if (event.type === "agent_end") break;
			}
			return { seen, text };
		})();

		await client.send(sessionId, { type: "prompt", message: "please answer" });
		const { seen, text } = await reply;
		expect(seen.some(event => event.type === "message_update")).toBe(true);
		expect(text).toContain("hello from the backend");

		// Detach: close only this client's stream; the backend and its session
		// stay alive for the next client.
		abort.abort();
		const identity = await fetch(`${server.url}/api/server/identity`);
		expect(identity.ok).toBe(true);
		expect(gatewaySessions.get(sessionId)?.isAlive()).toBe(true);
		const list = await client.listSessions();
		expect(list.sessions.length).toBeGreaterThanOrEqual(0);
	});

	test("session addressing picks the newest exact-cwd session across repositories", () => {
		const sessions = [
			{ id: "old", cwd: "C:/work/repo", modified: "2026-10-01T00:00:00.000Z" },
			{ id: "other-repo", cwd: "C:/work/other", modified: "2026-10-20T00:00:00.000Z" },
			{ id: "new", cwd: "C:/work/repo", modified: "2026-10-19T00:00:00.000Z" },
		];
		expect(pickMostRecentSessionForCwd(sessions, "C:/work/repo")?.id).toBe("new");
		expect(pickMostRecentSessionForCwd(sessions, "C:/work/missing")).toBeUndefined();
		expect(sortSessionsNewestFirst(sessions).map(session => session.id)).toEqual(["other-repo", "new", "old"]);
	});

	test("--backend print mode streams the reply through the gateway", async () => {
		const cwd = join(agentDir, "print-workspace");
		await mkdir(cwd, { recursive: true });
		const { sessionId } = await createMockBackendSession(cwd, join(agentDir, "print-sessions"), "print reply");
		const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("probe") });
		const port = probe.port ?? 0;
		await probe.stop(true);
		const server = await startWebGateway(port);
		cleanups.push(() => server.shutdown());

		const originalWrite = process.stdout.write.bind(process.stdout);
		let printed = "";
		process.stdout.write = ((chunk: string | Uint8Array) => {
			printed += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
			return true;
		}) as typeof process.stdout.write;
		try {
			const exitCode = await runBackendPrintMode({
				intent: { sessionId, newSession: false, explicit: true },
				cwd,
				messages: ["hello"],
				mode: "text",
				env: { ZETA_GATEWAY_URL: server.url },
			});
			expect(exitCode).toBe(0);
		} finally {
			process.stdout.write = originalWrite;
		}
		expect(printed).toContain("print reply");
	});

	test("a missing backend falls back to the in-process launch path", async () => {
		const unreachable = async (): Promise<Response> => {
			throw new TypeError("fetch failed: connection refused");
		};
		const transport = await resolveStartupTransport(
			{
				backendUrl: "http://127.0.0.1:1",
				messages: [],
				fileArgs: [],
				unrecognizedFlags: [],
				invalidFlagValues: [],
				unknownFlags: new Map(),
			},
			[],
			{ interactive: true, fetchImpl: unreachable as unknown as typeof fetch, timeoutMs: 50 },
		);
		expect(transport.kind).toBe("in-process");

		// Explicit --attach is likewise a fallback, not a hard failure.
		const explicit = await resolveStartupTransport(
			{
				attach: true,
				backendUrl: "http://127.0.0.1:1",
				messages: [],
				fileArgs: [],
				unrecognizedFlags: [],
				invalidFlagValues: [],
				unknownFlags: new Map(),
			},
			["--attach"],
			{ interactive: true, fetchImpl: unreachable as unknown as typeof fetch, timeoutMs: 50 },
		);
		expect(explicit.kind).toBe("in-process");
	});
});

/**
 * Project/repo routing for the IM bridge.
 *
 * The default IM connection lands in the default workspace. A chat may instead
 * be bound to a repository — directly (`@workspace bind`) or through a PM/bot
 * session (`!session new <name> project:<alias>`) — and then every inbound
 * message, plan turn and tool call is scoped to that repository. These tests
 * pin the isolation guarantees:
 * - no binding → default workspace relay, never a random repo;
 * - an explicit project binding → that repo's session, with its cwd;
 * - a project-bound session cannot delegate into another repo;
 * - two repos on one channel keep their own routes and replies;
 * - a PM session routes by its project, not by the global default workspace.
 */

import { afterEach, describe, expect, test, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { IrcMessage } from "@linxiraos/pi-channels";
import { SessionRouter } from "../../src/channels/session-router";
import { WebConfig } from "../../src/config/web-config";
import type { LoadExtensionsResult } from "../../src/extensibility/extensions/types";
import * as sdk from "../../src/sdk";
import { SessionManager } from "../../src/session/session-manager";
import type { AgentSession } from "../../src/session/agent-session";
import type { AgentSessionEvent } from "../../src/session/agent-session-events";
import { EventBus } from "../../src/utils/event-bus";

interface StubSession {
	session: AgentSession;
	deliveries: IrcMessage[];
}

/** Stub target session: records deliveries and emits one `turn_end` reply. */
function makeDeliveringStub(agentId: string, reply = "delegated task done"): StubSession {
	const listeners = new Set<(event: AgentSessionEvent) => void>();
	const deliveries: IrcMessage[] = [];
	const session = {
		getAgentId: () => agentId,
		subscribe: (listener: (event: AgentSessionEvent) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		deliverIrcMessage: async (msg: IrcMessage) => {
			deliveries.push(msg);
			queueMicrotask(() => {
				for (const listener of listeners) {
					listener({
						type: "turn_end",
						message: { role: "assistant", content: [{ type: "text", text: reply }] },
						toolResults: [],
					} as unknown as AgentSessionEvent);
				}
			});
			return "woken" as const;
		},
		// No setIrcWakeTurnObserver: the bridge's ordered fallback correlates the reply.
		agent: { state: { systemPrompt: [] as string[] }, setSystemPrompt: () => {} },
		dispose: async () => {},
	} as unknown as AgentSession;
	return { session, deliveries };
}

interface Harness {
	router: SessionRouter;
	webConfig: WebConfig;
	sent: Array<{ channelId: string; peer: string; text: string }>;
	coordinatorDeliveries: IrcMessage[];
	/** `cwd` values handed to `createAgentSession`, in call order. */
	createdCwds: Array<string | undefined>;
}

async function makeHarness(defaultCwd: string, configDir: string): Promise<Harness> {
	const webConfig = await WebConfig.load(join(configDir, "web.yml"));
	const sent: Array<{ channelId: string; peer: string; text: string }> = [];
	const coordinatorDeliveries: IrcMessage[] = [];
	const createdCwds: Array<string | undefined> = [];
	const byCwd = new Map<string, StubSession>();
	const stubFor = (cwd: string): StubSession => {
		let stub = byCwd.get(cwd);
		if (!stub) {
			stub = makeDeliveringStub(`agent-${basename(cwd)}`);
			byCwd.set(cwd, stub);
		}
		return stub;
	};
	vi.spyOn(sdk, "createAgentSession").mockImplementation(async agentOptions => {
		const cwd = agentOptions?.cwd;
		createdCwds.push(cwd);
		const stub = stubFor(cwd ?? "");
		return {
			session: stub.session,
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		};
	});
	const router = new SessionRouter({
		coordinator: {
			getAgentId: () => "coordinator",
			deliverIrcMessage: async (msg: IrcMessage) => {
				coordinatorDeliveries.push(msg);
				return "woken" as const;
			},
		} as unknown as AgentSession,
		webConfig,
		getLastInbound: () => null,
		sendText: async (channelId, peer, text) => {
			sent.push({ channelId, peer, text });
		},
		defaultCwd,
	});
	return { router, webConfig, sent, coordinatorDeliveries, createdCwds };
}

describe("IM project routing", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		vi.restoreAllMocks();
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	async function setup(): Promise<{
		harness: Harness;
		defaultDir: string;
		repoA: string;
		repoB: string;
	}> {
		const root = await mkdtemp(join(tmpdir(), "zeta-project-"));
		cleanups.push(() => rm(root, { recursive: true, force: true }));
		const defaultDir = await mkdtemp(join(root, "default-"));
		const repoA = await mkdtemp(join(root, "repo-a-"));
		const repoB = await mkdtemp(join(root, "repo-b-"));
		const harness = await makeHarness(defaultDir, root);
		cleanups.push(async () => {
			await harness.router.stopAll();
		});
		return { harness, defaultDir, repoA, repoB };
	}

	test("an unbound chat lands in the default workspace, not a repository", async () => {
		const { harness, defaultDir } = await setup();

		expect(await harness.router.resolveChatTarget("telegram", "unbound")).toEqual({ kind: "relay" });

		const created = await harness.router.createBotSession("default-bot");
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(created.entry.cwd).toBe(defaultDir);
		expect(created.entry.workspaceAlias).toBeUndefined();
		expect(created.entry.sessionFile.startsWith(SessionManager.getDefaultSessionDir(defaultDir))).toBe(true);
		// Its runtime is materialized in the default workspace.
		expect(harness.createdCwds.at(-1)).toBe(defaultDir);
	});

	test("a PM session bound to a repo runs in that repo and routes by it", async () => {
		const { harness, defaultDir, repoA } = await setup();
		await harness.router.open(repoA, "web");

		const created = await harness.router.createBotSession("PM web", "bot", { alias: "web" });
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(created.entry.cwd).toBe(repoA);
		expect(created.entry.workspaceAlias).toBe("web");
		expect(created.entry.sessionFile.startsWith(SessionManager.getDefaultSessionDir(repoA))).toBe(true);
		// The runtime (not the default workspace) is opened in the repo.
		expect(harness.createdCwds.at(-1)).toBe(repoA);
		expect(harness.createdCwds.at(-1)).not.toBe(defaultDir);

		await harness.router.setActiveBotSession("telegram", "pm-chat", created.entry.id);
		expect(await harness.router.resolveChatTarget("telegram", "pm-chat")).toEqual({
			kind: "bot",
			id: created.entry.id,
		});
		const target = await harness.router.resolveChatTargetSession("telegram", "pm-chat");
		expect(target).toMatchObject({ ok: true, id: created.entry.id });

		const status = await harness.router.statusSnapshot("telegram", "pm-chat");
		expect(status.workspaceDir).toBe(repoA);
		expect(status.workspaceAlias).toBe("web");
		// Routing by project never touches the default workspace coordinator.
		expect(harness.coordinatorDeliveries).toEqual([]);
	});

	test("a project-bound session cannot delegate into another repo", async () => {
		const { harness, repoA, repoB } = await setup();
		await harness.router.open(repoA, "a");
		await harness.router.open(repoB, "b");
		const created = await harness.router.createBotSession("PM a", "bot", { alias: "a" });
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const caller = { sessionKey: created.entry.id, projectDir: repoA, workspaceAlias: "a" };

		expect((await harness.router.run("b", "task", caller)).reply).toContain("cross-project access denied");
		expect((await harness.router.run(repoB, "task", caller)).reply).toContain("cross-project access denied");

		// Its own project is allowed (the target session materializes lazily).
		expect((await harness.router.run("a", "task", caller)).reply).toBe(`[${basename(repoA)}] delegated task done`);

		// An arbitrary, unregistered directory is refused even for the relay.
		const stray = await mkdtemp(join(tmpdir(), "zeta-project-stray-"));
		cleanups.push(() => rm(stray, { recursive: true, force: true }));
		const relayCaller = { sessionKey: "coordinator", projectDir: repoA, relay: true };
		expect((await harness.router.run(stray, "task", relayCaller)).reply).toContain("is not registered");

		// The relay coordinator keeps its documented cross-repo delegation role.
		expect((await harness.router.run("b", "task", relayCaller)).reply).toBe(
			`[${basename(repoB)}] delegated task done`,
		);
	});

	test("two repos on one channel keep separate routes and replies", async () => {
		const { harness, repoA, repoB } = await setup();
		await harness.router.open(repoA, "a");
		await harness.router.open(repoB, "b");
		await harness.router.bindChat("telegram", "chat-a", "a");
		const created = await harness.router.createBotSession("PM b", "bot", { alias: "b" });
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		await harness.router.setActiveBotSession("telegram", "chat-b", created.entry.id);

		expect(await harness.router.resolveChatTarget("telegram", "chat-a")).toEqual({
			kind: "workspace",
			alias: "a",
		});
		expect(await harness.router.resolveChatTarget("telegram", "chat-b")).toEqual({
			kind: "bot",
			id: created.entry.id,
		});

		expect(await harness.router.deliverDirect("a", "telegram", "chat-a", "question a")).toEqual({ ok: true });
		expect(await harness.router.deliverToBotSession(created.entry.id, "telegram", "chat-b", "question b")).toEqual({
			ok: true,
		});
		expect(harness.sent).toEqual([
			{ channelId: "telegram", peer: "chat-a", text: "delegated task done" },
			{ channelId: "telegram", peer: "chat-b", text: "delegated task done" },
		]);
	});

	test("rebinding a session moves its transcript into the new project", async () => {
		const { harness, repoA, repoB } = await setup();
		await harness.router.open(repoA, "a");
		await harness.router.open(repoB, "b");
		const created = await harness.router.createBotSession("PM", "bot", { alias: "a" });
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		const bound = await harness.router.bindBotSessionProject(created.entry.id, "b");
		expect(bound.ok).toBe(true);
		if (!bound.ok) return;
		expect(bound.cwd).toBe(repoB);
		const entry = harness.router.botSession(created.entry.id);
		expect(entry?.cwd).toBe(repoB);
		expect(entry?.workspaceAlias).toBe("b");
		expect(entry?.sessionFile.startsWith(SessionManager.getDefaultSessionDir(repoB))).toBe(true);

		// A recreated runtime opens in the new repo, not the old one.
		const ensured = await harness.router.ensureBotSession(entry!);
		expect(ensured.ok).toBe(true);
		expect(harness.createdCwds.at(-1)).toBe(repoB);
	});

	test("channel_send from a project session rejects a peer outside allowedPeers", async () => {
		const { harness } = await setup();
		await harness.webConfig.set("channels.allowedPeers", ["owner-chat"]);

		await expect(
			harness.router.push(
				{ text: "leak", to: "stranger-chat", channel: "telegram" },
				{ sessionKey: "bot-x", projectDir: "/tmp", workspaceAlias: "x" },
			),
		).rejects.toThrow("not in channels.allowedPeers");

		await harness.router.push({ text: "ok", to: "owner-chat", channel: "telegram" });
		expect(harness.sent.at(-1)).toEqual({
			channelId: "telegram",
			peer: "owner-chat",
			text: "ok",
		});
	});
});

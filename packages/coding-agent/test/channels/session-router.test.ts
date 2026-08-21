/**
 * SessionRouter contracts — multi-workspace registration plus the delegated
 * `workspace_run` reply path (`[name] <reply>` prefix), verified with stubbed
 * target sessions so the observable delegation contract is pinned without a
 * live agent/model.
 */

import { afterEach, describe, expect, test, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { join } from "node:path";
import { SessionRouter } from "../../src/channels/session-router";
import { WebConfig } from "../../src/config/web-config";
import type { LoadExtensionsResult } from "../../src/extensibility/extensions/types";
import * as sdk from "../../src/sdk";
import type { AgentSession } from "../../src/session/agent-session";
import type { AgentSessionEvent } from "../../src/session/agent-session-events";
import { EventBus } from "../../src/utils/event-bus";

/** Stub target session: delivers IRC messages, emits a `turn_end` reply. */
function makeStubSession(agentId: string): AgentSession {
	const listeners = new Set<(event: AgentSessionEvent) => void>();
	return {
		getAgentId: () => agentId,
		subscribe: (listener: (event: AgentSessionEvent) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		deliverIrcMessage: async () => {
			queueMicrotask(() => {
				for (const listener of listeners) {
					listener({
						type: "turn_end",
						turnIndex: 1,
						message: {
							role: "assistant",
							content: [{ type: "text", text: "delegated task done" }],
						},
						toolResults: [],
					} as unknown as AgentSessionEvent);
				}
			});
			return "woken" as const;
		},
		dispose: async () => {},
	} as unknown as AgentSession;
}

describe("SessionRouter", () => {
	const cleanups: Array<() => Promise<void>> = [];
	let webConfig: WebConfig;

	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	});

	async function makeRouter(dirs: string[]): Promise<SessionRouter> {
		webConfig = await WebConfig.load(join(await mkdtemp(join(tmpdir(), "zeta-router-")), "web.yml"));
		const coordinator = { getAgentId: () => "coordinator" } as unknown as AgentSession;
		const router = new SessionRouter({
			coordinator,
			webConfig,
			getLastInbound: () => null,
			sendText: async () => {},
		});
		cleanups.push(async () => {
			await router.stopAll();
		});
		// open() creates real AgentSessions via createAgentSession; stub that so
		// registration and the delegation path are exercised in isolation.
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async options => ({
			session: makeStubSession(`agent-${path.basename(options?.cwd ?? "")}`),
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		for (const dir of dirs) {
			const result = await router.open(dir);
			expect(result.ok).toBe(true);
		}
		return router;
	}

	test("open/list registers multiple workspace sessions and persists in web.yml", async () => {
		const dir1 = await mkdtemp(join(tmpdir(), "zeta-repo1-"));
		const dir2 = await mkdtemp(join(tmpdir(), "zeta-repo2-"));
		cleanups.push(() => rm(dir1, { recursive: true, force: true }));
		cleanups.push(() => rm(dir2, { recursive: true, force: true }));

		const router = await makeRouter([dir1, dir2]);

		expect(
			router
				.list()
				.map(e => e.alias)
				.sort(),
		).toEqual([path.basename(dir1), path.basename(dir2)].sort());
		expect(webConfig.getWorkspaces().map(e => e.path)).toEqual([dir1, dir2]);
	});

	test("run() delegates a task and prefixes the reply with the workspace name", async () => {
		const dir1 = await mkdtemp(join(tmpdir(), "zeta-repo1-"));
		const dir2 = await mkdtemp(join(tmpdir(), "zeta-repo2-"));
		cleanups.push(() => rm(dir1, { recursive: true, force: true }));
		cleanups.push(() => rm(dir2, { recursive: true, force: true }));

		const router = await makeRouter([dir1, dir2]);

		const result = await router.run(path.basename(dir2), "implement the auth flow");
		expect(result.reply).toBe(`[${path.basename(dir2)}] delegated task done`);
	});

	test("run() reports unknown workspaces and close() removes a registration", async () => {
		const dir1 = await mkdtemp(join(tmpdir(), "zeta-repo1-"));
		cleanups.push(() => rm(dir1, { recursive: true, force: true }));

		const router = await makeRouter([dir1]);

		expect((await router.run("nope", "task")).reply).toBe('workspace_run: unknown workspace "nope"');

		await router.close(path.basename(dir1));
		expect(router.list()).toEqual([]);
		expect(webConfig.getWorkspaces()).toEqual([]);
	});

	test("aliases, rename and the reserved coordinator alias are enforced", async () => {
		const dir1 = await mkdtemp(join(tmpdir(), "zeta-repo1-"));
		cleanups.push(() => rm(dir1, { recursive: true, force: true }));

		webConfig = await WebConfig.load(join(await mkdtemp(join(tmpdir(), "zeta-router-")), "web.yml"));
		const router = new SessionRouter({
			coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
			webConfig,
			getLastInbound: () => null,
			sendText: async () => {},
		});
		cleanups.push(async () => {
			await router.stopAll();
		});
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async options => ({
			session: makeStubSession(`agent-${path.basename(options?.cwd ?? "")}`),
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));

		const opened = await router.open(dir1, "web");
		expect(opened).toEqual({ ok: true, alias: "web" });

		expect((await router.open(dir1, "main")).ok).toBe(false);
		expect((await router.rename("web", "main")).ok).toBe(false);

		const renamed = await router.rename("web", "frontend");
		expect(renamed).toEqual({ ok: true, alias: "frontend" });
		expect(router.resolveDir("frontend")).toBe(dir1);
		expect(router.resolveDir("web")).toBeUndefined();
	});

	test("runtime + persisted bindings route a chat direct to a workspace", async () => {
		const dir1 = await mkdtemp(join(tmpdir(), "zeta-repo1-"));
		cleanups.push(() => rm(dir1, { recursive: true, force: true }));

		const router = await makeRouter([dir1]);
		const alias = path.basename(dir1);

		// Unbound → relay.
		expect(await router.resolveRoute("wechat", "peer-a")).toBe("relay");

		// Runtime override from `@workspace use`.
		await router.setRuntimeBinding("wechat", "peer-a", alias);
		expect(await router.resolveRoute("wechat", "peer-a")).toBe("direct");
		expect(await router.bindingFor("wechat", "peer-a")).toBe(alias);

		// Back to relay.
		await router.setRuntimeBinding("wechat", "peer-a", "main");
		expect(await router.resolveRoute("wechat", "peer-a")).toBe("relay");

		// Persisted binding via bindChat survives a fresh router.
		const bound = await router.bindChat("wechat", "peer-b", alias);
		expect(bound).toEqual({ ok: true, alias });

		const router2 = new SessionRouter({
			coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
			webConfig,
			getLastInbound: () => null,
			sendText: async () => {},
		});
		cleanups.push(async () => {
			await router2.stopAll();
		});
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async options => ({
			session: makeStubSession(`agent-${path.basename(options?.cwd ?? "")}`),
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		expect(await router2.resolveRoute("wechat", "peer-b")).toBe("direct");
		expect(await router2.bindingFor("wechat", "peer-b")).toBe(alias);

		// Unbind removes it.
		expect(await router2.unbindChat("wechat", "peer-b")).toBe(true);
		expect(await router2.resolveRoute("wechat", "peer-b")).toBe("relay");
	});

	test("deliverDirect injects into the bound session and routes its reply to the chat", async () => {
		const dir1 = await mkdtemp(join(tmpdir(), "zeta-repo1-"));
		cleanups.push(() => rm(dir1, { recursive: true, force: true }));

		const sent: Array<{ channelId: string; peer: string; text: string }> = [];
		webConfig = await WebConfig.load(join(await mkdtemp(join(tmpdir(), "zeta-router-")), "web.yml"));
		const router = new SessionRouter({
			coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
			webConfig,
			getLastInbound: () => null,
			sendText: async (channelId, peer, text) => {
				sent.push({ channelId, peer, text });
			},
		});
		cleanups.push(async () => {
			await router.stopAll();
		});
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async options => ({
			session: makeStubSession(`agent-${path.basename(options?.cwd ?? "")}`),
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));

		await router.open(dir1, "web");
		await router.setRuntimeBinding("feishu", "oc-chat-1", "web");
		expect(await router.resolveRoute("feishu", "oc-chat-1")).toBe("direct");

		const delivered = await router.deliverDirect("web", "feishu", "oc-chat-1", "hello direct");
		expect(delivered).toEqual({ ok: true });
		await new Promise(resolve => setTimeout(resolve, 10));
		expect(sent).toEqual([{ channelId: "feishu", peer: "oc-chat-1", text: "delegated task done" }]);
	});

	// ------------------------------------------------------------------
	// Default-space bot sessions (`!session` / `!lang`)
	// ------------------------------------------------------------------

	/** Stub bot session: records system-prompt writes, emits a turn_end reply. */
	function makeBotSession(agentId: string, initialPrompt: string[] = []): AgentSession & { prompts: string[][] } {
		const listeners = new Set<(event: AgentSessionEvent) => void>();
		const prompts: string[][] = [initialPrompt];
		return {
			prompts,
			getAgentId: () => agentId,
			agent: {
				state: {
					get systemPrompt() {
						return prompts[prompts.length - 1];
					},
				},
				setSystemPrompt: (v: string[] | string) => {
					prompts.push(typeof v === "string" ? [v] : v);
				},
			},
			subscribe: (listener: (event: AgentSessionEvent) => void) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			deliverIrcMessage: async () => {
				queueMicrotask(() => {
					for (const listener of listeners) {
						listener({
							type: "turn_end",
							turnIndex: 1,
							message: {
								role: "assistant",
								content: [{ type: "text", text: "bot reply" }],
							},
							toolResults: [],
						} as unknown as AgentSessionEvent);
					}
				});
				return "woken" as const;
			},
			dispose: async () => {},
		} as unknown as AgentSession & { prompts: string[][] };
	}

	async function makeBotRouter(): Promise<{ router: SessionRouter; config: WebConfig }> {
		const config = await WebConfig.load(join(await mkdtemp(join(tmpdir(), "zeta-bot-")), "web.yml"));
		const router = new SessionRouter({
			coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
			webConfig: config,
			getLastInbound: () => null,
			sendText: async () => {},
			defaultCwd: await mkdtemp(join(tmpdir(), "zeta-bot-cwd-")),
		});
		cleanups.push(async () => {
			await router.stopAll();
		});
		return { router, config };
	}

	test("ensureRelaySession registers a protected relay entry once", async () => {
		const { router, config } = await makeBotRouter();
		await router.ensureRelaySession("/tmp/zeta-bot.jsonl");
		expect(config.getBotSession("relay")).toMatchObject({ id: "relay", tag: "relay" });
		// Idempotent.
		await router.ensureRelaySession("/tmp/zeta-bot.jsonl");
		expect(config.getBotSessions()).toHaveLength(1);
	});

	test("createBotSession registers a draft session and materializes its transcript", async () => {
		const { router, config } = await makeBotRouter();
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async () => ({
			session: makeBotSession("bot-1", []),
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		const created = await router.createBotSession("scratch", "draft");
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const entry = config.getBotSession(created.entry.id);
		expect(entry).toMatchObject({ id: created.entry.id, name: "scratch", tag: "draft" });
		// The transcript file exists (materialized on open) so the web UI sees it.
		const stat = await import("node:fs/promises").then(fs2 => fs2.stat(entry!.sessionFile).catch(() => null));
		expect(stat?.isFile()).toBe(true);
	});

	test("!session use routes the chat to the bot session; deliverToBotSession returns its reply", async () => {
		const sent: string[] = [];
		const config = await WebConfig.load(join(await mkdtemp(join(tmpdir(), "zeta-bot-")), "web.yml"));
		const router = new SessionRouter({
			coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
			webConfig: config,
			getLastInbound: () => null,
			sendText: async (_c, _p, text) => {
				sent.push(text);
			},
			defaultCwd: await mkdtemp(join(tmpdir(), "zeta-bot-cwd2-")),
		});
		cleanups.push(async () => {
			await router.stopAll();
		});
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async () => ({
			session: makeBotSession("bot-1", []),
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		await router.ensureRelaySession("/tmp/zeta-bot.jsonl");
		const created = await router.createBotSession("test");
		if (!created.ok) throw new Error("create failed");
		const id = created.entry.id;

		expect(await router.activeBotSessionIdFor("wechat", "peer-a")).toBeNull();
		const switched = await router.setActiveBotSession("wechat", "peer-a", id);
		expect(switched).toEqual({ ok: true, id });
		expect(await router.activeBotSessionIdFor("wechat", "peer-a")).toBe(id);

		const delivered = await router.deliverToBotSession(id, "wechat", "peer-a", "hello bot");
		expect(delivered).toEqual({ ok: true });
		await new Promise(resolve => setTimeout(resolve, 10));
		expect(sent).toEqual(["bot reply"]);
	});

	test("!lang applies a language line to the bot session system prompt", async () => {
		let bot: (AgentSession & { prompts: string[][] }) | null = null;
		const { router } = await makeBotRouter();
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async () => {
			bot = makeBotSession("bot-1", ["base prompt"]);
			return {
				session: bot,
				extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
				setToolUIContext: () => {},
				eventBus: new EventBus(),
			};
		});
		await router.ensureRelaySession("/tmp/zeta-bot.jsonl");
		const created = await router.createBotSession("test");
		if (!created.ok) throw new Error("create failed");
		const id = created.entry.id;
		await router.setActiveBotSession("wechat", "peer-a", id);

		await router.setLanguage("wechat", "peer-a", "zh");
		expect(await router.languageFor("wechat", "peer-a")).toBe("zh");

		// Language is applied at delivery time: the session system prompt gains
		// exactly one language line (idempotent across deliveries).
		await router.deliverToBotSession(id, "wechat", "peer-a", "hi");
		await router.deliverToBotSession(id, "wechat", "peer-a", "again");
		const lastPrompt = bot!.prompts[bot!.prompts.length - 1];
		expect(lastPrompt).toContain("Reply in Simplified Chinese.");
		expect(lastPrompt.filter(p => p === "Reply in Simplified Chinese.")).toHaveLength(1);

		// Switching to English replaces the directive.
		await router.setLanguage("wechat", "peer-a", "en");
		await router.deliverToBotSession(id, "wechat", "peer-a", "hello");
		const enPrompt = bot!.prompts[bot!.prompts.length - 1];
		expect(enPrompt).toContain("Reply in English.");
		expect(enPrompt.some(p => p === "Reply in Simplified Chinese.")).toBe(false);
	});

	test("deleteBotSession rejects the relay session and removes non-relay sessions + their transcript", async () => {
		const { router, config } = await makeBotRouter();
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async () => ({
			session: makeBotSession("bot-1", []),
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		await router.ensureRelaySession("/tmp/zeta-bot.jsonl");

		// Relay is protected.
		expect((await router.deleteBotSession("relay")).ok).toBe(false);

		const created = await router.createBotSession("temp");
		if (!created.ok) throw new Error("create failed");
		const id = created.entry.id;
		await router.setActiveBotSession("wechat", "peer-a", id);
		const file = config.getBotSession(id)!.sessionFile;

		const removed = await router.deleteBotSession(id);
		expect(removed).toEqual({ ok: true });
		expect(config.getBotSession(id)).toBeUndefined();
		// Transcript removed.
		const stat = await import("node:fs/promises").then(fs2 => fs2.stat(file).catch(() => null));
		expect(stat).toBeNull();
		// Chat pointer cleared → falls back to relay.
		expect(await router.activeBotSessionIdFor("wechat", "peer-a")).toBeNull();
	});

	test("!session use relay drops the chat pointer back to the relay", async () => {
		const { router } = await makeBotRouter();
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async () => ({
			session: makeBotSession("bot-1", []),
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		await router.ensureRelaySession("/tmp/zeta-bot.jsonl");
		const created = await router.createBotSession("test");
		if (!created.ok) throw new Error("create failed");
		await router.setActiveBotSession("wechat", "peer-a", created.entry.id);
		expect(await router.activeBotSessionIdFor("wechat", "peer-a")).toBe(created.entry.id);
		const back = await router.setActiveBotSession("wechat", "peer-a", "relay");
		expect(back).toEqual({ ok: true, id: "relay" });
		expect(await router.activeBotSessionIdFor("wechat", "peer-a")).toBeNull();
	});
});

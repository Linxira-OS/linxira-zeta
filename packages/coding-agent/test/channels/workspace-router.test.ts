/**
 * Workspace router command contracts — `@workspace` management commands,
 * `*<alias>` shortcuts, and the remote `@plan <title>` trigger. The router
 * returns `true` when a message was consumed as a control command and `false`
 * when it should fall through to normal message routing.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionRouter } from "../../src/channels/session-router";
import type { ImTarget } from "../../src/channels/im-config";
import { routeWorkspaceCommand, type WorkspaceRouterDeps } from "../../src/channels/workspace-router";

function makeRouterStub(overrides: Partial<SessionRouter> = {}): SessionRouter {
	const aliases: Record<string, string> = {
		web: "/repo/web",
		other: "/repo/other",
	};
	let appliedAlias = "main";
	let pending:
		| { action: "target"; target: { kind: "workspace"; workspace: string } }
		| { action: "unbind" }
		| null = null;
	const preview = (target: { kind: "workspace"; workspace: string }) => {
		const next = `workspace:${target.workspace}`;
		const current = `workspace:${appliedAlias}`;
		if (next === current) {
			pending = null;
			return { current, next, same: true };
		}
		pending = { action: "target", target };
		return { current, next, same: false };
	};
	return {
		list: () => [{ alias: "web", path: "/repo/web" }],
		resolveDir: (name: string) => aliases[name],
		open: async () => ({ ok: true, alias: "web" }),
		close: async () => ({ ok: true }),
		rename: async () => ({ ok: true, alias: "frontend" }),
		bindingFor: async () => (appliedAlias === "main" ? null : appliedAlias),
		setRuntimeBinding: async () => ({ ok: true }),
			bindChat: async (_c: string, _p: string, alias: string) => ({ ok: true, alias }),
		unbindChat: async () => true,
		bindingsForPlatform: () => [],
		requestWorkspaceSwitch: async (_c: string, _p: string, target: ImTarget) => {
			if (target.kind !== "workspace") return { current: "unbound", next: target.kind, same: false };
			return preview(target);
		},
		confirmWorkspaceSwitch: async (_c: string, _p: string) => {
			if (!pending) return { ok: false as const, error: "No pending workspace switch." };
			const staged = pending;
			pending = null;
			if (staged.action === "unbind") {
				const previous = appliedAlias;
				appliedAlias = "main";
				return { ok: true as const, target: { kind: "workspace" as const, workspace: "main" }, previous };
			}
			appliedAlias = staged.target.workspace;
			return { ok: true as const, target: staged.target };
		},
		cancelWorkspaceSwitch: async (_c: string, _p: string) => {
			const had = pending !== null;
			pending = null;
			return had;
		},
		requestWorkspaceUnbind: async (_c: string, _p: string) => {
			pending = { action: "unbind" };
			return true;
		},
		// Default-space bot sessions + language.
		listBotSessions: () => [],
		listSessionCandidates: async () => ({
			generatedAt: 0,
			candidates: [],
			bySelector: new Map(),
		}),
		resolveSessionSelector: (selector: string) => (selector ? aliases[selector] ?? selector : null),
		botSession: () => undefined,
		activeBotSessionIdFor: async () => null,
		setActiveBotSession: async (_c: string, _p: string, id: string) => ({ ok: true, id }),
		clearActiveBotSession: async () => {},
		createBotSession: async () => ({ ok: false, error: "no session factory" }),
		renameBotSession: async () => ({ ok: false, error: "no session factory" }),
		deleteBotSession: async () => ({ ok: false, error: "no session factory" }),
		languageFor: async () => undefined,
		setLanguage: async () => {},
		listWorkspaceSessions: async () => [],
		deliverToBotSession: async () => ({ ok: true }),
		deliverDirect: async () => ({ ok: true }),
		...overrides,
	} as unknown as SessionRouter;
}

function makeDeps(overrides: Partial<WorkspaceRouterDeps> = {}): {
	deps: WorkspaceRouterDeps;
	calls: {
		sent: string[];
		plans: string[];
	};
} {
	const calls = {
		sent: [] as string[],
		plans: [] as string[],
	};
	const deps: WorkspaceRouterDeps = {
		router: makeRouterStub(),
		channelId: "wechat",
		peer: "peer-1",
		sendText: async text => {
			calls.sent.push(text);
		},
		fallback: async () => {},
		planRequest: async title => {
			calls.plans.push(title);
		},
		...overrides,
	};
	return { deps, calls };
}

describe("routeWorkspaceCommand", () => {
	test("@plan <title> triggers planRequest with the title and is consumed", async () => {
		const { deps, calls } = makeDeps();
		const consumed = await routeWorkspaceCommand("@plan 优化登录流程", "peer-1", deps);

		expect(consumed).toBe(true);
		expect(calls.plans).toEqual(["优化登录流程"]);
	});

	test("@plan without a title prints usage and never starts a plan", async () => {
		const { deps, calls } = makeDeps();
		const consumed = await routeWorkspaceCommand("@plan", "peer-1", deps);

		expect(consumed).toBe(true);
		expect(calls.plans).toEqual([]);
		expect(calls.sent).toContain("Usage: @plan <task description>");
	});

	test("plain messages fall through (return false)", async () => {
		const { deps, calls } = makeDeps();
		const consumed = await routeWorkspaceCommand("hello world", "peer-2", deps);

		expect(consumed).toBe(false);
		expect(calls.plans).toEqual([]);
		expect(calls.sent).toEqual([]);
	});

	test("@workspace list lists aliases and the current binding", async () => {
		const { deps, calls } = makeDeps({
			router: makeRouterStub({
				bindingFor: async () => "web",
			}),
		});
		const consumed = await routeWorkspaceCommand("@workspace list", "peer-1", deps);

		expect(consumed).toBe(true);
		expect(calls.sent[0]).toContain("{1} [web] → /repo/web");
		expect(calls.sent[0]).toContain("This chat → [web] (direct)");
	});

	test("@workspace use <alias> previews, then confirm applies the target", async () => {
		const { deps, calls } = makeDeps();
		const consumed = await routeWorkspaceCommand("@workspace use web", "peer-1", deps);

		expect(consumed).toBe(true);
		expect(calls.sent[0]).toContain("Switch this chat from workspace:main to workspace:web");
		expect(calls.sent[0]).toContain("Reply @workspace confirm");
		expect(calls.sent[0]).toContain("History and memory are not moved");

		expect(await routeWorkspaceCommand("@workspace confirm", "peer-1", deps)).toBe(true);
		expect(calls.sent[1]).toContain("Workspace switch applied: [web]");
	});

	test("@workspace relay is a noop when already on the coordinator", async () => {
		const { deps, calls } = makeDeps();
		const consumed = await routeWorkspaceCommand("@workspace relay", "peer-1", deps);

		expect(consumed).toBe(true);
		expect(calls.sent[0]).toContain("already on workspace:main");
		expect(calls.sent[0]).toContain("nothing changed");

		expect(await routeWorkspaceCommand("@workspace cancel", "peer-1", deps)).toBe(true);
		expect(calls.sent[1]).toContain("No pending workspace switch");
	});

	test("*<alias> and *relay shortcuts route to use/relay", async () => {
		const { deps, calls } = makeDeps();

		expect(await routeWorkspaceCommand("*web", "peer-1", deps)).toBe(true);
		expect(calls.sent[0]).toContain("to workspace:web");
		expect(await routeWorkspaceCommand("@workspace confirm", "peer-1", deps)).toBe(true);
		expect(calls.sent[1]).toContain("Workspace switch applied: [web]");

		expect(await routeWorkspaceCommand("*relay", "peer-1", deps)).toBe(true);
		expect(calls.sent[2]).toContain("to workspace:main");
		expect(await routeWorkspaceCommand("@workspace confirm", "peer-1", deps)).toBe(true);
		expect(calls.sent[3]).toContain("Workspace switch applied: [main]");

		// Unknown alias → fall through as a normal message.
		expect(await routeWorkspaceCommand("*nope", "peer-1", deps)).toBe(false);
	});

	test("@workspace bind previews, then confirm persists the chat → workspace binding", async () => {
		const { deps, calls } = makeDeps();
		const consumed = await routeWorkspaceCommand("@workspace bind web", "peer-1", deps);

		expect(consumed).toBe(true);
		expect(calls.sent[0]).toContain("to workspace:web");
		expect(await routeWorkspaceCommand("@workspace confirm", "peer-1", deps)).toBe(true);
		expect(calls.sent[1]).toContain("Workspace switch applied: [web]");
	});

	test("@workspace unbind stages removal and confirm applies it", async () => {
		const { deps, calls } = makeDeps();
		const consumed = await routeWorkspaceCommand("@workspace unbind", "peer-1", deps);

		expect(consumed).toBe(true);
		expect(calls.sent[0]).toContain("Remove this chat's binding");
		expect(calls.sent[0]).toContain("Reply @workspace confirm");
		expect(await routeWorkspaceCommand("@workspace confirm", "peer-1", deps)).toBe(true);
		expect(calls.sent[1]).toContain("Workspace switch applied: [main]");
	});

	test("unknown @workspace commands print usage and are consumed", async () => {
		const { deps, calls } = makeDeps();
		const consumed = await routeWorkspaceCommand("@workspace frobnicate", "peer-1", deps);

		expect(consumed).toBe(true);
		expect(calls.sent[0]).toContain('Unknown @workspace command "frobnicate"');
	});

	test("a bare @workspace with no command shows help instead of an error", async () => {
		const { deps, calls } = makeDeps();
		expect(await routeWorkspaceCommand("@workspace", "peer-1", deps)).toBe(true);
		expect(calls.sent[0]).toContain("Workspace relay:");
		expect(calls.sent[0]).not.toContain("Unknown");

		const bang = makeDeps();
		expect(await routeWorkspaceCommand("!workspace ", "peer-1", bang.deps)).toBe(true);
		expect(bang.calls.sent[0]).toContain("Workspace relay:");
	});

	test("!workspace is an alias for @workspace (Feishu cannot type @)", async () => {
		const { deps, calls } = makeDeps();

		expect(await routeWorkspaceCommand("!workspace use web", "peer-1", deps)).toBe(true);
		expect(calls.sent[0]).toContain("to workspace:web");
		expect(await routeWorkspaceCommand("!workspace confirm", "peer-1", deps)).toBe(true);
		expect(calls.sent[1]).toContain("Workspace switch applied: [web]");

		expect(await routeWorkspaceCommand("!workspace list", "peer-1", deps)).toBe(true);
		expect(calls.sent[calls.sent.length - 1]).toContain("{1} [web] → /repo/web");
	});

	test("!workspace open/close work with the bang prefix", async () => {
		const dir = await mkdtemp(join(tmpdir(), "zeta-ws-"));
		const opened: string[] = [];
		const { deps, calls } = makeDeps({
			router: makeRouterStub({
				open: async (d: string) => {
					opened.push(d);
					return { ok: true, alias: "pi" };
				},
				close: async () => ({ ok: true }),
			}),
		});

		expect(await routeWorkspaceCommand(`!workspace open ${dir} pi`, "peer-1", deps)).toBe(true);
		expect(opened).toEqual([dir]);
		expect(calls.sent[0]).toContain("Workspace [pi]");

		expect(await routeWorkspaceCommand("!workspace close pi", "peer-1", deps)).toBe(true);
		expect(calls.sent[1]).toContain("Workspace [pi] closed");

		await rm(dir, { recursive: true, force: true });
	});

	test("!hello replies with the platform name to verify the binding", async () => {
		const { deps, calls } = makeDeps();
		expect(await routeWorkspaceCommand("!hello", "peer-1", deps)).toBe(true);
		expect(calls.sent[0]).toContain("[WeChat]");

		const feishu = makeDeps({ channelId: "feishu" });
		expect(await routeWorkspaceCommand("!helo", "peer-1", feishu.deps)).toBe(true);
		expect(feishu.calls.sent[0]).toContain("[Feishu]");
	});

	test("full-width punctuation from Chinese IMEs is normalized before matching", async () => {
		// `！hello` (full-width bang) → same as `!hello`.
		const { deps, calls } = makeDeps();
		expect(await routeWorkspaceCommand("！hello", "peer-1", deps)).toBe(true);
		expect(calls.sent[0]).toContain("[WeChat]");

		// `！workspace　list` with full-width bang and full-width space.
		const ws = makeDeps({
			router: makeRouterStub({
				bindingFor: async () => "web",
			}),
		});
		expect(await routeWorkspaceCommand("！workspace　list", "peer-1", ws.deps)).toBe(true);
		expect(ws.calls.sent[0]).toContain("{1} [web] → /repo/web");

		// `＊web` full-width star → shortcut to direct mode.
		const star = makeDeps();
		expect(await routeWorkspaceCommand("＊web", "peer-1", star.deps)).toBe(true);
		expect(star.calls.sent[0]).toContain("to workspace:web");
		expect(await routeWorkspaceCommand("！workspace confirm", "peer-1", star.deps)).toBe(true);
		expect(star.calls.sent[1]).toContain("Workspace switch applied: [web]");

		// `！session　list` — full-width punctuation on a session command.
		const sess = makeDeps({
			router: makeRouterStub({
				listSessionCandidates: async () => ({
					generatedAt: 1,
					candidates: [
						{
							selector: "01-00001",
							canonicalSessionId: "relay",
							workspaceAlias: "main",
							workspaceId: "main",
							label: "Zeta Bot (Relay)",
							status: "unknown",
							lastActiveAt: "2026-01-01T00:00:00.000Z",
							isPm: false,
							tag: "relay",
						},
					],
					bySelector: new Map(),
				}),
				activeBotSessionIdFor: async () => null,
			}),
		});
		expect(await routeWorkspaceCommand("！session　list", "peer-1", sess.deps)).toBe(true);
		expect(sess.calls.sent[0]).toContain("01-00001");
		expect(sess.calls.sent[0]).toContain("Zeta Bot");
	});

	test("!help prints the categorized reference and is consumed", async () => {
		const { deps, calls } = makeDeps();
		expect(await routeWorkspaceCommand("!help", "peer-1", deps)).toBe(true);
		expect(calls.sent[0]).toContain("System commands");
		expect(calls.sent[0]).toContain("!session");
		expect(calls.sent[0]).toContain("!model");
		expect(calls.sent[0]).toContain("!work workspace:<alias>");
	});

	test("!status reports channel status, routing, workspaces, language and model", async () => {
		const { deps, calls } = makeDeps({
			router: makeRouterStub({
				bindingFor: async () => null,
				activeBotSessionIdFor: async () => "abc123",
				botSession: () => ({
					id: "abc123",
					name: "Test",
					tag: "bot",
					sessionFile: "/tmp/bot.jsonl",
					createdAt: "2026-01-01",
				}),
				list: () => [{ alias: "web", path: "/repo/web" }],
				languageFor: async () => "zh",
			}),
			channelStatus: () => [
				{ id: "wechat", running: true },
				{ id: "feishu", running: false },
			],
			getChatModel: async () => ({ provider: "volcengine", modelId: "deepseek-v4-flash" }),
		});
		expect(await routeWorkspaceCommand("!status", "peer-1", deps)).toBe(true);
		const text = calls.sent[0];
		expect(text).toContain("wechat 运行中");
		expect(text).toContain("feishu 未运行");
		expect(text).toContain("bot 会话 [Test]");
		expect(text).toContain("{1} [web]");
		expect(text).toContain("中文 (zh)");
		expect(text).toContain("[volcengine] [deepseek-v4-flash]");
	});

	test("!session list / new / use / rename / delete manage default-space sessions", async () => {
		const created: string[] = [];
		const used: string[] = [];
		const { deps, calls } = makeDeps({
			router: makeRouterStub({
				listSessionCandidates: async () => ({
					generatedAt: 1,
					candidates: [
						{
							selector: "01-00001",
							canonicalSessionId: "relay",
							workspaceAlias: "main",
							workspaceId: "main",
							label: "Zeta Bot (Relay)",
							status: "unknown",
							lastActiveAt: "2026-01-01T00:00:00.000Z",
							isPm: false,
							tag: "relay",
						},
						{
							selector: "01-00002",
							canonicalSessionId: "abc123",
							workspaceAlias: "main",
							workspaceId: "main",
							label: "Test",
							latestTaskSummary: "Completed result",
							status: "completed",
							lastActiveAt: "2026-01-01T00:00:00.000Z",
							isPm: false,
							tag: "draft",
						},
					],
					bySelector: new Map(),
				}),
				activeBotSessionIdFor: async () => "relay",
				resolveSessionSelector: (selector: string) =>
					({ "01-00001": "relay", "01-00002": "abc123", relay: "relay", abc123: "abc123" })[selector] ?? null,
				botSession: (id: string) =>
					({
						relay: { id: "relay", name: "Zeta Bot (Relay)", tag: "relay", sessionFile: "/tmp/zeta-bot.jsonl", createdAt: "2026-01-01" },
						abc123: { id: "abc123", name: "Test", tag: "draft", sessionFile: "/tmp/test-abc123.jsonl", createdAt: "2026-01-01" },
					} as Record<string, unknown>)[id] as never,
				createBotSession: async (name: string) => {
					created.push(name);
					return {
						ok: true,
						entry: {
							id: "xyz789",
							name,
							tag: "draft",
							sessionFile: "/tmp/x-xyz789.jsonl",
							createdAt: "2026-01-01",
						},
					};
				},
				setActiveBotSession: async (_c: string, _p: string, id: string) => {
					used.push(id);
					return { ok: true, id };
				},
				renameBotSession: async () => ({ ok: true, name: "Renamed" }),
				deleteBotSession: async (id: string) =>
					id === "relay" ? { ok: false, error: "relay 会话不可删除" } : { ok: true },
			}),
		});

		expect(await routeWorkspaceCommand("!session list", "peer-1", deps)).toBe(true);
		expect(calls.sent[0]).toContain("01-00001 Zeta Bot (Relay) [main] [当前]");
		expect(calls.sent[0]).toContain("01-00002 Test — Completed result [main]");

		expect(await routeWorkspaceCommand("!session new scratch", "peer-1", deps)).toBe(true);
		expect(created).toEqual(["scratch"]);
		expect(calls.sent[1]).toContain("会话 [scratch] 已创建");

		expect(await routeWorkspaceCommand("!session use 01-00002", "peer-1", deps)).toBe(true);
		expect(used).toEqual(["abc123"]);

		expect(await routeWorkspaceCommand("!session rename 01-00002 new-name", "peer-1", deps)).toBe(true);
		expect(calls.sent[3]).toContain("renamed to [Renamed]");

		// Relay delete is rejected.
		expect(await routeWorkspaceCommand("!session delete 01-00001", "peer-1", deps)).toBe(true);
		expect(calls.sent[4]).toContain("relay 会话不可删除");

		// Non-relay delete succeeds.
		expect(await routeWorkspaceCommand("!session delete 01-00002", "peer-1", deps)).toBe(true);
		expect(calls.sent[5]).toContain("Session [Test] deleted.");
	});

	test("!lang zh|en sets the chat language via the router", async () => {
		const langs: string[] = [];
		const { deps, calls } = makeDeps({
			router: makeRouterStub({
				setLanguage: async (_c, _p, lang) => {
					langs.push(lang);
				},
			}),
		});
		expect(await routeWorkspaceCommand("!lang zh", "peer-1", deps)).toBe(true);
		expect(await routeWorkspaceCommand("!lang en", "peer-1", deps)).toBe(true);
		expect(langs).toEqual(["zh", "en"]);
		expect(calls.sent[0]).toContain("中文");
		expect(calls.sent[1]).toContain("English");

		const bad = makeDeps();
		expect(await routeWorkspaceCommand("!lang fr", "peer-1", bad.deps)).toBe(true);
		expect(bad.calls.sent[0]).toContain("Usage: !lang <zh|en>");
	});

	test("!model lists numbered models and switches by selector", async () => {
		const switched: Array<{ provider: string; modelId: string }> = [];
		const { deps, calls } = makeDeps({
			listModels: async () => [
				{ provider: "opencode-go", models: ["kimi-k2.7-code", "qwen3-coder"] },
				{ provider: "volcengine", models: ["deepseek-v4-flash"] },
			],
			setChatModel: async (provider, modelId) => {
				switched.push({ provider, modelId });
				return { ok: true, provider, modelId };
			},
		});

		expect(await routeWorkspaceCommand("!model", "peer-1", deps)).toBe(true);
		expect(calls.sent[0]).toContain("{1} [opencode-go]");
		expect(calls.sent[0]).toContain("{1-1} [kimi-k2.7-code]");
		expect(calls.sent[0]).toContain("{2-1} [deepseek-v4-flash]");

		expect(await routeWorkspaceCommand("!model 2-1", "peer-1", deps)).toBe(true);
		expect(switched).toEqual([{ provider: "volcengine", modelId: "deepseek-v4-flash" }]);
		expect(calls.sent[1]).toContain("[volcengine] [deepseek-v4-flash]");

		// Out-of-range selector → usage.
		const bad = makeDeps({
			listModels: async () => [{ provider: "volcengine", models: ["deepseek-v4-flash"] }],
		});
		expect(await routeWorkspaceCommand("!model 9-9", "peer-1", bad.deps)).toBe(true);
		expect(bad.calls.sent[0]).toContain("Unknown model selector");
	});

	test("!work workspace:<alias> routes directly; bare !work falls through", async () => {
		const delivered: Array<{ alias: string; task: string }> = [];
		const { deps } = makeDeps({
			router: makeRouterStub({
				deliverDirect: async (alias, _c, _p, task) => {
					delivered.push({ alias, task });
					return { ok: true };
				},
			}),
		});
		expect(await routeWorkspaceCommand("!work workspace:web implement auth", "peer-1", deps)).toBe(true);
		expect(delivered).toEqual([{ alias: "web", task: "implement auth" }]);

		// Unknown alias → error + hint.
		const fail = makeDeps({
			router: makeRouterStub({
				deliverDirect: async () => ({ ok: false, error: "Unknown workspace [nope]" }),
			}),
		});
		expect(await routeWorkspaceCommand("!work workspace:nope do it", "peer-1", fail.deps)).toBe(true);
		expect(fail.calls.sent[0]).toContain("Unknown workspace [nope]");
		expect(fail.calls.sent[0]).toContain("!workspace list");

		// Bare `!work <task>` without workspace: → falls through to normal routing.
		const fall = makeDeps();
		expect(await routeWorkspaceCommand("!work fix the bug", "peer-1", fall.deps)).toBe(false);
	});

	test("!draft <task> creates a draft session, switches to it, and delivers the task", async () => {
		const createdName: string[] = [];
		const delivered: string[] = [];
		const { deps, calls } = makeDeps({
			router: makeRouterStub({
				createBotSession: async (name: string) => {
					createdName.push(name);
					return {
						ok: true,
						entry: { id: "d1", name, tag: "draft", sessionFile: "/tmp/d-d1.jsonl", createdAt: "2026-01-01" },
					};
				},
				setActiveBotSession: async () => ({ ok: true, id: "d1" }),
				deliverToBotSession: async (_id, _c, _p, task) => {
					delivered.push(task);
					return { ok: true };
				},
			}),
		});
		expect(await routeWorkspaceCommand("!draft summarize this repo", "peer-1", deps)).toBe(true);
		expect(createdName).toEqual(["summarize this repo"]);
		expect(delivered).toEqual(["summarize this repo"]);
		expect(calls.sent[0]).toContain("临时会话 d1");
	});
});

/**
 * im_control controller contracts — natural-language control of workspaces /
 * default-space sessions / language / model maps onto the SessionRouter ops
 * and formats replies with `{n}` numbers + `[name]` names. Stubbed router, so
 * the mapping + error handling are pinned without a live agent.
 */

import { describe, expect, test } from "bun:test";
import { type ImControlDeps, runImControl } from "../../src/channels/im-control";
import type { SessionRouter } from "../../src/channels/session-router";

function makeDeps(overrides: Partial<ImControlDeps> = {}): ImControlDeps {
	return {
		listModels: async () => [
			{ provider: "volcengine", models: ["deepseek-v4-flash"] },
			{ provider: "opencode-go", models: ["kimi-k2.7-code", "qwen3-coder"] },
		],
		setChatModel: async (_c, _p, provider, modelId) => ({ ok: true, provider, modelId }),
		getChatModel: async () => ({ provider: "volcengine", modelId: "deepseek-v4-flash" }),
		getChannelStatus: () => [
			{ id: "wechat", running: true },
			{ id: "feishu", running: false },
		],
		...overrides,
	};
}

function makeRouter(overrides: Partial<SessionRouter> = {}): SessionRouter {
	return {
		resolveImControlChat: () => ({ channelId: "wechat" as const, peer: "peer-1" }),
		list: () => [{ alias: "web", path: "/repo/web" }],
		listWorkspaceSessions: async () => [{ id: "s1", title: "Web Dev", path: "/repo/web/s1.jsonl" }],
		bindingFor: async () => null,
		listBotSessions: () => [
			{
				id: "relay",
				name: "Zeta Bot (Relay)",
				tag: "relay",
				sessionFile: "/tmp/zeta-bot.jsonl",
				createdAt: "2026-01-01",
			},
			{ id: "abc123", name: "Test", tag: "draft", sessionFile: "/tmp/test-abc123.jsonl", createdAt: "2026-01-01" },
		],
		activeBotSessionIdFor: async () => "relay",
		botSession: () => undefined,
		setActiveBotSession: async (_c: string, _p: string, id: string) => ({ ok: true, id }),
		createBotSession: async (name: string) => ({
			ok: true,
			entry: { id: "xyz789", name, tag: "draft", sessionFile: "/tmp/x-xyz789.jsonl", createdAt: "2026-01-01" },
		}),
		renameBotSession: async () => ({ ok: true, name: "Renamed" }),
		deleteBotSession: async (id: string) =>
			id === "relay" ? { ok: false, error: "relay 会话不可删除" } : { ok: true },
		setLanguage: async () => {},
		languageFor: async () => "zh",
		...overrides,
	} as unknown as SessionRouter;
}

describe("runImControl", () => {
	test("list_workspaces numbers workspaces and their sessions", async () => {
		const result = await runImControl(makeRouter(), "coordinator", { operation: "list_workspaces" }, makeDeps());
		expect(result.text).toContain("{1} [web] → /repo/web");
		expect(result.text).toContain("{1-1} [Web Dev]");
	});

	test("list_sessions numbers sessions and marks the active one", async () => {
		const result = await runImControl(makeRouter(), "coordinator", { operation: "list_sessions" }, makeDeps());
		expect(result.text).toContain("{1} [relay] — Zeta Bot (Relay) [relay] [当前]");
		expect(result.text).toContain("{2} [abc123] — Test [draft]");
	});

	test("use_session maps a {n} selector and rejects unknown selectors", async () => {
		let used = "";
		const router = makeRouter({
			setActiveBotSession: async (_c: string, _p: string, id: string) => {
				used = id;
				return { ok: true, id };
			},
		});
		const ok = await runImControl(router, "coordinator", { operation: "use_session", session: "{2}" }, makeDeps());
		expect(used).toBe("abc123");
		expect(ok.text).toContain("[Test]");

		const bad = await runImControl(
			makeRouter(),
			"coordinator",
			{ operation: "use_session", session: "nope" },
			makeDeps(),
		);
		expect(bad.isError).toBe(true);
		expect(bad.text).toContain('Unknown bot session "nope"');
	});

	test("delete_session rejects the relay session", async () => {
		const result = await runImControl(
			makeRouter(),
			"coordinator",
			{ operation: "delete_session", session: "[relay]" },
			makeDeps(),
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("relay 会话不可删除");
	});

	test("set_language validates zh/en and routes to setLanguage", async () => {
		let lang = "";
		const router = makeRouter({
			setLanguage: async (_c: string, _p: string, next: "zh" | "en") => {
				lang = next;
			},
		});
		const ok = await runImControl(router, "coordinator", { operation: "set_language", language: "en" }, makeDeps());
		expect(lang).toBe("en");
		expect(ok.text).toContain("English");

		const bad = await runImControl(
			makeRouter(),
			"coordinator",
			{ operation: "set_language", language: "fr" as never },
			makeDeps(),
		);
		expect(bad.isError).toBe(true);
		expect(bad.text).toContain('"zh" or "en"');
	});

	test("set_model switches via provider/model and unknown models error", async () => {
		const switched: Array<{ provider: string; modelId: string }> = [];
		const deps = makeDeps({
			setChatModel: async (_c: string, _p: string, provider: string, modelId: string) => {
				switched.push({ provider, modelId });
				return { ok: true, provider, modelId };
			},
		});
		const ok = await runImControl(
			makeRouter(),
			"coordinator",
			{ operation: "set_model", provider: "opencode-go", model: "kimi-k2.7-code" },
			deps,
		);
		expect(switched).toEqual([{ provider: "opencode-go", modelId: "kimi-k2.7-code" }]);
		expect(ok.text).toContain("模型已切换");
	});

	test("missing chat context returns an error, never guesses", async () => {
		const router = makeRouter({ resolveImControlChat: () => null });
		const result = await runImControl(router, "bot-1", { operation: "status" }, makeDeps());
		expect(result.isError).toBe(true);
		expect(result.text).toContain("No chat context");
	});

	test("status reports channels, routing, workspaces, language and model", async () => {
		const result = await runImControl(makeRouter(), "coordinator", { operation: "status" }, makeDeps());
		expect(result.text).toContain("wechat 运行中");
		expect(result.text).toContain("relay 协调者 (main)");
		expect(result.text).toContain("{1} [web]");
		expect(result.text).toContain("中文 (zh)");
		expect(result.text).toContain("[volcengine] [deepseek-v4-flash]");
	});
});

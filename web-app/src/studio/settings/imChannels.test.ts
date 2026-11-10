import { describe, expect, test } from "bun:test";
import {
	MASKED_SECRET,
	bindingKey,
	bindingProblem,
	botSessionViews,
	channelConfigured,
	channelRuntimeState,
	chatBindings,
	conflictingBinding,
	fetchChannelStatus,
	fetchPairedDevices,
	fetchPairingQr,
	fetchWebConfig,
	fetchWechatQr,
	isAbsolutePath,
	putWebConfigValue,
	removeBinding,
	runningFor,
	unknownBindingKeys,
	upsertBinding,
	validateChannelCredentials,
	wechatLoginStage,
	workspaceAliases,
	type ChannelsFetch,
	type ChatBinding,
	type WebConfigView,
} from "./imChannelsApi";

interface Call {
	url: string;
	init: RequestInit | undefined;
	body: unknown;
}

/** A recording fetcher; each test answers by URL. */
function fakeFetch(answer: (url: string, init: RequestInit | undefined) => Response): {
	fetcher: ChannelsFetch;
	calls: Call[];
} {
	const calls: Call[] = [];
	const fetcher: ChannelsFetch = (url, init) => {
		const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		calls.push({ url, init, body });
		return Promise.resolve(answer(url, init));
	};
	return { fetcher, calls };
}

/** The message a promise rejected with (the tests assert the gateway's own text). */
async function rejection(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	throw new Error("expected the call to reject");
}

function configPaths(): WebConfigView {
	return {
		channels: {
			wechat: { enabled: true, botToken: MASKED_SECRET, workspaceRoot: "/work/alpha" },
			feishu: { enabled: false, appId: "cli_1" },
			telegram: { enabled: false },
			discord: { enabled: false },
			qq: { enabled: false, mode: "forward" },
		},
		remote: {},
	};
}

describe("channel reads", () => {
	test("status keeps only well-formed entries", async () => {
		const { fetcher } = fakeFetch(() =>
			Response.json({ channels: [{ id: "wechat", running: true }, { id: "nope", running: true }, { id: "telegram" }] }),
		);
		expect(await fetchChannelStatus(fetcher)).toEqual([{ id: "wechat", running: true }]);
	});

	test("a failed status read surfaces the gateway's error text", async () => {
		const { fetcher } = fakeFetch(() => Response.json({ error: "unauthorized" }, { status: 401 }));
		expect(await rejection(fetchChannelStatus(fetcher))).toBe("unauthorized");
	});

	test("web config narrows channels and keeps the masked secret", async () => {
		const { fetcher } = fakeFetch(() =>
			Response.json({
				channels: {
					wechat: { enabled: true, botToken: MASKED_SECRET, peerTokens: { peer: MASKED_SECRET }, extra: 1 },
					feishu: { enabled: false, appId: "cli_1", domain: "lark" },
					telegram: { enabled: true, botToken: MASKED_SECRET },
				},
				desktopLabels: { about: "About" },
				remote: { workspaces: [{ alias: "alpha", path: "/work/alpha" }], sessionMappings: [], botSessions: [] },
			}),
		);
		const config = await fetchWebConfig(fetcher);
		expect(config.channels.wechat).toEqual({ enabled: true, botToken: MASKED_SECRET });
		expect(config.channels.feishu).toEqual({ enabled: false, appId: "cli_1", domain: "lark" });
		expect(Object.hasOwn(config.channels.wechat, "peerTokens")).toBe(false);
		expect(Object.hasOwn(config.channels.wechat, "extra")).toBe(false);
	});

	test("the WeChat QR keeps the server-rendered symbol", async () => {
		const { fetcher } = fakeFetch(() =>
			Response.json({ pending: true, qrcodeUrl: "https://liteapp.weixin.qq.com/q/abc", status: "wait", svg: "<svg/>" }),
		);
		expect(await fetchWechatQr(fetcher)).toEqual({
			pending: true,
			qrcodeUrl: "https://liteapp.weixin.qq.com/q/abc",
			status: "wait",
			svg: "<svg/>",
		});
	});

	test("devices parse without a token field", async () => {
		const { fetcher } = fakeFetch(() =>
			Response.json({
				devices: [{ id: "dev_1", label: "Phone", platform: "android", scopes: ["read"], createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: null, revokedAt: null }],
				currentDeviceId: null,
				legacyTokenActive: true,
			}),
		);
		const inventory = await fetchPairedDevices(fetcher);
		expect(inventory.legacyTokenActive).toBe(true);
		expect(inventory.devices.length).toBe(1);
		expect(inventory.devices[0]?.label).toBe("Phone");
	});

	test("pairing drops the plaintext token", async () => {
		const { fetcher } = fakeFetch(() => Response.json({ url: "http://host:43141", token: "secret", payload: "p", svg: "<svg/>" }));
		expect(await fetchPairingQr(fetcher)).toEqual({ url: "http://host:43141", svg: "<svg/>" });
	});
});

describe("credential and config writes", () => {
	test("validating a credential posts only the provided fields", async () => {
		const { fetcher, calls } = fakeFetch(() =>
			Response.json({ ok: true, channel: "feishu", state: "connected", identity: { id: "ou_1", name: "Build Bot" }, credentialsPersisted: true }),
		);
		const result = await validateChannelCredentials(fetcher, { channel: "feishu", appId: "cli_1", domain: "lark" });
		expect(result.identity?.name).toBe("Build Bot");
		expect(calls[0]?.url).toBe("/api/channels/credentials");
		expect(calls[0]?.body).toEqual({ channel: "feishu", appId: "cli_1", domain: "lark" });
	});

	test("a rejected credential throws the platform's (redacted) message", async () => {
		const { fetcher } = fakeFetch(() => Response.json({ error: "Invalid bot token ••••" }, { status: 400 }));
		expect(await rejection(validateChannelCredentials(fetcher, { channel: "telegram", botToken: "x" }))).toContain("••••");
	});

	test("a web-config write carries one dot path", async () => {
		const { fetcher, calls } = fakeFetch(() => Response.json({ ok: true }));
		await putWebConfigValue(fetcher, "channels.wechat.enabled", true);
		expect(calls[0]?.init?.method).toBe("PUT");
		expect(calls[0]?.body).toEqual({ path: "channels.wechat.enabled", value: true });
	});

	test("a rejected binding array keeps the server's validation reason", async () => {
		const { fetcher } = fakeFetch(() => Response.json({ error: "Each binding needs a chatId" }, { status: 400 }));
		expect(await rejection(putWebConfigValue(fetcher, "remote.sessionMappings", []))).toContain("chatId");
	});
});

describe("view state", () => {
	test("runtime state never guesses", () => {
		expect(channelRuntimeState(false, true)).toBe("stopped");
		expect(channelRuntimeState(true, true)).toBe("running");
		expect(channelRuntimeState(true, false)).toBe("error");
		expect(runningFor([{ id: "wechat", running: false }], "wechat")).toBe(false);
	});

	test("configured means the masked secret is present", () => {
		const config = configPaths();
		expect(channelConfigured("wechat", config)).toBe(true);
		expect(channelConfigured("feishu", config)).toBe(false);
		expect(channelConfigured("telegram", config)).toBe(false);
		expect(channelConfigured("discord", config)).toBe(false);
		// QQ has two credential shapes: forward needs an endpoint, reverse a token.
		expect(channelConfigured("qq", config)).toBe(false);
		config.channels.qq.endpoint = "ws://127.0.0.1:3001";
		expect(channelConfigured("qq", config)).toBe(true);
		config.channels.qq.mode = "reverse";
		expect(channelConfigured("qq", config)).toBe(false);
		config.channels.qq.token = "••••";
		expect(channelConfigured("qq", config)).toBe(true);
	});

	test("WeChat stages follow the route's words", () => {
		expect(wechatLoginStage(null, false)).toBe("unbound");
		expect(wechatLoginStage(null, true)).toBe("connected");
		expect(wechatLoginStage({ pending: true, status: "wait" }, false)).toBe("pending");
		expect(wechatLoginStage({ pending: true, status: "scaned" }, false)).toBe("scanned");
		expect(wechatLoginStage({ pending: true, status: "confirmed" }, false)).toBe("connected");
		expect(wechatLoginStage({ pending: true, status: "expired" }, false)).toBe("expired");
		expect(wechatLoginStage({ pending: false }, true)).toBe("connected");
	});

	test("aliases normalize the legacy bare-path form", () => {
		expect(workspaceAliases([{ alias: "alpha", path: "/w/a" }, "/w/beta", "/w/beta", 7])).toEqual(["alpha", "beta"]);
		expect(workspaceAliases(undefined)).toEqual([]);
	});

	test("bot sessions are read-only summaries", () => {
		expect(botSessionViews([{ id: "s1", name: "PM", tag: "bot", workspaceAlias: "alpha", sessionFile: "/x" }])).toEqual([
			{ id: "s1", name: "PM", tag: "bot", workspaceAlias: "alpha" },
		]);
	});

	test("binding rows drop entries that are not bindings", () => {
		expect(chatBindings([{ platform: "feishu", chatId: "oc_1" }, { platform: "slack", chatId: "x" }, { chatId: "y" }]).length).toBe(1);
	});

	test("absolute-path validation accepts both separators", () => {
		expect(isAbsolutePath("C:\\work\\repo")).toBe(true);
		expect(isAbsolutePath("/home/me/repo")).toBe(true);
		expect(isAbsolutePath("relative/dir")).toBe(false);
		expect(isAbsolutePath("")).toBe(false);
	});
});

describe("binding edits", () => {
	const row: ChatBinding = {
		platform: "feishu",
		chatId: "oc_1",
		workspaceAlias: "alpha",
		userId: "ou_1",
		chatType: "group",
		mode: "direct",
		lang: "zh",
		label: "kept",
	};

	test("an edit preserves every field the table does not own", () => {
		const next = upsertBinding([row], row, { platform: "feishu", chatId: "oc_1", workspaceAlias: "beta", sessionId: "" });
		expect(next[0]).toEqual({ ...row, workspaceAlias: "beta" });
		expect(unknownBindingKeys(next[0]!)).toEqual(["label"]);
	});

	test("adding an empty target omits both optional keys", () => {
		const next = upsertBinding([], null, { platform: "telegram", chatId: "42", workspaceAlias: "", sessionId: "s1" });
		expect(next).toEqual([{ platform: "telegram", chatId: "42", sessionId: "s1" }]);
	});

	test("clearing the alias deletes the key instead of writing undefined", () => {
		const next = upsertBinding([row], row, { platform: "feishu", chatId: "oc_1", workspaceAlias: "", sessionId: "s1" });
		expect(Object.hasOwn(next[0]!, "workspaceAlias")).toBe(false);
		expect(next[0]?.sessionId).toBe("s1");
		expect(next[0]?.lang).toBe("zh");
	});

	test("remove targets the row identity, not its position", () => {
		const other: ChatBinding = { platform: "wechat", chatId: "wx", workspaceAlias: "alpha" };
		expect(removeBinding([row, other], row)).toEqual([other]);
	});

	test("validation mirrors the gateway's rules", () => {
		expect(bindingProblem({ platform: "feishu", chatId: " ", workspaceAlias: "alpha", sessionId: "" }, ["alpha"])).toBe("chatId");
		expect(bindingProblem({ platform: "feishu", chatId: "oc_1", workspaceAlias: "", sessionId: "" }, ["alpha"])).toBe("target");
		expect(bindingProblem({ platform: "feishu", chatId: "oc_1", workspaceAlias: "ghost", sessionId: "" }, ["alpha"])).toBe("alias");
		expect(bindingProblem({ platform: "feishu", chatId: "oc_1", workspaceAlias: "", sessionId: "s1" }, [])).toBeNull();
	});

	test("a duplicate platform+chat+user is reported before writing", () => {
		const draft = { platform: "feishu" as const, chatId: "oc_1", workspaceAlias: "alpha", sessionId: "" };
		const plain: ChatBinding = { platform: "feishu", chatId: "oc_1", workspaceAlias: "alpha" };
		expect(conflictingBinding([plain], draft, null)).toBe(true);
		expect(conflictingBinding([plain], draft, plain)).toBe(false);
		// A user-specific row and a chat-level row are distinct identities: the
		// gateway stores both, so this table must not call them a conflict.
		expect(conflictingBinding([{ ...plain, userId: "ou_1" }], draft, null)).toBe(false);
	});

	test("row identity includes the optional user", () => {
		expect(bindingKey(row)).not.toBe(bindingKey({ ...row, userId: "ou_2" }));
	});
});

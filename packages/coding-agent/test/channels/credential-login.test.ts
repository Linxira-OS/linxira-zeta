/**
 * `channels login feishu|telegram` contracts, against a stubbed platform:
 * validation happens before persistence, the bot identity is reported, and no
 * error path can print the credential.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	redactSecrets,
	runCredentialLogin,
	validateFeishuCredentials,
	validateTelegramToken,
} from "../../src/channels/credential-login";
import { WebConfig } from "../../src/config/web-config";

const tempDirs: string[] = [];
const SECRET = "s3cr3t-app-secret";
const TOKEN = "123456:AAH-secret-token";

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

async function makeConfig(): Promise<WebConfig> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-credentials-"));
	tempDirs.push(dir);
	const file = path.join(dir, "web.yml");
	await Bun.write(
		file,
		JSON.stringify({
			tray: { minimizeToTray: true, autostart: false },
			channels: {
				wechat: { enabled: false },
				feishu: { enabled: true },
				telegram: { enabled: false },
			},
			remote: {},
		}),
	);
	return await WebConfig.load(file);
}

/** The error a promise rejected with (a rejected validation's reason). */
async function rejection(promise: Promise<unknown>): Promise<Error> {
	try {
		await promise;
		throw new Error("expected the call to reject");
	} catch (error) {
		return error as Error;
	}
}

interface Call {
	url: string;
	init: RequestInit | undefined;
}

/** A recording fetch that answers by URL suffix, like the real endpoints. */
function stubFetch(replies: Array<{ match: string; status?: number; body: unknown }>): {
	calls: Call[];
	fetch: typeof globalThis.fetch;
} {
	const calls: Call[] = [];
	const impl = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		calls.push({ url, init });
		const reply = replies.find(entry => url.includes(entry.match));
		if (!reply) throw new Error(`stub has no reply for ${url}`);
		return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
	}) as typeof globalThis.fetch;
	return { calls, fetch: impl };
}

describe("Feishu credential validation", () => {
	test("exchanges the app credential and reports the bot identity", async () => {
		const stub = stubFetch([
			{
				match: "/open-apis/auth/v3/tenant_access_token/internal",
				body: { code: 0, msg: "ok", tenant_access_token: "t-abc", expire: 7200 },
			},
			{
				match: "/open-apis/bot/v3/info",
				body: { code: 0, msg: "success", bot: { open_id: "ou_1", app_name: "Zeta Bot" } },
			},
		]);
		const identity = await validateFeishuCredentials({
			appId: "cli_1",
			appSecret: SECRET,
			customFetch: stub.fetch,
			baseUrl: "https://open.feishu.cn",
		});
		expect(identity).toEqual({ id: "ou_1", name: "Zeta Bot" });
		expect(stub.calls).toHaveLength(2);
		expect(stub.calls[0]?.url).toBe("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal");
		expect(String(stub.calls[0]?.init?.body)).toContain('"app_id":"cli_1"');
		expect(stub.calls[1]?.url).toBe("https://open.feishu.cn/open-apis/bot/v3/info");
		const headers = stub.calls[1]?.init?.headers as Record<string, string> | undefined;
		expect(headers?.authorization).toBe("Bearer t-abc");
	});

	test("uses the Lark origin for the lark domain", async () => {
		const stub = stubFetch([
			{
				match: "/tenant_access_token/internal",
				body: { code: 0, tenant_access_token: "t-abc" },
			},
			{ match: "/bot/v3/info", body: { code: 0, bot: { open_id: "ou_1", app_name: "Bot" } } },
		]);
		await validateFeishuCredentials({
			appId: "cli_1",
			appSecret: SECRET,
			domain: "lark",
			customFetch: stub.fetch,
		});
		expect(stub.calls[0]?.url.startsWith("https://open.larksuite.com/")).toBe(true);
	});

	test("rejects an invalid app secret without spelling it out", async () => {
		const stub = stubFetch([
			{
				match: "/tenant_access_token/internal",
				body: { code: 10014, msg: `app secret ${SECRET} is invalid` },
			},
		]);
		const error = await rejection(
			validateFeishuCredentials({ appId: "cli_1", appSecret: SECRET, customFetch: stub.fetch }),
		);
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toContain("app secret");
		expect(error.message).not.toContain(SECRET);
		expect(error.message).not.toContain("cli_1");
	});

	test("a token for an app without the bot capability fails the identity step", async () => {
		const stub = stubFetch([
			{ match: "/tenant_access_token/internal", body: { code: 0, tenant_access_token: "t-abc" } },
			{ match: "/bot/v3/info", body: { code: 10001, msg: "bot not enabled" } },
		]);
		const error = await rejection(
			validateFeishuCredentials({ appId: "cli_1", appSecret: SECRET, customFetch: stub.fetch }),
		);
		expect(error.message).toContain("bot identity lookup failed");
		expect(error.message).toContain("bot not enabled");
		expect(error.message).not.toContain("t-abc");
	});
});

describe("Telegram credential validation", () => {
	test("getMe reports the bot identity", async () => {
		const stub = stubFetch([
			{
				match: "/getMe",
				body: {
					ok: true,
					result: { id: 42, is_bot: true, first_name: "Zeta", username: "zeta_bot" },
				},
			},
		]);
		const identity = await validateTelegramToken({
			botToken: TOKEN,
			customFetch: stub.fetch,
			baseUrl: "https://api.telegram.org",
		});
		expect(identity).toEqual({ id: "42", name: "Zeta", username: "zeta_bot" });
		expect(stub.calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
	});

	test("a token the Bot API refuses is an error that hides the token", async () => {
		const stub = stubFetch([
			{
				match: "/getMe",
				status: 401,
				body: { ok: false, error_code: 401, description: `Unauthorized (token ${TOKEN})` },
			},
		]);
		const error = await rejection(validateTelegramToken({ botToken: TOKEN, customFetch: stub.fetch }));
		expect(error.message).toContain("Unauthorized");
		expect(error.message).not.toContain(TOKEN);
	});
});

describe("login state words and persistence", () => {
	test("Feishu: connected after a successful check, and only then written", async () => {
		const webConfig = await makeConfig();
		const stub = stubFetch([
			{ match: "/tenant_access_token/internal", body: { code: 0, tenant_access_token: "t-abc" } },
			{ match: "/bot/v3/info", body: { code: 0, bot: { open_id: "ou_1", app_name: "Zeta" } } },
		]);
		const result = await runCredentialLogin("feishu", {
			webConfig,
			appId: "cli_1",
			appSecret: SECRET,
			domain: "lark",
			customFetch: stub.fetch,
			baseUrl: "https://open.feishu.cn",
		});
		expect(result.state).toBe("connected");
		expect(result.credentialsPersisted).toBe(true);
		expect(result.identity).toEqual({ id: "ou_1", name: "Zeta" });
		const saved = webConfig.getData().channels.feishu;
		expect(saved.appId).toBe("cli_1");
		expect(saved.appSecret).toBe(SECRET);
		expect(saved.domain).toBe("lark");
	});

	test("Feishu: a rejected credential reports error and writes nothing", async () => {
		const webConfig = await makeConfig();
		const stub = stubFetch([
			{ match: "/tenant_access_token/internal", body: { code: 10014, msg: "invalid app credentials" } },
		]);
		const result = await runCredentialLogin("feishu", {
			webConfig,
			appId: "cli_1",
			appSecret: SECRET,
			customFetch: stub.fetch,
		});
		expect(result.state).toBe("error");
		expect(result.credentialsPersisted).toBe(false);
		expect(result.identity).toBeNull();
		expect(result.error).toContain("invalid app credentials");
		expect(result.error).not.toContain(SECRET);
		const saved = webConfig.getData().channels.feishu;
		expect(saved.appId ?? "").toBe("");
		expect(saved.appSecret ?? "").toBe("");
	});

	test("Telegram: connected and saved after getMe, rejected writes nothing", async () => {
		const okConfig = await makeConfig();
		const okStub = stubFetch([{ match: "/getMe", body: { ok: true, result: { id: 42, first_name: "Zeta" } } }]);
		const connected = await runCredentialLogin("telegram", {
			webConfig: okConfig,
			botToken: TOKEN,
			customFetch: okStub.fetch,
		});
		expect(connected.state).toBe("connected");
		expect(okConfig.getData().channels.telegram.botToken).toBe(TOKEN);

		const badConfig = await makeConfig();
		const badStub = stubFetch([{ match: "/getMe", status: 401, body: { ok: false, description: "Unauthorized" } }]);
		const failed = await runCredentialLogin("telegram", {
			webConfig: badConfig,
			botToken: TOKEN,
			customFetch: badStub.fetch,
		});
		expect(failed.state).toBe("error");
		expect(failed.error).not.toContain(TOKEN);
		expect(badConfig.getData().channels.telegram.botToken ?? "").toBe("");
	});

	test("stored credentials are validated when no new value is pasted", async () => {
		const webConfig = await makeConfig();
		await webConfig.set("channels.feishu.appId", "cli_stored");
		await webConfig.set("channels.feishu.appSecret", SECRET);
		const stub = stubFetch([
			{ match: "/tenant_access_token/internal", body: { code: 0, tenant_access_token: "t-abc" } },
			{ match: "/bot/v3/info", body: { code: 0, bot: { open_id: "ou_1", app_name: "Zeta" } } },
		]);
		const result = await runCredentialLogin("feishu", { webConfig, customFetch: stub.fetch });
		expect(result.state).toBe("connected");
		expect(String(stub.calls[0]?.init?.body)).toContain("cli_stored");
	});

	test("a timeout is its own state and a missing credential is an error", async () => {
		const webConfig = await makeConfig();
		const timeout = (async () => {
			const error = new Error("timed out");
			error.name = "TimeoutError";
			throw error;
		}) as unknown as typeof globalThis.fetch;
		const timedOut = await runCredentialLogin("telegram", {
			webConfig,
			botToken: TOKEN,
			customFetch: timeout,
		});
		expect(timedOut.state).toBe("timeout");
		expect(timedOut.error).not.toContain(TOKEN);

		const missing = await runCredentialLogin("telegram", { webConfig });
		expect(missing.state).toBe("error");
		expect(missing.error).toContain("bot token");
	});
});

describe("redaction", () => {
	test("every occurrence is replaced and blank secrets are ignored", () => {
		expect(redactSecrets("token abc-123 failed: abc-123", ["abc-123", "", undefined])).toBe(
			"token •••• failed: ••••",
		);
	});
});

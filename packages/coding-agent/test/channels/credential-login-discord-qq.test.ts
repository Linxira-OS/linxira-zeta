/**
 * `channels login discord|qq` contracts: the platform (or the bridge) must
 * accept the credential/endpoint before `web.yml` changes, and a rejected or
 * unreachable target writes nothing.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ReverseServerFactory, SocketFactory, SocketLike } from "@linxiraos/pi-channels";
import { runCredentialLogin, validateDiscordToken } from "../../src/channels/credential-login";
import { WebConfig } from "../../src/config/web-config";

const tempDirs: string[] = [];
const DISCORD_TOKEN = "MTIz.discord.secret-token";

const PROFILE = {
	id: "companion",
	label: "Companion",
	persona: { mode: "workspace" },
	location: { kind: "workspace", workspace: "main" },
	tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
	memory: {},
};

function instance(id: string, platform: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id,
		platform,
		label: id,
		enabled: false,
		agentProfile: PROFILE.id,
		allow: { peers: [`${id}-peer`] },
		credentials: {},
		...overrides,
	};
}

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

async function makeConfig(): Promise<WebConfig> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-credentials-im-"));
	tempDirs.push(dir);
	const file = path.join(dir, "web.yml");
	await Bun.write(
		file,
		JSON.stringify({
			channels: { instances: [instance("discord", "discord"), instance("qq", "qq")] },
			imAgents: [PROFILE],
			remote: {},
		}),
	);
	return await WebConfig.load(file);
}

/** One instance's stored credentials, by instance id. */
function credentialsOf(config: WebConfig, instanceId: string): Record<string, unknown> {
	const found = config.getData().channels.instances.find(entry => entry.id === instanceId);
	if (!found) throw new Error(`missing instance ${instanceId}`);
	return found.credentials;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

class FakeSocket implements SocketLike {
	readyState = 0;
	readonly sent: string[] = [];
	#open: Array<() => void> = [];
	#message: Array<(data: string) => void> = [];
	#close: Array<(code: number, reason: string) => void> = [];
	#error: Array<(error: unknown) => void> = [];
	open(): void {
		this.readyState = 1;
		for (const handler of this.#open) handler();
	}
	receive(payload: unknown): void {
		const raw = JSON.stringify(payload);
		for (const handler of this.#message) handler(raw);
	}
	fail(error: unknown): void {
		for (const handler of this.#error) handler(error);
	}
	send(data: string): void {
		this.sent.push(data);
	}
	close(code = 1000, reason = ""): void {
		this.readyState = 3;
		for (const handler of this.#close) handler(code, reason);
	}
	onOpen(handler: () => void): void {
		this.#open.push(handler);
	}
	onMessage(handler: (data: string) => void): void {
		this.#message.push(handler);
	}
	onClose(handler: (code: number, reason: string) => void): void {
		this.#close.push(handler);
	}
	onError(handler: (error: unknown) => void): void {
		this.#error.push(handler);
	}
	jsonSent(): Array<Record<string, unknown>> {
		return this.sent.map(frame => JSON.parse(frame) as Record<string, unknown>);
	}
}

/** A forward socket that answers `get_login_info` as soon as it opens. */
function loginSocketFactory(identity: { user_id: number; nickname: string }): SocketFactory {
	return () => {
		const socket = new FakeSocket();
		queueMicrotask(() => {
			socket.open();
			const call = socket.jsonSent().find(frame => frame.action === "get_login_info");
			if (call) socket.receive({ status: "ok", retcode: 0, data: identity, echo: call.echo });
		});
		return socket;
	};
}

describe("Discord credential validation", () => {
	test("reports the bot identity from /users/@me", async () => {
		const fetchImpl = async (): Promise<Response> =>
			jsonResponse({ id: "42", username: "zeta", global_name: "Zeta Bot" });
		const identity = await validateDiscordToken({
			botToken: DISCORD_TOKEN,
			customFetch: fetchImpl as unknown as typeof globalThis.fetch,
		});
		expect(identity).toEqual({ id: "42", name: "Zeta Bot", username: "zeta" });
	});

	test("a rejected token never echoes the token", async () => {
		const fetchImpl = async (): Promise<Response> => jsonResponse({ message: "401: Unauthorized" }, 401);
		await expect(
			validateDiscordToken({
				botToken: DISCORD_TOKEN,
				customFetch: fetchImpl as unknown as typeof globalThis.fetch,
			}),
		).rejects.toThrow(/Discord rejected/);
		let error: Error | undefined;
		try {
			await validateDiscordToken({
				botToken: DISCORD_TOKEN,
				customFetch: fetchImpl as unknown as typeof globalThis.fetch,
			});
		} catch (caught) {
			error = caught as Error;
		}
		expect(error).toBeInstanceOf(Error);
		expect(error?.message).not.toContain(DISCORD_TOKEN);
	});

	test("persists only after the platform accepts the token", async () => {
		const config = await makeConfig();
		const ok = await runCredentialLogin("discord", {
			webConfig: config,
			instanceId: "discord",
			botToken: DISCORD_TOKEN,
			customFetch: (async () => jsonResponse({ id: "42", username: "zeta" })) as unknown as typeof globalThis.fetch,
		});
		expect(ok.state).toBe("connected");
		expect(credentialsOf(config, "discord").botToken).toBe(DISCORD_TOKEN);
		expect(config.getMasked().channels.instances.find(entry => entry.id === "discord")?.credentials.botToken).not.toBe(
			DISCORD_TOKEN,
		);
		// The other instance is not touched by a Discord credential write.
		expect(credentialsOf(config, "qq")).toEqual({});

		const rejectedConfig = await makeConfig();
		const rejected = await runCredentialLogin("discord", {
			webConfig: rejectedConfig,
			instanceId: "discord",
			botToken: DISCORD_TOKEN,
			customFetch: (async () => jsonResponse({ message: "401" }, 401)) as unknown as typeof globalThis.fetch,
		});
		expect(rejected.state).toBe("error");
		expect(rejected.error).not.toContain(DISCORD_TOKEN);
		expect(credentialsOf(rejectedConfig, "discord").botToken).toBeUndefined();
	});
});

describe("QQ (OneBot) endpoint validation", () => {
	test("forward mode reads get_login_info and saves endpoint/token/selfId", async () => {
		const config = await makeConfig();
		const result = await runCredentialLogin("qq", {
			webConfig: config,
			instanceId: "qq",
			endpoint: "ws://127.0.0.1:3001",
			token: "onebot-token",
			createSocket: loginSocketFactory({ user_id: 10001, nickname: "zeta-bot" }),
		});
		expect(result.state).toBe("connected");
		expect(result.identity).toEqual({ id: "10001", name: "zeta-bot" });
		expect(credentialsOf(config, "qq")).toMatchObject({
			mode: "forward",
			endpoint: "ws://127.0.0.1:3001",
			token: "onebot-token",
			selfId: "10001",
		});
	});

	test("an unreachable bridge writes nothing", async () => {
		const config = await makeConfig();
		const factory: SocketFactory = () => {
			const socket = new FakeSocket();
			queueMicrotask(() => socket.fail(new Error("ECONNREFUSED")));
			return socket;
		};
		const result = await runCredentialLogin("qq", {
			webConfig: config,
			instanceId: "qq",
			endpoint: "ws://127.0.0.1:3999",
			createSocket: factory,
		});
		expect(result.state).toBe("error");
		expect(result.error).toContain("unreachable");
		expect(credentialsOf(config, "qq").endpoint).toBeUndefined();
	});

	test("forward mode without an endpoint is a usage error, not a network call", async () => {
		const config = await makeConfig();
		const result = await runCredentialLogin("qq", { webConfig: config, instanceId: "qq", mode: "forward" });
		expect(result.state).toBe("error");
		expect(result.error).toContain("endpoint");
		expect(credentialsOf(config, "qq").endpoint).toBeUndefined();
	});

	test("reverse mode validates the port and requires a token", async () => {
		const config = await makeConfig();
		let stopped = false;
		const factory: ReverseServerFactory = options => ({
			port: options.port,
			stop: () => {
				stopped = true;
			},
		});
		const result = await runCredentialLogin("qq", {
			webConfig: config,
			instanceId: "qq",
			mode: "reverse",
			port: 18084,
			token: "reverse-token",
			createReverseServer: factory,
		});
		expect(result.state).toBe("connected");
		expect(stopped).toBe(true);
		expect(credentialsOf(config, "qq")).toMatchObject({
			mode: "reverse",
			port: 18084,
			token: "reverse-token",
		});

		const missing = await runCredentialLogin("qq", {
			webConfig: await makeConfig(),
			instanceId: "qq",
			mode: "reverse",
			port: 18085,
		});
		expect(missing.state).toBe("error");
		expect(missing.error).toContain("access token");
	});
});

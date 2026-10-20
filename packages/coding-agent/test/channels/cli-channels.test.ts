/**
 * `zetacode channels` contracts: config/flag resolution, the shared
 * single-instance lock, terminal QR rendering, the WeChat login state
 * machine, logout clearing, and the `status --json` shape.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type ChannelRuntime, type ChannelSession, startChannels } from "@linxiraos/pi-channels";
import {
	collectChannelStatus,
	isChannelId,
	logoutChannel,
	resolveChannelHosting,
	setChannelEnabled,
} from "../../src/channels/channel-status";
import { acquireChannelLock, channelLockPath, readChannelLock } from "../../src/channels/instance-lock";
import { renderTerminalQr } from "../../src/channels/qr-terminal";
import { startSessionChannels } from "../../src/channels/session-host";
import { runWechatLogin, WechatLoginTracker } from "../../src/channels/wechat-login";
import { WebConfig } from "../../src/config/web-config";

const tempDirs: string[] = [];

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

async function makeConfig(data: Record<string, unknown>): Promise<{ dir: string; config: WebConfig }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-channels-"));
	tempDirs.push(dir);
	const file = path.join(dir, "web.yml");
	await Bun.write(file, JSON.stringify(data, null, 2));
	return { dir, config: await WebConfig.load(file) };
}

function fakeSession(): ChannelSession {
	return {
		getAgentId: () => "main",
		deliverIrcMessage: async () => undefined,
		subscribe: () => () => {},
		setIrcAutoReplyListener: () => {},
	};
}

function fakeRuntime(ids: Array<"wechat" | "feishu" | "telegram">): ChannelRuntime {
	const channels = new Map(
		ids.map(id => [
			id,
			{
				id,
				start: async () => {},
				stop: async () => {},
				sendText: async () => {},
				sendImage: async () => {},
			},
		]),
	);
	return {
		channels,
		host: { lastInbound: null, deliver: async () => {}, start: () => {}, stop: () => {} },
		sendText: async () => {},
		sendImage: async () => {},
		stop: async () => {},
	} as unknown as ChannelRuntime;
}

describe("channel config/flag resolution", () => {
	test("web.yml enabled", async () => {
		const { config } = await makeConfig({ channels: { wechat: { enabled: true, botToken: "tok" } } });
		expect(resolveChannelHosting(config, false)).toEqual({
			shouldStart: true,
			source: "web.yml",
			enabled: ["wechat"],
		});
	});

	test("--channels with and without an enabled channel", async () => {
		const { config } = await makeConfig({ channels: { wechat: { enabled: true, botToken: "tok" } } });
		expect(resolveChannelHosting(config, true)).toEqual({
			shouldStart: true,
			source: "flag+web.yml",
			enabled: ["wechat"],
		});

		const empty = await makeConfig({});
		expect(resolveChannelHosting(empty.config, true)).toEqual({
			shouldStart: true,
			source: "flag",
			enabled: [],
		});
	});

	test("neither source", async () => {
		const { config } = await makeConfig({});
		expect(resolveChannelHosting(config, false)).toEqual({
			shouldStart: false,
			source: "none",
			enabled: [],
		});
	});
});

describe("single-instance guard", () => {
	test("a live holder refuses a second host and names the pid", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-channels-lock-"));
		tempDirs.push(dir);
		const lockPath = channelLockPath(dir);
		const first = await acquireChannelLock({
			lockPath,
			metadata: { pid: process.pid, host: "cli", cwd: dir, channels: ["wechat"] },
		});
		expect(first.ok).toBe(true);

		const second = await acquireChannelLock({
			lockPath,
			metadata: { pid: process.pid, host: "serve", cwd: dir, channels: [] },
		});
		expect(second.ok).toBe(false);
		if (!second.ok) {
			expect(second.message).toContain(String(process.pid));
			expect(second.holder?.metadata.host).toBe("cli");
		}
		if (first.ok) await first.lock.release();
		expect(await readChannelLock(lockPath)).toBeNull();
	});

	test("a stale lock is replaced", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-channels-lock-"));
		tempDirs.push(dir);
		const lockPath = channelLockPath(dir);
		const stale = await acquireChannelLock({
			lockPath,
			metadata: { pid: 424242, host: "cli", cwd: dir, channels: [] },
		});
		expect(stale.ok).toBe(true);

		const replacement = await acquireChannelLock({
			lockPath,
			isAlive: () => false,
			metadata: { pid: process.pid, host: "cli", cwd: dir, channels: ["telegram"] },
		});
		expect(replacement.ok).toBe(true);
		if (replacement.ok) {
			expect(replacement.lock.metadata.channels).toEqual(["telegram"]);
			await replacement.lock.release();
		}
	});

	// Bun's module graph for the full session host is large on Windows; the
	// lock assertions themselves are fast, so give this integration case room.
	test("a second session in one process refuses with a clear message", async () => {
		const { dir, config } = await makeConfig({
			channels: { telegram: { enabled: true, botToken: "tok" } },
		});
		const lockPath = channelLockPath(dir);
		const session = fakeSession();
		const first = await startSessionChannels({
			session,
			webConfig: config,
			lockPath,
			startChannels: (async () => fakeRuntime(["telegram"])) as unknown as typeof startChannels,
		});
		expect(first.started).toBe(true);
		try {
			const second = await startSessionChannels({
				session,
				webConfig: config,
				lockPath,
				startChannels: (async () => fakeRuntime(["telegram"])) as unknown as typeof startChannels,
			});
			expect(second.started).toBe(false);
			if (!second.started) {
				expect(second.reason).toBe("already-running");
				expect(second.message).toContain("already hosted");
			}
		} finally {
			if (first.started) await first.host.stop();
		}

		// Cross-process holder: the same path acquired by a live pid refuses too.
		const external = await acquireChannelLock({
			lockPath,
			metadata: { pid: process.pid, host: "serve", cwd: dir, channels: [] },
		});
		expect(external.ok).toBe(true);
		const third = await startSessionChannels({
			session,
			webConfig: config,
			lockPath,
			startChannels: (async () => fakeRuntime(["telegram"])) as unknown as typeof startChannels,
		});
		expect(third.started).toBe(false);
		if (!third.started) expect(third.reason).toBe("instance-lock");
		if (external.ok) await external.lock.release();
	}, 20_000);
});

describe("terminal QR", () => {
	test("renders a URL payload as half-block rows (snapshot)", () => {
		const result = renderTerminalQr("https://liteapp.weixin.qq.com/q/demo", { color: false });
		expect(result.kind).toBe("qr");
		expect(result.payload).toBe("https://liteapp.weixin.qq.com/q/demo");
		expect(result.lines.length).toBe(19);
		expect(result.width).toBe(37);
		// Full matrix snapshot: encoding is deterministic, so the hash pins
		// every block character without a CI-gated snapshot file.
		expect(createHash("sha256").update(result.lines.join("\n")).digest("hex")).toBe(
			"d2d6c128f9793f4ef5ad40a224bf71761dcf4d00e6306671c386ff89a2dd7727",
		);
	});

	test("a narrow terminal falls back to the raw payload", () => {
		const payload = "https://liteapp.weixin.qq.com/q/demo";
		const result = renderTerminalQr(payload, { columns: 10 });
		expect(result.kind).toBe("fallback");
		expect(result.lines).toEqual([payload]);
		expect(result.reason).toContain("terminal-too-narrow");
	});

	test("an image data URL falls back; an image URL with a data param encodes locally", () => {
		const image = renderTerminalQr("data:image/png;base64,AAAA");
		expect(image.kind).toBe("fallback");
		expect(image.reason).toBe("image-payload");
		expect(image.lines).toEqual(["data:image/png;base64,AAAA"]);

		const generated = renderTerminalQr("https://api.qrserver.com/v1/create-qr-code/?data=scanme");
		expect(generated.kind).toBe("qr");
		expect(generated.payload).toBe("scanme");
	});
});

describe("WeChat login state machine", () => {
	test("pending → scanned → connected, ignoring later polls", () => {
		let now = 0;
		const tracker = new WechatLoginTracker(1_000, () => now);
		expect(tracker.state).toBe("pending");
		expect(tracker.observe("wait")).toBe("pending");
		expect(tracker.observe("scaned")).toBe("scanned");
		expect(tracker.observe("scaned_but_redirect")).toBe("scanned");
		expect(tracker.observe("confirmed")).toBe("connected");
		now = 5_000;
		expect(tracker.observe("wait")).toBe("connected");
	});

	test("timeout is terminal", () => {
		let now = 0;
		const tracker = new WechatLoginTracker(100, () => now);
		now = 101;
		expect(tracker.state).toBe("timeout");
		expect(tracker.observe("confirmed")).toBe("timeout");
	});

	test("runWechatLogin returns connected and persists via the adapter seam", async () => {
		const { config } = await makeConfig({ channels: { wechat: { enabled: true } } });
		const states: string[] = [];
		const result = await runWechatLogin({
			webConfig: config,
			timeoutMs: 1_000,
			onState: state => states.push(state),
			createChannel: options => ({
				async start() {
					options.onQrCode?.({
						qrcode: "qr-token",
						qrcodeUrl: "https://liteapp.weixin.qq.com/q/x",
						status: "wait",
					});
					options.onQrCode?.({
						qrcode: "qr-token",
						qrcodeUrl: "https://liteapp.weixin.qq.com/q/x",
						status: "scaned",
					});
					options.onQrCode?.({
						qrcode: "qr-token",
						qrcodeUrl: "https://liteapp.weixin.qq.com/q/x",
						status: "confirmed",
					});
				},
				async stop() {},
			}),
		});
		expect(result.state).toBe("connected");
		expect(result.credentialsPersisted).toBe(true);
		expect(states).toEqual(["pending", "scanned", "connected"]);
	});

	test("runWechatLogin times out", async () => {
		const { config } = await makeConfig({ channels: { wechat: { enabled: true } } });
		const result = await runWechatLogin({
			webConfig: config,
			timeoutMs: 20,
			createChannel: () => ({ start: async () => {}, stop: async () => {} }),
		});
		expect(result.state).toBe("timeout");
		expect(result.credentialsPersisted).toBe(false);
	});
});

describe("logout and enable/disable", () => {
	test("logout clears WeChat credentials and peer tokens through the adapter", async () => {
		const { config } = await makeConfig({
			channels: {
				wechat: {
					enabled: true,
					botToken: "tok",
					ilinkBotId: "bot-1",
					ilinkUserId: "user-1",
					peerTokens: { "u1@im.wechat": "ctx" },
				},
			},
		});
		const failingFetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof globalThis.fetch;
		await logoutChannel(config, "wechat", { customFetch: failingFetch });
		const data = (await WebConfig.load(config.path)).getData();
		expect(data.channels.wechat.botToken).toBe("");
		expect(data.channels.wechat.ilinkBotId).toBe("");
		expect(data.channels.wechat.ilinkUserId).toBe("");
		expect(data.channels.wechat.peerTokens).toEqual({});
	});

	test("logout clears Telegram/Feishu secrets", async () => {
		const { config } = await makeConfig({
			channels: {
				telegram: { enabled: true, botToken: "tg" },
				feishu: { enabled: true, appId: "app", appSecret: "secret" },
			},
		});
		await logoutChannel(config, "telegram");
		await logoutChannel(config, "feishu");
		const data = (await WebConfig.load(config.path)).getData();
		expect(data.channels.telegram.botToken).toBe("");
		expect(data.channels.feishu.appId).toBe("");
		expect(data.channels.feishu.appSecret).toBe("");
	});

	test("enable/disable persists the flag", async () => {
		const { config } = await makeConfig({});
		await setChannelEnabled(config, "wechat", true);
		expect((await WebConfig.load(config.path)).getData().channels.wechat.enabled).toBe(true);
		await setChannelEnabled(config, "wechat", false);
		expect((await WebConfig.load(config.path)).getData().channels.wechat.enabled).toBe(false);
		expect(isChannelId("wechat")).toBe(true);
		expect(isChannelId("slack")).toBe(false);
	});
});

describe("status --json shape", () => {
	test("reports enabled/running/peers/route from web.yml and the lock", async () => {
		const workspace = path.join(os.tmpdir(), "zeta-workspace-demo");
		const { dir, config } = await makeConfig({
			channels: {
				wechat: {
					enabled: true,
					botToken: "tok",
					workspaceRoot: workspace,
					peerTokens: { "u2@im.wechat": "ctx" },
				},
			},
			remote: {
				workspaces: [{ alias: "proj", path: workspace }],
				sessionMappings: [{ platform: "wechat", chatId: "u1@im.wechat", workspaceAlias: "proj" }],
			},
		});
		const lock = {
			metadata: {
				version: 1 as const,
				instanceId: "instance-1",
				pid: process.pid,
				host: "cli" as const,
				startedAt: "2026-10-20T00:00:00.000Z",
				cwd: dir,
				sessionId: "session-1",
				channels: ["wechat" as const],
			},
			alive: true,
		};
		const status = await collectChannelStatus(config, { lock });
		expect(status).toEqual({
			configPath: config.path,
			runtime: {
				hosting: true,
				pid: process.pid,
				host: "cli",
				startedAt: "2026-10-20T00:00:00.000Z",
				sessionId: "session-1",
				channels: ["wechat"],
				stale: false,
			},
			channels: [
				{
					id: "wechat",
					enabled: true,
					configured: true,
					running: true,
					boundPeers: 2,
					workspaceRoute: { workspaceRoot: workspace, alias: "proj", source: "config" },
					login: "qr",
				},
				{
					id: "feishu",
					enabled: false,
					configured: false,
					running: false,
					boundPeers: 0,
					workspaceRoute: { workspaceRoot: null, alias: null, source: "default" },
					login: "credentials",
				},
				{
					id: "telegram",
					enabled: false,
					configured: false,
					running: false,
					boundPeers: 0,
					workspaceRoute: { workspaceRoot: null, alias: null, source: "default" },
					login: "credentials",
				},
			],
		});
	});

	test("reads the host state from the lock file when none is injected", async () => {
		const { dir, config } = await makeConfig({ channels: { telegram: { enabled: true, botToken: "tok" } } });
		const lock = await acquireChannelLock({
			lockPath: channelLockPath(dir),
			metadata: { pid: process.pid, host: "serve", cwd: dir, channels: ["telegram"] },
		});
		expect(lock.ok).toBe(true);
		try {
			const status = await collectChannelStatus(config);
			expect(status.runtime.hosting).toBe(true);
			expect(status.runtime.host).toBe("serve");
			expect(status.channels.find(entry => entry.id === "telegram")?.running).toBe(true);
		} finally {
			if (lock.ok) await lock.lock.release();
		}
	});
});

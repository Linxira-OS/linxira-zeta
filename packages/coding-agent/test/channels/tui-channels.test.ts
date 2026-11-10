/**
 * `/channels` is the TUI-only operator entry for pairing/toggling IM channels.
 *
 * This suite pins the two things that made the TUI path unusable before:
 * a live session must not hold `channels.lock` when WeChat is merely
 * unpaired, and a host that only owns another channel must not block a
 * WeChat QR login. The command itself is hidden from the everyday palette but
 * still resolves explicitly.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type ChannelRuntime, type ChannelSession, startChannels } from "@linxiraos/pi-channels";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { Settings } from "../../src/config/settings";
import { WebConfig } from "../../src/config/web-config";
import {
	acquireChannelLock,
	channelLockPath,
	readChannelLock,
	wechatPairingBlockedByHost,
} from "../../src/channels/instance-lock";
import {
	restartSessionChannels,
	startSessionChannels,
	stopActiveSessionChannels,
} from "../../src/channels/session-host";
import { formatChannelStatus } from "../../src/slash-commands/builtin-channels";
import {
	buildTuiBuiltinSlashCommands,
	executeBuiltinSlashCommand,
	lookupBuiltinSlashCommand,
} from "../../src/slash-commands/builtin-registry";
import type { InteractiveModeContext } from "../../src/modes/types";

const tempDirs: string[] = [];

afterEach(async () => {
	await stopActiveSessionChannels();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

async function makeConfig(data: Record<string, unknown>): Promise<{ dir: string; config: WebConfig }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-tui-channels-"));
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

describe("TUI channel host lock", () => {
	test("an enabled-but-unpaired WeChat takes no host lock", async () => {
		const { dir, config } = await makeConfig({ channels: { wechat: { enabled: true } } });
		let started = false;
		const result = await startSessionChannels({
			session: fakeSession(),
			webConfig: config,
			lockPath: channelLockPath(dir),
			startChannels: (async () => {
				started = true;
				return fakeRuntime(["wechat"]);
			}) as unknown as typeof startChannels,
		});

		expect(result.started).toBe(false);
		if (!result.started) {
			expect(result.reason).toBe("unpaired");
			expect(result.message).toContain("/channels login wechat");
		}
		expect(started).toBe(false);
		expect(await readChannelLock(channelLockPath(dir))).toBeNull();
	});

	test("a host that owns only Feishu/Telegram does not block WeChat pairing", async () => {
		const { dir } = await makeConfig({});
		const lockPath = channelLockPath(dir);
		const held = await acquireChannelLock({
			lockPath,
			metadata: { pid: process.pid, host: "cli", cwd: dir, channels: ["telegram"] },
		});
		expect(held.ok).toBe(true);
		try {
			expect(await wechatPairingBlockedByHost(lockPath)).toEqual({
				ok: true,
				holder: expect.objectContaining({ alive: true }),
			});
			if (held.ok) await held.lock.update({ channels: ["wechat"] });
			const owned = await wechatPairingBlockedByHost(lockPath);
			expect(owned.ok).toBe(false);
			if (!owned.ok) expect(owned.reason).toBe("wechat-hosted");

			if (held.ok) await held.lock.update({ channels: [] });
			const starting = await wechatPairingBlockedByHost(lockPath);
			expect(starting.ok).toBe(false);
			if (!starting.ok) expect(starting.reason).toBe("starting");
		} finally {
			if (held.ok) await held.lock.release();
		}
	});

	test("restart applies an enable/disable change to the live host", async () => {
		const { dir, config } = await makeConfig({
			channels: {
				telegram: { enabled: true, botToken: "tg" },
				feishu: { enabled: false },
			},
		});
		const started: string[][] = [];
		const start = (async (_session: ChannelSession, _webConfig: unknown) => {
			const data = config.getData();
			const ids = (["wechat", "feishu", "telegram"] as const).filter(id => data.channels[id].enabled);
			started.push([...ids]);
			return fakeRuntime([...ids]);
		}) as unknown as typeof startChannels;

		const first = await startSessionChannels({
			session: fakeSession(),
			webConfig: config,
			lockPath: channelLockPath(dir),
			startChannels: start,
		});
		expect(first.started).toBe(true);
		if (first.started) expect(first.host.channels).toEqual(["telegram"]);

		await config.set("channels.telegram.enabled", false);
		await config.set("channels.feishu.enabled", true);
		const second = await restartSessionChannels();
		expect(second?.started).toBe(true);
		if (second?.started) expect(second.host.channels).toEqual(["feishu"]);
		expect(started).toEqual([["telegram"], ["feishu"]]);
	});
});

describe("/channels command", () => {
	test("resolves explicitly but stays out of the palette", () => {
		expect(lookupBuiltinSlashCommand("channels")?.name).toBe("channels");
		const listed = buildTuiBuiltinSlashCommands({
			ctx: { settings: Settings.isolated() } as unknown as InteractiveModeContext,
		});
		expect(listed.some(command => command.name === "channels")).toBe(false);
	});

	test("status text names every channel and its login mode", () => {
		const text = formatChannelStatus({
			configPath: "/tmp/web.yml",
			runtime: {
				hosting: true,
				pid: 42,
				host: "cli",
				startedAt: "2026-01-01T00:00:00.000Z",
				sessionId: "s1",
				channels: ["telegram"],
				stale: false,
			},
			channels: [
				{
					id: "wechat",
					enabled: true,
					configured: false,
					running: false,
					boundPeers: 0,
					workspaceRoute: { workspaceRoot: null, alias: null, source: "default" },
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
					enabled: true,
					configured: true,
					running: true,
					boundPeers: 2,
					workspaceRoute: { workspaceRoot: null, alias: null, source: "default" },
					login: "credentials",
				},
			],
		});
		expect(text).toContain("hosted by pid 42 (cli");
		expect(text).toContain("wechat    enabled, stopped, not configured");
		expect(text).toContain("login=qr");
		expect(text).toContain("telegram  enabled, running, configured  peers=2");
		expect(text).toContain("/channels login wechat");
	});

	test("help and credential guidance render in the transcript without a secret prompt", async () => {
		const output: string[] = [];
		const runtime = {
			ctx: {
				presentCommandOutput: (content: { getText: () => string }) => output.push(content.getText()),
				showError: () => {},
			} as unknown as InteractiveModeContext,
		};
		expect(await executeBuiltinSlashCommand("/channels help", runtime)).toBe(true);
		expect(output.at(-1)).toContain("/channels login wechat");

		expect(await executeBuiltinSlashCommand("/channels login feishu", runtime)).toBe(true);
		expect(output.at(-1)).toContain("zetacode channels login feishu");
		expect(output.at(-1)).toContain("not entered into the TUI transcript");
	});

	test("/channels status reads web.yml through the command path", async () => {
		const { dir } = await makeConfig({
			channels: { wechat: { enabled: true, botToken: "tok" } },
		});
		const previous = process.env.ZETA_CODING_AGENT_DIR;
		process.env.ZETA_CODING_AGENT_DIR = dir;
		refreshDirsFromEnv();
		try {
			const output: string[] = [];
			const runtime = {
				ctx: {
					presentCommandOutput: (content: { getText: () => string }) => output.push(content.getText()),
					showError: () => {},
				} as unknown as InteractiveModeContext,
			};
			expect(await executeBuiltinSlashCommand("/channels status", runtime)).toBe(true);
			expect(output.at(-1)).toContain(`IM channels — ${path.join(dir, "web.yml")}`);
			expect(output.at(-1)).toContain("wechat    enabled, stopped, configured");
			expect(output.at(-1)).toContain("no live host");
		} finally {
			if (previous === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
			else process.env.ZETA_CODING_AGENT_DIR = previous;
			refreshDirsFromEnv();
		}
	});
});

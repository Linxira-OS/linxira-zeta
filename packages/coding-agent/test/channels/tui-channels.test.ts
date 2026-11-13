/**
 * `/channels` is the TUI-only operator entry for pairing/toggling IM instance.
 *
 * This suite pins the two things that made the TUI path unusable before:
 * a live session must not hold `channels.lock` when WeChat is merely
 * unpaired, and a host that only owns another instance must not block a
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
	hasActiveSessionChannels,
	restartSessionChannels,
	startSessionChannels,
	stopActiveSessionChannels,
	suspendActiveSessionChannels,
} from "../../src/channels/session-host";
import {
	buildTuiBuiltinSlashCommands,
	executeBuiltinSlashCommand,
	lookupBuiltinSlashCommand,
} from "../../src/slash-commands/builtin-registry";
import type { InteractiveModeContext } from "../../src/modes/types";

const tempDirs: string[] = [];

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

function imConfig(instances: Array<Record<string, unknown>>): Record<string, unknown> {
	return { channels: { instances }, imAgents: [PROFILE] };
}

afterEach(async () => {
	await suspendActiveSessionChannels();
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

function fakeRuntime(ids: string[]): ChannelRuntime {
	const channels = new Map(
		ids.map(id => [
			id,
			{
				id,
				platform: id,
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
		const { dir, config } = await makeConfig(imConfig([instance("wechat", "wechat", { enabled: true })]));
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
			metadata: {
				pid: process.pid,
				host: "cli",
				cwd: dir,
				instances: [{ id: "telegram", platform: "telegram" }],
			},
		});
		expect(held.ok).toBe(true);
		try {
			expect(await wechatPairingBlockedByHost(lockPath)).toEqual({
				ok: true,
				holder: expect.objectContaining({ alive: true }),
			});
			if (held.ok) await held.lock.update({ instances: [{ id: "wechat", platform: "wechat" }] });
			const owned = await wechatPairingBlockedByHost(lockPath);
			expect(owned.ok).toBe(false);
			if (!owned.ok) expect(owned.reason).toBe("wechat-hosted");

			if (held.ok) await held.lock.update({ instances: [] });
			const starting = await wechatPairingBlockedByHost(lockPath);
			expect(starting.ok).toBe(false);
			if (!starting.ok) expect(starting.reason).toBe("starting");
		} finally {
			if (held.ok) await held.lock.release();
		}
	});

	test("restart applies an enable/disable change to the live host", async () => {
		const { dir, config } = await makeConfig(
			imConfig([
				instance("telegram", "telegram", { enabled: true, credentials: { botToken: "tg" } }),
				instance("feishu", "feishu"),
			]),
		);
		const started: string[][] = [];
		const start = (async (_session: ChannelSession, _webConfig: unknown) => {
			const data = config.getData();
			const ids = data.channels.instances.filter(entry => entry.enabled).map(entry => entry.id);
			started.push(ids);
			return fakeRuntime(ids);
		}) as unknown as typeof startChannels;

		const first = await startSessionChannels({
			session: fakeSession(),
			webConfig: config,
			lockPath: channelLockPath(dir),
			startChannels: start,
		});
		expect(first.started).toBe(true);
		if (first.started) expect(first.host.instances).toEqual(["telegram"]);

		await config.setInstance("telegram", { enabled: false });
		await config.setInstance("feishu", { enabled: true });
		const second = await restartSessionChannels();
		expect(second?.started).toBe(true);
		if (second?.started) expect(second.host.instances).toEqual(["feishu"]);
		expect(started).toEqual([["telegram"], ["feishu"]]);
	});
	test("stop releases the host and clears restart context; a later start is full", async () => {
		const { dir, config } = await makeConfig(
			imConfig([instance("telegram", "telegram", { enabled: true, credentials: { botToken: "tg" } })]),
		);
		const start = (async (_session: ChannelSession, _webConfig: unknown) => {
			const ids = config
				.getData()
				.channels.instances.filter(entry => entry.enabled)
				.map(entry => entry.id);
			return fakeRuntime(ids);
		}) as unknown as typeof startChannels;
		const first = await startSessionChannels({
			session: fakeSession(),
			webConfig: config,
			lockPath: channelLockPath(dir),
			startChannels: start,
		});
		expect(first.started).toBe(true);
		expect(hasActiveSessionChannels()).toBe(true);
		await stopActiveSessionChannels();
		expect(hasActiveSessionChannels()).toBe(false);
		// stop clears lastContext: restart cannot reuse the stopped host.
		expect(await restartSessionChannels()).toBeNull();
		const again = await startSessionChannels({
			session: fakeSession(),
			webConfig: config,
			lockPath: channelLockPath(dir),
			startChannels: start,
		});
		expect(again.started).toBe(true);
		await stopActiveSessionChannels();
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

	test("help names the instance commands and never prompts for a secret", async () => {
		const output: string[] = [];
		const runtime = {
			ctx: {
				presentCommandOutput: (content: { getText: () => string }) => output.push(content.getText()),
				showError: () => {},
			} as unknown as InteractiveModeContext,
		};
		expect(await executeBuiltinSlashCommand("/channels help", runtime)).toBe(true);
		expect(output.at(-1)).toContain("enable-instance");
		expect(output.at(-1)).toContain("never accepts a secret");
	});

	test("/channels status renders the v2 instances and bindings", async () => {
		const { dir } = await makeConfig({
			imAgents: [{ ...PROFILE, id: "pm-work", label: "PM Work" }],
			channels: {
				instances: [
					{
						id: "wechat-work",
						platform: "wechat",
						label: "Work",
						enabled: true,
						agentProfile: "pm-work",
						allow: { peers: ["wx-1"] },
						credentials: {},
					},
				],
			},
			remote: {
				imBindings: [
					{
						id: "b_0123456789abcdef",
						instanceId: "wechat-work",
						platform: "wechat",
						chatId: "wx-1",
						agentProfileId: "pm-work",
						sessionId: "s1",
						role: "mention",
						target: { kind: "workspace", workspace: "alpha" },
					},
				],
			},
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
			expect(output.at(-1)).toContain(`IM runtime — ${path.join(dir, "web.yml")}`);
			expect(output.at(-1)).toContain("wechat-work");
			expect(output.at(-1)).toContain("mention");
			expect(output.at(-1)).toContain("alpha");
			expect(output.at(-1)).toContain("no live host");
		} finally {
			if (previous === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
			else process.env.ZETA_CODING_AGENT_DIR = previous;
			refreshDirsFromEnv();
		}
	});
});

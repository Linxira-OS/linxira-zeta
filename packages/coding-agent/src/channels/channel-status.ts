/**
 * Config/flag resolution, `channels status` snapshots, and credential toggles
 * shared by the `zetacode channels` command and the session host.
 *
 * `web.yml` remains the single source of truth for enabled channels and their
 * credentials. The lock file only describes who is currently hosting the
 * runtime (see `instance-lock.ts`), so the gateway and the CLI observe the
 * same state rather than keeping parallel registries.
 */

import * as path from "node:path";
import type { ChannelId } from "@linxiraos/pi-channels";
import { WeChatChannel } from "@linxiraos/pi-channels";
import type { WebConfig, WebConfigData } from "../config/web-config";
import { channelLockPath, type ChannelLockSnapshot, readChannelLock } from "./instance-lock";

export const CHANNEL_IDS: readonly ChannelId[] = ["wechat", "feishu", "telegram"];

export function isChannelId(value: string): value is ChannelId {
	return CHANNEL_IDS.includes(value as ChannelId);
}

export type ChannelHostingSource = "none" | "web.yml" | "flag" | "flag+web.yml";

export interface ChannelHostingPlan {
	shouldStart: boolean;
	/** Which input(s) requested the runtime; useful for diagnostics and tests. */
	source: ChannelHostingSource;
	/** Channels enabled in `web.yml` (the runtime starts exactly these). */
	enabled: ChannelId[];
}

/** Decide whether a normal session should host channels. */
export function resolveChannelHosting(
	webConfig: Pick<WebConfig, "getData">,
	channelsFlag: boolean,
): ChannelHostingPlan {
	const data = webConfig.getData();
	const enabled = CHANNEL_IDS.filter(id => data.channels[id].enabled);
	const source: ChannelHostingSource =
		channelsFlag && enabled.length > 0
			? "flag+web.yml"
			: channelsFlag
				? "flag"
				: enabled.length > 0
					? "web.yml"
					: "none";
	return { shouldStart: channelsFlag || enabled.length > 0, source, enabled };
}

export interface ChannelWorkspaceRoute {
	/** Channel-specific default workspace from `web.yml`, if configured. */
	workspaceRoot: string | null;
	/** Registered alias for that path, when `remote.workspaces` names it. */
	alias: string | null;
	source: "config" | "default";
}

export interface ChannelStatusEntry {
	id: ChannelId;
	enabled: boolean;
	/** Required credentials are present (WeChat can pair by QR instead). */
	configured: boolean;
	/** Live runtime membership, read from the hosting lock. */
	running: boolean;
	/** Distinct chats currently bound to this channel. */
	boundPeers: number;
	workspaceRoute: ChannelWorkspaceRoute;
	/** How this channel authenticates. */
	login: "qr" | "credentials";
}

export interface ChannelRuntimeStatus {
	hosting: boolean;
	pid: number | null;
	host: "serve" | "cli" | null;
	startedAt: string | null;
	sessionId: string | null;
	channels: ChannelId[];
	stale: boolean;
}

export interface ChannelsStatusJson {
	configPath: string;
	runtime: ChannelRuntimeStatus;
	channels: ChannelStatusEntry[];
}

function normalizedPathKey(value: string): string {
	const normalized = path.normalize(value);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function channelConfigured(data: WebConfigData, id: ChannelId): boolean {
	switch (id) {
		case "wechat":
			return Boolean(data.channels.wechat.botToken);
		case "feishu":
			return Boolean(data.channels.feishu.appId && data.channels.feishu.appSecret);
		case "telegram":
			return Boolean(data.channels.telegram.botToken);
	}
}

function boundPeerCount(data: WebConfigData, id: ChannelId): number {
	const peers = new Set<string>();
	for (const mapping of data.remote.sessionMappings ?? []) {
		if (mapping.platform === id && mapping.chatId) peers.add(mapping.chatId);
	}
	if (id === "wechat") {
		for (const peer of Object.keys(data.channels.wechat.peerTokens ?? {})) peers.add(peer);
	}
	return peers.size;
}

function workspaceRouteFor(webConfig: WebConfig, workspaceRoot: string | undefined): ChannelWorkspaceRoute {
	if (!workspaceRoot) return { workspaceRoot: null, alias: null, source: "default" };
	const key = normalizedPathKey(workspaceRoot);
	const entry = webConfig.getWorkspaces().find(workspace => normalizedPathKey(workspace.path) === key);
	return { workspaceRoot, alias: entry?.alias ?? null, source: "config" };
}

function runtimeFromLock(lock: ChannelLockSnapshot | null): ChannelRuntimeStatus {
	if (!lock) {
		return { hosting: false, pid: null, host: null, startedAt: null, sessionId: null, channels: [], stale: false };
	}
	const live = lock.alive && lock.metadata.pid !== 0;
	return {
		hosting: live,
		pid: lock.metadata.pid || null,
		host: lock.metadata.host,
		startedAt: lock.metadata.startedAt || null,
		sessionId: lock.metadata.sessionId ?? null,
		channels: live ? lock.metadata.channels : [],
		stale: !lock.alive,
	};
}

/**
 * Snapshot every channel for `zetacode channels status --json`.
 *
 * `lock` is injectable for tests; production reads `<agent dir>/run/channels.lock`
 * next to the loaded `web.yml`.
 */
export async function collectChannelStatus(
	webConfig: WebConfig,
	options: { lock?: ChannelLockSnapshot | null } = {},
): Promise<ChannelsStatusJson> {
	const data = webConfig.getData();
	const lock =
		options.lock !== undefined ? options.lock : await readChannelLock(channelLockPath(path.dirname(webConfig.path)));
	const runtime = runtimeFromLock(lock);
	const channels = CHANNEL_IDS.map((id): ChannelStatusEntry => {
		const channel = data.channels[id];
		return {
			id,
			enabled: channel.enabled,
			configured: channelConfigured(data, id),
			running: runtime.hosting && runtime.channels.includes(id),
			boundPeers: boundPeerCount(data, id),
			workspaceRoute: workspaceRouteFor(webConfig, channel.workspaceRoot),
			login: id === "wechat" ? "qr" : "credentials",
		};
	});
	return { configPath: webConfig.path, runtime, channels };
}

/** Persist `channels.<id>.enabled` through the same config API the GUI uses. */
export async function setChannelEnabled(
	webConfig: WebConfig,
	channel: ChannelId,
	enabled: boolean,
): Promise<{ channel: ChannelId; enabled: boolean }> {
	await webConfig.set(`channels.${channel}.enabled`, enabled);
	return { channel, enabled };
}

export interface ChannelLogoutResult {
	channel: ChannelId;
	cleared: string[];
}

/** Minimal adapter seam so tests can drive logout without a network. */
export interface WechatLogoutChannel {
	unbind(): Promise<void>;
}

export interface LogoutChannelOptions {
	createWechatChannel?: (options: ConstructorParameters<typeof WeChatChannel>[0]) => WechatLogoutChannel;
	/** Test seam for the adapter's `channel_reset` request (failure still clears local credentials). */
	customFetch?: typeof globalThis.fetch;
}

/**
 * Clear a channel's credentials. WeChat goes through the adapter's `unbind`,
 * exactly like the gateway's unbind route, so `channel_reset`, peer tokens and
 * every persisted credential field stay in lockstep. Feishu/Telegram have no
 * adapter-side logout and only need their secret fields emptied.
 */
export async function logoutChannel(
	webConfig: WebConfig,
	channel: ChannelId,
	options: LogoutChannelOptions = {},
): Promise<ChannelLogoutResult> {
	const data = webConfig.getData();
	if (channel === "wechat") {
		const create =
			options.createWechatChannel ??
			((channelOptions: ConstructorParameters<typeof WeChatChannel>[0]) => new WeChatChannel(channelOptions));
		const adapter = create({
			config: {
				botToken: data.channels.wechat.botToken,
				ilinkBotId: data.channels.wechat.ilinkBotId,
				ilinkUserId: data.channels.wechat.ilinkUserId,
				baseUrl: data.channels.wechat.baseUrl,
				endpoint: data.channels.wechat.endpoint,
				peerTokens: data.channels.wechat.peerTokens,
			},
			webConfig,
			onMessage: () => {},
			...(options.customFetch ? { customFetch: options.customFetch } : {}),
		});
		await adapter.unbind();
		return {
			channel,
			cleared: [
				"channels.wechat.botToken",
				"channels.wechat.ilinkBotId",
				"channels.wechat.ilinkUserId",
				"channels.wechat.peerTokens",
			],
		};
	}
	if (channel === "telegram") {
		await webConfig.set("channels.telegram.botToken", "");
		return { channel, cleared: ["channels.telegram.botToken"] };
	}
	await webConfig.set("channels.feishu.appId", "");
	await webConfig.set("channels.feishu.appSecret", "");
	return { channel, cleared: ["channels.feishu.appId", "channels.feishu.appSecret"] };
}

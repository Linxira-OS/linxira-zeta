/**
 * Config/flag resolution and `channels status` snapshots for IM instances.
 *
 * `web.yml` is the only truth source. The lock file says which process hosts
 * which instance ids; it is not a second config store.
 */

import * as path from "node:path";
import type { ChannelInstanceConfig, ChannelPlatform, ImAgentProfile } from "../channels/im-config";
import { INSTANCE_ID_RE, credentialFields } from "../channels/im-config";
import { WeChatChannel, type WeChatCredentialSink } from "@linxiraos/pi-channels";
import type { WebConfig, WebConfigData } from "../config/web-config";
import { channelLockPath, type ChannelLockSnapshot, readChannelLock } from "./instance-lock";

export const CHANNEL_PLATFORMS: readonly ChannelPlatform[] = ["wechat", "feishu", "telegram", "discord", "qq"];

export function isChannelInstanceId(value: string): boolean {
	return INSTANCE_ID_RE.test(value);
}

export function isChannelPlatform(value: string): value is ChannelPlatform {
	return (CHANNEL_PLATFORMS as readonly string[]).includes(value);
}

export type ChannelHostingSource = "none" | "web.yml" | "flag" | "flag+web.yml";

export interface ChannelHostingPlan {
	shouldStart: boolean;
	source: ChannelHostingSource;
	enabled: string[];
}

export function resolveChannelHosting(
	webConfig: Pick<WebConfig, "getData">,
	channelsFlag: boolean,
): ChannelHostingPlan {
	const enabled = webConfig
		.getData()
		.channels.instances.filter(instance => instance.enabled)
		.map(instance => instance.id);
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

export interface ChannelStatusEntry {
	id: string;
	platform: ChannelPlatform;
	label: string;
	enabled: boolean;
	configured: boolean;
	running: boolean;
	boundPeers: number;
	agentProfileId: string;
	agentProfileLabel: string;
	targetDisplay: string;
	targetAvailable: boolean;
	targetReason?: string;
	login: "qr" | "credentials" | "endpoint";
}

export interface ChannelRuntimeStatus {
	hosting: boolean;
	pid: number | null;
	host: "serve" | "cli" | null;
	startedAt: string | null;
	sessionId: string | null;
	instances: string[];
	stale: boolean;
}

export interface ChannelsStatusJson {
	configPath: string;
	runtime: ChannelRuntimeStatus;
	instances: ChannelStatusEntry[];
}

function cred(instance: ChannelInstanceConfig, key: string): unknown {
	return instance.credentials[key];
}

function configuredFor(instance: ChannelInstanceConfig): boolean {
	switch (instance.platform) {
		case "wechat":
			return Boolean(cred(instance, "botToken"));
		case "feishu":
			return Boolean(cred(instance, "appId") && cred(instance, "appSecret"));
		case "telegram":
			return Boolean(cred(instance, "botToken"));
		case "discord":
			return Boolean(cred(instance, "botToken"));
		case "qq":
			return cred(instance, "mode") === "reverse" ? Boolean(cred(instance, "token")) : Boolean(cred(instance, "endpoint"));
	}
}

function boundPeers(data: WebConfigData, instanceId: string): number {
	const peers = new Set<string>();
	for (const binding of data.remote.imBindings ?? []) {
		if (binding.instanceId === instanceId) peers.add(binding.chatId);
	}
	const instance = data.channels.instances.find(candidate => candidate.id === instanceId);
	for (const peer of Object.keys(instance?.options?.peerTokens ?? {})) peers.add(peer);
	return peers.size;
}

function targetDisplay(profile: ImAgentProfile | undefined): { display: string; available: boolean; reason?: string } {
	if (!profile) return { display: "missing agent profile", available: false, reason: "unknown-profile" };
	const target = profile.location;
	if (target.kind === "workspace") return { display: `workspace:${target.workspace}`, available: true };
	if (target.kind === "team-pm") return { display: `Team ${target.team} · PM ${target.pm}`, available: true };
	return {
		display: `Team ${target.team} · PM ${target.pm} · engineer ${target.engineer}${target.repo ? ` · ${target.repo}` : ""}`,
		available: true,
	};
}

function runtimeFromLock(lock: ChannelLockSnapshot | null): ChannelRuntimeStatus {
	if (!lock) {
		return { hosting: false, pid: null, host: null, startedAt: null, sessionId: null, instances: [], stale: false };
	}
	const live = lock.alive && lock.metadata.pid !== 0;
	return {
		hosting: live,
		pid: lock.metadata.pid || null,
		host: lock.metadata.host,
		startedAt: lock.metadata.startedAt || null,
		sessionId: lock.metadata.sessionId ?? null,
		instances: live ? lock.metadata.instances.map(instance => instance.id) : [],
		stale: !lock.alive,
	};
}

export async function collectChannelStatus(
	webConfig: WebConfig,
	options: { lock?: ChannelLockSnapshot | null } = {},
): Promise<ChannelsStatusJson> {
	const data = webConfig.getData();
	const lock =
		options.lock !== undefined ? options.lock : await readChannelLock(channelLockPath(path.dirname(webConfig.path)));
	const runtime = runtimeFromLock(lock);
	const instances = data.channels.instances.map((instance): ChannelStatusEntry => {
		const profile = data.imAgents.find(candidate => candidate.id === instance.agentProfile);
		const target = targetDisplay(profile);
		return {
			id: instance.id,
			platform: instance.platform,
			label: instance.label,
			enabled: instance.enabled,
			configured: configuredFor(instance),
			running: runtime.hosting && runtime.instances.includes(instance.id),
			boundPeers: boundPeers(data, instance.id),
			agentProfileId: instance.agentProfile,
			agentProfileLabel: profile?.label ?? instance.agentProfile,
			targetDisplay: target.display,
			targetAvailable: target.available,
			...(target.reason ? { targetReason: target.reason } : {}),
			login: instance.platform === "wechat" ? "qr" : instance.platform === "qq" ? "endpoint" : "credentials",
		};
	});
	return { configPath: webConfig.path, runtime, instances };
}

export async function setChannelEnabled(
	webConfig: WebConfig,
	instanceId: string,
	enabled: boolean,
): Promise<{ instanceId: string; enabled: boolean }> {
	await webConfig.setInstance(instanceId, { enabled });
	return { instanceId, enabled };
}

export interface ChannelLogoutResult {
	instanceId: string;
	cleared: string[];
}

export interface WechatLogoutChannel {
	unbind(): Promise<void>;
}

export interface LogoutChannelOptions {
	createWechatChannel?: (options: ConstructorParameters<typeof WeChatChannel>[0]) => WechatLogoutChannel;
	customFetch?: typeof globalThis.fetch;
}

/** Clear one instance's credentials; WeChat also asks iLink to reset. */
export async function logoutChannel(
	webConfig: WebConfig,
	instanceId: string,
	options: LogoutChannelOptions = {},
): Promise<ChannelLogoutResult> {
	const instance = webConfig.getChannelInstance(instanceId);
	if (!instance) throw new Error(`Unknown channel instance: ${instanceId}`);
	const fields = credentialFields(instance.platform);
	if (instance.platform === "wechat") {
		const sink: WeChatCredentialSink = {
			setField: async (field, value) => {
				await webConfig.setInstance(instanceId, {
					credentials: { ...(instance.credentials as Record<string, unknown>), [field]: value },
				});
			},
			setPeerTokens: async peerTokens => {
				await webConfig.setInstance(instanceId, { options: { ...instance.options, peerTokens } });
			},
			clear: async () => {
				await webConfig.setInstance(instanceId, { credentials: {}, options: { ...instance.options, peerTokens: {} } });
			},
		};
		const create =
			options.createWechatChannel ??
			((channelOptions: ConstructorParameters<typeof WeChatChannel>[0]) => new WeChatChannel(channelOptions));
		const adapter = create({
			instanceId,
			config: {
				botToken: cred(instance, "botToken") as string | undefined,
				ilinkBotId: cred(instance, "ilinkBotId") as string | undefined,
				ilinkUserId: cred(instance, "ilinkUserId") as string | undefined,
				baseUrl: cred(instance, "baseUrl") as string | undefined,
				endpoint: cred(instance, "endpoint") as string | undefined,
				peerTokens: instance.options?.peerTokens,
			},
			credentialSink: sink,
			onMessage: () => {},
			...(options.customFetch ? { customFetch: options.customFetch } : {}),
		});
		await adapter.unbind();
		return { instanceId, cleared: fields };
	}
	await webConfig.setInstance(instanceId, { credentials: {} });
	return { instanceId, cleared: fields };
}

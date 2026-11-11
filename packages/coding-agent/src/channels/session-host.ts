/**
 * Host the IM channel runtime from a normal CLI/TUI session.
 *
 * One process hosts every enabled instance. The lock records instance ids and
 * platforms; an unpaired WeChat instance is left out so a terminal QR login is
 * not competing with a hidden adapter login.
 */

import * as path from "node:path";
import type {
	ChannelInstanceId,
	ChannelRuntime,
	ChannelSession,
	ChannelsWebConfig,
	WeChatQrStatus,
} from "@linxiraos/pi-channels";
import { startChannels } from "@linxiraos/pi-channels";
import { CLI_BIN_NAME, logger } from "@linxiraos/pi-utils";
import type { WebConfig } from "../config/web-config";
import { resolveChannelHosting } from "./channel-status";
import { acquireChannelLock, channelLockPath, type ChannelLockHandle } from "./instance-lock";

export interface SessionChannelHost {
	readonly runtime: ChannelRuntime;
	readonly instances: string[];
	readonly host: "cli" | "serve";
	lastInbound: { instanceId: string; peer: string } | null;
	stop(): Promise<void>;
}

let activeHost: SessionChannelHost | null = null;
let lastContext: StartSessionChannelsOptions | null = null;

export type StartSessionChannelsResult =
	| { started: true; host: SessionChannelHost }
	| {
			started: false;
			reason: "already-running" | "not-enabled" | "unpaired" | "instance-lock" | "start-failed";
			message: string;
			instances: string[];
	  };

export interface StartSessionChannelsOptions {
	session: ChannelSession;
	webConfig: WebConfig;
	flag?: boolean;
	lockPath?: string;
	host?: "cli" | "serve";
	sessionId?: string;
	onQrCode?: (instanceId: string, payload: WeChatQrStatus) => void;
	startChannels?: typeof startChannels;
}

function defaultQrHint(instanceId: string, payload: WeChatQrStatus): void {
	if (payload.status === "confirmed") return;
	process.stderr.write(
		`[channels] WeChat instance ${instanceId} needs pairing; run \`${CLI_BIN_NAME} channels login wechat --instance ${instanceId}\`.\n`,
	);
}

export async function startSessionChannels(options: StartSessionChannelsOptions): Promise<StartSessionChannelsResult> {
	lastContext = options;
	const plan = resolveChannelHosting(options.webConfig, options.flag === true);
	if (!plan.shouldStart) {
		return {
			started: false,
			reason: "not-enabled",
			message: "No IM channel instance is enabled: add one under channels.instances or pass --channels.",
			instances: [],
		};
	}
	if (activeHost) {
		return {
			started: false,
			reason: "already-running",
			message:
				`IM channels are already hosted by this process (pid ${process.pid}). ` +
				"Stop that session before starting another host.",
			instances: [...activeHost.instances],
		};
	}

	const data = options.webConfig.getData();
	const unpairedWechat = data.channels.instances.filter(
		instance => instance.enabled && instance.platform === "wechat" && !instance.credentials.botToken,
	);
	let effectiveWebConfig: ChannelsWebConfig = options.webConfig;
	if (unpairedWechat.length > 0) {
		const unpairedIds = new Set(unpairedWechat.map(instance => instance.id));
		const hostable = plan.enabled.filter(id => !unpairedIds.has(id));
		if (hostable.length === 0) {
			return {
				started: false,
				reason: "unpaired",
				message:
					`WeChat instance(s) ${[...unpairedIds].join(", ")} are not paired: run ` +
					`\`${CLI_BIN_NAME} channels login wechat --instance <id>\`, then retry.`,
				instances: [],
			};
		}
		process.stderr.write(
			`[channels] WeChat instance(s) ${[...unpairedIds].join(", ")} are not paired; skipping them until paired.\n`,
		);
		effectiveWebConfig = {
			getData: () => {
				const current = options.webConfig.getData();
				current.channels.instances = current.channels.instances.map(instance =>
					unpairedIds.has(instance.id) ? { ...instance, enabled: false } : instance,
				);
				return current;
			},
			set: (pathToSet, value) => options.webConfig.set(pathToSet, value),
			setInstance: (id, patch) => options.webConfig.setInstance(id, patch),
		};
	}

	const lockPath = options.lockPath ?? channelLockPath(path.dirname(options.webConfig.path));
	const hostKind = options.host ?? "cli";
	const planned = data.channels.instances
		.filter(instance => instance.enabled && !unpairedWechat.some(unpaired => unpaired.id === instance.id))
		.map(instance => ({ id: instance.id, platform: instance.platform }));
	const acquired = await acquireChannelLock({
		lockPath,
		metadata: {
			pid: process.pid,
			host: hostKind,
			cwd: process.cwd(),
			sessionId: options.sessionId,
			instances: planned,
		},
	});
	if (!acquired.ok) {
		return { started: false, reason: "instance-lock", message: acquired.message, instances: plan.enabled };
	}

	const lock: ChannelLockHandle = acquired.lock;
	let runtime: ChannelRuntime;
	try {
		const start = options.startChannels ?? startChannels;
		runtime = await start(
			options.session,
			effectiveWebConfig,
			undefined,
			(instanceId, payload) => {
				options.onQrCode?.(instanceId, payload);
				defaultQrHint(instanceId, payload);
			},
			{ stateDir: path.dirname(options.webConfig.path) },
		);
		const instances = [...runtime.channels.keys()];
		await lock.update({
			instances: instances.map(id => ({
				id,
				platform: runtime.channels.get(id)?.platform ?? "wechat",
			})),
		});
		const host: SessionChannelHost = {
			runtime,
			instances,
			host: hostKind,
			get lastInbound() {
				return runtime.host.lastInbound;
			},
			async stop() {
				try {
					await runtime.stop();
				} finally {
					await lock.release();
					if (activeHost === host) activeHost = null;
				}
			},
		};
		activeHost = host;
		logger.info("IM channel instances started from a CLI session", { instances });
		return { started: true, host };
	} catch (error) {
		await lock.release();
		return {
			started: false,
			reason: "start-failed",
			message: error instanceof Error ? error.message : String(error),
			instances: plan.enabled,
		};
	}
}

export async function sendFromSessionChannel(opts: {
	text: string;
	to?: string;
	instance?: string;
	channel?: string;
}): Promise<void> {
	const host = activeHost;
	if (!host) throw new Error("IM channels are not started in this session");
	const last = host.lastInbound;
	let instanceId = opts.instance;
	if (!instanceId && opts.channel) {
		const matches = [...host.runtime.channels.values()].filter(channel => channel.platform === opts.channel);
		if (matches.length === 1) instanceId = matches[0]!.id;
		else if (matches.length > 1) throw new Error(`Ambiguous platform "${opts.channel}"; name one with instance=<id>.`);
	}
	instanceId ??= last?.instanceId;
	const to = opts.to ?? (instanceId === last?.instanceId ? last?.peer : undefined);
	if (!instanceId) throw new Error("No channel instance is bound to this session; name one with instance=<id>.");
	if (!to) throw new Error(`No peer is bound to instance ${instanceId}; name one with to=<peer>.`);
	if (!host.runtime.channels.has(instanceId)) throw new Error(`Channel instance not enabled: ${instanceId}`);
	await host.runtime.sendText(instanceId, to, opts.text);
}

export function hasActiveSessionChannels(): boolean {
	return activeHost !== null;
}

export function rememberSessionChannelContext(options: StartSessionChannelsOptions): void {
	lastContext = options;
}

export async function restartSessionChannels(): Promise<StartSessionChannelsResult | null> {
	if (!lastContext) return null;
	if (activeHost) await activeHost.stop();
	return await startSessionChannels(lastContext);
}

export async function suspendActiveSessionChannels(): Promise<boolean> {
	if (!activeHost) return false;
	await activeHost.stop();
	return true;
}

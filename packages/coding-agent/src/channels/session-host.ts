/**
 * Host the IM channel runtime from a normal CLI/TUI session.
 *
 * `startChannels` is transport-agnostic: it only needs the four-method
 * `ChannelSession` contract that `AgentSession` already implements. This
 * module owns the process-level pieces the gateway used to get from
 * `ZetaServer`: config/flag resolution, the single-instance lock, the outbound
 * sink used by `channel_send`, and stop-on-session-end semantics.
 *
 * The web gateway keeps reading the in-process runtime (`registerChannelStatus`
 * in `zeta-server.ts`); a CLI host never starts a server and never becomes a
 * second source of truth for config or routes.
 */

import * as path from "node:path";
import type {
	ChannelId,
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
	readonly channels: ChannelId[];
	readonly host: "cli" | "serve";
	lastInbound: { channelId: ChannelId; peer: string } | null;
	stop(): Promise<void>;
}

let activeHost: SessionChannelHost | null = null;

export type StartSessionChannelsResult =
	| { started: true; host: SessionChannelHost }
	| {
			started: false;
			reason: "already-running" | "not-enabled" | "instance-lock" | "start-failed";
			message: string;
			channels: ChannelId[];
	  };

export interface StartSessionChannelsOptions {
	session: ChannelSession;
	webConfig: WebConfig;
	/** `--channels` on the launch surface. */
	flag?: boolean;
	/** Test seam; production uses `<agent dir>/run/channels.lock`. */
	lockPath?: string;
	/** Which surface owns the lock; normal sessions are `cli`, serve passes `serve`. */
	host?: "cli" | "serve";
	sessionId?: string;
	/** Extra QR observer (the default prints a one-line pairing hint). */
	onQrCode?: (payload: WeChatQrStatus) => void;
	/** Test seam. */
	startChannels?: typeof startChannels;
}

function defaultQrHint(payload: WeChatQrStatus): void {
	if (payload.status === "confirmed") return;
	process.stderr.write(
		`[channels] WeChat pairing needed; run \`${CLI_BIN_NAME} channels login wechat\` in a terminal to scan.\n`,
	);
}

/**
 * Start the runtime for one session. A second host in the same process, or a
 * live lock from another process, is refused with a message that names the
 * holder — never silently ignored.
 */
export async function startSessionChannels(options: StartSessionChannelsOptions): Promise<StartSessionChannelsResult> {
	const plan = resolveChannelHosting(options.webConfig, options.flag === true);
	if (!plan.shouldStart) {
		return {
			started: false,
			reason: "not-enabled",
			message: "No IM channel is enabled: set channels.<id>.enabled in web.yml or pass --channels.",
			channels: [],
		};
	}
	if (activeHost) {
		return {
			started: false,
			reason: "already-running",
			message:
				`IM channels are already hosted by this process (pid ${process.pid}). ` +
				"Stop that session before starting another host.",
			channels: [...activeHost.channels],
		};
	}

	// WeChat without a token would start the adapter's QR login inside the
	// session, competing with `zetacode channels login wechat` for the scan.
	// The CLI path pairs explicitly, then the next host uses the token.
	const data = options.webConfig.getData();
	let effectiveWebConfig: ChannelsWebConfig = options.webConfig;
	if (data.channels.wechat.enabled && !data.channels.wechat.botToken) {
		process.stderr.write(
			`[channels] WeChat is enabled but not paired; run \`${CLI_BIN_NAME} channels login wechat\`, then restart this session.\n`,
		);
		effectiveWebConfig = {
			getData: () => {
				const current = options.webConfig.getData();
				current.channels.wechat.enabled = false;
				return current;
			},
			set: (pathToSet, value) => options.webConfig.set(pathToSet, value),
		};
	}

	const lockPath = options.lockPath ?? channelLockPath(path.dirname(options.webConfig.path));
	const hostKind = options.host ?? "cli";
	const acquired = await acquireChannelLock({
		lockPath,
		metadata: {
			pid: process.pid,
			host: hostKind,
			cwd: process.cwd(),
			sessionId: options.sessionId,
			channels: [],
		},
	});
	if (!acquired.ok) {
		return {
			started: false,
			reason: "instance-lock",
			message: acquired.message,
			channels: plan.enabled,
		};
	}

	const lock: ChannelLockHandle = acquired.lock;
	let runtime: ChannelRuntime;
	let lastQr = "";
	try {
		const start = options.startChannels ?? startChannels;
		runtime = await start(options.session, effectiveWebConfig, undefined, payload => {
			if (payload.status === "confirmed" || payload.qrcodeUrl === lastQr) return;
			lastQr = payload.qrcodeUrl;
			options.onQrCode?.(payload);
			defaultQrHint(payload);
		});
		const channels = [...runtime.channels.keys()];
		await lock.update({ channels });
		const host: SessionChannelHost = {
			runtime,
			channels,
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
		logger.info("IM channels started from a CLI session", { channels });
		return { started: true, host };
	} catch (error) {
		await lock.release();
		return {
			started: false,
			reason: "start-failed",
			message: error instanceof Error ? error.message : String(error),
			channels: plan.enabled,
		};
	}
}

/**
 * Outbound sink for `channel_send`. Resolves like the serve coordinator: an
 * explicit channel/peer wins; otherwise the last inbound chat is the target.
 */
export async function sendFromSessionChannel(opts: { text: string; to?: string; channel?: string }): Promise<void> {
	const host = activeHost;
	if (!host) throw new Error("IM channels are not started in this session");
	const last = host.lastInbound;
	const channel = (opts.channel as ChannelId | undefined) ?? last?.channelId;
	const to = opts.to ?? (channel === last?.channelId ? last?.peer : undefined);
	if (!channel) throw new Error("No channel is bound to this session; name one with channel=<id>.");
	if (!to) throw new Error(`No peer is bound to channel ${channel}; name one with to=<peer>.`);
	if (!host.runtime.channels.has(channel)) throw new Error(`Channel not enabled: ${channel}`);
	await host.runtime.sendText(channel, to, opts.text);
}

/** True when this process currently hosts channels (used by lifecycle wiring). */
export function hasActiveSessionChannels(): boolean {
	return activeHost !== null;
}

/**
 * `zetacode channels` — inspect, pair, and toggle IM channels without a
 * browser or a running web server.
 *
 * `status`, `logout`, `enable`, and `disable` read/write the same `web.yml`
 * the GUI and `zeta serve` use. `login wechat` prints the QR in the terminal
 * and drives the same adapter that persists credentials during serve. The
 * command never hosts the runtime itself; a normal CLI/TUI session does that
 * when a channel is enabled (see `channels/session-host.ts`).
 */

import * as path from "node:path";
import type { ChannelId } from "@linxiraos/pi-channels";
import chalk from "@linxiraos/pi-utils/chalk";
import { Args, CliUsageError, Command, Flags } from "@linxiraos/pi-utils/cli";
import { CLI_BIN_NAME } from "@linxiraos/pi-utils/dirs";
import { channelsHelp } from "../cli/command-help";
import {
	CHANNEL_IDS,
	collectChannelStatus,
	isChannelId,
	logoutChannel,
	setChannelEnabled,
} from "../channels/channel-status";
import { acquireChannelLock, channelLockPath } from "../channels/instance-lock";
import { renderTerminalQr } from "../channels/qr-terminal";
import {
	runWechatLogin,
	wechatQrDisplayPayload,
	type WechatLoginResult,
	type WechatLoginState,
} from "../channels/wechat-login";
import { WebConfig } from "../config/web-config";

const ACTIONS = ["status", "login", "logout", "enable", "disable"] as const;
type ChannelsAction = (typeof ACTIONS)[number];

function isChannelsAction(value: string): value is ChannelsAction {
	return ACTIONS.includes(value as ChannelsAction);
}

const USAGE: Record<ChannelsAction, string> = {
	status: `${CLI_BIN_NAME} channels status [--json]`,
	login: `${CLI_BIN_NAME} channels login <channel> [--json] [--timeout <seconds>]`,
	logout: `${CLI_BIN_NAME} channels logout <channel> [--json]`,
	enable: `${CLI_BIN_NAME} channels enable <channel> [--json]`,
	disable: `${CLI_BIN_NAME} channels disable <channel> [--json]`,
};

function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function requireChannel(action: ChannelsAction, channel: string | undefined): ChannelId {
	if (!channel) throw new CliUsageError(`Missing channel. Usage: ${USAGE[action]}`);
	if (!isChannelId(channel)) {
		throw new CliUsageError(`Unknown channel "${channel}". Expected one of: ${CHANNEL_IDS.join(", ")}`);
	}
	return channel;
}

function loginStateLabel(state: WechatLoginState): string {
	switch (state) {
		case "pending":
			return "waiting for scan";
		case "scanned":
			return "scanned — confirm in WeChat";
		case "connected":
			return "connected";
		case "timeout":
			return "timed out";
	}
}

export default class Channels extends Command {
	static description = channelsHelp.description;

	static args = {
		action: Args.string({
			description: "status, login, logout, enable, or disable",
			required: true,
			options: ACTIONS,
		}),
		channel: Args.string({
			description: "Channel id: wechat, feishu, or telegram (login/logout/enable/disable)",
			required: false,
		}),
	};

	static flags = {
		json: Flags.boolean({ description: "Machine-readable JSON on stdout" }),
		timeout: Flags.integer({
			description: "Seconds to wait for a WeChat scan (login; default 180)",
			default: 180,
		}),
	};

	static examples = [
		`# Is a bot running, and which channels are enabled?\n  ${CLI_BIN_NAME} channels status --json`,
		`# Pair WeChat from this terminal (no browser)\n  ${CLI_BIN_NAME} channels login wechat`,
		`# Forget WeChat credentials and peer bindings\n  ${CLI_BIN_NAME} channels logout wechat`,
		`# Enable a channel for the next CLI/TUI session or serve run\n  ${CLI_BIN_NAME} channels enable telegram`,
	];

	async run(): Promise<void> {
		const { args, flags, argv } = await this.parse(Channels);
		const action = args.action ?? "";
		if (!isChannelsAction(action)) throw new CliUsageError(`Unknown action: ${action}`);
		if (argv.length > (action === "status" ? 1 : 2)) {
			throw new CliUsageError(`Unexpected argument "${argv.at(-1)}". Usage: ${USAGE[action]}`);
		}

		const webConfig = await WebConfig.load();

		switch (action) {
			case "status": {
				const status = await collectChannelStatus(webConfig);
				if (flags.json) {
					writeJson(status);
					return;
				}
				console.log(chalk.bold(`\n  IM channels (${status.configPath})\n`));
				if (status.runtime.hosting) {
					console.log(
						chalk.green(
							`  Hosted by pid ${status.runtime.pid} (${status.runtime.host}, started ${status.runtime.startedAt})`,
						),
					);
				} else if (status.runtime.stale) {
					console.log(chalk.yellow(`  Stale lock from pid ${status.runtime.pid}; no live host.`));
				} else {
					console.log(chalk.dim("  No CLI session or serve process is hosting channels."));
				}
				console.log("");
				for (const entry of status.channels) {
					const state = [
						entry.enabled ? chalk.green("enabled") : chalk.dim("disabled"),
						entry.running ? chalk.green("running") : chalk.dim("stopped"),
						entry.configured ? null : chalk.yellow("not configured"),
					]
						.filter(Boolean)
						.join(", ");
					const route = entry.workspaceRoute.workspaceRoot
						? `${entry.workspaceRoute.workspaceRoot}${entry.workspaceRoute.alias ? ` [${entry.workspaceRoute.alias}]` : ""}`
						: "session default";
					console.log(
						`  ${entry.id.padEnd(9)} ${state}  peers=${entry.boundPeers}  route=${route}  login=${entry.login}`,
					);
				}
				console.log("");
				return;
			}
			case "enable":
			case "disable": {
				const channel = requireChannel(action, args.channel);
				const result = await setChannelEnabled(webConfig, channel, action === "enable");
				if (flags.json) {
					writeJson(result);
					return;
				}
				console.log(
					`${channel} ${result.enabled ? "enabled" : "disabled"} in ${webConfig.path}. ` +
						(result.enabled
							? `The next \`${CLI_BIN_NAME}\` session or \`${CLI_BIN_NAME} serve\` will start it.`
							: "Running hosts keep it until they restart."),
				);
				return;
			}
			case "logout": {
				const channel = requireChannel(action, args.channel);
				const result = await logoutChannel(webConfig, channel);
				if (flags.json) {
					writeJson({ channel: result.channel, loggedOut: true, cleared: result.cleared });
					return;
				}
				console.log(`${channel}: logged out; cleared ${result.cleared.join(", ")}.`);
				return;
			}
			case "login": {
				const channel = requireChannel(action, args.channel);
				if (channel !== "wechat") {
					const message = `${channel} has no QR login; set its credentials in web.yml or the GUI.`;
					if (flags.json) writeJson({ channel, state: "unsupported", error: message });
					else process.stderr.write(`${chalk.yellow(`${message}\n`)}`);
					process.exitCode = 1;
					return;
				}
				// A QR login rewrites the bot credentials a host binds, so it takes
				// the same single-instance lock as a host: a second login (or a
				// login racing a running host) would fight over the same bot.
				const acquired = await acquireChannelLock({
					lockPath: channelLockPath(path.dirname(webConfig.path)),
					metadata: {
						pid: process.pid,
						host: "cli",
						cwd: process.cwd(),
						channels: [channel],
					},
				});
				if (!acquired.ok) {
					if (flags.json) writeJson({ channel, state: "locked", error: acquired.message });
					else process.stderr.write(chalk.red(`${acquired.message}\n`));
					process.exitCode = 1;
					return;
				}
				try {
					await this.#loginWechat(channel, flags.json === true, Math.max(1, flags.timeout ?? 180), webConfig);
				} finally {
					await acquired.lock.release();
				}
				return;
			}
		}
	}

	/** The WeChat QR login body (lock already held by {@link run}). */
	async #loginWechat(channel: ChannelId, json: boolean, timeoutSeconds: number, webConfig: WebConfig): Promise<void> {
		let lastRendered = "";
		let result: WechatLoginResult;
		try {
			result = await runWechatLogin({
				webConfig,
				timeoutMs: timeoutSeconds * 1_000,
				onQrCode: payload => {
					if (json) return;
					const display = wechatQrDisplayPayload(payload);
					if (payload.status === "confirmed") return;
					if (payload.status === "expired") {
						process.stderr.write(chalk.yellow("QR expired; fetching a fresh one...\n"));
						return;
					}
					if (display !== "" && display !== lastRendered) {
						lastRendered = display;
						const qr = renderTerminalQr(display, {
							columns: process.stdout.columns,
							color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
						});
						process.stdout.write(`\nScan this QR code with WeChat:\n\n${qr.lines.join("\n")}\n\n`);
						if (qr.kind === "fallback") {
							process.stderr.write(chalk.dim(`(rendered as text: ${qr.reason})\n`));
						}
					}
				},
				onState: state => {
					if (!json && state === "scanned") {
						process.stderr.write(chalk.dim("Scanned — confirm in WeChat.\n"));
					}
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (json) writeJson({ channel, state: "error", timeoutSeconds, error: message });
			else process.stderr.write(chalk.red(`WeChat login failed: ${message}\n`));
			process.exitCode = 1;
			return;
		}
		if (json) {
			writeJson({
				channel,
				state: result.state,
				qrcode: result.qrcode ? wechatQrDisplayPayload(result.qrcode) : null,
				timeoutSeconds,
				credentialsPersisted: result.credentialsPersisted,
				...(result.error ? { error: result.error } : {}),
			});
		} else if (result.state === "connected") {
			console.log(chalk.green(`\nWeChat connected. Credentials saved to ${webConfig.path}.`));
		} else {
			process.stderr.write(chalk.red(`\nWeChat login ${loginStateLabel(result.state)}.\n`));
		}
		if (result.state !== "connected") process.exitCode = 1;
	}
}

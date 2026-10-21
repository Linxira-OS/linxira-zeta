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
import { formatCredentialIdentity, runCredentialLogin, type CredentialLoginResult } from "../channels/credential-login";
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

/**
 * Read one line from the terminal, without echoing it when `secret` is true.
 * A non-interactive stdin yields `""`; the caller turns that into a usage
 * error instead of hanging on a pipe that will never answer.
 */
async function promptFor(label: string, secret: boolean): Promise<string> {
	const stdin = process.stdin;
	if (!stdin.isTTY) return "";
	process.stdout.write(label);
	return await new Promise<string>(resolve => {
		let value = "";
		const finish = (result: string): void => {
			stdin.setRawMode(false);
			stdin.pause();
			stdin.off("data", onData);
			process.stdout.write("\n");
			resolve(result.trim());
		};
		const onData = (chunk: Buffer): void => {
			for (const char of chunk.toString("utf8")) {
				if (char === "\r" || char === "\n") {
					finish(value);
					return;
				}
				if (char === "\u0003") {
					process.exitCode = 130;
					finish("");
					return;
				}
				if (char === "\u007f" || char === "\b") {
					value = value.slice(0, -1);
					continue;
				}
				value += char;
				if (!secret) process.stdout.write(char);
			}
		};
		if (secret) stdin.setRawMode(true);
		stdin.resume();
		stdin.on("data", onData);
	});
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
		"app-id": Flags.string({ description: "Feishu app id (login feishu)" }),
		"app-secret": Flags.string({ description: "Feishu app secret (login feishu)" }),
		domain: Flags.string({
			description: "Feishu deployment: feishu or lark (login feishu)",
			options: ["feishu", "lark"],
		}),
		token: Flags.string({ description: "Telegram bot token (login telegram)" }),
	};

	static examples = [
		`# Is a bot running, and which channels are enabled?\n  ${CLI_BIN_NAME} channels status --json`,
		`# Pair WeChat from this terminal (no browser)\n  ${CLI_BIN_NAME} channels login wechat`,
		`# Validate a Feishu app credential, then save it\n  ${CLI_BIN_NAME} channels login feishu --app-id cli_… --app-secret …`,
		`# Validate a Telegram bot token with getMe, then save it\n  ${CLI_BIN_NAME} channels login telegram --token 123:ABC`,
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
					await this.#loginCredentials(
						channel,
						{
							json: flags.json === true,
							appId: flags["app-id"],
							appSecret: flags["app-secret"],
							domain: flags.domain as "feishu" | "lark" | undefined,
							token: flags.token,
						},
						webConfig,
					);
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

	/**
	 * Feishu / Telegram pair with a pasted credential, not a QR code. The
	 * platform validates it before anything is written; the same words as the
	 * WeChat flow are used (`connected`, `error`, `timeout`).
	 */
	async #loginCredentials(
		channel: Exclude<ChannelId, "wechat">,
		options: {
			json: boolean;
			appId?: string;
			appSecret?: string;
			domain?: "feishu" | "lark";
			token?: string;
		},
		webConfig: WebConfig,
	): Promise<void> {
		const stored = webConfig.getData();
		const label = channel === "feishu" ? "Feishu" : "Telegram";
		let result: CredentialLoginResult;

		if (channel === "feishu") {
			const saved = stored.channels.feishu;
			const appId =
				options.appId?.trim() ||
				saved.appId?.trim() ||
				(options.json ? "" : await promptFor("Feishu App ID: ", false));
			const appSecret =
				options.appSecret?.trim() ||
				saved.appSecret?.trim() ||
				(options.json ? "" : await promptFor("Feishu App Secret: ", true));
			if (!appId || !appSecret) {
				throw new CliUsageError(
					`Missing Feishu credentials. Usage: ${CLI_BIN_NAME} channels login feishu --app-id <id> --app-secret <secret>`,
				);
			}
			if (!options.json) process.stdout.write(chalk.dim("Validating with Feishu…\n"));
			result = await runCredentialLogin(channel, {
				webConfig,
				appId,
				appSecret,
				domain: options.domain ?? saved.domain ?? "feishu",
			});
		} else {
			const saved = stored.channels.telegram;
			const token =
				options.token?.trim() ||
				saved.botToken?.trim() ||
				(options.json ? "" : await promptFor("Telegram bot token: ", true));
			if (!token) {
				throw new CliUsageError(
					`Missing Telegram bot token. Usage: ${CLI_BIN_NAME} channels login telegram --token <token>`,
				);
			}
			if (!options.json) process.stdout.write(chalk.dim("Validating with Telegram (getMe)…\n"));
			result = await runCredentialLogin(channel, { webConfig, botToken: token });
		}

		if (options.json) {
			writeJson({
				channel,
				state: result.state,
				identity: result.identity,
				credentialsPersisted: result.credentialsPersisted,
				...(result.error ? { error: result.error } : {}),
			});
		} else if (result.state === "connected") {
			const who = formatCredentialIdentity(result.identity);
			console.log(
				chalk.green(`\n${label} connected${who ? ` as ${who}` : ""}. Credentials saved to ${webConfig.path}.`),
			);
		} else {
			process.stderr.write(
				chalk.red(`\n${label} login ${result.state === "timeout" ? "timed out" : "failed"}: ${result.error}\n`),
			);
		}
		if (result.state !== "connected") process.exitCode = 1;
	}
}

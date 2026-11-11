/**
 * `zetacode channels` — inspect, pair, and toggle IM channel instances.
 *
 * Every action names an instance id from `channels.instances`. The platform is
 * inferred from that instance; there is no platform-wide credential path.
 */

import * as path from "node:path";
import chalk from "@linxiraos/pi-utils/chalk";
import { Args, CliUsageError, Command, Flags } from "@linxiraos/pi-utils/cli";
import { CLI_BIN_NAME } from "@linxiraos/pi-utils/dirs";
import { channelsHelp } from "../cli/command-help";
import { collectChannelStatus, isChannelInstanceId, logoutChannel, setChannelEnabled } from "../channels/channel-status";
import {
	acquireChannelLock,
	channelLockPath,
	channelPairingLockPath,
	wechatPairingBlockedByHost,
} from "../channels/instance-lock";
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
	login: `${CLI_BIN_NAME} channels login <instance-id> [--json] [--timeout <seconds>]`,
	logout: `${CLI_BIN_NAME} channels logout <instance-id> [--json]`,
	enable: `${CLI_BIN_NAME} channels enable <instance-id> [--json]`,
	disable: `${CLI_BIN_NAME} channels disable <instance-id> [--json]`,
};

function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function requireInstance(action: ChannelsAction, value: string | undefined): string {
	if (!value) throw new CliUsageError(`Missing instance id. Usage: ${USAGE[action]}`);
	if (!isChannelInstanceId(value)) throw new CliUsageError(`Invalid instance id "${value}".`);
	return value;
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
			description: "Channel instance id (login/logout/enable/disable)",
			required: false,
		}),
	};

	static flags = {
		json: Flags.boolean({ description: "Machine-readable JSON on stdout" }),
		timeout: Flags.integer({
			description: "Seconds to wait for a WeChat scan (login; default 180)",
			default: 180,
		}),
		"app-id": Flags.string({ description: "Feishu app id (login feishu instance)" }),
		"app-secret": Flags.string({ description: "Feishu app secret (login feishu instance)" }),
		domain: Flags.string({ description: "Feishu deployment: feishu or lark", options: ["feishu", "lark"] }),
		token: Flags.string({ description: "Bot token / OneBot access token" }),
		endpoint: Flags.string({ description: "OneBot WebSocket URL (forward mode)" }),
		mode: Flags.string({ description: "OneBot transport: forward or reverse", options: ["forward", "reverse"] }),
		port: Flags.integer({ description: "Reverse OneBot listen port" }),
	};

	static examples = [
		`# Instance status\n  ${CLI_BIN_NAME} channels status --json`,
		`# Pair a WeChat instance\n  ${CLI_BIN_NAME} channels login wx-main`,
		`# Validate a Feishu instance\n  ${CLI_BIN_NAME} channels login fs-roleplay --app-id cli_… --app-secret …`,
		`# Validate a Discord instance\n  ${CLI_BIN_NAME} channels login dc-roleplay --token MTIz…`,
		`# Validate an OneBot instance\n  ${CLI_BIN_NAME} channels login qq-pm --endpoint ws://127.0.0.1:3001 --token abc`,
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
				console.log(chalk.bold(`\n  IM instances (${status.configPath})\n`));
				if (status.runtime.hosting) {
					console.log(chalk.green(`  Hosted by pid ${status.runtime.pid} (${status.runtime.host})`));
				} else if (status.runtime.stale) {
					console.log(chalk.yellow(`  Stale lock from pid ${status.runtime.pid}; no live host.`));
				} else {
					console.log(chalk.dim("  No CLI session or serve process is hosting channels."));
				}
				console.log("");
				for (const entry of status.instances) {
					const state = [
						entry.enabled ? chalk.green("enabled") : chalk.dim("disabled"),
						entry.running ? chalk.green("running") : chalk.dim("stopped"),
						entry.configured ? null : chalk.yellow("not configured"),
					]
						.filter(Boolean)
						.join(", ");
					console.log(
						`  ${entry.id.padEnd(14)} ${entry.platform.padEnd(9)} ${state}  agent=${entry.agentProfileId}  target=${entry.targetDisplay}  peers=${entry.boundPeers}  login=${entry.login}`,
					);
				}
				console.log("");
				return;
			}
			case "enable":
			case "disable": {
				const instanceId = requireInstance(action, args.channel);
				const result = await setChannelEnabled(webConfig, instanceId, action === "enable");
				if (flags.json) {
					writeJson(result);
					return;
				}
				console.log(`${instanceId} ${result.enabled ? "enabled" : "disabled"} in ${webConfig.path}.`);
				return;
			}
			case "logout": {
				const instanceId = requireInstance(action, args.channel);
				const result = await logoutChannel(webConfig, instanceId);
				if (flags.json) {
					writeJson({ instanceId: result.instanceId, loggedOut: true, cleared: result.cleared });
					return;
				}
				console.log(`${instanceId}: logged out; cleared ${result.cleared.join(", ")}.`);
				return;
			}
			case "login": {
				const instanceId = requireInstance(action, args.channel);
				const instance = webConfig.getChannelInstance(instanceId);
				if (!instance) throw new CliUsageError(`Unknown channel instance "${instanceId}".`);
				if (instance.platform !== "wechat") {
					await this.#loginCredentials(
						instanceId,
						instance.platform,
						{
							json: flags.json === true,
							appId: flags["app-id"],
							appSecret: flags["app-secret"],
							domain: flags.domain as "feishu" | "lark" | undefined,
							token: flags.token,
							endpoint: flags.endpoint,
							mode: flags.mode as "forward" | "reverse" | undefined,
							port: flags.port,
						},
						webConfig,
					);
					return;
				}
				const configDir = path.dirname(webConfig.path);
				const acquired = await acquireChannelLock({
					lockPath: `${channelPairingLockPath(configDir)}.${instanceId}`,
					metadata: {
						pid: process.pid,
						host: "cli",
						cwd: process.cwd(),
						instances: [{ id: instanceId, platform: "wechat" }],
					},
				});
				if (!acquired.ok) {
					if (flags.json) writeJson({ instanceId, state: "locked", error: acquired.message });
					else process.stderr.write(chalk.red(`${acquired.message}\n`));
					process.exitCode = 1;
					return;
				}
				try {
					const hostCheck = await wechatPairingBlockedByHost(channelLockPath(configDir));
					if (!hostCheck.ok) {
						if (flags.json) writeJson({ instanceId, state: "locked", error: hostCheck.message });
						else process.stderr.write(chalk.red(`${hostCheck.message}\n`));
						process.exitCode = 1;
						return;
					}
					await this.#loginWechat(instanceId, flags.json === true, Math.max(1, flags.timeout ?? 180), webConfig);
				} finally {
					await acquired.lock.release();
				}
				return;
			}
		}
	}

	async #loginWechat(instanceId: string, json: boolean, timeoutSeconds: number, webConfig: WebConfig): Promise<void> {
		let lastRendered = "";
		let result: WechatLoginResult;
		try {
			result = await runWechatLogin({
				webConfig,
				instanceId,
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
						process.stdout.write(`\nScan this QR code with WeChat (${instanceId}):\n\n${qr.lines.join("\n")}\n\n`);
					}
				},
				onState: state => {
					if (!json && state === "scanned") process.stderr.write(chalk.dim("Scanned — confirm in WeChat.\n"));
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (json) writeJson({ instanceId, state: "error", timeoutSeconds, error: message });
			else process.stderr.write(chalk.red(`WeChat login failed: ${message}\n`));
			process.exitCode = 1;
			return;
		}
		if (json) {
			writeJson({
				instanceId,
				state: result.state,
				qrcode: result.qrcode ? wechatQrDisplayPayload(result.qrcode) : null,
				timeoutSeconds,
				credentialsPersisted: result.credentialsPersisted,
				...(result.error ? { error: result.error } : {}),
			});
		} else if (result.state === "connected") {
			console.log(chalk.green(`\nWeChat instance ${instanceId} connected. Credentials saved to ${webConfig.path}.`));
		} else {
			process.stderr.write(chalk.red(`\nWeChat login ${loginStateLabel(result.state)}.\n`));
		}
		if (result.state !== "connected") process.exitCode = 1;
	}

	async #loginCredentials(
		instanceId: string,
		platform: "feishu" | "telegram" | "discord" | "qq",
		options: {
			json: boolean;
			appId?: string;
			appSecret?: string;
			domain?: "feishu" | "lark";
			token?: string;
			endpoint?: string;
			mode?: "forward" | "reverse";
			port?: number;
		},
		webConfig: WebConfig,
	): Promise<void> {
		const instance = webConfig.getChannelInstance(instanceId);
		if (!instance) throw new CliUsageError(`Unknown channel instance "${instanceId}".`);
		const label = platform === "feishu" ? "Feishu" : platform === "discord" ? "Discord" : platform === "qq" ? "QQ" : "Telegram";
		const stored = instance.credentials;
		const field = (key: string): string => (typeof stored[key] === "string" ? (stored[key] as string) : "");
		let result: CredentialLoginResult;

		if (platform === "feishu") {
			const appId = options.appId?.trim() || field("appId") || (options.json ? "" : await promptFor("Feishu App ID: ", false));
			const appSecret =
				options.appSecret?.trim() || field("appSecret") || (options.json ? "" : await promptFor("Feishu App Secret: ", true));
			if (!appId || !appSecret) {
				throw new CliUsageError(`Missing Feishu credentials. Usage: ${CLI_BIN_NAME} channels login ${instanceId} --app-id <id> --app-secret <secret>`);
			}
			if (!options.json) process.stdout.write(chalk.dim("Validating with Feishu…\n"));
			result = await runCredentialLogin(platform, {
				webConfig,
				instanceId,
				appId,
				appSecret,
				domain: options.domain ?? (field("domain") as "feishu" | "lark") ?? "feishu",
			});
		} else if (platform === "discord") {
			const token = options.token?.trim() || field("botToken") || (options.json ? "" : await promptFor("Discord bot token: ", true));
			if (!token) throw new CliUsageError(`Missing Discord bot token. Usage: ${CLI_BIN_NAME} channels login ${instanceId} --token <token>`);
			if (!options.json) process.stdout.write(chalk.dim("Validating with Discord (/users/@me)…\n"));
			result = await runCredentialLogin(platform, { webConfig, instanceId, botToken: token });
		} else if (platform === "qq") {
			const mode = options.mode ?? (field("mode") as "forward" | "reverse") ?? "forward";
			const token = options.token?.trim() || field("token") || "";
			const endpoint =
				options.endpoint?.trim() ||
				field("endpoint") ||
				(mode === "forward" && !options.json ? await promptFor("OneBot endpoint (ws://127.0.0.1:3001): ", false) : "");
			const port = options.port ?? (typeof stored.port === "number" ? stored.port : 8082);
			if (mode === "forward" && !endpoint) {
				throw new CliUsageError(`Missing OneBot endpoint. Usage: ${CLI_BIN_NAME} channels login ${instanceId} --endpoint ws://…`);
			}
			if (!options.json) process.stdout.write(chalk.dim(`Validating OneBot (${mode})…\n`));
			result = await runCredentialLogin(platform, {
				webConfig,
				instanceId,
				endpoint: endpoint || undefined,
				token: token || undefined,
				mode,
				port,
			});
		} else {
			const token = options.token?.trim() || field("botToken") || (options.json ? "" : await promptFor("Telegram bot token: ", true));
			if (!token) throw new CliUsageError(`Missing Telegram bot token. Usage: ${CLI_BIN_NAME} channels login ${instanceId} --token <token>`);
			if (!options.json) process.stdout.write(chalk.dim("Validating with Telegram (getMe)…\n"));
			result = await runCredentialLogin(platform, { webConfig, instanceId, botToken: token });
		}

		if (options.json) {
			writeJson({
				instanceId,
				platform,
				state: result.state,
				identity: result.identity,
				credentialsPersisted: result.credentialsPersisted,
				...(result.error ? { error: result.error } : {}),
			});
		} else if (result.state === "connected") {
			const who = formatCredentialIdentity(result.identity);
			console.log(chalk.green(`\n${label} instance ${instanceId} connected${who ? ` as ${who}` : ""}.`));
		} else {
			process.stderr.write(chalk.red(`\n${label} login ${result.state === "timeout" ? "timed out" : "failed"}: ${result.error}\n`));
		}
		if (result.state !== "connected") process.exitCode = 1;
	}
}

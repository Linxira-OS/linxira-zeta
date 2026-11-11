/**
 * `/channels` — operator entry for IM channels from inside the TUI.
 *
 * The CLI (`zetacode channels …`) remains the scriptable surface. This command
 * exists for the TUI-only user who cannot open a second terminal while the
 * session hosts channels: it can inspect status, toggle a channel, and run the
 * WeChat QR flow in-process after briefly suspending the host.
 *
 * The command is hidden from the everyday palette (`hidden: true`); an explicit
 * `/channels` still resolves through the builtin registry.
 */

import * as path from "node:path";
import type { ChannelId } from "@linxiraos/pi-channels";
import { CLI_BIN_NAME } from "@linxiraos/pi-utils";
import { Text } from "@linxiraos/pi-tui";
import {
	CHANNEL_IDS,
	collectChannelStatus,
	isChannelId,
	setChannelEnabled,
	type ChannelStatusEntry,
	type ChannelsStatusJson,
} from "../channels/channel-status";
import {
	acquireChannelLock,
	channelLockPath,
	channelPairingLockPath,
	wechatPairingBlockedByHost,
} from "../channels/instance-lock";
import {
	formatChannelsAdmin,
	legacyAdminBindings,
	legacyAdminInstances,
	mergeAdminStatus,
	parseAdminBindings,
	parseAdminInstances,
	type AdminTarget,
	type ChannelsAdminSnapshot,
} from "../channels/admin-view";
import { getChannelStatus } from "../channels";
import { renderTerminalQr } from "../channels/qr-terminal";
import { restartSessionChannels, suspendActiveSessionChannels } from "../channels/session-host";
import { runWechatLogin, wechatQrDisplayPayload, type WechatLoginResult } from "../channels/wechat-login";
import { WebConfig } from "../config/web-config";
import { M } from "../i18n";
import { commandConsumed } from "./helpers/parse";
import type { ParsedSlashCommand, SlashCommandSpec } from "./types";

const SUBCOMMANDS = [
	{ name: "status", description: () => M.cmdChannelsStatus },
	{ name: "instances", description: () => "instances / targets / bindings" },
	{ name: "enable-instance", description: () => "enable-instance <instance-id>" },
	{ name: "disable-instance", description: () => "disable-instance <instance-id>" },
	{ name: "login", description: () => M.cmdChannelsLogin },
	{ name: "enable", description: () => M.cmdChannelsEnable },
	{ name: "disable", description: () => M.cmdChannelsDisable },
	{ name: "logout", description: () => M.cmdChannelsLogout },
] as const;

const USAGE = [
	"Usage: /channels [status|instances|enable-instance|disable-instance|login|enable|disable|logout] [id]",
	"",
	"  /channels status",
	"  /channels instances              instances, targets and bindings (redacted)",
	"  /channels enable-instance <id>   per-instance switch (instances[] config)",
	"  /channels disable-instance <id>",
	"  /channels login wechat [timeout-seconds]",
	"  /channels login feishu|telegram   (prints the CLI command; secrets stay out of the transcript)",
	"  /channels enable <wechat|feishu|telegram>",
	"  /channels disable <wechat|feishu|telegram>",
	"  /channels logout <wechat|feishu|telegram>",
].join("\n");

function parseChannel(value: string | undefined): ChannelId | null {
	return value && isChannelId(value) ? value : null;
}

function statusLine(entry: ChannelStatusEntry): string {
	const state = [
		entry.enabled ? "enabled" : "disabled",
		entry.running ? "running" : "stopped",
		entry.configured ? "configured" : "not configured",
	].join(", ");
	const route = entry.workspaceRoute.workspaceRoot
		? `${entry.workspaceRoute.workspaceRoot}${entry.workspaceRoute.alias ? ` [${entry.workspaceRoute.alias}]` : ""}`
		: "session default";
	return `  ${entry.id.padEnd(9)} ${state}  peers=${entry.boundPeers}  route=${route}  login=${entry.login}`;
}

/** Build the redacted admin page from web.yml + the live runtime. */
async function collectAdminSnapshot(webConfig: WebConfig): Promise<ChannelsAdminSnapshot> {
	const data = webConfig.getData();
	const rich = await collectChannelStatus(webConfig);
	const live = getChannelStatus();
	const parsed = parseAdminInstances(data);
	const legacy = parsed === null;
	let instances = mergeAdminStatus(parsed ?? legacyAdminInstances(data), live);
	instances = instances.map(instance => {
		const entry = rich.channels.find(status => status.id === instance.id);
		if (entry === undefined) return instance;
		const target = entry.workspaceRoute.workspaceRoot;
		return {
			...instance,
			configured: entry.configured,
			...(target !== null ? { targetDisplay: entry.workspaceRoute.alias ?? target } : {}),
			...(entry.running !== instance.running ? { running: entry.running } : {}),
		};
	});
	const bindings = parseAdminBindings(data) ?? legacyAdminBindings(data);
	const seen = new Set<string>();
	const targets: AdminTarget[] = [];
	for (const binding of bindings) {
		if (binding.targetDisplay === undefined || seen.has(binding.targetDisplay)) continue;
		seen.add(binding.targetDisplay);
		targets.push({
			display: binding.targetDisplay,
			kind: "binding",
			available: binding.targetAvailable !== false && binding.needsReview !== true,
			...(binding.targetReason !== undefined ? { reason: binding.targetReason } : {}),
		});
	}
	const runtime = rich.runtime;
	const host = runtime.hosting
		? `hosted by pid ${runtime.pid} (${runtime.host}, started ${runtime.startedAt})`
		: runtime.stale
			? `stale lock from pid ${runtime.pid}; no live host`
			: "no live host";
	return {
		configPath: rich.configPath,
		host,
		...(legacy
			? {
					legacyNote:
						"web.yml is still on channels.<platform>; instances are synthesized (id = platform) until migration.",
				}
			: {}),
		instances,
		bindings,
		targets,
	};
}

/** The TUI context has no language accessor; the admin page follows the env. */
function adminLanguageIsChinese(): boolean {
	return (process.env.ZETA_LANG ?? process.env.LANG ?? "").toLowerCase().startsWith("zh");
}

async function showAdmin(ctx: { presentCommandOutput: (content: Text) => void }): Promise<void> {
	const webConfig = await WebConfig.load();
	const snapshot = await collectAdminSnapshot(webConfig);
	ctx.presentCommandOutput(new Text(formatChannelsAdmin(snapshot, adminLanguageIsChinese()), 1, 0));
}

async function setInstanceEnabledById(
	ctx: { showStatus: (message: string) => void },
	webConfig: WebConfig,
	id: string,
	enabled: boolean,
): Promise<void> {
	const data = webConfig.getData();
	const parsed = parseAdminInstances(data);
	if (parsed === null) {
		if (!isChannelId(id)) {
			ctx.showStatus(`Unknown instance: ${id}`);
			return;
		}
		await setChannelEnabled(webConfig, id, enabled);
	} else {
		const row = parsed.find(instance => instance.id === id);
		if (row === undefined) {
			ctx.showStatus(`Unknown instance: ${id}`);
			return;
		}
		try {
			await webConfig.set(
				"channels.instances",
				parsed.map(instance => (instance.id === id ? { ...instance, enabled } : instance)),
			);
		} catch (error) {
			ctx.showStatus(
				`Could not write channels.instances: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}
	}
	const restart = await restartSessionChannels();
	ctx.showStatus(
		restart?.started
			? `${id} ${enabled ? "enabled" : "disabled"}; runtime restarted (${restart.host.channels.join(", ") || "no channels"}).`
			: `${id} ${enabled ? "enabled" : "disabled"} in ${webConfig.path}. The next session will start it.`,
	);
}

export function formatChannelStatus(status: ChannelsStatusJson): string {
	const runtime = status.runtime;
	const host = runtime.hosting
		? `hosted by pid ${runtime.pid} (${runtime.host}, started ${runtime.startedAt})`
		: runtime.stale
			? `stale lock from pid ${runtime.pid}; no live host`
			: "no live host";
	return [
		"",
		`IM channels — ${status.configPath}`,
		`  ${host}`,
		"",
		...status.channels.map(statusLine),
		"",
		"Pair from here: /channels login wechat",
		"Credential channels: /channels login feishu|telegram for the CLI command.",
		"",
	].join("\n");
}

async function enableChannel(
	ctx: { showStatus: (message: string) => void; showWarning: (message: string) => void },
	channel: ChannelId,
	enabled: boolean,
): Promise<void> {
	const webConfig = await WebConfig.load();
	await setChannelEnabled(webConfig, channel, enabled);
	const restart = await restartSessionChannels();
	if (!restart) {
		ctx.showStatus(
			`${channel} ${enabled ? "enabled" : "disabled"} in ${webConfig.path}. The next session will start it.`,
		);
		return;
	}
	if (restart.started) {
		ctx.showStatus(
			`${channel} ${enabled ? "enabled" : "disabled"}; runtime restarted (${restart.host.channels.join(", ") || "no channels"}).`,
		);
		return;
	}
	if (restart.reason === "unpaired") {
		ctx.showStatus(`${channel} ${enabled ? "enabled" : "disabled"}. WeChat needs pairing: /channels login wechat.`);
		return;
	}
	ctx.showWarning(`${channel} ${enabled ? "enabled" : "disabled"}, but the host did not restart: ${restart.message}`);
}

function presentQr(ctx: { presentCommandOutput: (content: Text) => void }, payload: string): void {
	const qr = renderTerminalQr(payload, {
		columns: process.stdout.columns,
		color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
	});
	const lines = ["", "Scan this QR code with WeChat:", "", ...qr.lines];
	if (qr.kind === "fallback") lines.push("", `raw payload (${qr.reason}):`, payload);
	lines.push("");
	ctx.presentCommandOutput(new Text(lines.join("\n"), 0, 0));
}

async function loginWechat(
	ctx: {
		presentCommandOutput: (content: Text) => void;
		showStatus: (message: string) => void;
		showWarning: (message: string) => void;
		showError: (message: string) => void;
	},
	timeoutSeconds: number,
): Promise<void> {
	const webConfig = await WebConfig.load();
	const configDir = path.dirname(webConfig.path);
	// Stop this session's host first so the QR flow never competes with a
	// long-poll loop; the lock is released by `stop()`. If another process
	// still hosts WeChat, the host check below refuses instead of racing it.
	const suspended = await suspendActiveSessionChannels();
	const acquired = await acquireChannelLock({
		lockPath: channelPairingLockPath(configDir),
		metadata: {
			pid: process.pid,
			host: "cli",
			cwd: process.cwd(),
			channels: ["wechat"],
		},
	});
	if (!acquired.ok) {
		ctx.showError(acquired.message);
		if (suspended) await restartSessionChannels();
		return;
	}

	let lastRendered = "";
	let result: WechatLoginResult;
	try {
		const hostCheck = await wechatPairingBlockedByHost(channelLockPath(configDir));
		if (!hostCheck.ok) {
			ctx.showError(hostCheck.message);
			if (suspended) await restartSessionChannels();
			return;
		}

		ctx.showStatus("Waiting for WeChat QR scan…");
		result = await runWechatLogin({
			webConfig,
			timeoutMs: Math.max(1, timeoutSeconds) * 1_000,
			onQrCode: payload => {
				if (payload.status === "confirmed") return;
				if (payload.status === "expired") {
					ctx.showWarning("QR expired; fetching a fresh one…");
					return;
				}
				const display = wechatQrDisplayPayload(payload);
				if (!display || display === lastRendered) return;
				lastRendered = display;
				presentQr(ctx, display);
			},
			onState: state => {
				if (state === "scanned") ctx.showStatus("Scanned — confirm in WeChat.");
			},
		});
	} catch (error) {
		if (suspended) await restartSessionChannels();
		ctx.showError(`WeChat login failed: ${error instanceof Error ? error.message : String(error)}`);
		return;
	} finally {
		await acquired.lock.release();
	}

	if (result.state === "connected") {
		const restarted = await restartSessionChannels();
		ctx.showStatus(
			`WeChat connected. Credentials saved to ${webConfig.path}.` +
				(restarted?.started ? ` Runtime restarted (${restarted.host.channels.join(", ")}).` : ""),
		);
	} else {
		if (suspended) await restartSessionChannels();
		ctx.showError(`WeChat login ${result.state}.`);
	}
}

function credentialGuidance(channel: ChannelId): string {
	if (channel === "feishu") {
		return [
			"Feishu / Lark credentials are validated by the platform before they are saved.",
			"Secrets are not entered into the TUI transcript.",
			"",
			`Run: ${CLI_BIN_NAME} channels login feishu --app-id <id> --app-secret <secret> [--domain feishu|lark]`,
			`Then: /channels enable feishu`,
		].join("\n");
	}
	if (channel === "telegram") {
		return [
			"Telegram credentials are validated with getMe before they are saved.",
			"Secrets are not entered into the TUI transcript.",
			"",
			`Run: ${CLI_BIN_NAME} channels login telegram --token <bot-token>`,
			`Then: /channels enable telegram`,
		].join("\n");
	}
	return [
		`${channel} uses a credential login; entering secrets in the TUI transcript is not supported.`,
		"",
		`Run: ${CLI_BIN_NAME} channels login ${channel} --help`,
		`Then: /channels enable ${channel}`,
	].join("\n");
}

export const BUILTIN_CHANNELS_SLASH_COMMAND: SlashCommandSpec = {
	name: "channels",
	icon: "broadcast",
	description: () => M.cmdChannels,
	allowArgs: true,
	hidden: true,
	subcommands: SUBCOMMANDS.map(subcommand => ({ ...subcommand })),
	handleTui: async (command: ParsedSlashCommand, runtime) => {
		const ctx = runtime.ctx;
		const [action = "status", ...rest] = command.args.trim().split(/\s+/).filter(Boolean);
		switch (action.toLowerCase()) {
			case "status":
			case "instances":
			case "targets":
			case "bindings": {
				await showAdmin(ctx);
				return commandConsumed();
			}
			case "enable-instance":
			case "disable-instance": {
				const id = rest[0]?.trim();
				if (!id) {
					ctx.showError(`Usage: /channels ${action} <instance-id>`);
					return commandConsumed();
				}
				const webConfig = await WebConfig.load();
				await setInstanceEnabledById(ctx, webConfig, id, action.toLowerCase() === "enable-instance");
				return commandConsumed();
			}
			case "enable":
			case "disable": {
				const channel = parseChannel(rest[0]);
				if (!channel) {
					ctx.showError(`Usage: /channels ${action} <${CHANNEL_IDS.join("|")}>`);
					return commandConsumed();
				}
				await enableChannel(ctx, channel, action.toLowerCase() === "enable");
				return commandConsumed();
			}
			case "login": {
				const channel = parseChannel(rest[0]);
				if (!channel) {
					ctx.showError(USAGE);
					return commandConsumed();
				}
				if (channel === "wechat") {
					const timeout = Number(rest[1] ?? "180");
					await loginWechat(ctx, Number.isFinite(timeout) ? timeout : 180);
					return commandConsumed();
				}
				ctx.presentCommandOutput(new Text(credentialGuidance(channel), 1, 0));
				return commandConsumed();
			}
			case "logout": {
				const channel = parseChannel(rest[0]);
				if (!channel) {
					ctx.showError(`Usage: /channels logout <${CHANNEL_IDS.join("|")}>`);
					return commandConsumed();
				}
				ctx.showWarning(
					`Run \`${CLI_BIN_NAME} channels logout ${channel}\` to clear its credentials; a running host keeps the connection until it stops.`,
				);
				return commandConsumed();
			}
			case "help":
			default:
				ctx.presentCommandOutput(new Text(USAGE, 1, 0));
				return commandConsumed();
		}
	},
};

/**
 * `/channels` — operator entry for the IM runtime from inside the TUI.
 *
 * The command reads and writes the frozen ADR-IM-0007 shape only:
 * `channels.instances` and `remote.imBindings`. Legacy `channels.<platform>` is
 * not synthesized or toggled here — migration is a one-time backend step. If
 * `web.yml` has not been migrated, the page says so and shows no rows.
 *
 * Secrets are never accepted or printed: credential pairing belongs to Studio
 * or the CLI, and the page is redacted. The command stays hidden from the
 * everyday palette; an explicit `/channels` still resolves.
 */

import { Text } from "@linxiraos/pi-tui";
import {
	formatChannelsAdmin,
	parseAdminBindings,
	type AdminTarget,
	type ChannelsAdminSnapshot,
} from "../channels/admin-view";
import { collectChannelStatus, setChannelEnabled } from "../channels/channel-status";
import { restartSessionChannels } from "../channels/session-host";
import { WebConfig } from "../config/web-config";
import { M } from "../i18n";
import { commandConsumed } from "./helpers/parse";
import type { ParsedSlashCommand, SlashCommandSpec } from "./types";

const SUBCOMMANDS = [
	{ name: "status", description: () => M.cmdChannelsStatus },
	{ name: "instances", description: () => "instances / targets / bindings" },
	{ name: "enable-instance", description: () => "enable-instance <instance-id>" },
	{ name: "disable-instance", description: () => "disable-instance <instance-id>" },
] as const;

const USAGE = [
	"Usage: /channels [status|instances|enable-instance|disable-instance] [id]",
	"",
	"  /channels status                 instances, targets and bindings (redacted)",
	"  /channels enable-instance <id>   per-instance switch (channels.instances)",
	"  /channels disable-instance <id>",
	"",
	"Credential pairing is in Work Studio or `zetacode channels login`; the TUI never accepts a secret.",
].join("\n");

/** Build the redacted admin page from web.yml + the live runtime (v2 only). */
async function collectAdminSnapshot(webConfig: WebConfig): Promise<ChannelsAdminSnapshot> {
	const data = webConfig.getData();
	const rich = await collectChannelStatus(webConfig);
	const instances = rich.instances.map(instance => ({
		id: instance.id,
		platform: instance.platform,
		label: instance.label,
		enabled: instance.enabled,
		configured: instance.configured,
		running: instance.running,
		...(instance.agentProfileLabel !== "" ? { agentProfile: instance.agentProfileLabel } : {}),
		...(instance.targetDisplay !== "" ? { targetDisplay: instance.targetDisplay } : {}),
		targetAvailable: instance.targetAvailable,
		...(instance.targetReason !== undefined ? { targetReason: instance.targetReason } : {}),
	}));
	const parsedBindings = parseAdminBindings(data);
	const bindings = parsedBindings ?? [];
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
	return { configPath: rich.configPath, host, instances, bindings, targets };
}

/** The TUI context has no language accessor; the page follows the env. */
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
	const known = webConfig.getChannelInstances?.().some(instance => instance.id === id) ?? true;
	if (!known) {
		ctx.showStatus(`Unknown instance: ${id}`);
		return;
	}
	try {
		await setChannelEnabled(webConfig, id, enabled);
	} catch (error) {
		ctx.showStatus(`Could not update ${id}: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	const restart = await restartSessionChannels();
	ctx.showStatus(
		restart?.started
			? `${id} ${enabled ? "enabled" : "disabled"}; runtime restarted (${restart.host.instances.join(", ") || "no channels"}).`
			: `${id} ${enabled ? "enabled" : "disabled"} in ${webConfig.path}. The next session will start it.`,
	);
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
			case "bindings":
				await showAdmin(ctx);
				return commandConsumed();
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

			case "help":
				ctx.presentCommandOutput(new Text(USAGE, 1, 0));
				return commandConsumed();
			default:
				ctx.showError(USAGE);
				return commandConsumed();
		}
	},
};

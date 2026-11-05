/**
 * Studio operations the chrome still needs — and the honest answer for each.
 *
 * The port rule is "a surface whose data has no Zeta endpoint is omitted, not
 * stubbed". Applied to the window chrome, that leaves **no operation to map**:
 * every chrome surface is callback-driven (`StudioPaletteActions`,
 * `PlatformCapabilities`) or reads a contract type the shell already holds
 * (`RuntimeConnection`). Studio's chrome touched three operations; none of them
 * survives contact with the gateway unchanged, so they stay unmapped and the
 * base client throws `UnsupportedStudioOperationError` for them — which is the
 * signal the shell uses to omit that affordance.
 *
 * `CHROME_UNMAPPED_OPERATIONS` records why, so the next port does not re-derive
 * it. Do **not** add a handler here that answers another module's surface: the
 * client keeps one handler per name (later registration wins), so a generic
 * manifest invented here would silently replace the Capabilities port's real one.
 */

import type { CommandName, QueryName } from "@/lib/studio-protocol/contract";
import type { CommandHandler, QueryHandler } from "@/lib/studio-client";

export const queries: Partial<Record<QueryName, QueryHandler>> = {};
export const commands: Partial<Record<CommandName, CommandHandler>> = {};

export interface UnmappedChromeOperation {
	readonly kind: "query" | "command";
	readonly name: string;
	/** The chrome surface that asked for it in Studio. */
	readonly surface: string;
	/** Why it has no mapping, and what an endpoint would have to publish. */
	readonly reason: string;
}

export const CHROME_UNMAPPED_OPERATIONS: readonly UnmappedChromeOperation[] = [
	{
		kind: "query",
		name: "commands.getManifest",
		surface: "titlebar boot model / command palette",
		reason:
			"Studio's operator-command manifest carries risk/effect/presentation/contractTestId per command. " +
			"Zeta publishes slash commands only as name/description/source " +
			"(POST /api/agent/:id { type: \"get_commands\" }), so a manifest built here would invent the " +
			"classification fields. Owned by the Capabilities port; needs an endpoint that returns the " +
			"manifest shape (or an extension of get_commands with those fields).",
	},
	{
		kind: "query",
		name: "environment.get",
		surface: "titlebar runtime chip",
		reason:
			"EnvironmentReadModel includes OMP's installer state and runtime authority. Zeta's " +
			"/api/server/identity publishes app/version/pid/webUrl only; the gateway is the runtime, so " +
			"there is no separate installer to report.",
	},
	{
		kind: "command",
		name: "runtime.ensure",
		surface: "runtime-loss banner reconnect button",
		reason:
			"There is no managed runtime to spawn or restart: the gateway process is the runtime. " +
			"Reconnecting means re-opening the event stream, which the shell does through " +
			"useAgentSession — hence StudioRuntimeBanner takes an onReconnect callback.",
	},
	{
		kind: "command",
		name: "app.update.*",
		surface: "AppUpdateDialog",
		reason:
			"Zeta has GET /api/update/check ({ current, latest, available }) plus POST " +
			"download/install; Studio's dialog also renders release notes, asset size, byte progress and " +
			"an apply phase. The dialog is omitted until /api/update publishes that metadata.",
	},
];

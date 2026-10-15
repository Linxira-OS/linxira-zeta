/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration order is the
 * settings-panel order; `config/all-settings.ts` registers every domain.
 */
import { register, type ScopeLike } from "../config/registry";

// Collab

/**
 * Master gate, default **off**. The implementation is intact behind it: with
 * the gate off, `/collab` and `/join` are hidden from the palette and refused,
 * `collab.autoStart` stops hosting, and the splash stops advertising the
 * feature. Sharing needs a relay operated by someone the user trusts, so the
 * product ships it opt-in.
 */
export const cfgCollabEnabled = register({
	id: "collab.enabled",
	type: "boolean",
	default: false,
	ui: {
		tab: "interaction",
		group: "Collab",
		label: "Enabled",
		description:
			"Enable live session sharing (/collab, /join). Requires collab.relayUrl to point at a relay you control; zeta operates none.",
	},
});

/**
 * Relay endpoint, default **empty**: no relay is shipped, so a fresh install
 * has nothing to dial and sharing reports the missing configuration instead of
 * reaching for infrastructure the user does not control. A scheme-less value
 * (`relay.example.com`) is dialed over `wss://`; `ws://` must be spelled out.
 */
export const cfgCollabRelayUrl = register({
	id: "collab.relayUrl",
	type: "string",
	default: "",
	ui: {
		tab: "interaction",
		group: "Collab",
		label: "Relay URL",
		description: "Relay used by /collab (wss://host[:port]); empty disables sharing even when collab.enabled is on",
	},
});

export const cfgCollabWebUrl = register({
	id: "collab.webUrl",
	type: "string",
	default: "",
	ui: {
		tab: "interaction",
		group: "Collab",
		label: "Web UI URL",
		description:
			"Browser UI used by /collab links; empty derives from collab.relayUrl; explicit http:// is localhost-only",
	},
});

export const cfgCollabDisplayName = register({
	id: "collab.displayName",
	type: "string",
	default: "",
	ui: {
		tab: "interaction",
		group: "Collab",
		label: "Display Name",
		description: "Name shown to other collab participants (default: OS username)",
	},
});

export const cfgCollabAutoStart = register({
	id: "collab.autoStart",
	type: "enum",
	values: ["off", "view", "control"] as const,
	default: "off",
	ui: {
		tab: "interaction",
		group: "Collab",
		label: "Auto Start",
		description:
			"Host every interactive session via collab.relayUrl as it starts and publish it to the local registry (zetacode collab list); rooms rotate on session switch",
		options: [
			{ value: "off", label: "Off", description: "Share only when /collab is run" },
			{
				value: "view",
				label: "View",
				description: "Auto-host; the registry hands out view-only links (zetacode collab link --view)",
			},
			{
				value: "control",
				label: "Control",
				description: "Auto-host; the registry hands out control links that can prompt the session",
			},
		],
	},
});

/** Whether live session sharing is enabled for this scope (`collab.enabled`). */
export function isCollabEnabled(scope: ScopeLike): boolean {
	return cfgCollabEnabled.get(scope);
}

/** Shown when a collab command is invoked while {@link cfgCollabEnabled} is off. */
export const COLLAB_DISABLED_MESSAGE =
	"Collab sharing is disabled. Set collab.enabled to true and collab.relayUrl to a relay you control.";

/**
 * Shown when sharing is enabled but no endpoint is configured. Zeta ships no
 * relay, so there is deliberately nothing to fall back to.
 */
export const COLLAB_RELAY_MISSING_MESSAGE =
	"Collab is enabled but no relay is configured. Set collab.relayUrl to a relay you control (for example wss://relay.example.com); zeta ships no default relay.";

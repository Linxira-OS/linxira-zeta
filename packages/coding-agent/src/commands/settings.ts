/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration order is the
 * settings-panel order; `config/all-settings.ts` registers every domain.
 */
import { register } from "../config/registry";

export const cfgShareRedactSecrets = register({
	id: "share.redactSecrets",
	type: "boolean",
	default: true,
	ui: {
		tab: "interaction",
		group: "Share",
		label: "Share Secret Redaction",
		description:
			"Run the secret obfuscator over /share transcripts before they are handed to the agent (uses the secrets.* config)",
	},
});

/**
 * Model used for the session-title side task. `online` defers to the host's
 * configured provider; naming a model pins the title call to it.
 */
import { register } from "../config/registry";
import { ONLINE_TINY_TITLE_MODEL_KEY, TINY_TITLE_MODEL_OPTIONS, TINY_TITLE_MODEL_VALUES } from "./models";

export const cfgProvidersTinyModel = register({
	id: "providers.tinyModel",
	type: "enum",
	values: TINY_TITLE_MODEL_VALUES,
	default: ONLINE_TINY_TITLE_MODEL_KEY,
	ui: {
		tab: "providers",
		group: "Tiny Model",
		label: "Tiny Model",
		description:
			"Session-title model: online (the TINY role from /models, else @smol) by default, or a local on-device model",
		options: TINY_TITLE_MODEL_OPTIONS,
	},
});

/**
 * Global backend-mode settings.
 *
 * These are read from the global user config only: a project checkout must not
 * decide that this machine runs a background service or which directory is the
 * default workspace.
 */
import { register } from "../config/registry";

export const cfgBackendEnabled = register({
	id: "backend.enabled",
	type: "boolean",
	default: false,
	ui: {
		tab: "interaction",
		group: "Startup & Updates",
		label: "Enable Backend Mode",
		description:
			"Use one background backend for this machine. Off: every zetacode launch is a local process. On: launches connect to the default backend.",
	},
});

export const cfgBackendWorkspace = register({
	id: "backend.workspace",
	type: "string",
	default: "",
	ui: {
		tab: "interaction",
		group: "Startup & Updates",
		label: "Backend Default Workspace",
		description:
			"Directory the default backend is anchored to when it starts. Empty uses the stable default workspace (`~/.zeta/workspace`).",
	},
});

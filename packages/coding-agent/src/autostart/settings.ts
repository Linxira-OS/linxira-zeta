/**
 * Autostart settings owned by the daemon.
 *
 * `backend.autostart` is the single decision "start the background backend
 * with the system". It is read from the global user config only
 * (`~/.zeta/agent/config.yml`), never from a project layer; see
 * `autostart/setting.ts`. The registry entry gives the CLI/TUI and the GUI's
 * `/api/settings` catalog one typed, writable definition.
 */
import { register } from "../config/registry";

export const cfgBackendAutostart = register({
	id: "backend.autostart",
	type: "boolean",
	default: false,
	ui: {
		tab: "interaction",
		group: "Startup & Updates",
		label: "Start Backend at Login",
		description:
			"Run the background backend (zetacode daemon) with the system, three minutes after boot/login. Bundled app only; install the OS component with `zetacode daemon install-autostart`.",
	},
});

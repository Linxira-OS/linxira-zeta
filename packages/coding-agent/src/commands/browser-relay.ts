/**
 * `zetacode browser-relay` — drive the user's own Chrome tabs.
 */
import { Args, Command, Flags } from "@linxiraos/pi-utils/cli";
import { BROWSER_RELAY_ACTIONS, runBrowserRelayCommand } from "../cli/browser-relay-cli";
import { browserRelayHelp } from "../cli/command-help";

/** Install or sync the omp Chrome extension; Chrome launches its native host. */
export default class BrowserRelay extends Command {
	static description = browserRelayHelp.description;

	static args = {
		action: Args.string({
			description: `Action: ${BROWSER_RELAY_ACTIONS.join(" | ")} (native-host is launched by Chrome)`,
			options: [...BROWSER_RELAY_ACTIONS],
			required: true,
		}),
	};

	static flags = {
		dir: Flags.string({
			description: "Extension install directory (install; default ~/.zeta/browser-relay/extension)",
		}),
		"no-chrome": Flags.boolean({
			description: "Skip the unattended install into Chrome and print the manual steps",
			default: false,
		}),
		"no-group": Flags.boolean({
			description: "Don't gather controllable tabs into a 'zeta' tab group",
			default: false,
		}),
		profile: Flags.string({
			description: "Chrome profile directory for the unattended install (install; default: last used)",
		}),
	};

	static examples = [
		"zetacode browser-relay install    # install the zetacode extension, register it in Chrome and add its native host",
		"zetacode browser-relay sync       # sync every registered extension directory",
	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(BrowserRelay);
		const action = BROWSER_RELAY_ACTIONS.find(candidate => candidate === args.action);
		if (action === undefined) throw new Error(`Unknown action: ${args.action}`);
		await runBrowserRelayCommand({
			action,
			dir: flags.dir,
			chrome: !flags["no-chrome"],
			profile: flags.profile,
		});
	}
}

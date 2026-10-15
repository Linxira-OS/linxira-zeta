/**
 * Join a shared collab session from the CLI: launches the interactive TUI and
 * immediately runs `/join <link>`.
 */

import { CLI_BIN_NAME } from "@linxiraos/pi-utils";
import { Args, Command } from "@linxiraos/pi-utils/cli";
import { parseArgs } from "../cli/args";
import { joinHelp as commandHelp } from "../cli/command-help";
import { cfgCollabEnabled, COLLAB_DISABLED_MESSAGE } from "../collab/settings";
import { Settings } from "../config/settings";
import { runRootCommand } from "../main";

export default class Join extends Command {
	static description = commandHelp.description;
	static args = {
		link: Args.string({
			description: "Collab link shared by the host (/collab)",
			required: true,
		}),
	};

	static examples = [`${CLI_BIN_NAME} join "relay.example.sh/abc123#key"`];

	async run(): Promise<void> {
		const { args } = await this.parse(Join);
		const link = args.link?.trim();
		if (!link) {
			process.stderr.write(`Usage: ${CLI_BIN_NAME} join <link>\n`);
			process.exitCode = 1;
			return;
		}
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			process.stderr.write(`${CLI_BIN_NAME} join requires an interactive terminal\n`);
			process.exitCode = 1;
			return;
		}
		// Sharing is opt-in: refuse before the TUI boots rather than starting a
		// guest that would dial the host's relay with the feature switched off.
		const settings = await Settings.loadReadOnly({ cwd: process.cwd() });
		if (!cfgCollabEnabled.get(settings)) {
			process.stderr.write(`${COLLAB_DISABLED_MESSAGE}\n`);
			process.exitCode = 1;
			return;
		}
		const parsed = parseArgs([]);
		parsed.join = link;
		await runRootCommand(parsed, []);
	}
}

/**
 * `zetacode pages open <team|rooms|im|models>` — open a scoped page hosted by
 * the registered local `zetacode serve`.
 */
import { Args, CliUsageError, Command, Flags } from "@linxiraos/pi-utils/cli";
import { CLI_BIN_NAME } from "@linxiraos/pi-utils/dirs";
import { pagesHelp } from "../cli/command-help";
import { isPageName, openServePage, PAGE_NAMES } from "../cli/pages-cli";

export default class Pages extends Command {
	static description = pagesHelp.description;
	static args = {
		action: Args.string({ description: "open", options: ["open"], required: true }),
		name: Args.string({
			description: `Page to open (${PAGE_NAMES.join(", ")})`,
			required: true,
		}),
	};
	static flags = {
		print: Flags.boolean({ description: "Print the URL instead of opening a browser", default: false }),
		json: Flags.boolean({ description: "Print {url, opened} as JSON", default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Pages);
		if (args.action !== "open") throw new CliUsageError(`Usage: ${CLI_BIN_NAME} pages open <team|rooms|im|models>`);
		const name = args.name;
		if (!name || !isPageName(name)) {
			throw new CliUsageError(`Unknown page "${name ?? ""}". Expected one of: ${PAGE_NAMES.join(", ")}`);
		}
		const result = await openServePage(name, { open: !flags.print });
		if (flags.json) process.stdout.write(`${JSON.stringify(result)}\n`);
		else process.stdout.write(`${result.url}\n`);
	}
}

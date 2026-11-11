/**
 * Foreign project source consent.
 *
 * Native `.zeta` sources always load. Foreign project trees (`.claude`,
 * `.codex`, `.gemini`, `.cursor`, `.windsurf`, `.opencode`, `.github`,
 * `.vscode/mcp.json`) are inert until approved for this repository; the
 * approval is bound to a hash of the tree, so later edits revoke it.
 */

import { Args, Command, Flags, renderCommandHelp } from "@linxiraos/pi-utils/cli";
import { CLI_BIN_NAME } from "@linxiraos/pi-utils/dirs";
import {
	isForeignProjectProvider,
	listForeignProjectSources,
	setForeignProjectSourceConsent,
} from "../config/foreign-sources";

export default class Sources extends Command {
	static description = "List, approve, or revoke foreign project sources";
	static args = {
		action: Args.string({ description: "list | approve | revoke", required: false, options: ["list", "approve", "revoke"] }),
		provider: Args.string({ description: "Provider id (e.g. claude, codex, cursor)", required: false }),
	};
	static flags = {
		json: Flags.boolean({ description: "Output JSON" }),
		cwd: Flags.string({ description: "Repository to inspect (default: current directory)" }),
	};
	static examples = [
		"# What is present and approved in this repository\n  zetacode sources list",
		"# Approve the current .claude tree for this repository\n  zetacode sources approve claude",
		"# Revoke after an edit or when done\n  zetacode sources revoke claude",
	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Sources);
		const cwd = flags.cwd ?? process.cwd();
		if (!args.action || args.action === "list") {
			const statuses = listForeignProjectSources(cwd);
			if (flags.json) {
				console.log(JSON.stringify({ cwd, sources: statuses }, null, 2));
				return;
			}
			const present = statuses.filter(status => status.present);
			if (present.length === 0) {
				console.log("No foreign project sources present.");
				return;
			}
			for (const status of present) {
				const state = status.stale ? "stale (re-approve)" : status.approved ? "approved" : "not approved";
				console.log(`${status.providerId}: ${state}`);
			}
			return;
		}
		const provider = args.provider;
		if (!provider) {
			renderCommandHelp(CLI_BIN_NAME, "sources", Sources);
			return;
		}
		if (!isForeignProjectProvider(provider)) {
			console.error(`Not a foreign project source: ${provider}`);
			process.exitCode = 1;
			return;
		}
		const entry = setForeignProjectSourceConsent(provider, cwd, args.action === "approve");
		if (flags.json) console.log(JSON.stringify({ cwd, provider, ...entry }, null, 2));
		else console.log(`${provider}: ${entry.enabled ? "approved" : "revoked"} (hash ${entry.hash.slice(0, 12)})`);
	}
}

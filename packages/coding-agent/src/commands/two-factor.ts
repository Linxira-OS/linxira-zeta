import { Args, Command, Flags } from "@linxiraos/pi-utils/cli";
import { twoFactorHelp } from "../cli/command-help";
import { Settings } from "../config/settings";
import { formatTerminalTwoFactorStatus, readTerminalTwoFactorStatus } from "../server/auth/two-factor-status";
import { cfgLanguage } from "../zeta-settings";

export default class TwoFactor extends Command {
	static description = twoFactorHelp.description;
	static args = {
		action: Args.string({ description: "Read-only authentication status", options: ["status"], required: false }),
	};
	static flags = { json: Flags.boolean({ description: "Print secret-free JSON status", default: false }) };

	async run(): Promise<void> {
		const { flags } = await this.parse(TwoFactor);
		const status = await readTerminalTwoFactorStatus();
		if (flags.json) process.stdout.write(`${JSON.stringify(status)}\n`);
		else {
			const settings = await Settings.loadReadOnly({ cwd: process.cwd() });
			process.stdout.write(`${formatTerminalTwoFactorStatus(status, cfgLanguage.get(settings))}\n`);
		}
		if (!status.available) process.exitCode = 1;
	}
}

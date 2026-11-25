import { currentLanguage, M } from "../i18n";
import { formatTerminalTwoFactorStatus, readTerminalTwoFactorStatus } from "../server/auth/two-factor-status";
import type { SlashCommandSpec } from "./types";

export const BUILTIN_TWO_FACTOR_SLASH_COMMAND: SlashCommandSpec = {
	name: "2fa",
	description: () => M.cmdTwoFactor,
	allowArgs: true,
	subcommandOptional: true,
	subcommands: [
		{
			name: "status",
			description: () => M.cmdTwoFactorStatus,
		},
	],
	handleTui: async (command, runtime) => {
		if (command.args.trim() === "") {
			runtime.ctx.showSettingsSelector();
			return;
		}
		if (command.args.trim() !== "status") {
			runtime.ctx.showError(M.cmdTwoFactorUsage);
			return;
		}
		const status = await readTerminalTwoFactorStatus();
		runtime.ctx.presentCommandOutput(() => formatTerminalTwoFactorStatus(status, currentLanguage()));
	},
};

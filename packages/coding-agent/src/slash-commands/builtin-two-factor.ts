import { Text } from "@linxiraos/pi-tui";
import { currentLanguage } from "../i18n";
import { formatTerminalTwoFactorStatus, readTerminalTwoFactorStatus } from "../server/auth/two-factor-status";
import type { SlashCommandSpec } from "./types";

export const BUILTIN_TWO_FACTOR_SLASH_COMMAND: SlashCommandSpec = {
	name: "2fa",
	description: () =>
		currentLanguage() === "zh" ? "查看远程二次验证状态" : "Show remote two-factor authentication status",
	allowArgs: true,
	subcommandOptional: true,
	subcommands: [
		{
			name: "status",
			description: () =>
				currentLanguage() === "zh"
					? "查看绑定、策略与恢复码余量"
					: "Show enrollment, policy and recovery-code count",
		},
	],
	handleTui: async (command, runtime) => {
		if (command.args.trim() !== "" && command.args.trim() !== "status") {
			runtime.ctx.showError("Usage: /2fa [status]");
			return;
		}
		const status = await readTerminalTwoFactorStatus();
		runtime.ctx.presentCommandOutput(new Text(formatTerminalTwoFactorStatus(status, currentLanguage()), 1, 0));
	},
};

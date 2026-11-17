import { Text } from "@linxiraos/pi-tui";
import { currentLanguage } from "../i18n";
import { formatTerminalTwoFactorStatus, readTerminalTwoFactorStatus } from "../server/auth/two-factor-status";
import type { SlashCommandSpec } from "./types";

export const BUILTIN_TWO_FACTOR_SLASH_COMMAND: SlashCommandSpec = {
	name: "2fa",
	description: () =>
		currentLanguage() === "zh" ? "打开身份、设备与二次验证设置" : "Open identity, devices and two-factor settings",
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
		if (command.args.trim() === "") {
			runtime.ctx.showSettingsSelector("identity");
			return;
		}
		if (command.args.trim() !== "" && command.args.trim() !== "status") {
			runtime.ctx.showError("Usage: /2fa [status]");
			return;
		}
		const status = await readTerminalTwoFactorStatus();
		runtime.ctx.presentCommandOutput(new Text(formatTerminalTwoFactorStatus(status, currentLanguage()), 1, 0));
	},
};

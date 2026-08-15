import type { SettingPath, SettingValue } from "../config/settings";
import { currentLanguage, LANGUAGE_TAGS, M, setLanguage, type ZetaLanguage } from "../i18n";
import { commandConsumed, usage } from "./helpers/parse";
import type { SlashCommandSpec } from "./types";

/**
 * Zeta-originated slash commands.
 *
 * Kept separate from the upstream builtin-*.ts files so upstream merges
 * cannot silently drop them: this module is re-exported from
 * `builtin-registry.ts` alongside the upstream command groups.
 */

export const BUILTIN_ZETA_SLASH_COMMANDS: ReadonlyArray<SlashCommandSpec> = [
	{
		name: "language",
		description: M.cmdLanguage,
		acpDescription: M.cmdSetTheCLIDisplayLanguage,
		acpInputHint: "[en|zh]",
		subcommands: [
			{ name: "en", description: M.cmdEnglish },
			{ name: "zh", description: M.languageZhLabel },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const arg = command.args.trim().toLowerCase();
			if (!arg) {
				const rows = [
					M.languageCurrentFmt.replace("%s", currentLanguage()),
					...LANGUAGE_TAGS.map(tag =>
						M.languageListRowFmt
							.replace("%s", tag)
							.replace("%s", tag === "en" ? M.languageEnLabel : M.languageZhLabel),
					),
				].join("\n");
				await runtime.output(rows);
				return commandConsumed();
			}
			if (!(LANGUAGE_TAGS as readonly string[]).includes(arg)) {
				return usage(M.languageUnknownFmt.replace("%s", arg), runtime);
			}
			const tag = arg as ZetaLanguage;
			runtime.settings.set("language" as SettingPath, tag as SettingValue<SettingPath>);
			setLanguage(tag);
			await runtime.output(M.languageChangedFmt.replace("%s", tag));
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			const arg = command.args.trim().toLowerCase();
			if (!arg) {
				const rows = [
					M.languageCurrentFmt.replace("%s", currentLanguage()),
					...LANGUAGE_TAGS.map(tag =>
						M.languageListRowFmt
							.replace("%s", tag)
							.replace("%s", tag === "en" ? M.languageEnLabel : M.languageZhLabel),
					),
				].join("\n");
				runtime.ctx.showStatus(rows);
				runtime.ctx.editor.setText("");
				return;
			}
			if (!(LANGUAGE_TAGS as readonly string[]).includes(arg)) {
				runtime.ctx.showStatus(M.languageUnknownFmt.replace("%s", arg));
				runtime.ctx.editor.setText("");
				return;
			}
			const tag = arg as ZetaLanguage;
			runtime.ctx.settings.set("language" as SettingPath, tag as SettingValue<SettingPath>);
			setLanguage(tag);
			runtime.ctx.showStatus(M.languageChangedFmt.replace("%s", tag));
			runtime.ctx.editor.setText("");
		},
	},
];

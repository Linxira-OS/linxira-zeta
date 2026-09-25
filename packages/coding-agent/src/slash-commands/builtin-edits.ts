import { M } from "../i18n";
import { readEditBlackbox, type EditBlackboxEntry } from "../edit/blackbox";
import { cfgEditBlackboxEnabled } from "../edit/settings";
import { commandConsumed, errorMessage, usage } from "./helpers/parse";
import type { SlashCommandSpec } from "./types";

/** How many entries `/edits` lists when no count is given. */
const DEFAULT_LIMIT = 20;

/**
 * Render one blackbox entry as a single line: when the file changed, by how
 * much, and under which model. The size delta is the cheapest signal for
 * "did this edit nuke the file" — a −4000 line swing is visible at a glance
 * where a diff would need scrolling.
 */
function describeEntry(entry: EditBlackboxEntry): string {
	const before = entry.prev === "" ? 0 : entry.prev.split("\n").length;
	const after = entry.new === "" ? 0 : entry.new.split("\n").length;
	const delta = after - before;
	const magnitude = delta === 0 ? "same size" : delta > 0 ? `+${delta} lines` : `${delta} lines`;
	return `  ${entry.path}  (${before} → ${after} lines, ${magnitude})  ${entry.model}`;
}

export const BUILTIN_EDITS_SLASH_COMMANDS: ReadonlyArray<SlashCommandSpec> = [
	{
		name: "edits",
		icon: "history",
		description: () => M.cmdEdits,
		inlineHint: "[path] [count]",
		allowArgs: true,
		getTuiAutocompleteDescription: runtime =>
			cfgEditBlackboxEnabled.get(runtime.ctx.settings) ? M.acEditsOn : M.acEditsOff,
		handle: async (command, runtime) => {
			const args = command.args.trim().split(/\s+/).filter(Boolean);
			let limit = DEFAULT_LIMIT;
			if (args.length > 0 && /^\d+$/.test(args[args.length - 1])) {
				limit = Number.parseInt(args.pop() as string, 10);
			}
			const pathFilter = args[0];

			if (!cfgEditBlackboxEnabled.get(runtime.settings)) {
				await runtime.output(M.editsDisabledHint);
				return commandConsumed();
			}

			try {
				const entries = await readEditBlackbox(runtime.settings.getAgentDir(), {
					path: pathFilter,
					since: limit,
				});
				if (entries.length === 0) {
					await runtime.output(pathFilter === undefined ? M.editsEmpty : M.editsEmptyFiltered);
					return commandConsumed();
				}
				const header =
					pathFilter === undefined
						? M.editsHeaderRecent(entries.length)
						: M.editsHeaderForPath(pathFilter, entries.length);
				await runtime.output([header, ...entries.map(describeEntry)].join("\n"));
			} catch (err) {
				return usage(errorMessage(err), runtime);
			}
			return commandConsumed();
		},
		// TUI mode has no multi-line output channel: the list can be long, so the
		// handler points at `/edits` in print mode rather than truncating it into
		// a status line.
		handleTui: (_command, runtime) => {
			runtime.ctx.showStatus(
				cfgEditBlackboxEnabled.get(runtime.ctx.settings) ? M.editsUsePrintMode : M.editsDisabledHint,
			);
			return commandConsumed();
		},
	},
];

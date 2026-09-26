import { resolve } from "node:path";
import { M } from "../i18n";
import { readEditBlackbox, type EditBlackboxEntry } from "../edit/blackbox";
import { revertLastEdit, type RevertOutcome } from "../edit/revert";
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

/** One-line report for a revert attempt, covering every refusal reason. */
function describeRevert(outcome: RevertOutcome): string {
	switch (outcome.status) {
		case "reverted":
			return M.editsReverted(outcome.path, describeEntry(outcome.entry).trim());
		case "unrecorded":
			return M.editsRevertUnrecorded(outcome.path);
		case "missing":
			return M.editsRevertMissing(outcome.path);
		case "diverged":
			return M.editsRevertDiverged(outcome.path);
		case "read-failed":
			return M.editsRevertFailed(outcome.path, outcome.reason);
	}
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
			if (args[0] === "revert") {
				const target = args[1];
				if (!target) return usage("Usage: /edits revert <path>", runtime);
				const outcome = await revertLastEdit(runtime.settings.getAgentDir(), target, resolve(runtime.cwd, target));
				await runtime.output(describeRevert(outcome));
				return commandConsumed();
			}
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
				const { entries, corruptLines } = await readEditBlackbox(runtime.settings.getAgentDir(), {
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
				const listing = [header, ...entries.map(describeEntry)];
				if (corruptLines > 0) listing.push(M.editsCorruptLines(corruptLines));
				await runtime.output(listing.join("\n"));
			} catch (err) {
				return usage(errorMessage(err), runtime);
			}
			return commandConsumed();
		},
		// The list can be long and TUI has no multi-line channel, so listing points
		// at print mode. A revert is a single line of output, so it runs here.
		handleTui: async (command, runtime) => {
			const args = command.args.trim().split(/\s+/).filter(Boolean);
			if (args[0] === "revert" && args[1]) {
				const outcome = await revertLastEdit(
					runtime.ctx.settings.getAgentDir(),
					args[1],
					resolve(runtime.ctx.sessionManager.getCwd(), args[1]),
				);
				runtime.ctx.showStatus(describeRevert(outcome));
				return commandConsumed();
			}
			runtime.ctx.showStatus(
				cfgEditBlackboxEnabled.get(runtime.ctx.settings) ? M.editsUsePrintMode : M.editsDisabledHint,
			);
			return commandConsumed();
		},
	},
];

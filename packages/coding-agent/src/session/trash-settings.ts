/**
 * Session-trash settings domain. Lives in its own module so `all-settings.ts`
 * can register it last: the Files tab lists settings in registration order and
 * TAB_GROUPS must mirror that order (contiguous-groups contract), putting
 * "Session Trash" after Editing/Reading/Read Summaries/LSP.
 */
import { register } from "../config/registry";

/**
 * Days a soft-deleted session stays in `~/.zeta/trash/sessions/` before the
 * background sweeper removes it. 0 keeps entries forever.
 */
export const cfgSessionTrashRetentionDays = register({
	id: "session.trashRetentionDays",
	type: "number",
	default: 30,
	normalize: value => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : value),
	ui: {
		tab: "files",
		group: "Session Trash",
		label: "Trash Retention (days)",
		description:
			"Days to keep deleted sessions in the trash (~/.zeta/trash/sessions) before automatic cleanup. 0 keeps them forever.",
		options: [
			{ value: "7", label: "7 days" },
			{ value: "14", label: "14 days" },
			{ value: "30", label: "30 days" },
			{ value: "90", label: "90 days" },
			{ value: "0", label: "Keep forever" },
		],
	},
});

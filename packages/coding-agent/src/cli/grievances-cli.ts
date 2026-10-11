/**
 * CLI handler for `zetacode grievances` — view, clean, and manually push reported tool issues.
 */
import chalk from "@linxiraos/pi-utils/chalk";
import { Settings } from "../config/settings";
import { resolveIssueRepo } from "../grievances/client";
import { M } from "../i18n";
import { flushGrievances, type FlushResult, openAutoQaDb } from "../tools/report-tool-issue";

interface GrievanceRow {
	id: number;
	model: string;
	version: string;
	tool: string;
	report: string;
	/** 0 = queued, 1 = shipped, -1 = refused by the collector. */
	pushed: number;
	/** Collector error for refused rows; `null` otherwise. */
	push_error: string | null;
}

/** Human-readable push state for a listed row. */
function describeState(row: GrievanceRow): string {
	if (row.pushed === 1) return chalk.green("pushed");
	if (row.pushed === 0) return chalk.yellow("pending");
	return chalk.red(`rejected${row.push_error ? `: ${row.push_error}` : ""}`);
}

export interface ListGrievancesOptions {
	limit: number;
	tool?: string;
	json: boolean;
}

export interface CleanGrievancesOptions {
	/** Delete a single grievance by id. */
	id?: number;
	/** Delete every grievance recorded for this tool name. */
	tool?: string;
	/** Delete every grievance regardless of tool/id. */
	all?: boolean;
	/** Output the deletion count as JSON instead of a status message. */
	json?: boolean;
}

export interface PushGrievancesOptions {
	/** Emit the {@link FlushResult} as JSON instead of a status line. */
	json?: boolean;
}
export async function listGrievances(options: ListGrievancesOptions): Promise<void> {
	const db = openAutoQaDb();
	if (!db) {
		if (options.json) {
			console.log("[]");
		} else {
			console.log(
				chalk.dim("No grievances database found. Auto-QA has not recorded any reports yet (or was disabled)."),
			);
		}
		return;
	}

	try {
		const columns = "id, model, version, tool, report, pushed, push_error";
		let rows: GrievanceRow[];
		if (options.tool) {
			rows = db
				.prepare(`SELECT ${columns} FROM grievances WHERE tool = ? ORDER BY id DESC LIMIT ?`)
				.all(options.tool, options.limit) as GrievanceRow[];
		} else {
			rows = db
				.prepare(`SELECT ${columns} FROM grievances ORDER BY id DESC LIMIT ?`)
				.all(options.limit) as GrievanceRow[];
		}

		if (options.json) {
			console.log(JSON.stringify(rows, null, 2));
			return;
		}

		if (rows.length === 0) {
			console.log(chalk.dim("No grievances recorded yet."));
			return;
		}

		for (const row of rows) {
			console.log(
				`${chalk.dim(`#${row.id}`)} ${chalk.cyan(row.tool)} ${chalk.dim(`(${row.model} v${row.version})`)} ${describeState(row)}`,
			);
			console.log(`  ${row.report}`);
			console.log();
		}

		console.log(chalk.dim(`Showing ${rows.length} most recent${options.tool ? ` for ${options.tool}` : ""}`));
	} finally {
		db.close();
	}
}

/**
 * Delete grievances from the auto-QA database.
 *
 * Selectors are mutually exclusive in intent — exactly one of `id`, `tool`, or
 * `all` is required. Multiple selectors are rejected to prevent ambiguous deletes
 * (e.g. `--id 5 --all` would be a footgun). Returns silently when the database
 * does not exist yet.
 */
export async function cleanGrievances(options: CleanGrievancesOptions): Promise<void> {
	const selectors = [options.id !== undefined, !!options.tool, !!options.all].filter(Boolean).length;
	if (selectors === 0) {
		console.error(chalk.red("Specify exactly one of --id, --tool, or --all."));
		process.exitCode = 1;
		return;
	}
	if (selectors > 1) {
		console.error(chalk.red("--id, --tool, and --all are mutually exclusive."));
		process.exitCode = 1;
		return;
	}

	const db = openAutoQaDb();
	if (!db) {
		if (options.json) {
			console.log(JSON.stringify({ deleted: 0 }));
		} else {
			console.log(
				chalk.dim("No grievances database found. Auto-QA has not recorded any reports yet (or was disabled)."),
			);
		}
		return;
	}

	try {
		let deleted = 0;
		if (options.id !== undefined) {
			const result = db.prepare("DELETE FROM grievances WHERE id = ?").run(options.id);
			deleted = Number(result.changes);
		} else if (options.tool) {
			const result = db.prepare("DELETE FROM grievances WHERE tool = ?").run(options.tool);
			deleted = Number(result.changes);
		} else {
			const result = db.prepare("DELETE FROM grievances").run();
			deleted = Number(result.changes);
			// Reset the autoincrement counter so a fresh slate starts at #1 again.
			// `sqlite_sequence` only exists if AUTOINCREMENT was ever used; ignore failures.
			try {
				db.prepare("DELETE FROM sqlite_sequence WHERE name = 'grievances'").run();
			} catch {
				/* sequence table missing on a brand-new db — nothing to reset */
			}
		}

		if (options.json) {
			console.log(JSON.stringify({ deleted }));
			return;
		}

		if (deleted === 0) {
			console.log(chalk.dim("No matching grievances to delete."));
			return;
		}

		const scope =
			options.id !== undefined ? `#${options.id}` : options.tool ? `for ${options.tool}` : "(all entries)";
		console.log(chalk.green(`Deleted ${deleted} grievance${deleted === 1 ? "" : "s"} ${scope}.`));
	} finally {
		db.close();
	}
}

// ───────────────────────────────────────────────────────────────────────────
// Manual push (`zetacode grievances push`)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Single-line ANSI progress reporter. `update(done)` rewrites the line via
 * `\r`; `finish()` newlines out so subsequent log lines land cleanly. On a
 * non-TTY stdout (CI, pipes) both calls no-op so log files don't fill with
 * carriage-return noise.
 */
interface ProgressBar {
	update(done: number): void;
	finish(): void;
}

function makeProgressBar(total: number, width = 30): ProgressBar {
	const isTty = !!process.stdout.isTTY;
	if (!isTty || total === 0) {
		return { update: () => undefined, finish: () => undefined };
	}
	const render = (done: number): void => {
		const ratio = Math.min(1, done / total);
		const filled = Math.round(ratio * width);
		const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
		const pct = `${Math.floor(ratio * 100)
			.toString()
			.padStart(3, " ")}%`;
		process.stdout.write(`\r${chalk.cyan("Pushing")} [${bar}] ${pct} ${done}/${total}`);
	};
	render(0);
	return {
		update: render,
		finish: () => process.stdout.write("\n"),
	};
}

/**
 * Print the composed issue and the prefilled new-issue URL when no GitHub
 * token was available. Nothing was submitted; say so plainly.
 */
function printManualFallback(result: FlushResult): void {
	console.log(chalk.yellow(M.grManualHeaderFmt.replace("%s", resolveIssueRepo())));
	if (result.manualUrl) console.log(chalk.underline(M.grManualPrefilledFmt.replace("%s", result.manualUrl)));
	if (!result.composed) return;
	console.log(chalk.dim(M.grManualComposedHeader));
	console.log(chalk.dim(M.grManualTitleFmt.replace("%s", result.composed.title)));
	console.log(chalk.dim(M.grManualLabelsFmt.replace("%s", result.composed.labels.join(", "))));
	console.log(chalk.dim(M.grManualBodyLabel));
	console.log(result.composed.body);
}

/**
 * Manually drain every unpushed grievance to GitHub Issues, ignoring the
 * user-facing consent gate (manual push is the user's explicit "yes ship these
 * now" intent).
 *
 * Destination repo: `ZETA_ISSUE_REPO` (default {@link DEFAULT_ISSUE_REPO}).
 * Auth: `GITHUB_TOKEN` / `GH_TOKEN` / `dev.autoqaPush.token` / `gh auth token`.
 * Without a token the composed issues are printed with a prefilled
 * `github.com/<repo>/issues/new` URL and nothing is sent.
 */
export async function pushGrievances(options: PushGrievancesOptions): Promise<void> {
	const db = openAutoQaDb();
	if (!db) {
		if (options.json) {
			console.log(JSON.stringify({ pushed: 0, ok: false, skipped: true, reason: "no_db" }));
		} else {
			console.log(chalk.dim("No grievances database found — nothing to push."));
		}
		return;
	}
	const settings = await Settings.init();
	let bar: ProgressBar = { update: () => undefined, finish: () => undefined };
	let total = 0;

	try {
		const result = await flushGrievances(db, settings, {
			bypassConsent: true,
			kind: "feedback",
			onStart: t => {
				total = t;
				if (!options.json) bar = makeProgressBar(t);
			},
			onProgress: pushed => bar.update(pushed),
		});
		bar.finish();

		if (options.json) {
			console.log(JSON.stringify(result));
			return;
		}

		if (result.skipped) {
			console.log(chalk.yellow(M.grPushSkippedDisabled));
			return;
		}
		if (total === 0) {
			console.log(chalk.dim(M.grPushNothingToPush));
			return;
		}
		if (result.unauthenticated) {
			printManualFallback(result);
			process.exitCode = 1;
			return;
		}
		const rejected = result.rejected ?? 0;
		if (rejected > 0) {
			console.log(
				chalk.yellow(
					rejected === 1 ? M.grPushRejectedOne : M.grPushRejectedManyFmt.replace("%s", String(rejected)),
				),
			);
		}
		if (result.ok) {
			const urls = result.urls ?? [];
			console.log(
				chalk.green(
					result.pushed === 1 ? M.grPushFiledOne : M.grPushFiledManyFmt.replace("%s", String(result.pushed)),
				),
			);
			for (const url of urls) console.log(chalk.dim(url));
			return;
		}
		const remaining = total - result.pushed - rejected;
		console.log(
			chalk.red(
				M.grPushFailedFmt
					.replace("%s", String(result.pushed))
					.replace("%s", String(total))
					.replace("%s", String(remaining)),
			),
		);
		if (result.error) console.log(chalk.red(M.grPushServerSaidFmt.replace("%s", result.error)));
		process.exitCode = 1;
	} finally {
		db.close();
	}
}

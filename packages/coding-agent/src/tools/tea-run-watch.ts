/**
 * Gitea Actions equivalent of `gh run watch`.
 *
 * Polls `GET /repos/{owner}/{repo}/actions/runs/{run}` through `tea api`,
 * streaming a snapshot per poll and returning once the run reaches a terminal
 * state. Poll cadence, abort handling, and the "watch the run id" shape mirror
 * `gh-run-watch.ts`; Gitea exposes no failed-job log endpoint here, so the
 * result is the run snapshot plus its observed status transitions.
 */
import { scheduler } from "node:timers/promises";
import type { AgentToolResult, AgentToolUpdateCallback } from "@linxiraos/pi-agent-core";
import { formatShortSha, pushLine } from "@linxiraos/pi-tui/tools/gh-format";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { gitea } from "../utils/gitea";
import type { ToolSession } from ".";
import { RUN_WATCH_FAST_WINDOW_MS, RUN_WATCH_INTERVAL_DEFAULT, RUN_WATCH_INTERVAL_SLOW } from "./gh-run-watch";
import {
	buildTextResult,
	normalizeOptionalString,
	parseRepoRef,
	resolveLoginArgs,
	resolveTeaRepoMemoized,
} from "./tea-common";
import type { TeaInput, TeaRun, TeaToolDetails } from "./tea-types";
import { throwIfAborted } from "./tool-errors";

export const TEA_RUN_SUCCESS_CONCLUSIONS: Record<string, true> = {
	success: true,
	neutral: true,
	skipped: true,
};
export const TEA_RUN_FAILURE_CONCLUSIONS: Record<string, true> = {
	failure: true,
	timed_out: true,
	cancelled: true,
	canceled: true,
	action_required: true,
	startup_failure: true,
};

/**
 * Gitea reports `status` as an in-progress phase (`queued`, `in_progress`)
 * and `completed` at the end, with `conclusion` carrying the outcome; some
 * versions fold the outcome into `status` itself. Accept both shapes.
 */
export function getTeaRunOutcome(run: TeaRun): "success" | "failure" | "pending" {
	const status = (run.status ?? "").toLowerCase();
	const conclusion = (run.conclusion ?? "").toLowerCase();
	if (status === "completed") {
		if (TEA_RUN_SUCCESS_CONCLUSIONS[conclusion] === true) return "success";
		if (TEA_RUN_FAILURE_CONCLUSIONS[conclusion] === true) return "failure";
		return "pending";
	}
	if (TEA_RUN_SUCCESS_CONCLUSIONS[status] === true) return "success";
	if (TEA_RUN_FAILURE_CONCLUSIONS[status] === true) return "failure";
	return "pending";
}

export function isTeaRunTerminal(run: TeaRun): boolean {
	return getTeaRunOutcome(run) !== "pending" || (run.status ?? "").toLowerCase() === "completed";
}

/** Human-readable state for the poll trace, e.g. `completed (success)`. */
export function describeTeaRunState(run: TeaRun): string {
	const status = normalizeOptionalString(run.status) ?? "unknown";
	const conclusion = normalizeOptionalString(run.conclusion);
	return conclusion ? `${status} (${conclusion})` : status;
}

function formatTeaRunFields(repo: string, run: TeaRun): string[] {
	const lines: string[] = [];
	pushLine(lines, "Repository", repo);
	pushLine(lines, "Workflow", normalizeOptionalString(run.name));
	pushLine(lines, "Title", normalizeOptionalString(run.display_title));
	pushLine(lines, "Branch", normalizeOptionalString(run.head_branch));
	pushLine(lines, "Commit", formatShortSha(run.head_sha ?? undefined) ?? normalizeOptionalString(run.head_sha));
	pushLine(lines, "Status", normalizeOptionalString(run.status));
	pushLine(lines, "Conclusion", normalizeOptionalString(run.conclusion));
	pushLine(lines, "Created", normalizeOptionalString(run.created_at));
	pushLine(lines, "Updated", normalizeOptionalString(run.updated_at));
	pushLine(lines, "URL", normalizeOptionalString(run.html_url));
	return lines;
}

export function formatTeaRunSnapshot(
	repo: string,
	run: TeaRun,
	pollCount: number,
	transitions: readonly string[],
): string {
	const lines: string[] = [`# Watching Gitea Actions Run #${run.id ?? "?"}`, "", ...formatTeaRunFields(repo, run)];
	pushLine(lines, "Poll", pollCount);
	if (transitions.length > 0) {
		pushLine(lines, "Transitions", transitions.join(" → "));
	}
	return lines.join("\n").trim();
}

export function formatTeaRunResult(repo: string, run: TeaRun, transitions: readonly string[]): string {
	const lines: string[] = [`# Gitea Actions Run #${run.id ?? "?"}`, "", ...formatTeaRunFields(repo, run)];
	if (transitions.length > 0) {
		pushLine(lines, "Transitions", transitions.join(" → "));
	}
	lines.push("");
	const outcome = getTeaRunOutcome(run);
	lines.push(outcome === "success" ? "Run succeeded." : outcome === "failure" ? "Run failed." : "Run finished.");
	return lines.join("\n").trim();
}

function buildTeaRunDetails(repo: string, run: TeaRun): TeaToolDetails {
	return {
		repo,
		runId: run.id,
		runStatus: normalizeOptionalString(run.status),
		runConclusion: normalizeOptionalString(run.conclusion),
		branch: normalizeOptionalString(run.head_branch),
		headSha: normalizeOptionalString(run.head_sha),
		url: normalizeOptionalString(run.html_url),
	};
}

async function fetchTeaRun(
	cwd: string,
	loginArgs: readonly string[],
	slug: string,
	runId: number,
	signal: AbortSignal | undefined,
): Promise<TeaRun> {
	const run = await gitea.json<TeaRun>(cwd, ["api", ...loginArgs, `/repos/${slug}/actions/runs/${runId}`], signal, {
		repoProvided: true,
	});
	if (typeof run?.id !== "number") {
		throw new ToolError(`Gitea Actions run response for #${runId} did not include a run ID.`);
	}
	return run;
}

/** Test seam: override the poll cadence (milliseconds) instead of waiting out the 3s/15s schedule. */
export interface TeaRunWatchSchedule {
	pollIntervalMs(): number;
}

export async function executeTeaRunWatch(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<TeaToolDetails> | undefined,
	schedule?: TeaRunWatchSchedule,
): Promise<AgentToolResult<TeaToolDetails>> {
	const runId = params.run;
	if (typeof runId !== "number" || !Number.isSafeInteger(runId) || runId <= 0) {
		throw new ToolError("run_watch requires a positive numeric `run` id.");
	}
	const repo = await resolveTeaRepoMemoized(session.cwd, params.repo, signal);
	const ref = parseRepoRef(repo);
	const loginArgs = await resolveLoginArgs(session.cwd, ref, params.login, signal);
	const watchStartMs = Date.now();
	const pollIntervalMs =
		schedule?.pollIntervalMs ??
		(() =>
			(Date.now() - watchStartMs < RUN_WATCH_FAST_WINDOW_MS ? RUN_WATCH_INTERVAL_DEFAULT : RUN_WATCH_INTERVAL_SLOW) *
			1000);
	let pollCount = 0;
	let lastState: string | undefined;
	const transitions: string[] = [];

	while (true) {
		throwIfAborted(signal);
		pollCount += 1;
		const run = await fetchTeaRun(session.cwd, loginArgs, ref.slug, runId, signal);
		const state = describeTeaRunState(run);
		if (state !== lastState) {
			transitions.push(state);
			lastState = state;
		}
		const details = buildTeaRunDetails(repo, run);
		onUpdate?.({
			content: [{ type: "text", text: formatTeaRunSnapshot(repo, run, pollCount, transitions) }],
			details,
		});
		if (isTeaRunTerminal(run)) {
			return buildTextResult(formatTeaRunResult(repo, run, transitions), details.url, details);
		}
		await scheduler.wait(Math.max(0, pollIntervalMs()), { signal });
	}
}

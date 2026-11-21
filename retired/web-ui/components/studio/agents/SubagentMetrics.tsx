"use client";

/**
 * Metric formatting for roster rows and the inspect card.
 *
 * Ported from OMP Studio (MIT) `conversation/SubagentMetrics.tsx`. Studio also
 * overlaid live `StudioAgentSnapshot` usage onto transcript cards; the hub is
 * already reading snapshots directly, so only the pure formatters survive —
 * plus the duration clock, which is what tells a running child from a stopped
 * one.
 */

import type { StudioAgentSnapshot, StudioAgentUsage } from "@/lib/studio-protocol/protocol";

export interface SubagentMetricValues {
	readonly generationTps?: number;
	readonly tokens?: string;
	readonly tools?: string | number;
	readonly requests?: string | number;
	readonly files?: string | number;
	readonly cost?: string;
}

export function formatAgentCost(cost: number): string {
	if (cost === 0) return "—";
	if (!Number.isFinite(cost)) return "";
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	if (cost < 1) return `$${cost.toFixed(3)}`;
	return `$${cost.toFixed(2)}`;
}

/** Only these statuses are still running, so only their duration ticks. */
const TICKING_STATUS: readonly StudioAgentSnapshot["status"][] = ["starting", "running", "reviving"];

function isTickingAgentStatus(status: StudioAgentSnapshot["status"]): boolean {
	return TICKING_STATUS.includes(status);
}

/**
 * One roster row's duration: measured usage → ticking while running → frozen at
 * `updatedAt − startedAt` once stopped. A stopped runtime stops pushing
 * `updatedAt`, so the frozen span is the real time the child ran.
 */
export function subagentDurationMs(
	agent: Pick<StudioAgentSnapshot, "status" | "startedAt" | "updatedAt" | "usage">,
	nowMs: number = Date.now(),
): number | undefined {
	const measured = agent.usage?.durationMs;
	if (measured !== undefined && Number.isFinite(measured)) return Math.max(0, measured);
	if (agent.startedAt === undefined) return undefined;
	const started = Date.parse(agent.startedAt);
	if (!Number.isFinite(started)) return undefined;
	const ended = isTickingAgentStatus(agent.status) ? nowMs : Date.parse(agent.updatedAt);
	if (!Number.isFinite(ended)) return undefined;
	return Math.max(0, ended - started);
}

/** Compact metric chip row for an inspect card header. */
export function SubagentMetrics({ tokens, tools, requests, files, cost, generationTps }: SubagentMetricValues) {
	if (tokens === undefined && tools === undefined && requests === undefined && files === undefined && !cost) {
		return null;
	}
	const aria = [
		tokens === undefined ? "" : `${tokens} tok`,
		tools === undefined ? "" : `${tools} tools`,
		requests === undefined ? "" : `${requests} req`,
		files === undefined ? "" : `${files} files`,
		cost ?? "",
		generationTps === undefined ? "" : `${generationTps.toFixed(1)} tok/s`,
	]
		.filter(Boolean)
		.join("，");
	return (
		<div className="sa-metrics" aria-label={aria}>
			{tokens === undefined ? null : (
				<span className="sa-tok">
					<b>{tokens}</b>
					<i>tok</i>
				</span>
			)}
			{tools === undefined ? null : (
				<span className="hub-num">
					<i>tools</i>
					<b>{tools}</b>
				</span>
			)}
			{requests === undefined ? null : (
				<span className="hub-num">
					<i>req</i>
					<b>{requests}</b>
				</span>
			)}
			{files === undefined ? null : (
				<span className="hub-num">
					<i>files</i>
					<b>{files}</b>
				</span>
			)}
			{generationTps === undefined ? null : <span className="sa-tok">{generationTps.toFixed(1)} tok/s</span>}
			{cost ? (
				<span className="sa-cost" title="API-equivalent estimate; billed cost unavailable / API 等价估算，实际扣费未知">
					{cost}
				</span>
			) : null}
		</div>
	);
}

/**
 * Headline tiles for one trace: wall time split into model/tool/idle, then
 * turns, requests, tool calls, agents, tokens, cost.
 */

import { formatCompact, formatElapsed, formatEstimatedCost, formatInteger, formatPercent } from "../data/formatters";
import { t } from "../i18n";
import type { TraceSummary } from "../types";
import { Stat, StatGrid } from "../ui";

export interface SummaryStripProps {
	summary: TraceSummary;
}

export function SummaryStrip({ summary }: SummaryStripProps) {
	const share = (ms: number) =>
		summary.wallMs > 0 ? t("trace.of-wall", { percent: formatPercent(ms / summary.wallMs) }) : undefined;
	return (
		<StatGrid min={112}>
			<Stat size="sm" label={t("trace.wall-time")} value={formatElapsed(summary.wallMs)} />
			<Stat
				size="sm"
				label={t("trace.model-time")}
				value={formatElapsed(summary.modelMs)}
				hint={share(summary.modelMs)}
			/>
			<Stat
				size="sm"
				label={t("trace.tool-time")}
				value={formatElapsed(summary.toolMs)}
				hint={share(summary.toolMs)}
			/>
			<Stat size="sm" label={t("trace.idle")} value={formatElapsed(summary.idleMs)} hint={share(summary.idleMs)} />
			<Stat size="sm" label={t("trace.turns")} value={formatInteger(summary.turns)} />
			<Stat
				size="sm"
				label={t("common.requests")}
				value={formatInteger(summary.requests)}
				hint={t("trace.tool-calls-n", { count: formatInteger(summary.toolCalls) })}
			/>
			<Stat size="sm" label={t("trace.agents")} value={formatInteger(summary.subagents)} />
			<Stat size="sm" label={t("common.tokens")} value={formatCompact(summary.totalTokens)} />
			<Stat
				size="sm"
				label={t("common.cost")}
				value={formatEstimatedCost(summary.costTotal, summary.unpricedRequests)}
			/>
		</StatGrid>
	);
}

"use client";

import { useI18n } from "@/hooks/useI18n";
import { ContextRing } from "./ContextRing";
import {
	cacheHitRate,
	categorySlices,
	clampPercent,
	compactionMarkerPercent,
	formatCostUsd,
	formatTokensCompact,
	formatTokensExact,
	nonNegativeCount,
	toneForUsage,
	usedWindowPercent,
	type ContextTone,
} from "./context-ring-model";
import type { ContextCategoryId, ContextUsageReport } from "./types";

/** i18n keys per category, kept as literal tables so a new id is a compile error. */
const CATEGORY_LABEL_KEY: Record<ContextCategoryId, string> = {
	systemPrompt: "context-ring.category-systemPrompt",
	systemTools: "context-ring.category-systemTools",
	systemContext: "context-ring.category-systemContext",
	skills: "context-ring.category-skills",
	messages: "context-ring.category-messages",
};

const CATEGORY_HINT_KEY: Record<ContextCategoryId, string> = {
	systemPrompt: "context-ring.hint-systemPrompt",
	systemTools: "context-ring.hint-systemTools",
	systemContext: "context-ring.hint-systemContext",
	skills: "context-ring.hint-skills",
	messages: "context-ring.hint-messages",
};

const TONE_STATUS_KEY: Record<ContextTone, string> = {
	ok: "context-ring.status-ok",
	near: "context-ring.status-near",
	full: "context-ring.status-full",
};

/** Session token counters, in display order: `[i18n key, report field]`. */
const USAGE_ROWS = [
	["context-ring.usage-input", "input"],
	["context-ring.usage-output", "output"],
	["context-ring.usage-reasoning", "reasoning"],
	["context-ring.usage-cache-read", "cacheRead"],
	["context-ring.usage-cache-write", "cacheWrite"],
	["context-ring.usage-total", "total"],
] as const;

/** Call counters, in display order: `[i18n key, report field]`. */
const CALL_ROWS = [
	["context-ring.calls-user", "userMessages"],
	["context-ring.calls-assistant", "assistantMessages"],
	["context-ring.calls-tool-calls", "toolCalls"],
	["context-ring.calls-tool-results", "toolResults"],
	["context-ring.calls-total-messages", "totalMessages"],
	["context-ring.calls-premium", "premiumRequests"],
] as const;

export interface ContextRingReportViewProps {
	report: ContextUsageReport;
	/**
	 * Live occupancy from the agent state stream, used only when the report
	 * itself carries no window (first paint after a model switch). The report
	 * wins once it has numbers, so the ring and the legend cannot disagree.
	 */
	livePercent?: number | null;
	/** Set when a refresh failed but a previous snapshot is still on screen. */
	stale?: boolean;
	className?: string;
}

/**
 * Pure view of one context report — no fetching, no effects, no stylesheet
 * import, so the SSR tests can render it directly from a fixture.
 *
 * Rendering contract (matches Reasonix's ContextPanel / the harness's
 * ContextMeter): the ring is the window occupancy, the bar's total width is the
 * same reading, and the colored slices only redistribute that width by
 * category. Hover text on every legend row and fact row explains what the
 * number counts.
 */
export function ContextRingReportView({ report, livePercent, stale, className }: ContextRingReportViewProps) {
	const { locale, t } = useI18n();
	const contextWindow = nonNegativeCount(report.contextWindow);
	const reading = contextWindow > 0 ? usedWindowPercent(report) : clampPercent(livePercent ?? 0);
	const tone = toneForUsage(reading, report.compaction?.thresholdPercent ?? null);
	const marker = compactionMarkerPercent(report);
	const slices = categorySlices(report);
	const cacheRate = cacheHitRate(report.usage);
	const thresholdTokens = report.compaction?.thresholdTokens ?? null;
	const tokensUntilCompact =
		thresholdTokens === null ? null : Math.max(0, thresholdTokens - nonNegativeCount(report.usedTokens));
	const summary = t("context-ring.aria", {
		percent: Math.round(reading),
		used: formatTokensExact(report.usedTokens, locale),
		window: formatTokensExact(contextWindow, locale),
	});

	return (
		<section
			className={className === undefined ? "context-ring-panel" : `context-ring-panel ${className}`}
			aria-label={t("context-ring.panel-aria")}
		>
			<div className="context-ring-panel__hero">
				<ContextRing percent={reading} tone={tone} thresholdPercent={marker} label={summary} size={132}>
					<span className="context-ring-panel__percent">{Math.round(reading)}%</span>
					<span className="context-ring-panel__figures">
						{formatTokensCompact(report.usedTokens)} / {formatTokensCompact(contextWindow)}
					</span>
				</ContextRing>
				<ul className="context-ring-panel__legend">
					{slices.map(slice => (
						<li key={slice.id} className="context-ring-panel__legend-row" title={t(CATEGORY_HINT_KEY[slice.id])}>
							<span
								className={`context-ring-panel__swatch context-ring-panel__swatch--${slice.id}`}
								aria-hidden="true"
							/>
							<span className="context-ring-panel__legend-name">{t(CATEGORY_LABEL_KEY[slice.id])}</span>
							<span className="context-ring-panel__legend-tokens">{formatTokensExact(slice.tokens, locale)}</span>
							<span className="context-ring-panel__legend-share">
								{t("context-ring.share-of-used", { percent: Math.round(slice.usedShare * 100) })}
							</span>
						</li>
					))}
				</ul>
			</div>

			<div className="context-ring-panel__bar" aria-hidden="true">
				{slices.map(slice => (
					<span
						key={slice.id}
						className={`context-ring-panel__seg context-ring-panel__seg--${slice.id}`}
						style={{ width: `${slice.windowPercent}%` }}
					/>
				))}
				{marker !== null && marker > 0 && (
					<span className="context-ring-panel__mark" style={{ left: `${marker}%` }} />
				)}
			</div>

			<dl className="context-ring-panel__facts">
				<div className="context-ring-panel__fact">
					<dt>{t("context-ring.status-label")}</dt>
					<dd className={`context-ring-panel__tone context-ring-panel__tone--${tone}`}>
						{t(TONE_STATUS_KEY[tone])}
					</dd>
				</div>
				<div className="context-ring-panel__fact" title={t("context-ring.hint-compaction")}>
					<dt>{t("context-ring.compaction-threshold")}</dt>
					<dd>
						{thresholdTokens === null
							? t("context-ring.compaction-disabled")
							: t("context-ring.compaction-value", {
									tokens: formatTokensExact(thresholdTokens, locale),
									percent: Math.round(report.compaction?.thresholdPercent ?? 0),
								})}
					</dd>
				</div>
				{tokensUntilCompact !== null && (
					<div className="context-ring-panel__fact" title={t("context-ring.hint-until-compact")}>
						<dt>{t("context-ring.tokens-until-compact")}</dt>
						<dd>{formatTokensExact(tokensUntilCompact, locale)}</dd>
					</div>
				)}
				<div className="context-ring-panel__fact">
					<dt>{t("context-ring.free-tokens")}</dt>
					<dd>{formatTokensExact(report.freeTokens, locale)}</dd>
				</div>
				<div className="context-ring-panel__fact" title={t("context-ring.hint-buffer")}>
					<dt>{t("context-ring.buffer-tokens")}</dt>
					<dd>{formatTokensExact(report.autoCompactBufferTokens, locale)}</dd>
				</div>
				<div className="context-ring-panel__fact" title={t("context-ring.hint-cache")}>
					<dt>{t("context-ring.cache-hit-rate")}</dt>
					<dd>{cacheRate === null ? t("context-ring.cache-not-reported") : `${cacheRate.toFixed(1)}%`}</dd>
				</div>
			</dl>

			<h3 className="context-ring-panel__section">{t("context-ring.section-usage")}</h3>
			<dl className="context-ring-panel__facts">
				{USAGE_ROWS.map(([key, field]) => (
					<div className="context-ring-panel__fact" key={field}>
						<dt>{t(key)}</dt>
						<dd>{formatTokensExact(report.usage[field], locale)}</dd>
					</div>
				))}
				<div className="context-ring-panel__fact" title={t("context-ring.hint-cost")}>
					<dt>{t("context-ring.section-cost")}</dt>
					<dd>{formatCostUsd(report.cost, locale)}</dd>
				</div>
			</dl>

			<h3 className="context-ring-panel__section">{t("context-ring.section-calls")}</h3>
			<dl className="context-ring-panel__facts">
				{CALL_ROWS.map(([key, field]) => (
					<div className="context-ring-panel__fact" key={field}>
						<dt>{t(key)}</dt>
						<dd>{formatTokensExact(report.calls[field], locale)}</dd>
					</div>
				))}
			</dl>

			{stale === true && <p className="context-ring-panel__notice">{t("context-ring.stale")}</p>}
		</section>
	);
}

export interface ContextRingPanelChromeProps {
	/** Agent session to report on; null renders the empty state. */
	sessionId: string | null;
	report: ContextUsageReport | null;
	loading: boolean;
	error: string | null;
	/** Whether the agent session is live. */
	running: boolean;
	/** Live occupancy from the agent state stream (first paint only). */
	livePercent?: number | null;
	className?: string;
}

/**
 * Panel chrome: title row plus the report / loading / failure / no-session
 * states. Takes the fetch result as props so the state machine is testable
 * without a network or an effects harness.
 */
export function ContextRingPanelChrome({
	sessionId,
	report,
	loading,
	error,
	running,
	livePercent,
	className,
}: ContextRingPanelChromeProps) {
	const { t } = useI18n();
	const model = report?.model ?? null;

	return (
		<div className={className === undefined ? "context-ring-shell" : `context-ring-shell ${className}`}>
			<header className="context-ring-panel__header">
				<h2 className="context-ring-panel__title">{t("context-ring.title")}</h2>
				<span
					className="context-ring-panel__model"
					title={model === null ? undefined : `${model.provider}/${model.modelId}`}
				>
					{model === null ? t("context-ring.model-unknown") : `${model.provider}/${model.modelId}`}
				</span>
			</header>
			{!sessionId ? (
				<p className="context-ring-panel__empty" data-testid="context-ring-no-session">
					{t("context-ring.no-session")}
				</p>
			) : report !== null ? (
				<ContextRingReportView report={report} livePercent={livePercent} stale={error !== null} />
			) : error !== null ? (
				<p className="context-ring-panel__error" data-testid="context-ring-error">
					{t("context-ring.error", { error })}
				</p>
			) : loading || running ? (
				<p className="context-ring-panel__empty" data-testid="context-ring-loading">
					{t("context-ring.loading")}
				</p>
			) : (
				<p className="context-ring-panel__empty" data-testid="context-ring-not-running">
					{t("context-ring.not-running")}
				</p>
			)}
		</div>
	);
}

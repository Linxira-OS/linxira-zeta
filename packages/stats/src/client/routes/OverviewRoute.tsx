import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { getOverviewStats, getRecentRequests } from "../api";
import { t } from "../i18n";
import { Legend, ShareBar, TimeChart } from "../charts";
import {
	formatCompact,
	formatDurationMs,
	formatErrorRate,
	formatEstimatedCost,
	formatInteger,
	formatMessageCost,
	formatPercent,
	formatRelativeTime,
	formatTokensPerSecond,
} from "../data/formatters";
import { useQuery } from "../data/query";
import { bucketAxis, rangeMeta } from "../data/range";
import { densify } from "../data/series";
import { buildAgentTokenShare, sumConversationTokens } from "../data/view-models";
import type { AgentType, MessageStats, TimeRange } from "../types";
import {
	Badge,
	Card,
	ChartSkeleton,
	Dot,
	LabelCell,
	PageHeader,
	QueryView,
	Segmented,
	Stat,
	StatGrid,
	Table,
	TableSkeleton,
} from "../ui";

export interface OverviewRouteProps {
	active: boolean;
	range: TimeRange;
	onRequestClick: (id: number) => void;
}

type ActivityMetric = "requests" | "tokens" | "cost";

const ACTIVITY_OPTIONS = [
	{ value: "requests" as const, label: t("common.requests") },
	{ value: "tokens" as const, label: t("common.tokens") },
	{ value: "cost" as const, label: t("common.cost") },
];

const AGENT_LABEL: Record<AgentType, string> = {
	main: t("overview.main-agent"),
	subagent: t("overview.subagents"),
	advisor: t("overview.advisor"),
};
const AGENT_COLOR: Record<AgentType, string> = {
	main: "var(--chart-primary)",
	subagent: "var(--chart-secondary)",
	advisor: "#9d7bff",
};

const TOKEN_MIX = [
	{ key: "input", label: t("overview.uncached-input"), color: "#5b8cff" },
	{ key: "cacheRead", label: t("common.cache-read"), color: "var(--chart-primary)" },
	{ key: "cacheWrite", label: t("common.cache-write"), color: "#f5b54a" },
	{ key: "output", label: t("common.output"), color: "var(--chart-secondary)" },
] as const;

export function OverviewRoute({ active, range, onRequestClick }: OverviewRouteProps) {
	const overview = useQuery(["overview", range], ({ signal }) => getOverviewStats(range, signal), { enabled: active });
	const recent = useQuery(["recent-requests"], ({ signal }) => getRecentRequests(12, signal), { enabled: active });
	const [metric, setMetric] = useState<ActivityMetric>("requests");
	const meta = rangeMeta(range);

	const series = useMemo(() => {
		const points = overview.data?.timeSeries ?? [];
		const buckets = bucketAxis(
			range,
			points.map(p => p.timestamp),
		);
		return {
			buckets,
			requests: densify(points, buckets, p => p.requests - p.errors),
			errors: densify(points, buckets, p => p.errors),
			tokens: densify(points, buckets, p => p.tokens),
			cost: densify(points, buckets, p => p.cost),
			all: densify(points, buckets, p => p.requests),
		};
	}, [overview.data, range]);

	const chartSeries =
		metric === "requests"
			? [
					{ key: "ok", label: t("overview.succeeded"), color: "var(--chart-primary)", values: series.requests },
					{ key: "err", label: t("common.failed"), color: "var(--bad)", values: series.errors },
				]
			: metric === "tokens"
				? [{ key: "tokens", label: t("common.tokens"), color: "var(--chart-primary)", values: series.tokens }]
				: [
						{
							key: "cost",
							label: t("overview.api-equivalent"),
							color: "var(--chart-secondary)",
							values: series.cost,
						},
					];

	return (
		<div className="page">
			<PageHeader
				title={t("overview.title")}
				description={t("overview.description", { window: t(meta.windowKey) })}
			/>

			<QueryView query={overview} skeleton={<ChartSkeleton height={112} />}>
				{({ overall }) => (
					<div data-stale={overview.stale} className="stack" style={{ gap: 16 }}>
						<StatGrid min={190}>
							<Stat
								label={t("overview.api-equivalent-cost")}
								title={t("overview.api-cost-title")}
								value={formatEstimatedCost(overall.totalCost, overall.unpricedRequests)}
								hint={
									overall.unpricedRequests > 0
										? t("overview.unpriced-n", { count: formatInteger(overall.unpricedRequests) })
										: undefined
								}
								spark={series.cost}
								sparkColor="var(--chart-secondary)"
							/>
							<Stat
								label={t("common.requests")}
								value={formatInteger(overall.totalRequests)}
								hint={t("overview.failed-n", { count: formatInteger(overall.failedRequests) })}
								spark={series.all}
							/>
							<Stat
								label={t("overview.conversation-tokens")}
								title={t("overview.tokens-title")}
								value={formatCompact(sumConversationTokens(overall))}
								hint={t("overview.output-n", { count: formatCompact(overall.totalOutputTokens) })}
								spark={series.tokens}
							/>
							<Stat
								label={t("overview.cache-rate")}
								title={t("overview.cache-rate-title")}
								value={formatPercent(overall.cacheRate)}
								hint={t("overview.cache-saved", { value: formatPercent(overall.cacheSavings) })}
							/>
							<Stat
								label={t("common.error-rate")}
								value={formatErrorRate(overall.errorRate)}
								hint={t("overview.succeeded-n", { count: formatInteger(overall.successfulRequests) })}
								spark={series.errors}
								sparkColor="var(--bad)"
							/>
						</StatGrid>
						<StatGrid min={140}>
							<Stat
								size="sm"
								label={t("overview.uncached-input")}
								value={formatCompact(overall.totalInputTokens)}
							/>
							<Stat
								size="sm"
								label={t("common.cache-read")}
								value={formatCompact(overall.totalCacheReadTokens)}
							/>
							<Stat
								size="sm"
								label={t("common.cache-write")}
								value={formatCompact(overall.totalCacheWriteTokens)}
							/>
							<Stat size="sm" label={t("common.output")} value={formatCompact(overall.totalOutputTokens)} />
							<Stat
								size="sm"
								label={t("common.premium-requests")}
								value={formatInteger(Math.round(overall.totalPremiumRequests * 100) / 100)}
							/>
							<Stat
								size="sm"
								label={t("common.tokens-per-second")}
								value={formatTokensPerSecond(overall.avgTokensPerSecond)}
							/>
							<Stat size="sm" label={t("overview.avg-latency")} value={formatDurationMs(overall.avgDuration)} />
							<Stat size="sm" label={t("overview.avg-ttft")} value={formatDurationMs(overall.avgTtft)} />
						</StatGrid>
					</div>
				)}
			</QueryView>

			<div className="grid grid-main-side">
				<Card
					index={1}
					title={t("overview.activity")}
					description={
						meta.bucketMs < 3_600_000
							? t("overview.per-5m")
							: meta.bucketMs < 86_400_000
								? t("overview.per-hour")
								: t("overview.per-day")
					}
					actions={<Segmented size="sm" options={ACTIVITY_OPTIONS} value={metric} onChange={setMetric} />}
					stale={overview.stale}
				>
					<QueryView query={overview} skeleton={<ChartSkeleton height={260} />}>
						{() => (
							<TimeChart
								buckets={series.buckets}
								bucketMs={meta.bucketMs}
								series={chartSeries}
								height={260}
								format={metric === "cost" ? v => formatEstimatedCost(v, 0) : formatCompact}
							/>
						)}
					</QueryView>
				</Card>

				<Card
					index={2}
					title={t("overview.token-mix")}
					description={t("overview.token-mix-description")}
					stale={overview.stale}
				>
					<QueryView query={overview} skeleton={<ChartSkeleton height={260} />}>
						{({ overall, byAgentType }) => {
							const mix = {
								input: overall.totalInputTokens,
								cacheRead: overall.totalCacheReadTokens,
								cacheWrite: overall.totalCacheWriteTokens,
								output: overall.totalOutputTokens,
							};
							const total = sumConversationTokens(overall);
							const agents = buildAgentTokenShare(byAgentType);
							return (
								<div className="stack" style={{ gap: 18 }}>
									<div className="stack" style={{ gap: 10 }}>
										<ShareBar
											segments={TOKEN_MIX.map(slice => ({
												key: slice.key,
												label: slice.label,
												value: mix[slice.key],
												color: slice.color,
											}))}
										/>
										<Legend
											items={TOKEN_MIX.map(slice => ({
												key: slice.key,
												label: slice.label,
												color: slice.color,
												value: total > 0 ? formatPercent(mix[slice.key] / total, 0) : "–",
											}))}
										/>
									</div>
									<div className="stack" style={{ gap: 10 }}>
										<div className="section-label" style={{ marginBottom: 0 }}>
											{t("overview.by-agent")}
										</div>
										<ShareBar
											segments={agents.segments.map(s => ({
												key: s.agentType,
												label: AGENT_LABEL[s.agentType],
												value: s.tokens,
												color: AGENT_COLOR[s.agentType],
											}))}
										/>
										{agents.segments.map(s => (
											<div key={s.agentType} className="row" style={{ justifyContent: "space-between" }}>
												<span className="row">
													<span className="swatch" style={{ background: AGENT_COLOR[s.agentType] }} />
													{AGENT_LABEL[s.agentType]}
													<span className="dim num">
														{t("overview.requests-short", { count: formatInteger(s.requests) })}
													</span>
												</span>
												<span className="row">
													<span className="dim num">{formatCompact(s.tokens)}</span>
													<span className="num" style={{ minWidth: 48, textAlign: "right" }}>
														{formatPercent(s.share)}
													</span>
												</span>
											</div>
										))}
									</div>
								</div>
							);
						}}
					</QueryView>
				</Card>
			</div>

			<Card
				index={3}
				title={
					<>
						<Dot tone="live" pulse /> {t("overview.latest-requests")}
					</>
				}
				description={t("overview.latest-requests-description")}
				actions={
					<a className="btn" data-size="sm" data-variant="ghost" href={`#/requests?range=${range}`}>
						{t("overview.all-requests")} <ArrowRight size={13} />
					</a>
				}
				flush
			>
				<QueryView query={recent} skeleton={<TableSkeleton rows={8} />}>
					{rows => (
						<Table
							rows={rows}
							rowKey={row => row.id ?? `${row.sessionFile}:${row.entryId}`}
							onRowClick={row => row.id !== undefined && onRequestClick(row.id)}
							columns={REQUEST_COLUMNS}
							dense
						/>
					)}
				</QueryView>
			</Card>
		</div>
	);
}

const REQUEST_COLUMNS = [
	{
		key: "model",
		header: t("common.model"),
		render: (row: MessageStats) => <LabelCell primary={row.model} secondary={row.provider} />,
	},
	{
		key: "time",
		header: t("overview.when"),
		render: (row: MessageStats) => <span className="muted">{formatRelativeTime(row.timestamp)}</span>,
	},
	{
		key: "tokens",
		header: t("common.tokens"),
		align: "right" as const,
		render: (row: MessageStats) => <span className="num">{formatInteger(row.usage.totalTokens)}</span>,
	},
	{
		key: "cost",
		header: t("common.cost"),
		align: "right" as const,
		render: (row: MessageStats) => <span className="num">{formatMessageCost(row, 4)}</span>,
	},
	{
		key: "duration",
		header: t("common.duration"),
		align: "right" as const,
		render: (row: MessageStats) => <span className="num">{formatDurationMs(row.duration)}</span>,
	},
	{
		key: "status",
		header: t("overview.status"),
		align: "right" as const,
		render: (row: MessageStats) =>
			row.errorMessage ? (
				<Badge tone="bad">{t("common.failed")}</Badge>
			) : (
				<Badge tone="ok">{t("overview.ok")}</Badge>
			),
	},
];

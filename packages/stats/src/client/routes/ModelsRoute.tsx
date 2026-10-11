import "./models.css";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { getModelDashboardStats } from "../api";
import { t } from "../i18n";
import { type ChartSeries, Legend, Sparkline, TimeChart, useHiddenSeries } from "../charts";
import { buildModelColorLookup, modelKey, OTHER_COLOR } from "../data/colors";
import {
	formatCompact,
	formatDurationMs,
	formatErrorRate,
	formatEstimatedCost,
	formatInteger,
	formatPercent,
	formatRelativeTime,
	formatTokensPerSecond,
} from "../data/formatters";
import { useQuery } from "../data/query";
import { bucketAxis, rangeMeta } from "../data/range";
import { densify, pivotSeries } from "../data/series";
import {
	buildModelPerformanceLookup,
	type ModelPerformanceDataPoint,
	sumConversationTokens,
} from "../data/view-models";
import type { ModelDashboardStats, ModelStats, TimeRange } from "../types";
import {
	Badge,
	Card,
	ChartSkeleton,
	type Column,
	EmptyState,
	errorRateTone,
	KeyValues,
	LabelCell,
	MeterCell,
	PageHeader,
	QueryView,
	Segmented,
	Skeleton,
	Stat,
	StatGrid,
	Swatch,
	Table,
	TableSkeleton,
} from "../ui";

export interface ModelsRouteProps {
	active: boolean;
	range: TimeRange;
}

type ShareMode = "share" | "requests";

const SHARE_OPTIONS = [
	{ value: "share" as const, label: t("common.share") },
	{ value: "requests" as const, label: t("common.requests") },
];

/** Models plotted individually in the share chart; the rest fold into "Other". */
const SHARE_LIMIT = 6;

export function ModelsRoute({ active, range }: ModelsRouteProps) {
	const query = useQuery(["models", range], ({ signal }) => getModelDashboardStats(range, signal), {
		enabled: active,
	});
	const meta = rangeMeta(range);
	const [mode, setMode] = useState<ShareMode>("share");
	const [hidden, toggleSeries] = useHiddenSeries();
	const [expandedKey, setExpandedKey] = useState<string | null>(null);
	const view = useMemo(() => (query.data ? buildModelsView(query.data, range) : null), [query.data, range]);
	const bucketWord = bucketName(meta.bucketMs);
	// Stable columns: a fresh array would make Table re-sort on every render.
	const columns = useMemo(
		() => (view ? buildModelColumns(view, expandedKey, bucketWord) : []),
		[view, expandedKey, bucketWord],
	);
	const isEmpty = (data: ModelDashboardStats) => data.byModel.length === 0;
	const empty = <EmptyState title={t("models.empty-title")} hint={t("models.empty-hint")} />;

	return (
		<div className="page">
			<PageHeader title={t("common.models")} description={t("models.subtitle", { window: t(meta.windowKey) })} />

			<QueryView
				query={query}
				skeleton={<Skeleton height={112} style={{ borderRadius: 12 }} />}
				isEmpty={isEmpty}
				empty={empty}
			>
				{() =>
					view && (
						<div data-stale={query.stale}>
							<StatGrid min={200}>
								<Stat
									label={t("models.used")}
									value={formatInteger(view.models.length)}
									hint={
										view.providerCount === 1
											? t("models.across-providers-one", { count: formatInteger(view.providerCount) })
											: t("models.across-providers", { count: formatInteger(view.providerCount) })
									}
								/>
								<Stat
									label={t("models.most-used")}
									title={view.top ? `${view.top.model} (${view.top.provider})` : undefined}
									value={view.top ? view.top.model : "–"}
									hint={
										view.top
											? t("models.most-used-hint", {
													share: formatPercent(view.top.totalRequests / Math.max(1, view.totalRequests)),
													provider: view.top.provider,
												})
											: undefined
									}
								/>
								<Stat
									label={t("common.requests")}
									value={formatInteger(view.totalRequests)}
									hint={t("models.failed-n", { count: formatInteger(view.failedRequests) })}
									spark={view.requestTotals}
								/>
								<Stat
									label={t("models.api-cost")}
									title={t("models.api-cost-title")}
									value={formatEstimatedCost(view.totalCost, view.unpricedRequests)}
									hint={
										view.unpricedRequests > 0
											? t("models.unpriced-n", { count: formatInteger(view.unpricedRequests) })
											: undefined
									}
								/>
							</StatGrid>
						</div>
					)
				}
			</QueryView>

			<Card
				index={1}
				title={t("models.request-share")}
				description={
					mode === "share"
						? t("models.share-desc", { bucket: bucketWord })
						: t("models.count-desc", { bucket: bucketWord })
				}
				actions={
					<Segmented
						size="sm"
						options={SHARE_OPTIONS}
						value={mode}
						onChange={setMode}
						aria-label={t("models.share-mode-aria")}
					/>
				}
				stale={query.stale}
			>
				<QueryView query={query} skeleton={<ChartSkeleton height={260} />} isEmpty={isEmpty} empty={empty}>
					{() =>
						view && (
							<div className="stack" style={{ gap: 12 }}>
								<TimeChart
									buckets={view.buckets}
									bucketMs={meta.bucketMs}
									series={mode === "share" ? view.shareSeries : view.countSeries}
									hidden={hidden}
									height={260}
									yMax={mode === "share" ? 1 : undefined}
									format={mode === "share" ? v => formatPercent(v, 0) : formatCompact}
									formatTooltip={mode === "share" ? v => formatPercent(v) : formatInteger}
									showTotal={mode === "requests"}
								/>
								<Legend
									items={view.countSeries.map(s => ({
										key: s.key,
										label: s.label,
										color: s.color,
										value: formatPercent(sumValues(s.values) / Math.max(1, sumValues(view.requestTotals))),
									}))}
									hidden={hidden}
									onToggle={toggleSeries}
								/>
							</div>
						)
					}
				</QueryView>
			</Card>

			<Card index={2} title={t("models.all-models")} description={t("models.table-desc")} stale={query.stale} flush>
				<QueryView query={query} skeleton={<TableSkeleton rows={8} />} isEmpty={isEmpty} empty={empty}>
					{() =>
						view && (
							<Table
								rows={view.models}
								rowKey={row => modelKey(row.model, row.provider)}
								columns={columns}
								initialSort={{ key: "requests", dir: "desc" }}
								limit={25}
								onRowClick={row => {
									const key = modelKey(row.model, row.provider);
									setExpandedKey(prev => (prev === key ? null : key));
								}}
								selectedKey={expandedKey}
								expanded={row => {
									const key = modelKey(row.model, row.provider);
									return key === expandedKey ? (
										<ModelDetail
											model={row}
											color={view.swatches.get(key) ?? "var(--chart-primary)"}
											points={view.performance.get(key) ?? []}
											bucketMs={meta.bucketMs}
											bucketWord={bucketWord}
										/>
									) : null;
								}}
							/>
						)
					}
				</QueryView>
			</Card>
		</div>
	);
}

interface ModelsView {
	models: ModelStats[];
	top: ModelStats | undefined;
	/** Chart color of each individually plotted model; the rest share "Other" gray. */
	swatches: Map<string, string>;
	labels: Map<string, string>;
	providerCount: number;
	totalRequests: number;
	failedRequests: number;
	totalCost: number;
	unpricedRequests: number;
	maxRequests: number;
	buckets: number[];
	requestTotals: number[];
	/** Top-N + Other requests per bucket (stacked counts). */
	countSeries: ChartSeries[];
	/** `countSeries` as a fraction of each bucket's total. */
	shareSeries: ChartSeries[];
	/** Dense requests per bucket for every model, for the table sparkline. */
	trends: Map<string, readonly (number | null)[]>;
	performance: Map<string, ModelPerformanceDataPoint[]>;
}

function buildModelsView(data: ModelDashboardStats, range: TimeRange): ModelsView {
	const models = data.byModel;
	const colors = buildModelColorLookup(models);
	const labels = modelLabels(models);
	const buckets = bucketAxis(
		range,
		data.modelSeries.map(p => p.timestamp),
	);
	const requestTotals = densify(data.modelSeries, buckets, p => p.requests);
	const pivot = {
		buckets,
		key: (p: { model: string; provider: string }) => modelKey(p.model, p.provider),
		label: (key: string) => labels.get(key) ?? key,
		value: (p: { requests: number }) => p.requests,
		colors,
	};
	// Zero slots become gaps so tooltips list only the models active in that bucket.
	const countSeries = pivotSeries(data.modelSeries, { ...pivot, limit: SHARE_LIMIT }).map(s => ({
		...s,
		values: s.values.map(v => v || null),
	}));
	const shareSeries = countSeries.map(s => ({
		...s,
		values: s.values.map((v, i) => (v === null ? null : v / requestTotals[i])),
	}));
	const trends = new Map(pivotSeries(data.modelSeries, pivot).map(s => [s.key, s.values]));

	let top: ModelStats | undefined;
	let totalRequests = 0;
	let failedRequests = 0;
	let totalCost = 0;
	let unpricedRequests = 0;
	for (const m of models) {
		if (!top || m.totalRequests > top.totalRequests) top = m;
		totalRequests += m.totalRequests;
		failedRequests += m.failedRequests;
		totalCost += m.totalCost;
		unpricedRequests += m.unpricedRequests;
	}

	return {
		models,
		top,
		swatches: new Map(countSeries.filter(s => s.key !== "__other__").map(s => [s.key, s.color])),
		labels,
		providerCount: new Set(models.map(m => m.provider)).size,
		totalRequests,
		failedRequests,
		totalCost,
		unpricedRequests,
		maxRequests: top?.totalRequests ?? 0,
		buckets,
		requestTotals,
		countSeries,
		shareSeries,
		trends,
		performance: buildModelPerformanceLookup(data.modelPerformanceSeries),
	};
}

/** Model name, qualified by provider only when the same model id is served by several. */
function modelLabels(models: readonly ModelStats[]): Map<string, string> {
	const providersPerModel = new Map<string, number>();
	for (const m of models) providersPerModel.set(m.model, (providersPerModel.get(m.model) ?? 0) + 1);
	return new Map(
		models.map(m => [
			modelKey(m.model, m.provider),
			(providersPerModel.get(m.model) ?? 0) > 1 ? `${m.model} · ${m.provider}` : m.model,
		]),
	);
}

function buildModelColumns(view: ModelsView, expandedKey: string | null, bucketWord: string): Column<ModelStats>[] {
	return [
		{
			key: "expand",
			header: "",
			width: 28,
			render: row => (
				<span className="models-chevron" data-open={modelKey(row.model, row.provider) === expandedKey}>
					<ChevronRight size={14} />
				</span>
			),
		},
		{
			key: "model",
			header: t("common.model"),
			sort: row => row.model,
			render: row => (
				<LabelCell
					lead={<Swatch color={view.swatches.get(modelKey(row.model, row.provider)) ?? OTHER_COLOR} />}
					primary={<span className="mono">{row.model}</span>}
					secondary={row.provider}
				/>
			),
		},
		{
			key: "requests",
			header: t("common.requests"),
			align: "right",
			sort: row => row.totalRequests,
			render: row => (
				<MeterCell
					value={row.totalRequests}
					max={view.maxRequests}
					display={formatInteger(row.totalRequests)}
					color={view.swatches.get(modelKey(row.model, row.provider)) ?? OTHER_COLOR}
				/>
			),
		},
		{
			key: "cost",
			header: t("common.cost"),
			title: t("models.cost-title"),
			align: "right",
			sort: row => row.totalCost,
			render: row => <span className="num">{formatEstimatedCost(row.totalCost, row.unpricedRequests)}</span>,
		},
		{
			key: "tokens",
			header: t("common.tokens"),
			title: t("models.tokens-title"),
			align: "right",
			sort: row => sumConversationTokens(row),
			render: row => {
				const tokens = sumConversationTokens(row);
				return (
					<span className="num" title={formatInteger(tokens)}>
						{formatCompact(tokens)}
					</span>
				);
			},
		},
		{
			key: "cache",
			header: t("models.cache-rate"),
			title: t("models.cache-title"),
			align: "right",
			sort: row => row.cacheRate,
			render: row => <span className="num">{formatPercent(row.cacheRate)}</span>,
		},
		{
			key: "errors",
			header: t("models.errors"),
			align: "right",
			sort: row => row.errorRate,
			render: row =>
				row.failedRequests === 0 ? (
					<span className="num dim">0%</span>
				) : (
					<span title={t("models.failed-n", { count: formatInteger(row.failedRequests) })}>
						<Badge tone={errorRateTone(row.errorRate)} mono>
							{formatErrorRate(row.errorRate)}
						</Badge>
					</span>
				),
		},
		{
			key: "tps",
			header: t("common.tokens-per-second"),
			title: t("models.tps-title"),
			align: "right",
			sort: row => row.avgTokensPerSecond ?? -1,
			render: row => <span className="num">{formatTokensPerSecond(row.avgTokensPerSecond)}</span>,
		},
		{
			key: "ttft",
			header: t("models.ttft"),
			title: t("models.ttft-title"),
			align: "right",
			sort: row => row.avgTtft ?? -1,
			render: row => <span className="num">{formatDurationMs(row.avgTtft)}</span>,
		},
		{
			key: "trend",
			header: t("models.trend"),
			title: t("models.trend-title", { bucket: bucketWord }),
			width: 112,
			render: row => {
				const key = modelKey(row.model, row.provider);
				const values = view.trends.get(key);
				return values ? (
					<Sparkline
						values={values.map(v => v ?? 0)}
						color={view.swatches.get(key) ?? OTHER_COLOR}
						width={96}
						height={22}
					/>
				) : (
					<span className="dim">–</span>
				);
			},
		},
	];
}

function ModelDetail({
	model,
	color,
	points,
	bucketMs,
	bucketWord,
}: {
	model: ModelStats;
	color: string;
	points: readonly ModelPerformanceDataPoint[];
	bucketMs: number;
	bucketWord: string;
}) {
	const [hidden, toggle] = useHiddenSeries();
	const series: ChartSeries[] = [
		{
			key: "tps",
			label: t("common.tokens-per-second"),
			color,
			kind: points.length > 1 ? "line" : "bars",
			values: points.map(p => p.avgTokensPerSecond),
		},
		{
			key: "ttft",
			label: t("models.ttft"),
			color: OTHER_COLOR,
			kind: points.length > 1 ? "line" : "bars",
			axis: "right",
			dashed: true,
			values: points.map(p => p.avgTtftSeconds),
		},
	];

	return (
		<div className="models-detail">
			<div className="models-detail-facts">
				<div>
					<div className="section-label">{t("models.efficiency")}</div>
					<KeyValues
						items={[
							{
								key: "err",
								label: t("common.error-rate"),
								value: (
									<span className={`tone-${errorRateTone(model.errorRate)}`}>
										{formatErrorRate(model.errorRate)}{" "}
										<span className="dim">
											({t("models.failed-n", { count: formatInteger(model.failedRequests) })})
										</span>
									</span>
								),
							},
							{ key: "cache", label: t("models.cache-rate"), value: formatPercent(model.cacheRate) },
							{
								key: "savings",
								label: t("models.cache-savings"),
								value: (
									<span className={model.cacheSavings < 0 ? "tone-bad" : undefined}>
										{formatPercent(model.cacheSavings)}
									</span>
								),
							},
							{
								key: "premium",
								label: t("common.premium-requests"),
								value: formatInteger(Math.round(model.totalPremiumRequests * 100) / 100),
							},
						]}
					/>
				</div>
				<div>
					<div className="section-label">{t("models.latency")}</div>
					<KeyValues
						items={[
							{ key: "dur", label: t("models.avg-duration"), value: formatDurationMs(model.avgDuration) },
							{ key: "ttft", label: t("models.avg-ttft"), value: formatDurationMs(model.avgTtft) },
							{
								key: "tps",
								label: t("common.tokens-per-second"),
								value: formatTokensPerSecond(model.avgTokensPerSecond),
							},
						]}
					/>
				</div>
				<div>
					<div className="section-label">{t("common.tokens")}</div>
					<KeyValues
						items={[
							{ key: "in", label: t("models.uncached-input"), value: formatCompact(model.totalInputTokens) },
							{ key: "cr", label: t("common.cache-read"), value: formatCompact(model.totalCacheReadTokens) },
							{ key: "cw", label: t("common.cache-write"), value: formatCompact(model.totalCacheWriteTokens) },
							{ key: "out", label: t("common.output"), value: formatCompact(model.totalOutputTokens) },
						]}
					/>
				</div>
				<div className="micro dim">
					{t("models.first-last-seen", {
						first: formatRelativeTime(model.firstTimestamp),
						last: formatRelativeTime(model.lastTimestamp),
					})}
				</div>
			</div>
			<div className="models-detail-chart">
				<div className="row" style={{ justifyContent: "space-between" }}>
					<div className="section-label" style={{ marginBottom: 0 }}>
						{t("models.performance-per-bucket", { bucket: bucketWord })}
					</div>
					<Legend
						items={series.map(s => ({ key: s.key, label: s.label, color: s.color }))}
						hidden={hidden}
						onToggle={toggle}
					/>
				</div>
				{points.length === 0 ? (
					<EmptyState title={t("models.no-samples-title")} hint={t("models.no-samples-hint")} />
				) : (
					<TimeChart
						buckets={points.map(p => p.timestamp)}
						bucketMs={bucketMs}
						series={series}
						hidden={hidden}
						stacked={false}
						height={240}
						format={formatCompact}
						formatTooltip={v => t("models.tok-per-second", { value: formatTokensPerSecond(v) })}
						formatRight={v => `${Number(v.toFixed(2))}s`}
						tooltipExtra={i => (
							<div className="chart-tooltip-row chart-tooltip-total">
								<span className="chart-tooltip-label">{t("common.requests")}</span>
								<span className="chart-tooltip-value">{formatInteger(points[i].requests)}</span>
							</div>
						)}
					/>
				)}
			</div>
		</div>
	);
}

function bucketName(bucketMs: number): string {
	if (bucketMs < 3_600_000) return t("models.bucket-5m");
	if (bucketMs < 86_400_000) return t("models.bucket-hour");
	return t("models.bucket-day");
}

function sumValues(values: readonly (number | null)[]): number {
	let total = 0;
	for (const v of values) total += v ?? 0;
	return total;
}

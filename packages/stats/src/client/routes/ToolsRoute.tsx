import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { getToolDashboardStats } from "../api";
import { t } from "../i18n";
import { Legend, Sparkline, TimeChart, useHiddenSeries } from "../charts";
import { buildColorLookup, OTHER_COLOR } from "../data/colors";
import {
	formatCompact,
	formatErrorRate,
	formatEstimatedCost,
	formatInteger,
	formatPercent,
	formatRelativeTime,
} from "../data/formatters";
import { useQuery } from "../data/query";
import { bucketAxis, rangeMeta } from "../data/range";
import { densify, pivotSeries } from "../data/series";
import { buildToolRows, type ToolRowView } from "../data/view-models";
import type { TimeRange, ToolDashboardStats, ToolModelStats, ToolTimeSeriesPoint } from "../types";
import {
	Badge,
	Card,
	ChartSkeleton,
	type Column,
	EmptyState,
	errorRateTone,
	LabelCell,
	MeterCell,
	PageHeader,
	QueryView,
	Segmented,
	Stat,
	StatGrid,
	Swatch,
	Table,
	TableSkeleton,
} from "../ui";
import "./tools.css";

export interface ToolsRouteProps {
	active: boolean;
	range: TimeRange;
}

type CallMetric = "calls" | "errors";

const METRIC_OPTIONS = [
	{ value: "calls" as const, label: t("tools.calls") },
	{ value: "errors" as const, label: t("tools.errors") },
];

/** Tools stacked individually in the calls chart; the rest fold into "Other". */
const TOP_TOOLS = 6;

const ATTRIBUTION_NOTE = t("tools.attribution-note");

/** Bucket granularity label for the calls chart description. */
function bucketUnit(bucketMs: number): string {
	if (bucketMs < 3_600_000) return t("tools.bucket-5m");
	if (bucketMs < 86_400_000) return t("tools.bucket-hour");
	return t("tools.bucket-day");
}

const NO_CALLS = <EmptyState title={t("tools.no-tool-calls")} />;

export function ToolsRoute({ active, range }: ToolsRouteProps) {
	const tools = useQuery(["tools", range], ({ signal }) => getToolDashboardStats(range, signal), { enabled: active });
	const [metric, setMetric] = useState<CallMetric>("calls");
	const [hidden, toggleHidden] = useHiddenSeries();
	const [pickedTool, setToolFilter] = useState<string | null>(null);
	const meta = rangeMeta(range);

	const view = useMemo(() => buildToolsView(tools.data, range), [tools.data, range]);
	// A pick from another range only applies while that tool still has calls.
	const toolFilter = pickedTool !== null && view.toolNames.includes(pickedTool) ? pickedTool : null;

	const chartSeries = metric === "calls" ? view.callSeries : view.errorSeries;
	const isEmpty = (data: ToolDashboardStats) => data.byTool.length === 0;

	return (
		<div className="page">
			<PageHeader title={t("tools.title")} description={t("tools.description", { window: t(meta.windowKey) })} />

			<QueryView query={tools} skeleton={<ChartSkeleton height={112} />}>
				{() => {
					const totals = view.totals;
					return (
						<div data-stale={tools.stale} className="stack" style={{ gap: 16 }}>
							<StatGrid min={190}>
								<Stat
									label={t("tools.tool-calls")}
									value={formatInteger(totals.calls)}
									hint={t("tools.failed-n", { count: formatInteger(totals.errors) })}
									spark={view.totalCalls}
								/>
								<Stat
									label={t("tools.distinct-tools")}
									value={formatInteger(totals.tools)}
									hint={view.rows[0] ? t("tools.most-used", { tool: view.rows[0].tool }) : undefined}
								/>
								<Stat
									label={t("common.error-rate")}
									title={t("tools.error-rate-title")}
									value={formatErrorRate(totals.calls > 0 ? totals.errors / totals.calls : 0)}
									hint={t("tools.succeeded-n", { count: formatInteger(totals.calls - totals.errors) })}
									spark={view.totalErrors}
									sparkColor="var(--bad)"
								/>
								<Stat
									label={t("tools.attributed-tokens")}
									title={ATTRIBUTION_NOTE}
									value={formatCompact(Math.round(totals.tokens))}
									hint={t("tools.tokens-output", { tokens: formatCompact(Math.round(totals.output)) })}
								/>
								<Stat
									label={t("tools.attributed-cost")}
									title={t("tools.attribution-estimate", { note: ATTRIBUTION_NOTE })}
									value={formatEstimatedCost(totals.cost, totals.unpriced)}
									hint={
										totals.unpriced > 0
											? t("tools.unpriced-requests-n", { count: formatInteger(Math.round(totals.unpriced)) })
											: t("tools.api-equivalent")
									}
								/>
							</StatGrid>
							<StatGrid min={150}>
								<Stat
									size="sm"
									label={t("tools.result-text")}
									title={t("tools.result-chars-title")}
									value={t("tools.chars", { count: formatCompact(totals.resultChars) })}
								/>
								<Stat
									size="sm"
									label={t("tools.call-arguments")}
									title={t("tools.args-chars-title")}
									value={t("tools.chars", { count: formatCompact(totals.argsChars) })}
								/>
								<Stat
									size="sm"
									label={t("tools.avg-result-per-call")}
									value={t("tools.chars", {
										count: formatCompact(
											totals.calls > 0 ? Math.round(totals.resultChars / totals.calls) : 0,
										),
									})}
								/>
								<Stat
									size="sm"
									label={t("tools.avg-args-per-call")}
									value={t("tools.chars", {
										count: formatCompact(totals.calls > 0 ? Math.round(totals.argsChars / totals.calls) : 0),
									})}
								/>
							</StatGrid>
						</div>
					);
				}}
			</QueryView>

			<Card
				index={1}
				title={metric === "calls" ? t("tools.calls-over-time") : t("tools.errors-over-time")}
				description={t("tools.chart-description", { bucket: bucketUnit(meta.bucketMs), count: TOP_TOOLS })}
				actions={<Segmented size="sm" options={METRIC_OPTIONS} value={metric} onChange={setMetric} />}
				stale={tools.stale}
			>
				<QueryView query={tools} skeleton={<ChartSkeleton height={260} />} isEmpty={isEmpty} empty={NO_CALLS}>
					{() => (
						<div className="stack" style={{ gap: 12 }}>
							<TimeChart
								buckets={view.buckets}
								bucketMs={meta.bucketMs}
								series={chartSeries}
								hidden={hidden}
								height={260}
								formatTooltip={formatInteger}
								emptyLabel={metric === "errors" ? t("tools.no-tool-errors") : undefined}
							/>
							<Legend
								items={chartSeries.map(s => ({
									key: s.key,
									label: s.label,
									color: s.color,
									value: formatCompact(s.values.reduce<number>((sum, v) => sum + (v ?? 0), 0)),
								}))}
								hidden={hidden}
								onToggle={toggleHidden}
							/>
						</div>
					)}
				</QueryView>
			</Card>

			<Card
				index={2}
				title={t("tools.by-tool")}
				description={t("tools.by-tool-description", { note: ATTRIBUTION_NOTE })}
				flush
				stale={tools.stale}
			>
				<QueryView query={tools} skeleton={<TableSkeleton rows={8} />} isEmpty={isEmpty} empty={NO_CALLS}>
					{() => (
						<Table
							rows={view.rows}
							rowKey={row => row.tool}
							columns={view.toolColumns}
							initialSort={{ key: "calls", dir: "desc" }}
							limit={20}
							selectedKey={toolFilter}
							onRowClick={row => setToolFilter(prev => (prev === row.tool ? null : row.tool))}
							dense
						/>
					)}
				</QueryView>
			</Card>

			<Card
				index={3}
				title={t("tools.by-tool-and-model")}
				description={t("tools.by-tool-and-model-description")}
				flush
				stale={tools.stale}
				actions={
					<div className="row" style={{ gap: 6 }}>
						<select
							className="input tools-filter"
							value={toolFilter ?? ""}
							onChange={e => setToolFilter(e.target.value || null)}
							aria-label={t("tools.filter-by-tool")}
						>
							<option value="">{t("tools.all-tools")}</option>
							{view.toolNames.map(name => (
								<option key={name} value={name}>
									{name}
								</option>
							))}
						</select>
						{toolFilter !== null && (
							<button
								type="button"
								className="btn"
								data-size="sm"
								data-variant="ghost"
								data-icon="true"
								title={t("tools.clear-tool-filter")}
								aria-label={t("tools.clear-tool-filter")}
								onClick={() => setToolFilter(null)}
							>
								<X size={13} />
							</button>
						)}
					</div>
				}
			>
				<QueryView query={tools} skeleton={<TableSkeleton rows={8} />} isEmpty={isEmpty} empty={NO_CALLS}>
					{data => <ToolModelTable rows={data.byToolModel} tool={toolFilter} colors={view.colors} />}
				</QueryView>
			</Card>
		</div>
	);
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

interface ToolTotals {
	calls: number;
	errors: number;
	tools: number;
	tokens: number;
	output: number;
	cost: number;
	unpriced: number;
	resultChars: number;
	argsChars: number;
}

function buildToolsView(data: ToolDashboardStats | null, range: TimeRange) {
	const byTool = data?.byTool ?? [];
	const points = data?.series ?? [];
	const rows = buildToolRows(byTool).sort((a, b) => b.calls - a.calls);
	const colors = buildColorLookup(byTool.map(item => ({ key: item.tool, weight: item.calls })));
	const buckets = bucketAxis(
		range,
		points.map(p => p.timestamp),
	);

	const totals: ToolTotals = {
		calls: 0,
		errors: 0,
		tools: byTool.length,
		tokens: 0,
		output: 0,
		cost: 0,
		unpriced: 0,
		resultChars: 0,
		argsChars: 0,
	};
	for (const item of byTool) {
		totals.calls += item.calls;
		totals.errors += item.errors;
		totals.tokens += item.totalTokensShare;
		totals.output += item.outputTokensShare;
		totals.cost += item.costShare;
		totals.unpriced += item.unpricedRequestsShare;
		totals.resultChars += item.resultChars;
		totals.argsChars += item.argsChars;
	}

	// Every tool keeps its table swatch color in both metrics; zero slots become
	// gaps so the tooltip lists only tools active in that bucket.
	const [callSeries, errorSeries] = [(p: ToolTimeSeriesPoint) => p.calls, (p: ToolTimeSeriesPoint) => p.errors].map(
		value =>
			pivotSeries(points, { buckets, key: p => p.tool, value, limit: TOP_TOOLS, colors }).map(s => ({
				...s,
				values: s.values.map(v => v || null),
			})),
	);
	// Unlimited pivot for the per-row sparklines.
	const trends = new Map(
		pivotSeries(points, { buckets, key: p => p.tool, value: p => p.calls }).map(s => [s.key, s.values as number[]]),
	);

	const maxCalls = rows[0]?.calls ?? 0;
	const toolColumns = buildToolColumns(maxCalls, colors, trends);

	return {
		rows,
		colors,
		buckets,
		totals,
		callSeries,
		errorSeries,
		totalCalls: densify(points, buckets, p => p.calls),
		totalErrors: densify(points, buckets, p => p.errors),
		toolNames: rows.map(r => r.tool).sort((a, b) => a.localeCompare(b)),
		toolColumns,
	};
}

function buildToolColumns(
	maxCalls: number,
	colors: ReadonlyMap<string, string>,
	trends: ReadonlyMap<string, number[]>,
): Column<ToolRowView>[] {
	return [
		{
			key: "tool",
			header: t("tools.tool"),
			sort: row => row.tool,
			render: row => (
				<span className="row" style={{ gap: 8 }}>
					<Swatch color={colors.get(row.tool) ?? OTHER_COLOR} />
					<span className="mono truncate tools-name" title={row.tool}>
						{row.tool}
					</span>
				</span>
			),
		},
		{
			key: "trend",
			header: t("tools.trend"),
			title: t("tools.trend-title"),
			render: row => {
				const values = trends.get(row.tool);
				return values && values.length > 1 ? (
					<Sparkline values={values} width={80} height={20} color={colors.get(row.tool) ?? OTHER_COLOR} />
				) : (
					<span className="dim">–</span>
				);
			},
		},
		{
			key: "calls",
			header: t("tools.calls"),
			align: "right",
			sort: row => row.calls,
			render: row => (
				<MeterCell
					value={row.calls}
					max={maxCalls}
					display={
						<span title={t("tools.share-of-calls", { percent: formatPercent(row.callFraction) })}>
							{formatInteger(row.calls)}
							<span className="dim tools-share">{formatPercent(row.callFraction, 0)}</span>
						</span>
					}
				/>
			),
		},
		{
			key: "errorRate",
			header: t("tools.errors"),
			title: t("tools.errors-title"),
			align: "right",
			sort: row => row.errorRate,
			render: row => (
				<span className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
					<span className="num dim">{formatInteger(row.errors)}</span>
					<Badge tone={row.errors > 0 ? errorRateTone(row.errorRate) : "neutral"} mono>
						{formatErrorRate(row.errorRate)}
					</Badge>
				</span>
			),
		},
		{
			key: "args",
			header: t("tools.args"),
			title: t("tools.args-chars-title"),
			align: "right",
			sort: row => row.argsChars,
			render: row => <span className="num">{formatCompact(row.argsChars)}</span>,
		},
		{
			key: "result",
			header: t("tools.result"),
			title: t("tools.result-chars-title"),
			align: "right",
			sort: row => row.resultChars,
			render: row => <span className="num">{formatCompact(row.resultChars)}</span>,
		},
		{
			key: "avgResult",
			header: t("tools.result-per-call"),
			title: t("tools.result-per-call-title"),
			align: "right",
			sort: row => row.avgResultChars,
			render: row => <span className="num muted">{formatCompact(Math.round(row.avgResultChars))}</span>,
		},
		{
			key: "tokens",
			header: t("tools.attr-tokens"),
			title: ATTRIBUTION_NOTE,
			align: "right",
			sort: row => row.totalTokensShare,
			render: row => (
				<span className="num" title={t("tools.share-of-tokens", { percent: formatPercent(row.tokenFraction) })}>
					{formatCompact(Math.round(row.totalTokensShare))}
					<span className="dim tools-share">{formatPercent(row.tokenFraction, 0)}</span>
				</span>
			),
		},
		{
			key: "cost",
			header: t("tools.attr-cost"),
			title: t("tools.attribution-estimate", { note: ATTRIBUTION_NOTE }),
			align: "right",
			sort: row => row.costShare,
			render: row => (
				<span className="num" title={t("tools.share-of-cost", { percent: formatPercent(row.costFraction) })}>
					{formatEstimatedCost(row.costShare, row.unpricedRequestsShare)}
					<span className="dim tools-share">{formatPercent(row.costFraction, 0)}</span>
				</span>
			),
		},
		{
			key: "lastUsed",
			header: t("tools.last-used"),
			align: "right",
			sort: row => row.lastUsed,
			render: row => <span className="muted">{formatRelativeTime(row.lastUsed)}</span>,
		},
	];
}

// ---------------------------------------------------------------------------
// Tool × model breakdown
// ---------------------------------------------------------------------------

interface ToolModelRow extends ToolModelStats {
	errorRate: number;
}

function ToolModelTable({
	rows,
	tool,
	colors,
}: {
	rows: ToolModelStats[];
	tool: string | null;
	colors: ReadonlyMap<string, string>;
}) {
	const filtered = useMemo<ToolModelRow[]>(
		() =>
			(tool === null ? rows : rows.filter(r => r.tool === tool)).map(r => ({
				...r,
				errorRate: r.calls > 0 ? r.errors / r.calls : 0,
			})),
		[rows, tool],
	);
	const columns = useMemo<Column<ToolModelRow>[]>(() => {
		const maxCalls = filtered.reduce((max, r) => Math.max(max, r.calls), 0);
		return [
			{
				key: "tool",
				header: t("tools.tool"),
				sort: row => row.tool,
				render: row => (
					<span className="row" style={{ gap: 8 }}>
						<Swatch color={colors.get(row.tool) ?? OTHER_COLOR} />
						<span className="mono truncate tools-name" title={row.tool}>
							{row.tool}
						</span>
					</span>
				),
			},
			{
				key: "model",
				header: t("common.model"),
				sort: row => row.model,
				render: row => (
					<LabelCell
						primary={<span className="mono">{row.model || t("common.unknown")}</span>}
						secondary={row.provider}
					/>
				),
			},
			{
				key: "calls",
				header: t("tools.calls"),
				align: "right",
				sort: row => row.calls,
				render: row => <MeterCell value={row.calls} max={maxCalls} display={formatInteger(row.calls)} />,
			},
			{
				key: "errorRate",
				header: t("tools.errors"),
				align: "right",
				sort: row => row.errorRate,
				render: row => (
					<span className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
						<span className="num dim">{formatInteger(row.errors)}</span>
						<Badge tone={row.errors > 0 ? errorRateTone(row.errorRate) : "neutral"} mono>
							{formatErrorRate(row.errorRate)}
						</Badge>
					</span>
				),
			},
			{
				key: "result",
				header: t("tools.result"),
				title: t("tools.result-chars-title"),
				align: "right",
				sort: row => row.resultChars,
				render: row => <span className="num">{formatCompact(row.resultChars)}</span>,
			},
			{
				key: "tokens",
				header: t("tools.attr-tokens"),
				title: ATTRIBUTION_NOTE,
				align: "right",
				sort: row => row.totalTokensShare,
				render: row => <span className="num">{formatCompact(Math.round(row.totalTokensShare))}</span>,
			},
			{
				key: "cost",
				header: t("tools.attr-cost"),
				title: t("tools.attribution-estimate", { note: ATTRIBUTION_NOTE }),
				align: "right",
				sort: row => row.costShare,
				render: row => <span className="num">{formatEstimatedCost(row.costShare, row.unpricedRequestsShare)}</span>,
			},
			{
				key: "lastUsed",
				header: t("tools.last-used"),
				align: "right",
				sort: row => row.lastUsed,
				render: row => <span className="muted">{formatRelativeTime(row.lastUsed)}</span>,
			},
		];
	}, [filtered, colors]);

	return (
		<Table
			rows={filtered}
			rowKey={row => `${row.tool}::${row.model}::${row.provider}`}
			columns={columns}
			initialSort={{ key: "calls", dir: "desc" }}
			limit={25}
			dense
			empty={<EmptyState title={tool ? t("tools.no-calls-to-tool", { tool }) : t("tools.no-tool-calls")} />}
		/>
	);
}

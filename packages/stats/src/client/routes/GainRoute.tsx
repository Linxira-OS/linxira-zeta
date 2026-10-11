import { useMemo, useState } from "react";
import { getGainDashboardStats } from "../api";
import { t } from "../i18n";
import { Chart, type ChartSeries, Legend } from "../charts";
import { formatBytes, formatCompact, formatInteger, formatPercent } from "../data/formatters";
import { useQuery } from "../data/query";
import { bucketAxis, rangeMeta } from "../data/range";
import { densify } from "../data/series";
import type { GainSource, GainSourceTotals, TimeRange } from "../types";
import {
	Card,
	ChartSkeleton,
	type Column,
	EmptyState,
	MeterCell,
	PageHeader,
	QueryView,
	Stat,
	StatGrid,
	Table,
} from "../ui";

export interface GainRouteProps {
	active: boolean;
	range: TimeRange;
}

const DAY_MS = 86_400_000;

const SOURCE_LABEL: Record<GainSource, string> = { snapcompact: "Snapcompact" };

/** The server buckets gain by UTC calendar day (`YYYY-MM-DD`). */
const DAY_LABEL = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

interface SourceRow extends GainSourceTotals {
	source: GainSource;
	/** Share of all saved tokens (0-1). */
	share: number;
}

export function GainRoute({ active, range }: GainRouteProps) {
	const [project, setProject] = useState<string | null>(null);
	const gain = useQuery(["gain", range, project], ({ signal }) => getGainDashboardStats(range, project, signal), {
		enabled: active,
	});
	const meta = rangeMeta(range);
	const data = gain.data;

	const series = useMemo(() => {
		const points = (data?.timeSeries ?? []).map(p => ({ ...p, timestamp: Date.parse(`${p.date}T00:00:00Z`) }));
		const buckets = bucketAxis(
			range,
			points.map(p => p.timestamp),
			DAY_MS,
		);
		const daily = densify(points, buckets, p => p.snapcompact);
		let running = 0;
		const cumulative = daily.map(v => (running += v));
		return { buckets, daily, cumulative };
	}, [data, range]);

	const sourceRows = useMemo((): SourceRow[] => {
		if (!data) return [];
		const total = data.overall.savedTokens;
		return (Object.keys(data.bySource) as GainSource[]).map(source => ({
			...data.bySource[source],
			source,
			share: total > 0 ? data.bySource[source].savedTokens / total : 0,
		}));
	}, [data]);

	const projects = data?.projects ?? [];
	// Keep the chosen project selectable even when the current range never saw it.
	const projectOptions = project !== null && !projects.includes(project) ? [project, ...projects] : projects;

	const chartSeries: ChartSeries[] = [
		{ key: "daily", label: t("gain.saved-per-day"), color: "var(--chart-primary)", values: series.daily },
		{
			key: "cumulative",
			label: t("gain.cumulative"),
			color: "var(--chart-secondary)",
			values: series.cumulative,
			kind: "line",
			axis: "right",
		},
	];

	return (
		<div className="page">
			<PageHeader
				title={t("gain.title")}
				description={
					project
						? t("gain.description-scoped", { project, window: t(meta.windowKey) })
						: t("gain.description", { window: t(meta.windowKey) })
				}
				actions={
					projectOptions.length > 0 && (
						<select
							className="input"
							aria-label={t("common.project")}
							value={project ?? ""}
							onChange={e => setProject(e.target.value || null)}
							style={{ maxWidth: 320 }}
						>
							<option value="">{t("gain.all-projects")}</option>
							{projectOptions.map(p => (
								<option key={p} value={p}>
									{p}
								</option>
							))}
						</select>
					)
				}
			/>

			<QueryView
				query={gain}
				skeleton={<ChartSkeleton height={96} />}
				isEmpty={stats => stats.overall.hits === 0 && stats.timeSeries.length === 0}
				empty={
					<Card>
						<EmptyState
							title={
								project
									? t("gain.empty-title-scoped", { project, window: t(meta.windowKey) })
									: t("gain.empty-title", { window: t(meta.windowKey) })
							}
							hint={range === "all" ? t("gain.empty-hint-all") : t("gain.empty-hint-longer-range")}
						/>
					</Card>
				}
			>
				{({ overall }) => (
					<>
						<div data-stale={gain.stale}>
							<StatGrid min={180}>
								<Stat
									label={t("gain.saved-tokens")}
									value={formatCompact(overall.savedTokens)}
									hint={formatInteger(overall.savedTokens)}
									spark={series.daily}
								/>
								<Stat label={t("gain.saved-bytes")} value={formatBytes(overall.savedBytes)} />
								<Stat
									label={t("gain.reduction")}
									title={t("gain.reduction-title")}
									value={overall.reductionPercent !== null ? formatPercent(overall.reductionPercent) : "–"}
									hint={overall.reductionPercent === null ? t("gain.reduction-unknown") : undefined}
								/>
								<Stat label={t("gain.hits")} value={formatInteger(overall.hits)} />
								<Stat
									label={t("gain.saved-per-hit")}
									value={overall.hits > 0 ? formatCompact(overall.savedTokens / overall.hits) : "–"}
									hint={t("common.tokens")}
								/>
							</StatGrid>
						</div>

						<Card
							index={1}
							title={t("gain.savings-over-time")}
							description={t("gain.savings-over-time-description")}
							actions={<Legend items={chartSeries.map(s => ({ key: s.key, label: s.label, color: s.color }))} />}
							stale={gain.stale}
						>
							<Chart
								slots={series.buckets.length}
								tickLabel={i => DAY_LABEL.format(series.buckets[i])}
								series={chartSeries}
								height={260}
								formatTooltip={formatInteger}
								formatRight={formatCompact}
							/>
						</Card>

						<Card
							index={2}
							title={t("gain.by-source")}
							description={t("gain.by-source-description")}
							flush
							stale={gain.stale}
						>
							<Table rows={sourceRows} rowKey={row => row.source} columns={SOURCE_COLUMNS} />
						</Card>
					</>
				)}
			</QueryView>
		</div>
	);
}

const SOURCE_COLUMNS: Column<SourceRow>[] = [
	{
		key: "source",
		header: t("gain.source"),
		sort: row => row.source,
		render: row => <span className="cell-primary">{SOURCE_LABEL[row.source]}</span>,
	},
	{
		key: "tokens",
		header: t("gain.saved-tokens"),
		align: "right",
		sort: row => row.savedTokens,
		render: row => (
			<span title={formatInteger(row.savedTokens)}>
				<MeterCell value={row.share} max={1} display={formatCompact(row.savedTokens)} />
			</span>
		),
	},
	{
		key: "share",
		header: t("common.share"),
		align: "right",
		sort: row => row.share,
		render: row => <span className="num muted">{formatPercent(row.share)}</span>,
	},
	{
		key: "bytes",
		header: t("gain.saved-bytes"),
		align: "right",
		sort: row => row.savedBytes,
		render: row => <span className="num">{formatBytes(row.savedBytes)}</span>,
	},
	{
		key: "hits",
		header: t("gain.hits"),
		align: "right",
		sort: row => row.hits,
		render: row => <span className="num">{formatInteger(row.hits)}</span>,
	},
	{
		key: "reduction",
		header: t("gain.reduction"),
		align: "right",
		sort: row => row.reductionPercent ?? -1,
		render: row => (
			<span className="num">{row.reductionPercent !== null ? formatPercent(row.reductionPercent) : "–"}</span>
		),
	},
];

"use client";

/**
 * UsagePage — token/cost totals, the ported token chart over the stats service
 * time series, and the per-session breakdown.
 *
 *   `/api/usage`             aggregate totals + one row per session (gateway)
 *   `/api/stats/timeseries`  daily buckets from the stats service
 *   `/api/webui/stats-url`   link to the full dashboard
 *
 * The Studio heatmap and per-model legend are absent: `/api/stats/models`
 * reports request counts, not the per-day per-model token matrix the heatmap
 * needs, and `/api/usage` carries no model dimension.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/studio/i18n";
import { hostErrorMessage } from "@/components/studio/primitives/hostError";
import { PageBanner, PageEmpty, PageFrame } from "./page-frame";
import { TokenCurve, type TokenChartPoint } from "./usage/TokenCurve";
import { localDateKey } from "./usage/tokenUsage";

interface UsageRow {
	sessionId: string;
	cwd: string;
	title: string;
	totalTokens: number;
	input: number;
	output: number;
	cost: number;
	lastActive: string;
}

interface UsageResponse {
	totalTokens: number;
	input: number;
	output: number;
	cost: number;
	sessions: UsageRow[];
}

interface TimeSeriesPoint {
	timestamp: number;
	requests: number;
	errors: number;
	tokens: number;
	cost: number;
}

const RANGES = ["24h", "7d", "30d", "90d"] as const;
type Range = (typeof RANGES)[number];

function formatNumber(value: number): string {
	return new Intl.NumberFormat().format(Math.round(value));
}

function formatCost(value: number): string {
	return `$${value.toFixed(value > 0 && value < 1 ? 4 : 2)}`;
}

async function jsonOrThrow<T>(url: string, what: string): Promise<T> {
	const response = await fetch(url, { cache: "no-store" });
	if (!response.ok) throw new Error(`${what}: HTTP ${response.status}`);
	return (await response.json()) as T;
}

export function UsagePage({ title }: { title?: string }) {
	const { t } = useI18n();
	const [usage, setUsage] = useState<UsageResponse | null>(null);
	const [series, setSeries] = useState<TimeSeriesPoint[] | null>(null);
	const [statsUrl, setStatsUrl] = useState<string | null>(null);
	const [range, setRange] = useState<Range>("30d");
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const [usageBody, statsBody] = await Promise.all([
				jsonOrThrow<UsageResponse>("/api/usage", "usage"),
				jsonOrThrow<TimeSeriesPoint[]>(`/api/stats/timeseries?range=${range}`, "timeseries").catch(() => null),
				jsonOrThrow<{ url?: string }>("/api/webui/stats-url", "stats-url")
					.then(body => setStatsUrl(body.url ?? null))
					.catch(() => setStatsUrl(null)),
			]);
			setUsage(usageBody);
			setSeries(statsBody);
			setError(null);
		} catch (cause) {
			setError(hostErrorMessage(cause, t("studio.usage.loadError")));
		}
	}, [range, t]);

	useEffect(() => {
		void load();
	}, [load]);

	const points = useMemo<TokenChartPoint[]>(
		() =>
			(series ?? []).map(point => ({
				label: localDateKey(point.timestamp),
				value: point.tokens,
			})),
		[series],
	);

	const rows = useMemo(
		() => (usage ? [...usage.sessions].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 25) : []),
		[usage],
	);

	return (
		<PageFrame
			title={title ?? t("studio.route.usage")}
			actions={
				<>
					<select className="select" value={range} onChange={event => setRange(event.target.value as Range)}>
						{RANGES.map(value => (
							<option key={value} value={value}>
								{value}
							</option>
						))}
					</select>
					<button type="button" className="btn btn-ghost" onClick={() => void load()}>
						{t("studio.action.refresh")}
					</button>
					{statsUrl ? (
						<a className="btn btn-ghost" href={statsUrl} target="_blank" rel="noreferrer">
							{t("studio.usage.dashboard")}
						</a>
					) : null}
				</>
			}
		>
			{error ? <PageBanner className="banner red">{error}</PageBanner> : null}

			<div className="stat-grid">
				<div className="stat-card">
					<span className="stat-label">{t("studio.usage.totalTokens")}</span>
					<span className="stat-value">{usage ? formatNumber(usage.totalTokens) : "—"}</span>
				</div>
				<div className="stat-card">
					<span className="stat-label">{t("studio.usage.input")}</span>
					<span className="stat-value">{usage ? formatNumber(usage.input) : "—"}</span>
				</div>
				<div className="stat-card">
					<span className="stat-label">{t("studio.usage.output")}</span>
					<span className="stat-value">{usage ? formatNumber(usage.output) : "—"}</span>
				</div>
				<div className="stat-card">
					<span className="stat-label">{t("studio.usage.cost")}</span>
					<span className="stat-value">{usage ? formatCost(usage.cost) : "—"}</span>
				</div>
			</div>

			{points.length > 1 ? (
				<section className="card">
					<header className="card-head">
						<h2 className="card-title">{t("studio.usage.chart")}</h2>
					</header>
					<TokenCurve points={points} />
				</section>
			) : (
				<PageEmpty>{t("studio.usage.chartUnavailable")}</PageEmpty>
			)}

			<section className="card">
				<header className="card-head">
					<h2 className="card-title">{t("studio.usage.sessions")}</h2>
				</header>
				{rows.length === 0 ? (
					<PageEmpty>{t("studio.usage.empty")}</PageEmpty>
				) : (
					<table className="table">
						<thead>
							<tr>
								<th>{t("studio.usage.session")}</th>
								<th className="num">{t("studio.usage.tokens")}</th>
								<th className="num">{t("studio.usage.input")}</th>
								<th className="num">{t("studio.usage.output")}</th>
								<th className="num">{t("studio.usage.cost")}</th>
							</tr>
						</thead>
						<tbody>
							{rows.map(row => (
								<tr key={row.sessionId}>
									<td title={row.cwd}>{row.title || row.sessionId}</td>
									<td className="num">{formatNumber(row.totalTokens)}</td>
									<td className="num">{formatNumber(row.input)}</td>
									<td className="num">{formatNumber(row.output)}</td>
									<td className="num">{formatCost(row.cost)}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</section>
		</PageFrame>
	);
}

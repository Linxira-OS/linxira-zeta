"use client";

/**
 * StudioUsagePage — token/cost totals from `/api/usage`.
 *
 * `/api/usage` is the gateway's aggregate (30 s cache): overall totals plus one
 * row per session. The full dashboard (charts, heatmap, per-tool breakdown) is
 * a separate service behind `/api/stats/*`; the page links to it through
 * `/api/webui/stats-url` instead of re-implementing it.
 */

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { StudioPage } from "./StudioPageHost";

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

function formatNumber(value: number): string {
	return new Intl.NumberFormat().format(Math.round(value));
}

function formatCost(value: number): string {
	return `$${value.toFixed(value > 0 && value < 1 ? 4 : 2)}`;
}

export function StudioUsagePage({ title }: { title: string }) {
	const { t } = useI18n();
	const [usage, setUsage] = useState<UsageResponse | null>(null);
	const [statsUrl, setStatsUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const [usageRes, statsRes] = await Promise.all([
				fetch("/api/usage", { cache: "no-store" }),
				fetch("/api/webui/stats-url", { cache: "no-store" }).catch(() => null),
			]);
			if (!usageRes.ok) throw new Error(`usage: HTTP ${usageRes.status}`);
			setUsage((await usageRes.json()) as UsageResponse);
			if (statsRes?.ok) {
				const body = (await statsRes.json().catch(() => ({}))) as { url?: string };
				setStatsUrl(body.url ?? null);
			}
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const top = usage ? [...usage.sessions].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 20) : [];

	return (
		<StudioPage
			title={title}
			actions={
				<>
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
			{error ? (
				<div className="banner red" role="alert">
					{error}
				</div>
			) : null}

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

			<section className="card">
				<header className="card-head">
					<h2 className="card-title">{t("studio.usage.sessions")}</h2>
				</header>
				{top.length === 0 ? (
					<p className="muted small">{t("studio.usage.empty")}</p>
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
							{top.map(row => (
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
		</StudioPage>
	);
}

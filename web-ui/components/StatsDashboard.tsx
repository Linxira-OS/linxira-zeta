"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

/**
 * Stats dashboard pane (dock window). Embeds the local stats dashboard
 * (default http://127.0.0.1:3847, started by `zeta serve` / `zetacode stats`)
 * in an iframe instead of opening a separate browser window.
 *
 * URL resolution, in order:
 * 1. `NEXT_PUBLIC_STATS_URL` inlined into the client bundle (dev server
 *    spawned by `zeta serve`).
 * 2. `/api/webui/stats-url` — the serve process injects the stats URL into
 *    the web-ui child's environment; that route exposes it at request time
 *    so prebuilt production bundles (where `NEXT_PUBLIC_*` is baked at
 *    build time) still find the live dashboard.
 *
 * The resolved URL is probed (no-cors fetch with timeout) before the iframe
 * is trusted; when the service is unreachable the pane shows a hint naming
 * the command to start it, never a blank frame.
 */

const PROBE_TIMEOUT_MS = 4000;

async function probeStatsService(url: string): Promise<boolean> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	try {
		// no-cors: only reachability matters and the response stays opaque.
		// Connection refused or timeout rejects the promise.
		await fetch(url, { mode: "no-cors", cache: "no-store", signal: controller.signal });
		return true;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

/** Degraded-state notice shown when the stats service cannot be reached. */
export function StatsDownNotice({ onRetry }: { onRetry?: () => void }) {
	const { t } = useI18n();
	return (
		<div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
			<div data-testid="stats-pane-down-message">
				{t("stats.notRunningPrefix")}{" "}
				<code style={{ fontFamily: "var(--font-mono)", margin: "0 4px" }}>zetacode stats</code>
				{t("stats.notRunningSuffix")}
			</div>
			{onRetry && (
				<button
					type="button"
					onClick={onRetry}
					style={{
						padding: "6px 16px",
						borderRadius: 6,
						border: "1px solid var(--border)",
						background: "var(--bg-elevated)",
						color: "var(--text)",
						cursor: "pointer",
						fontSize: 13,
					}}
				>
					{t("stats.retry")}
				</button>
			)}
		</div>
	);
}

export function StatsDashboard() {
	const { t } = useI18n();
	// A build-time URL mounts the iframe immediately; the reachability probe
	// can still swap in the not-running notice afterwards.
	const [statsUrl, setStatsUrl] = useState<string | null>(process.env.NEXT_PUBLIC_STATS_URL || null);
	const [down, setDown] = useState(false);
	const [probeAttempt, setProbeAttempt] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setDown(false);
		void (async () => {
			let url = process.env.NEXT_PUBLIC_STATS_URL || null;
			if (!url) {
				try {
					const res = await fetch("/api/webui/stats-url", { cache: "no-store" });
					if (res.ok) {
						const data = (await res.json()) as { url?: string | null };
						if (typeof data.url === "string" && data.url.length > 0) url = data.url;
					}
				} catch {
					// Route unreachable (standalone dev server): no stats URL.
				}
			}
			if (cancelled) return;
			if (!url) {
				setStatsUrl(null);
				setDown(true);
				return;
			}
			setStatsUrl(url);
			const alive = await probeStatsService(url);
			if (!cancelled) setDown(!alive);
		})();
		return () => {
			cancelled = true;
		};
	}, [probeAttempt]);

	const retry = useCallback(() => setProbeAttempt(n => n + 1), []);

	if (statsUrl && !down) {
		return (
			<iframe
				src={statsUrl}
				title={t("topbar.statsDashboard")}
				data-testid="stats-pane-frame"
				style={{ width: "100%", height: "100%", border: "none", display: "block", background: "var(--bg)" }}
			/>
		);
	}

	return (
		<div
			data-testid={down ? "stats-pane-down" : "stats-pane-loading"}
			style={{
				height: "100%",
				display: "grid",
				placeItems: "center",
				color: "var(--text-dim)",
				fontSize: 13,
				padding: 24,
				textAlign: "center",
			}}
		>
			{down ? <StatsDownNotice onRetry={retry} /> : <div>{t("stats.loading")}</div>}
		</div>
	);
}

"use client";

/**
 * TokenChart — Studio's token curve (`tk-*` classes from `pages.css`).
 *
 * Geometry comes from the ported `tokenChart` helpers: `useTokenChartMorph`
 * samples and smooths the series (Fritsch–Carlson, so a steep neighbour cannot
 * pull a near-zero span below the axis) and animates between data revisions.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartPx } from "./tokenChart";
import { useTokenChartMorph } from "./useTokenChartMorph";

export interface TokenChartPoint {
	readonly label: string;
	readonly value: number;
}

const HEIGHT = 210;
const PAD_TOP = 18;
const PAD_BOTTOM = 26;
const Y_RATIOS = [0, 0.5, 1] as const;

function formatTokens(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
	return String(Math.round(value));
}

export function TokenCurve({ points }: { points: readonly TokenChartPoint[] }) {
	const [width, setWidth] = useState(640);
	const hostRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const host = hostRef.current;
		if (!host || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(entries => {
			const next = entries[0]?.contentRect.width;
			if (next && next > 0) setWidth(next);
		});
		observer.observe(host);
		return () => observer.disconnect();
	}, []);

	const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
	const max = useMemo(() => Math.max(1, ...points.map(point => point.value)), [points]);

	const model = useMemo(() => {
		const step = points.length > 1 ? width / (points.length - 1) : 0;
		const pts: ChartPx[] = points.map((point, index) => [index * step, PAD_TOP + plotH - (point.value / max) * plotH]);
		return [{ id: "total", pts }];
	}, [points, width, plotH, max]);

	const { paths } = useTokenChartMorph(model, { view: "total", width, padTop: PAD_TOP, plotH });

	const ticks = Y_RATIOS.map(ratio => ({
		ratio,
		y: PAD_TOP + plotH - ratio * plotH,
		value: ratio * max,
	}));
	const labels = points.length > 1 ? [points[0]!, points[Math.floor(points.length / 2)]!, points[points.length - 1]!] : [];

	return (
		<div className="tk-chart-wrap" ref={hostRef}>
			<svg className="tk-chart" viewBox={`0 0 ${Math.max(width, 1)} ${HEIGHT}`} role="img" aria-label="tokens">
				{ticks.map(tick => (
					<line
						key={tick.ratio}
						className={`tk-grid${tick.ratio === 0 ? " base" : ""}`}
						x1={0}
						x2={width}
						y1={tick.y}
						y2={tick.y}
					/>
				))}
				{ticks.map(tick => (
					<text key={`y-${tick.ratio}`} className="tk-yt" x={0} y={tick.y - 3.5}>
						{tick.value === 0 ? "0" : formatTokens(tick.value)}
					</text>
				))}
				{labels.map((label, index) => (
					<text
						key={`x-${index}`}
						className="tk-xt"
						x={index === 0 ? 0 : index === labels.length - 1 ? width : width / 2}
						y={HEIGHT - 7}
						textAnchor={index === 0 ? "start" : index === labels.length - 1 ? "end" : "middle"}
					>
						{label.label}
					</text>
				))}
				{paths.map(entry => (entry.path ? <path key={entry.id} className="tk-line total" d={entry.path} /> : null))}
			</svg>
		</div>
	);
}

"use client";

import type { CSSProperties, ReactNode } from "react";
import { clampPercent, ringDashOffset, type ContextTone } from "./context-ring-model";

/** Ring geometry, in the SVG's 100x100 user space. */
const VIEWBOX = 100;
const STROKE = 9;
const RADIUS = (VIEWBOX - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface ContextRingProps {
	/** Occupancy, 0-100 of the context window. */
	percent: number;
	tone: ContextTone;
	/** Rendered diameter in px. */
	size?: number;
	/** Auto-compaction threshold on the same 0-100 axis, drawn as a tick. */
	thresholdPercent?: number | null;
	/** Accessible summary; also the native hover tooltip. */
	label: string;
	className?: string;
	/** Centre content (percentage + absolute figures). */
	children?: ReactNode;
}

/**
 * Context-occupancy ring: a track at full circumference, an arc for the used
 * fraction, and an optional tick where auto-compaction fires.
 */
export function ContextRing({
	percent,
	tone,
	size = 132,
	thresholdPercent,
	label,
	className,
	children,
}: ContextRingProps) {
	const reading = clampPercent(percent);
	const marker = thresholdPercent === undefined || thresholdPercent === null ? null : clampPercent(thresholdPercent);
	const style: CSSProperties = { width: size, height: size };

	return (
		<div className={className === undefined ? "context-ring" : `context-ring ${className}`} style={style}>
			<svg
				className="context-ring__svg"
				viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
				role="img"
				aria-label={label}
			>
				<title>{label}</title>
				<circle className="context-ring__track" cx={VIEWBOX / 2} cy={VIEWBOX / 2} r={RADIUS} />
				<circle
					className={`context-ring__arc context-ring__arc--${tone}`}
					cx={VIEWBOX / 2}
					cy={VIEWBOX / 2}
					r={RADIUS}
					strokeDasharray={CIRCUMFERENCE}
					strokeDashoffset={ringDashOffset(reading, CIRCUMFERENCE)}
					transform={`rotate(-90 ${VIEWBOX / 2} ${VIEWBOX / 2})`}
				/>
				{marker !== null && marker > 0 && (
					<line
						className="context-ring__marker"
						x1={VIEWBOX / 2}
						y1={2}
						x2={VIEWBOX / 2}
						y2={STROKE + 4}
						transform={`rotate(${(marker / 100) * 360} ${VIEWBOX / 2} ${VIEWBOX / 2})`}
					/>
				)}
			</svg>
			{children !== undefined && <div className="context-ring__center">{children}</div>}
		</div>
	);
}

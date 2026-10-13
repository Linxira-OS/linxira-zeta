"use client";

import type { ReactNode } from "react";

/**
 * Dock-registry descriptor for the context-statistics panel.
 *
 * The shell owns the panel registry (`web-ui/components/shell/panel-registry`),
 * so this file only supplies the declaration and the rail icon in the shape
 * that registry expects; registering it is a one-line import in the shell's
 * registry module plus a `case "context"` in its dock body.
 *
 * `ContextRingIcon` stays here (not in the shell) because the glyph is this
 * panel's own: a ring with a partial arc, echoing the panel's geometry.
 */
export interface ContextRingPanelEntry {
	id: "context";
	titleKey: string;
	ariaKey: string;
	surface: "rail";
	kind: "dock";
	widthTier: "regular";
	exclusive: true;
	icon: ReactNode;
}

const ICON_VIEWBOX = 16;
const ICON_RADIUS = 6;
const ICON_CIRCUMFERENCE = 2 * Math.PI * ICON_RADIUS;
/** Share of the icon arc that is drawn, matching the panel's default reading. */
const ICON_ARC = 0.35;

/** Rail/dock icon: a context ring, drawn with `currentColor`. */
export function ContextRingIcon({ size = 16 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
			aria-hidden="true"
			focusable="false"
		>
			<circle
				cx={ICON_VIEWBOX / 2}
				cy={ICON_VIEWBOX / 2}
				r={ICON_RADIUS}
				fill="none"
				stroke="currentColor"
				strokeOpacity="0.35"
				strokeWidth="1.5"
			/>
			<circle
				cx={ICON_VIEWBOX / 2}
				cy={ICON_VIEWBOX / 2}
				r={ICON_RADIUS}
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeDasharray={ICON_CIRCUMFERENCE}
				strokeDashoffset={ICON_CIRCUMFERENCE * (1 - ICON_ARC)}
				transform={`rotate(-90 ${ICON_VIEWBOX / 2} ${ICON_VIEWBOX / 2})`}
			/>
		</svg>
	);
}

export const contextRingPanelEntry: ContextRingPanelEntry = {
	id: "context",
	titleKey: "context-ring.title",
	ariaKey: "context-ring.panel-aria",
	surface: "rail",
	kind: "dock",
	widthTier: "regular",
	exclusive: true,
	icon: <ContextRingIcon />,
};

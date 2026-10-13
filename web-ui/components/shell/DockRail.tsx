"use client";

import { useI18n } from "@/hooks/useI18n";
import { getDockPanels, type PanelId } from "./panel-registry";

export interface DockRailProps {
	/** Currently open dock panel, or null. */
	activeId: PanelId | null;
	onToggle: (id: PanelId) => void;
	trackingEnabled: boolean;
}

/**
 * Persistent right-edge icon rail. Every entry is generated from the panel
 * registry — this component holds no panel list of its own, so the rail and the
 * top-bar chips can never drift apart.
 */
export function DockRail({ activeId, onToggle, trackingEnabled }: DockRailProps) {
	const { t } = useI18n();
	return (
		<div
			role="tablist"
			aria-label={t("dock.rail-label")}
			style={{
				width: 40,
				flexShrink: 0,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 4,
				padding: "6px 0",
				background: "var(--bg-panel)",
				borderLeft: "1px solid var(--border)",
			}}
		>
			{getDockPanels(trackingEnabled).map(panel => {
				const label = t(panel.titleKey);
				const active = activeId === panel.id;
				return (
					<button
						key={panel.id}
						onClick={() => onToggle(panel.id)}
						title={label}
						aria-label={label}
						aria-pressed={active}
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: 30,
							height: 30,
							padding: 0,
							background: active ? "var(--bg-selected)" : "transparent",
							border: "none",
							borderRadius: 7,
							color: active ? "var(--accent)" : "var(--text-muted)",
							cursor: "pointer",
							transition: "color 0.12s, background 0.12s",
						}}
					>
						{panel.icon}
					</button>
				);
			})}
		</div>
	);
}

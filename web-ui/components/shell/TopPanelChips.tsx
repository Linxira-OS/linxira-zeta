"use client";

import { Fragment, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PANEL_REGISTRY, type PanelId } from "./panel-registry";

export interface TopChipState {
	active?: boolean;
	disabled?: boolean;
	/** Overrides the registry title (e.g. "Full history (unavailable)"). */
	title?: string;
}

export interface TopPanelChipsProps {
	activeId: PanelId | null;
	/** Opens/toggles the anchored dropdown for a `topPanel` entry. */
	onToggle: (id: PanelId) => void;
	isMobile: boolean;
	/** Per-panel state (disabled/active/title) for the generated chip. */
	stateFor?: (id: PanelId) => TopChipState;
	/** Bespoke rendering for a panel that is not a plain chip (e.g. branches). */
	overrides?: Partial<Record<PanelId, ReactNode>>;
}

/**
 * Top-bar panel chips, generated from the panel registry. Non-panel controls
 * (theme/language/update/open-in-app) stay in AppShell; only panel entries live
 * here, so the set of panels is declared exactly once.
 */
export function TopPanelChips({ activeId, onToggle, isMobile, stateFor, overrides }: TopPanelChipsProps) {
	const { t } = useI18n();
	return (
		<>
			{PANEL_REGISTRY.filter(panel => panel.surface === "topbar").map(panel => {
				const override = overrides?.[panel.id];
				if (override) return <Fragment key={panel.id}>{override}</Fragment>;
				const state = stateFor?.(panel.id) ?? {};
				const active = state.active ?? activeId === panel.id;
				const label = panel.titleKey ? t(panel.titleKey) : "";
				return (
					<button
						key={panel.id}
						type="button"
						onClick={() => onToggle(panel.id)}
						disabled={state.disabled}
						title={state.title ?? label}
						aria-label={state.title ?? label}
						aria-pressed={panel.kind === "topPanel" ? active : undefined}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							height: "100%",
							padding: "0 12px",
							background: active && panel.kind === "topPanel" ? "var(--zeta-alias-bg-selected)" : "none",
							border: "none",
							borderTop: active && panel.kind === "topPanel" ? "2px solid var(--zeta-alias-accent)" : "2px solid transparent",
							borderRight: "1px solid var(--zeta-alias-border)",
							cursor: state.disabled ? "not-allowed" : "pointer",
							color: active ? "var(--zeta-alias-text)" : "var(--zeta-alias-text-muted)",
							opacity: state.disabled ? 0.45 : 1,
							fontSize: 11,
							whiteSpace: "nowrap",
							flexShrink: 0,
							transition: "color 0.1s, background 0.1s, opacity 0.1s",
						}}
						onMouseEnter={e => {
							if (state.disabled) return;
							e.currentTarget.style.color = "var(--zeta-alias-text)";
							e.currentTarget.style.background = "var(--zeta-alias-bg-hover)";
						}}
						onMouseLeave={e => {
							e.currentTarget.style.color = active ? "var(--zeta-alias-text)" : "var(--zeta-alias-text-muted)";
							e.currentTarget.style.background =
								active && panel.kind === "topPanel" ? "var(--zeta-alias-bg-selected)" : "none";
						}}
					>
						{panel.icon}
						{!isMobile && <span>{label}</span>}
					</button>
				);
			})}
		</>
	);
}

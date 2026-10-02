/**
 * "Projects" section header: the label row above the project group list.
 * The action cluster (⊞ open workspace · + new session) only surfaces on
 * hover / focus-within (D3) and fades out when the pointer leaves.
 */
"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";

interface ProjectsSectionProps {
	/** Opens the existing open-workspace dialog (⊞). */
	onOpenWorkspace: () => void;
	/** Starts a new-session draft (＋) — routes through the sidebar callback. */
	onNewSession: () => void;
}

const ACTION_BUTTON_STYLE = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	width: 22,
	height: 22,
	padding: 0,
	background: "none",
	border: "none",
	borderRadius: 5,
	color: "var(--text-muted)",
	cursor: "pointer",
} as const;

export function ProjectsSection({ onOpenWorkspace, onNewSession }: ProjectsSectionProps) {
	const { t } = useI18n();
	const [active, setActive] = useState(false);
	return (
		<div
			onMouseEnter={() => setActive(true)}
			onMouseLeave={() => setActive(false)}
			onFocus={() => setActive(true)}
			onBlur={e => {
				if (!e.currentTarget.contains(e.relatedTarget as Node)) setActive(false);
			}}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				width: "100%",
				padding: "10px 10px 4px 14px",
			}}
		>
			<span
				style={{
					fontSize: 10.5,
					fontWeight: 600,
					letterSpacing: "0.08em",
					color: "var(--text-dim)",
				}}
			>
				{t("sidebar.projectsSection")}
			</span>
			<span style={{ flex: 1 }} />
			<span
				style={{
					display: "flex",
					alignItems: "center",
					gap: 2,
					flexShrink: 0,
					opacity: active ? 1 : 0,
					transition: "opacity 0.12s",
					pointerEvents: active ? "auto" : "none",
				}}
			>
				<button
					aria-label={t("sidebar.openWorkspace")}
					title={t("sidebar.openWorkspace")}
					style={ACTION_BUTTON_STYLE}
					onClick={onOpenWorkspace}
				>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<rect x="3" y="3" width="7" height="7" rx="1" />
						<rect x="14" y="3" width="7" height="7" rx="1" />
						<rect x="3" y="14" width="7" height="7" rx="1" />
						<rect x="14" y="14" width="7" height="7" rx="1" />
					</svg>
				</button>
				<button
					aria-label={t("sidebar.actions.newSession")}
					title={t("sidebar.actions.newSession")}
					style={ACTION_BUTTON_STYLE}
					onClick={onNewSession}
				>
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
						<line x1="6" y1="1" x2="6" y2="11" />
						<line x1="1" y1="6" x2="11" y2="6" />
					</svg>
				</button>
			</span>
		</div>
	);
}

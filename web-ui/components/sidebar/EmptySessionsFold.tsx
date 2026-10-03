/**
 * Empty-sessions fold (D5): the group-tail ghost row "N empty sessions".
 * Collapsed by default; expanding reveals grayed rows that can be deleted
 * individually, plus a "Clean up" batch action. Both deletions go through the
 * caller's two-step danger confirm — this component never deletes on its own.
 */
"use client";

import { useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { sessionDisplayTitle } from "./sidebar-shared";

interface EmptySessionsFoldProps {
	sessions: SessionInfo[];
	/** Per-row delete — the caller owns the danger confirm. */
	onDelete: (session: SessionInfo) => void;
	/** Batch delete of every listed session — caller owns the danger confirm. */
	onCleanup: (sessions: SessionInfo[]) => void;
}

export function EmptySessionsFold({ sessions, onDelete, onCleanup }: EmptySessionsFoldProps) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	if (sessions.length === 0) return null;
	return (
		<div>
			<button
				onClick={() => setOpen(v => !v)}
				aria-expanded={open}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					width: "100%",
					padding: "4px 14px 6px 30px",
					background: "none",
					border: "none",
					color: "var(--text-dim)",
					cursor: "pointer",
					fontSize: 11,
					textAlign: "left",
					fontStyle: "italic",
				}}
			>
				<svg
					width="9"
					height="9"
					viewBox="0 0 10 10"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
					style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform 0.12s", flexShrink: 0 }}
				>
					<polyline points="2.5 3.5 5 6.5 7.5 3.5" />
				</svg>
				{t("sidebar.emptySessionsFold", { count: sessions.length })}
			</button>
			{open && (
				<>
					{sessions.map(s => (
						<div
							key={s.id}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								padding: "4px 14px 4px 30px",
								opacity: 0.55,
							}}
						>
							<span
								title={s.id}
								style={{
									flex: 1,
									minWidth: 0,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									fontSize: 11.5,
									color: "var(--text-dim)",
								}}
							>
								{sessionDisplayTitle(s, t)}
							</span>
							<button
								aria-label={t("sidebar.delete")}
								title={t("sidebar.delete")}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									width: 20,
									height: 20,
									padding: 0,
									background: "none",
									border: "none",
									borderRadius: 4,
									color: "var(--text-dim)",
									cursor: "pointer",
									flexShrink: 0,
								}}
								onClick={() => onDelete(s)}
							>
								<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<polyline points="3 6 5 6 21 6" />
									<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
								</svg>
							</button>
						</div>
					))}
					<button
						onClick={() => onCleanup(sessions)}
						style={{
							display: "block",
							padding: "2px 14px 8px 30px",
							background: "none",
							border: "none",
							color: "var(--status-error)",
							cursor: "pointer",
							fontSize: 11,
							textAlign: "left",
						}}
					>
						{t("sidebar.emptySessionCleanup")}
					</button>
				</>
			)}
		</div>
	);
}

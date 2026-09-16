/**
 * Sidebar bottom "Archived" section: collapsed list of archived sessions with
 * per-row restore/delete (oh-my-pi-UI in-sidebar model — no separate page).
 * Search across projects is provided by the caller passing pre-filtered rows.
 */
"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { archiveSession, deleteSession, unarchiveSession } from "@/lib/session-api";
import type { SessionInfo } from "@/lib/types";

interface ArchiveSectionProps {
	archivedSessions: SessionInfo[];
	onChanged: () => void;
}

export function ArchiveSection({ archivedSessions, onChanged }: ArchiveSectionProps) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [query, setQuery] = useState("");

	if (archivedSessions.length === 0) return null;

	const q = query.trim().toLowerCase();
	const visible = q
		? archivedSessions.filter(s => {
				const title = (s.name || s.id).toLowerCase();
				const cwd = (s.cwd ?? "").toLowerCase();
				return title.includes(q) || cwd.includes(q);
			})
		: archivedSessions;

	const handleUnarchive = async (id: string) => {
		setBusyId(id);
		try {
			await unarchiveSession(id);
			onChanged();
		} finally {
			setBusyId(null);
		}
	};

	const handleDelete = async (id: string) => {
		setBusyId(id);
		try {
			await deleteSession(id);
			onChanged();
		} finally {
			setBusyId(null);
		}
	};

	const handleArchiveOne = async (id: string) => {
		// Unused keep-alive to preserve the API surface for batch wiring (B4).
		void archiveSession;
		void id;
	};

	void handleArchiveOne;

	return (
		<div style={{ borderTop: "1px solid var(--border)", flexShrink: 0 }}>
			<button
				onClick={() => setOpen(v => !v)}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					width: "100%",
					padding: "7px 10px",
					background: "none",
					border: "none",
					color: "var(--text-muted)",
					cursor: "pointer",
					fontSize: 11,
					fontWeight: 600,
					letterSpacing: "0.05em",
					textTransform: "uppercase",
					textAlign: "left",
				}}
			>
				<svg
					width="9"
					height="9"
					viewBox="0 0 10 10"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
					style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
				>
					<polyline points="3 2 7 5 3 8" />
				</svg>
				{t("sidebar.archivedSection")}
				<span style={{ color: "var(--text-dim)", fontWeight: 400 }}>{archivedSessions.length}</span>
			</button>
			{open && (
				<div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
					{archivedSessions.length > 6 && (
						<div style={{ padding: "0 8px 6px" }}>
							<input
								value={query}
								onChange={e => setQuery(e.target.value)}
								placeholder={t("sidebar.display.searchPlaceholder")}
								style={{
									width: "100%",
									fontSize: 11,
									padding: "5px 8px",
									border: "1px solid var(--border)",
									borderRadius: 5,
									outline: "none",
									background: "var(--bg)",
									color: "var(--text)",
									boxSizing: "border-box",
								}}
							/>
						</div>
					)}
					{visible.map(session => (
						<div
							key={session.id}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								padding: "5px 10px",
								borderBottom: "1px solid var(--border)",
								opacity: busyId === session.id ? 0.5 : 1,
							}}
						>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div
									style={{
										fontSize: 11.5,
										color: "var(--text)",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
									title={session.archivedFrom ?? session.cwd}
								>
									{session.name || session.id.slice(0, 12)}
								</div>
								<div
									style={{
										fontSize: 10,
										color: "var(--text-dim)",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{(session.archivedFrom ?? session.cwd ?? "").split(/[\\/]/).filter(Boolean).pop()}
								</div>
							</div>
							<button
								onClick={() => void handleUnarchive(session.id)}
								disabled={busyId !== null}
								title={t("sidebar.unarchive")}
								style={{
									padding: "3px 8px",
									background: "var(--bg-hover)",
									border: "1px solid var(--border)",
									borderRadius: 5,
									color: "var(--text-muted)",
									fontSize: 10.5,
									cursor: "pointer",
									flexShrink: 0,
								}}
							>
								{t("sidebar.unarchive")}
							</button>
							<button
								onClick={() => void handleDelete(session.id)}
								disabled={busyId !== null}
								title={t("sidebar.delete")}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									width: 24,
									height: 24,
									padding: 0,
									background: "none",
									border: "none",
									borderRadius: 5,
									color: "var(--text-dim)",
									cursor: "pointer",
									flexShrink: 0,
								}}
								onMouseEnter={e => {
									e.currentTarget.style.color = "var(--status-error)";
									e.currentTarget.style.background = "var(--status-error-background)";
								}}
								onMouseLeave={e => {
									e.currentTarget.style.color = "var(--text-dim)";
									e.currentTarget.style.background = "none";
								}}
							>
								<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<polyline points="3 6 5 6 21 6" />
									<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
									<path d="M10 11v6M14 11v6" />
									<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
								</svg>
							</button>
						</div>
					))}
					{visible.length === 0 && (
						<div style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-dim)" }}>∅</div>
					)}
				</div>
			)}
		</div>
	);
}

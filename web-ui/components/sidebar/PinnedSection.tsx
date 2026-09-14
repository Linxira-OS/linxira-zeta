/**
 * Pinned sessions section: order-preserving pinned id list (localStorage
 * persistence), stale-id graying (OpenCodeUI pinnedSessionsStore model), and
 * per-row unpin. Rows render via the shared SessionNodeItem so pinned and
 * normal rows stay visually identical.
 */
"use client";

import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo } from "@/lib/types";
import { SessionNodeItem } from "./SessionNodeItem";

interface PinnedSectionProps {
	pinnedSessions: SessionInfo[];
	/** Pinned ids that no longer resolve to a live session. */
	stalePinnedIds: string[];
	selectedSessionId: string | null;
	runningSessionIds: ReadonlySet<string>;
	unreadSessionIds: ReadonlySet<string>;
	editMode: boolean;
	selectedIds: ReadonlySet<string>;
	onSelectSession: (s: SessionInfo) => void;
	onToggleSelect: (id: string, opts?: { shift?: boolean; visibleIds?: readonly string[] }) => void;
	visibleIds: readonly string[];
	onUnpin: (id: string) => void;
	onArchive: (id: string) => void;
	onDeleted: (id: string) => void;
}

export function PinnedSection({
	pinnedSessions,
	stalePinnedIds,
	selectedSessionId,
	runningSessionIds,
	unreadSessionIds,
	editMode,
	selectedIds,
	onSelectSession,
	onToggleSelect,
	visibleIds,
	onUnpin,
	onArchive,
	onDeleted,
}: PinnedSectionProps) {
	const { t } = useI18n();
	if (pinnedSessions.length === 0 && stalePinnedIds.length === 0) return null;

	return (
		<div style={{ borderBottom: "1px solid var(--border)", paddingBottom: 4 }}>
			<div
				style={{
					padding: "8px 14px 2px",
					color: "var(--text-dim)",
					fontSize: 10,
					fontWeight: 600,
					letterSpacing: "0.08em",
					textTransform: "uppercase",
					display: "flex",
					alignItems: "center",
					gap: 4,
				}}
			>
				<svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M16 3a2 2 0 0 1 2.7 2.7l-1 1 1.9 4.6a1 1 0 0 1-.24 1.1L17 14.7V19a1 1 0 0 1-1.7.7L12 16.4l-3.3 3.3A1 1 0 0 1 7 19v-4.3l-2.36-2.3a1 1 0 0 1-.24-1.1l1.9-4.6-1-1A2 2 0 0 1 8 3z" />
				</svg>
				{t("sidebar.pinned")}
			</div>
			{pinnedSessions.map(session => (
				<SessionNodeItem
					key={session.id}
					session={session}
					isSelected={session.id === selectedSessionId}
					isRunning={runningSessionIds.has(session.id)}
					isUnread={unreadSessionIds.has(session.id)}
					editMode={editMode}
					isChecked={selectedIds.has(session.id)}
					onClick={() => onSelectSession(session)}
					onToggleSelect={opts => onToggleSelect(session.id, { ...opts, visibleIds })}
					onPinToggle={() => onUnpin(session.id)}
					pinned
					onArchive={() => onArchive(session.id)}
					onDeleted={onDeleted}
				/>
			))}
			{stalePinnedIds.map(id => (
				<div
					key={id}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						height: 34,
						padding: "0 14px",
						color: "var(--text-dim)",
						fontSize: 11.5,
						opacity: 0.65,
					}}
				>
					<span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
						{t("sidebar.pinnedMissing")}
					</span>
					<button
						onClick={() => onUnpin(id)}
						title={t("sidebar.unpin")}
						style={{
							background: "none",
							border: "none",
							color: "var(--text-dim)",
							cursor: "pointer",
							fontSize: 11,
							flexShrink: 0,
						}}
					>
						✕
					</button>
				</div>
			))}
		</div>
	);
}

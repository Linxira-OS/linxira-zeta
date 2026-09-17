/**
 * Bottom bulk-action bar, visible only in edit mode with a non-empty
 * selection: count + select-all-visible + bulk delete + bulk archive + exit.
 * Destructive actions go through the caller, which owns confirmation.
 */
"use client";

import { useI18n } from "@/hooks/useI18n";

interface BulkActionBarProps {
	count: number;
	visibleCount: number;
	onSelectAllVisible: () => void;
	onBulkDelete: () => void;
	onBulkArchive: () => void;
	onExit: () => void;
}

export function BulkActionBar({
	count,
	visibleCount,
	onSelectAllVisible,
	onBulkDelete,
	onBulkArchive,
	onExit,
}: BulkActionBarProps) {
	const { t } = useI18n();
	if (count === 0) return null;

	return (
		<div
			style={{
				flexShrink: 0,
				display: "flex",
				alignItems: "center",
				gap: 5,
				padding: "6px 8px",
				borderTop: "1px solid var(--border)",
				background: "var(--bg-panel)",
			}}
		>
			<span style={{ fontSize: 11.5, color: "var(--text)", flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>
				{t("sidebar.editMode")} · {count}
			</span>
			<button
				onClick={onSelectAllVisible}
				disabled={visibleCount === 0}
				style={{
					padding: "4px 9px",
					background: "none",
					border: "1px solid var(--border)",
					borderRadius: 6,
					color: "var(--text-muted)",
					fontSize: 11,
					cursor: "pointer",
					flexShrink: 0,
				}}
			>
				{t("sidebar.selectAllVisible")}
			</button>
			<button
				onClick={onBulkArchive}
				style={{
					padding: "4px 9px",
					background: "none",
					border: "1px solid var(--border)",
					borderRadius: 6,
					color: "var(--text)",
					fontSize: 11,
					cursor: "pointer",
					flexShrink: 0,
				}}
			>
				{t("sidebar.bulkArchive")}
			</button>
			<button
				onClick={onBulkDelete}
				style={{
					padding: "4px 9px",
					background: "var(--status-error)",
					border: "none",
					borderRadius: 6,
					color: "var(--status-error-foreground)",
					fontSize: 11,
					fontWeight: 600,
					cursor: "pointer",
					flexShrink: 0,
				}}
			>
				{t("sidebar.bulkDelete")}
			</button>
			<button
				onClick={onExit}
				title={t("sidebar.exitEditMode")}
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: 24,
					height: 24,
					padding: 0,
					background: "none",
					border: "none",
					color: "var(--text-dim)",
					cursor: "pointer",
					flexShrink: 0,
				}}
			>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
					<line x1="18" y1="6" x2="6" y2="18" />
					<line x1="6" y1="6" x2="18" y2="18" />
				</svg>
			</button>
		</div>
	);
}

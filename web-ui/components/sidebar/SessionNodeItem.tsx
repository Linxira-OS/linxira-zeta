/**
 * Session row: the former SessionItem (visual + rename/delete flows preserved)
 * extended with the openchamber activity contract — running state shows an
 * accent dot + elapsed timer (never a spinner), unread a pulsing info dot —
 * plus edit-mode checkboxes and a right-click context menu (pin / rename /
 * archive / delete).
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { deleteSession, renameSession } from "@/lib/session-api";
import { useI18n } from "@/hooks/useI18n";

const ITEM_HEIGHT = 54;

export interface SessionNodeItemProps {
	session: SessionInfo;
	isSelected: boolean;
	isRunning?: boolean;
	isUnread?: boolean;
	onClick: () => void;
	onRenamed?: () => void;
	onDeleted?: (id: string) => void;
	/** Right-click menu actions; omitted entries hide their menu items. */
	pinned?: boolean;
	onPinToggle?: () => void;
	onArchive?: () => void;
	depth?: number;
	hasChildren?: boolean;
	collapsed?: boolean;
	onToggleCollapse?: () => void;
	/** Edit mode: show the selection checkbox and suppress row navigation. */
	editMode?: boolean;
	isChecked?: boolean;
	onToggleSelect?: (opts?: { shift?: boolean; visibleIds?: readonly string[] }) => void;
	visibleIds?: readonly string[];
}

function formatElapsed(startedMs: number, nowMs: number): string {
	const totalSec = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	const mm = String(m).padStart(2, "0");
	const ss = String(s).padStart(2, "0");
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatRelativeTime(dateStr: string): string {
	const d = new Date(dateStr);
	const diff = Date.now() - d.getTime();
	const min = Math.floor(diff / 60_000);
	if (min < 1) return "now";
	if (min < 60) return `${min}m`;
	const h = Math.floor(min / 60);
	if (h < 24) return `${h}h`;
	const days = Math.floor(h / 24);
	return `${days}d`;
}

/** Accent dot + elapsed timer — the openchamber "point + timer" contract. */
function RunningIndicator({ startedMs }: { startedMs: number }) {
	const { t } = useI18n();
	// The timer value lives in state so render stays pure; the interval only
	// advances the captured "now" once per second.
	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		setNowMs(Date.now());
		const timer = setInterval(() => setNowMs(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	return (
		<span
			title={t("sidebar.agentRunning")}
			aria-label={t("sidebar.agentRunning")}
			style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, color: "var(--accent)", fontVariantNumeric: "tabular-nums" }}
		>
			<span
				style={{
					width: 6,
					height: 6,
					borderRadius: "50%",
					background: "var(--accent)",
					boxShadow: "0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent)",
				}}
			/>
			<span style={{ fontSize: 10.5 }}>{formatElapsed(startedMs, nowMs)}</span>
		</span>
	);
}

/** Unread marker: pulsing info dot (no spinner semantics). */
function UnreadIndicator() {
	const { t } = useI18n();
	return (
		<span
			title={t("sidebar.newActivity")}
			aria-label={t("sidebar.newSessionActivity")}
			style={{
				width: 14,
				height: 14,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				flexShrink: 0,
				color: "var(--status-info)",
			}}
		>
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
				<circle cx="7" cy="7" r="2.5" fill="currentColor" />
				<circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" opacity="0.32">
					<animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite" />
					<animate attributeName="opacity" values="0.32;0;0.32" dur="1.6s" repeatCount="indefinite" />
				</circle>
			</svg>
		</span>
	);
}

export function SessionNodeItem({
	session,
	isSelected,
	isRunning,
	isUnread,
	onClick,
	onRenamed,
	onDeleted,
	pinned,
	onPinToggle,
	onArchive,
	depth = 0,
	hasChildren = false,
	collapsed = false,
	onToggleCollapse,
	editMode = false,
	isChecked = false,
	onToggleSelect,
	visibleIds,
}: SessionNodeItemProps) {
	const { t } = useI18n();
	const [hovered, setHovered] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState("");
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	const title = session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);

	const startRename = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			setMenuOpen(false);
			setRenameValue(session.name ?? "");
			setRenaming(true);
			setTimeout(() => inputRef.current?.select(), 0);
		},
		[session.name],
	);

	const commitRename = useCallback(async () => {
		const name = renameValue.trim();
		setRenaming(false);
		if (name === (session.name ?? "")) return;
		try {
			await renameSession(session.id, name);
			onRenamed?.();
		} catch {
			// ignore
		}
	}, [renameValue, session.id, session.name, onRenamed]);

	const performDelete = useCallback(async () => {
		setConfirmDelete(false);
		setDeleting(true);
		try {
			await deleteSession(session.id);
			onDeleted?.(session.id);
		} catch {
			setDeleting(false);
		}
	}, [session.id, onDeleted]);

	const handleDeleteClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			if (e.shiftKey) {
				void performDelete();
			} else {
				setConfirmDelete(true);
			}
		},
		[performDelete],
	);

	const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		setConfirmDelete(false);
	}, []);
	const handleDeleteConfirm = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			void performDelete();
		},
		[performDelete],
	);

	// Close the context menu on outside click.
	useEffect(() => {
		if (!menuOpen) return;
		const handler = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [menuOpen]);

	return (
		<div
			onClick={confirmDelete || renaming ? undefined : editMode ? e => onToggleSelect?.({ shift: e.shiftKey, visibleIds }) : onClick}
			onContextMenu={
				editMode || confirmDelete || renaming
					? undefined
					: e => {
							e.preventDefault();
							setMenuOpen(v => !v);
						}
			}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => {
				setHovered(false);
			}}
			style={{
				height: ITEM_HEIGHT,
				display: "flex",
				alignItems: "center",
				paddingLeft: depth > 0 ? depth * 12 + 14 : 14,
				paddingRight: 8,
				cursor: confirmDelete || renaming ? "default" : "pointer",
				background: confirmDelete
					? "var(--status-error-background)"
					: isSelected
						? "var(--bg-selected)"
						: hovered
							? "var(--bg-hover)"
							: "transparent",
				borderLeft: confirmDelete
					? "2px solid var(--status-error)"
					: isSelected
						? "2px solid var(--accent)"
						: "2px solid transparent",
				transition: "background 0.1s",
				opacity: deleting ? 0.5 : 1,
				gap: 6,
				overflow: "hidden",
				position: "relative",
			}}
		>
			{confirmDelete ? (
				/* ── Delete confirmation: same height, two flat buttons ── */
				<>
					<div
						style={{
							flex: 1,
							minWidth: 0,
							fontSize: 12,
							color: "var(--text)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{t("sidebar.deleteSession", {
							title: title.slice(0, 22) + (title.length > 22 ? "…" : ""),
						})}
					</div>
					<div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
						<button
							onClick={handleDeleteConfirm}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								gap: 4,
								height: 30,
								padding: "0 11px",
								background: "var(--status-error)",
								border: "none",
								borderRadius: 6,
								color: "var(--status-error-foreground)",
								cursor: "pointer",
								fontSize: 12,
								fontWeight: 600,
								whiteSpace: "nowrap",
							}}
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<polyline points="3 6 5 6 21 6" />
								<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
								<path d="M10 11v6M14 11v6" />
								<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
							</svg>
							{t("models.delete")}
						</button>
						<button
							onClick={handleDeleteCancel}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								height: 30,
								padding: "0 11px",
								background: "var(--bg)",
								border: "1px solid var(--border)",
								borderRadius: 6,
								color: "var(--text-muted)",
								cursor: "pointer",
								fontSize: 12,
								fontWeight: 500,
								whiteSpace: "nowrap",
							}}
						>
							{t("cancel")}
						</button>
					</div>
				</>
			) : renaming ? (
				/* ── Rename: input fills the same row ── */
				<input
					ref={inputRef}
					value={renameValue}
					onChange={e => setRenameValue(e.target.value)}
					onBlur={commitRename}
					onKeyDown={e => {
						if (e.key === "Enter") commitRename();
						if (e.key === "Escape") setRenaming(false);
					}}
					autoFocus
					style={{
						flex: 1,
						fontSize: 12,
						padding: "5px 8px",
						border: "1px solid var(--accent)",
						borderRadius: 5,
						outline: "none",
						background: "var(--bg)",
						color: "var(--text)",
						height: 30,
					}}
				/>
			) : (
				/* ── Normal view ── */
				<>
					{/* Edit-mode checkbox in the gutter */}
					{editMode && (
						<span
							onClick={e => {
								e.stopPropagation();
								onToggleSelect?.({ visibleIds });
							}}
							style={{
								width: 16,
								height: 16,
								flexShrink: 0,
								borderRadius: 4,
								border: `1px solid ${isChecked ? "var(--accent)" : "var(--border)"}`,
								background: isChecked ? "var(--accent)" : "transparent",
								color: "var(--primary-foreground)",
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								cursor: "pointer",
							}}
							role="checkbox"
							aria-checked={isChecked}
						>
							{isChecked && (
								<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
									<polyline points="20 6 9 17 4 12" />
								</svg>
							)}
						</span>
					)}

					{/* Fork indicator for child sessions */}
					{depth > 0 && (
						<svg
							width="10"
							height="10"
							viewBox="0 0 24 24"
							fill="none"
							stroke="var(--text-dim)"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ flexShrink: 0 }}
						>
							<line x1="6" y1="3" x2="6" y2="15" />
							<circle cx="18" cy="6" r="3" />
							<circle cx="6" cy="18" r="3" />
							<path d="M18 9a9 9 0 0 1-9 9" />
						</svg>
					)}
					<div style={{ flex: 1, minWidth: 0 }}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 5,
								minWidth: 0,
								fontSize: 12,
								fontWeight: isSelected ? 500 : 400,
								lineHeight: 1.4,
								color: "var(--text)",
							}}
							title={title}
						>
							<span
								style={{
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									minWidth: 0,
								}}
							>
								{title}
							</span>
							{session.tag && (
								<span
									style={{
										flexShrink: 0,
										fontSize: 9,
										lineHeight: 1,
										padding: "2px 5px",
										borderRadius: 8,
										border: "1px solid var(--accent-dim, rgba(99,102,241,0.4))",
										color: "var(--accent, #6366f1)",
										textTransform: "uppercase",
										letterSpacing: 0.4,
									}}
								>
									{session.tag}
								</span>
							)}
						</div>
						<div
							style={{
								marginTop: 2,
								display: "flex",
								alignItems: "center",
								gap: 8,
								color: "var(--text-dim)",
								fontSize: 11,
								minWidth: 0,
							}}
						>
							{session.cwd && (
								<span
									title={session.cwd}
									style={{
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										maxWidth: "45%",
										color: "var(--text-dim)",
									}}
								>
									{session.cwd.split(/[\\/]/).filter(Boolean).pop() || session.cwd}
								</span>
							)}
							{isRunning ? (
								<RunningIndicator startedMs={new Date(session.modified).getTime()} />
							) : isUnread ? (
								<UnreadIndicator />
							) : (
								<span title={session.modified}>{formatRelativeTime(session.modified)}</span>
							)}
							<span>{t("sidebar.messagesCount", { count: session.messageCount })}</span>
							{session.worktreeBranch && (
								<span
									title={`Worktree: ${session.cwd}`}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 3,
										color: "var(--accent)",
										minWidth: 0,
										overflow: "hidden",
									}}
								>
									<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
										<line x1="6" y1="3" x2="6" y2="15" />
										<circle cx="18" cy="6" r="3" />
										<circle cx="6" cy="18" r="3" />
										<path d="M18 9a9 9 0 0 1-9 9" />
									</svg>
									<span
										style={{
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>
										{session.worktreeBranch}
									</span>
								</span>
							)}
						</div>
					</div>

					{/* Collapse toggle — always visible when has children */}
					{hasChildren && (
						<button
							onClick={e => {
								e.stopPropagation();
								onToggleCollapse?.();
							}}
							title={collapsed ? "Expand forks" : "Collapse forks"}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 20,
								height: 20,
								padding: 0,
								flexShrink: 0,
								background: "none",
								border: "none",
								color: "var(--text-dim)",
								cursor: "pointer",
								transform: collapsed ? "rotate(-90deg)" : "none",
								transition: "transform 0.15s",
							}}
						>
							<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
								<polyline points="2 3.5 5 6.5 8 3.5" />
							</svg>
						</button>
					)}

					{/* Action buttons — reserved width so the row never reflows */}
					<div
						style={{
							display: "flex",
							gap: 4,
							flexShrink: 0,
							width: 68,
							justifyContent: "flex-end",
							opacity: hovered ? 1 : 0,
							transition: "opacity 0.12s",
							pointerEvents: hovered ? "auto" : "none",
						}}
					>
						<button
							onClick={startRename}
							title={t("sidebar.rename")}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 32,
								height: 32,
								padding: 0,
								background: "var(--bg-hover)",
								border: "1px solid var(--border)",
								borderRadius: 7,
								color: "var(--text-muted)",
								cursor: "pointer",
								flexShrink: 0,
								transition: "background 0.12s, color 0.12s, border-color 0.12s",
							}}
							onMouseEnter={e => {
								e.currentTarget.style.background = "var(--bg-selected)";
								e.currentTarget.style.color = "var(--accent)";
								e.currentTarget.style.borderColor = "var(--interactive-border-focus)";
							}}
							onMouseLeave={e => {
								e.currentTarget.style.background = "var(--bg-hover)";
								e.currentTarget.style.color = "var(--text-muted)";
								e.currentTarget.style.borderColor = "var(--border)";
							}}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
							</svg>
						</button>
						<button
							onClick={handleDeleteClick}
							title={t("sidebar.deleteWithShiftClick")}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 32,
								height: 32,
								padding: 0,
								background: "var(--bg-hover)",
								border: "1px solid var(--border)",
								borderRadius: 7,
								color: "var(--text-muted)",
								cursor: "pointer",
								flexShrink: 0,
								transition: "background 0.12s, color 0.12s, border-color 0.12s",
							}}
							onMouseEnter={e => {
								e.currentTarget.style.background = "var(--status-error-background)";
								e.currentTarget.style.color = "var(--status-error)";
								e.currentTarget.style.borderColor = "var(--status-error-border)";
							}}
							onMouseLeave={e => {
								e.currentTarget.style.background = "var(--bg-hover)";
								e.currentTarget.style.color = "var(--text-muted)";
								e.currentTarget.style.borderColor = "var(--border)";
							}}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<polyline points="3 6 5 6 21 6" />
								<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
								<path d="M10 11v6M14 11v6" />
								<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
							</svg>
						</button>
					</div>

					{/* Right-click context menu */}
					{menuOpen && (
						<div
							ref={menuRef}
							style={{
								position: "fixed",
								zIndex: 300,
								minWidth: 150,
								background: "var(--bg-elevated, var(--bg))",
								border: "1px solid var(--border)",
								borderRadius: 8,
								boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
								padding: 4,
							}}
							onClick={e => e.stopPropagation()}
						>
							{onPinToggle && (
								<button
									onClick={() => {
										setMenuOpen(false);
										onPinToggle();
									}}
									style={{
										display: "block",
										width: "100%",
										textAlign: "left",
										padding: "6px 8px",
										fontSize: 12,
										color: "var(--text)",
										background: "none",
										border: "none",
										borderRadius: 5,
										cursor: "pointer",
									}}
								>
									{pinned ? t("sidebar.unpin") : t("sidebar.pin")}
								</button>
							)}
							<button
								onClick={e => startRename(e)}
								style={{
									display: "block",
									width: "100%",
									textAlign: "left",
									padding: "6px 8px",
									fontSize: 12,
									color: "var(--text)",
									background: "none",
									border: "none",
									borderRadius: 5,
									cursor: "pointer",
								}}
							>
								{t("sidebar.rename")}
							</button>
							{onArchive && (
								<button
									onClick={() => {
										setMenuOpen(false);
										onArchive();
									}}
									style={{
										display: "block",
										width: "100%",
										textAlign: "left",
										padding: "6px 8px",
										fontSize: 12,
										color: "var(--text)",
										background: "none",
										border: "none",
										borderRadius: 5,
										cursor: "pointer",
									}}
								>
									{t("sidebar.archive")}
								</button>
							)}
							<button
								onClick={e => {
									setMenuOpen(false);
									handleDeleteClick(e);
								}}
								style={{
									display: "block",
									width: "100%",
									textAlign: "left",
									padding: "6px 8px",
									fontSize: 12,
									color: "var(--status-error)",
									background: "none",
									border: "none",
									borderRadius: 5,
									cursor: "pointer",
								}}
							>
								{t("sidebar.delete")}
							</button>
						</div>
					)}
				</>
			)}
		</div>
	);
}

"use client";

/**
 * Session tab strip — one tab per open session/draft, above the chat area.
 *
 * PR A covers the skeleton: activate, close, new, plus the running dot. The
 * right-click close family (close others / to the right / close and abort),
 * the attention flash, drag-to-reorder and the keyboard roving tabindex land in
 * PR B/C; the ARIA roles below are already the ones PR C will drive.
 *
 * Visual language follows `components/TabBar.tsx` (the file tab strip inside the
 * dock's files panel): 36px strip, hover-revealed ×, middle-click closes. The
 * two strips never merge — one lists sessions, the other files.
 */
import { useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import type { SessionTab } from "@/lib/session-tabs";

interface Props {
	tabs: readonly SessionTab[];
	activeTabId: string | null;
	/** Tabs with a live run (the shared poll plus each tab's own SSE state). */
	runningTabIds: ReadonlySet<string>;
	/** Tabs allowed to hold their session stream right now (the 3-stream budget). */
	streamingTabIds: ReadonlySet<string>;
	/** Live display title (session name > first message > fallback). */
	titleFor: (tab: SessionTab) => string;
	onActivateTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
	onNewTab: () => void;
	isMobile: boolean;
}

export function SessionTabBar({
	tabs,
	activeTabId,
	runningTabIds,
	streamingTabIds,
	titleFor,
	onActivateTab,
	onCloseTab,
	onNewTab,
	isMobile,
}: Props) {
	const { t } = useI18n();
	const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);

	// Tabs are the only cross-project surface in the shell, so when more than one
	// project is open the strip names the project in front of the title.
	const projects = new Set(tabs.map(tab => tab.projectRoot ?? ""));
	const showProject = projects.size > 1;

	return (
		<div
			role="tablist"
			aria-label={t("tabs.railLabel")}
			style={{
				display: "flex",
				alignItems: "stretch",
				flexShrink: 0,
				height: 36,
				borderBottom: "1px solid var(--zeta-alias-border)",
				background: "var(--zeta-alias-bg-panel)",
			}}
		>
			<div
				role="presentation"
				style={{ display: "flex", alignItems: "stretch", flex: 1, minWidth: 0, overflowX: "auto" }}
			>
				{tabs.map(tab => {
					const isActive = tab.id === activeTabId;
					const title = titleFor(tab);
					const isRunning = runningTabIds.has(tab.id);
					const isLive = streamingTabIds.has(tab.id);
					return (
						<div
							key={tab.id}
							role="tab"
							aria-selected={isActive}
							tabIndex={isActive ? 0 : -1}
							data-session-tab={tab.id}
							onClick={() => onActivateTab(tab.id)}
							onMouseDown={e => {
								if (e.button === 1) e.preventDefault();
							}}
							onAuxClick={e => {
								if (e.button !== 1) return;
								e.preventDefault();
								onCloseTab(tab.id);
							}}
							onMouseEnter={() => setHoveredTabId(tab.id)}
							onMouseLeave={() => setHoveredTabId(current => (current === tab.id ? null : current))}
							title={[title, tab.projectRoot ?? "", tab.sessionId ?? ""].filter(Boolean).join("\n")}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								maxWidth: 220,
								padding: "0 8px 0 10px",
								borderRight: "1px solid var(--zeta-alias-border)",
								borderBottom: isActive ? "2px solid var(--zeta-alias-accent)" : "2px solid transparent",
								background: isActive ? "var(--zeta-alias-bg-selected)" : "none",
								color: isActive ? "var(--zeta-alias-text)" : "var(--zeta-alias-text-muted)",
								fontSize: 12,
								cursor: "pointer",
								userSelect: "none",
								flexShrink: 0,
							}}
						>
							{isRunning && (
								<span
									aria-label={t("agent-is-running")}
									title={t("agent-is-running")}
									style={{
										width: 6,
										height: 6,
										borderRadius: "50%",
										background: "var(--zeta-alias-accent)",
										// A cold tab (running, stream over budget) still shows
										// the dot — the run is real — but dimmed: its view is
										// refreshed when the tab is activated again.
										opacity: isLive ? 1 : 0.45,
										flexShrink: 0,
									}}
								/>
							)}
							{showProject && tab.projectRoot && (
								<span
									style={{
										color: "var(--zeta-alias-text-dim)",
										flexShrink: 0,
										maxWidth: 72,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{getFileName(tab.projectRoot) || tab.projectRoot}
								</span>
							)}
							<span
								style={{
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{title}
							</span>
							<button
								type="button"
								aria-label={t("tabs.closeNamedFmt", { title })}
								title={t("tabs.close")}
								onClick={e => {
									// Close must not double as activate.
									e.stopPropagation();
									onCloseTab(tab.id);
								}}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									width: 16,
									height: 16,
									padding: 0,
									border: "none",
									borderRadius: 3,
									background: "none",
									color: "inherit",
									cursor: "pointer",
									flexShrink: 0,
									opacity: isMobile || isActive || hoveredTabId === tab.id ? 1 : 0,
									transition: "opacity 0.12s",
								}}
							>
								<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
									<line
										x1="2"
										y1="2"
										x2="8"
										y2="8"
										stroke="currentColor"
										strokeWidth="1.4"
										strokeLinecap="round"
									/>
									<line
										x1="8"
										y1="2"
										x2="2"
										y2="8"
										stroke="currentColor"
										strokeWidth="1.4"
										strokeLinecap="round"
									/>
								</svg>
							</button>
						</div>
					);
				})}
			</div>
			<button
				type="button"
				aria-label={t("tabs.new")}
				title={t("tabs.new")}
				onClick={onNewTab}
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: 34,
					border: "none",
					borderLeft: "1px solid var(--zeta-alias-border)",
					background: "none",
					color: "var(--zeta-alias-text-muted)",
					fontSize: 16,
					cursor: "pointer",
					flexShrink: 0,
				}}
			>
				+
			</button>
		</div>
	);
}

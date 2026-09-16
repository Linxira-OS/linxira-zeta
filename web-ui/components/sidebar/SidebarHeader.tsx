/**
 * Sidebar header row: brand title, folder picker, display-settings dropdown,
 * search toggle, and the edit-mode (multi-select) toggle. New-session remains
 * the only creation entry — no batch button here.
 */
"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SidebarDisplaySettings } from "./sidebar-shared";

interface SidebarHeaderProps {
	title: React.ReactNode;
	display: SidebarDisplaySettings;
	searchOpen: boolean;
	editMode: boolean;
	onToggleSearch: () => void;
	onToggleEditMode: () => void;
	onUpdateDisplay: (patch: Partial<SidebarDisplaySettings>) => void;
}

const TOOL_BUTTON_STYLE: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	color: "var(--text-muted)",
	cursor: "pointer",
	width: 32,
	height: 32,
	borderRadius: 7,
	padding: 0,
	flexShrink: 0,
};

function hoverAccent(e: React.MouseEvent<HTMLButtonElement>) {
	e.currentTarget.style.background = "var(--bg-selected)";
	e.currentTarget.style.color = "var(--accent)";
}

function hoverReset(e: React.MouseEvent<HTMLButtonElement>) {
	e.currentTarget.style.background = "var(--bg-hover)";
	e.currentTarget.style.color = "var(--text-muted)";
}

export function SidebarHeader({
	title,
	display,
	searchOpen,
	editMode,
	onToggleSearch,
	onToggleEditMode,
	onUpdateDisplay,
}: SidebarHeaderProps) {
	const { t } = useI18n();
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				marginBottom: 10,
			}}
		>
			{title}
			<div style={{ display: "flex", gap: 6 }}>
				{/* Display settings dropdown — sort/group/recent controls */}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger asChild>
						<button title={t("sidebar.display.title")} className="ze-btn" style={TOOL_BUTTON_STYLE} onMouseEnter={hoverAccent} onMouseLeave={hoverReset}>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
								<line x1="4" y1="6" x2="20" y2="6" />
								<line x1="4" y1="12" x2="16" y2="12" />
								<line x1="4" y1="18" x2="12" y2="18" />
							</svg>
						</button>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							align="end"
							sideOffset={4}
							style={{
								minWidth: 200,
								background: "var(--bg)",
								border: "1px solid var(--border)",
								borderRadius: 8,
								boxShadow: "0 6px 20px rgba(0,0,0,0.14)",
								padding: 4,
								zIndex: 200,
							}}
						>
							<DropdownMenu.Label
								style={{
									padding: "6px 8px 2px",
									fontSize: 10,
									fontWeight: 600,
									letterSpacing: "0.08em",
									textTransform: "uppercase",
									color: "var(--text-dim)",
								}}
							>
								{t("sidebar.display.projectSort")}
							</DropdownMenu.Label>
							{(
								[
									["manual", "sidebar.display.sort.manual"],
									["a-z", "sidebar.display.sort.a-z"],
									["z-a", "sidebar.display.sort.z-a"],
									["date-added", "sidebar.display.sort.date-added"],
									["recent", "sidebar.display.sort.recent"],
								] as const
							).map(([value, key]) => (
								<DropdownMenu.Item
									key={value}
									onSelect={() => onUpdateDisplay({ projectSort: value })}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 6,
										padding: "6px 8px",
										fontSize: 12,
										color: display.projectSort === value ? "var(--accent)" : "var(--text)",
										borderRadius: 5,
										cursor: "pointer",
										outline: "none",
									}}
								>
									<span style={{ width: 12 }}>{display.projectSort === value ? "✓" : ""}</span>
									{t(key)}
								</DropdownMenu.Item>
							))}
							<DropdownMenu.Separator style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
							<DropdownMenu.Label
								style={{
									padding: "6px 8px 2px",
									fontSize: 10,
									fontWeight: 600,
									letterSpacing: "0.08em",
									textTransform: "uppercase",
									color: "var(--text-dim)",
								}}
							>
								{t("sidebar.display.sessionGrouping")}
							</DropdownMenu.Label>
							{(
								[
									["by-worktree", "sidebar.display.grouping.by-worktree"],
									["flat", "sidebar.display.grouping.flat"],
								] as const
							).map(([value, key]) => (
								<DropdownMenu.Item
									key={value}
									onSelect={() => onUpdateDisplay({ sessionGrouping: value })}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 6,
										padding: "6px 8px",
										fontSize: 12,
										color: display.sessionGrouping === value ? "var(--accent)" : "var(--text)",
										borderRadius: 5,
										cursor: "pointer",
										outline: "none",
									}}
								>
									<span style={{ width: 12 }}>{display.sessionGrouping === value ? "✓" : ""}</span>
									{t(key)}
								</DropdownMenu.Item>
							))}
							<DropdownMenu.Separator style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
							<DropdownMenu.Item
								onSelect={() => onUpdateDisplay({ showRecent: !display.showRecent })}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "6px 8px",
									fontSize: 12,
									color: "var(--text)",
									borderRadius: 5,
									cursor: "pointer",
									outline: "none",
								}}
							>
								{t("sidebar.display.showRecent")}
								<span
									style={{
										fontSize: 11,
										color: display.showRecent ? "var(--accent)" : "var(--text-dim)",
									}}
								>
									{display.showRecent ? "ON" : "OFF"}
								</span>
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>

				{/* Search toggle */}
				<button
					className="ze-btn"
					aria-pressed={searchOpen}
					onClick={onToggleSearch}
					title={t("sidebar.display.search")}
					style={{
						...TOOL_BUTTON_STYLE,
						color: searchOpen ? "var(--accent)" : "var(--text-muted)",
					}}
					onMouseEnter={hoverAccent}
					onMouseLeave={hoverReset}
				>
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<circle cx="11" cy="11" r="8" />
						<line x1="21" y1="21" x2="16.65" y2="16.65" />
					</svg>
				</button>

				{/* Edit mode (multi-select) toggle */}
				<button
					className="ze-btn"
					aria-pressed={editMode}
					onClick={onToggleEditMode}
					title={editMode ? t("sidebar.exitEditMode") : t("sidebar.editMode")}
					style={{
						...TOOL_BUTTON_STYLE,
						color: editMode ? "var(--accent)" : "var(--text-muted)",
					}}
					onMouseEnter={hoverAccent}
					onMouseLeave={hoverReset}
				>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M9 11l3 3L22 4" />
						<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
					</svg>
				</button>
			</div>
		</div>
	);
}

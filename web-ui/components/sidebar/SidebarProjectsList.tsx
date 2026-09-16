/**
 * Project group list: workspace groups (per-project headers with counts and
 * collapse chevrons) extracted from SessionSidebar. The header of the current
 * project exposes a hover menu with project-scoped destructive actions
 * (delete all sessions; delete sessions + project entry) wired by the caller.
 */
"use client";

import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";

export interface ProjectGroup {
	project: string;
	count: number;
}

interface SidebarProjectsListProps {
	groups: ProjectGroup[];
	selectedProject: string | null;
	collapsedProjects: ReadonlySet<string>;
	/** cwd → display alias (UI-only rename; never touches disk). */
	projectAliases?: Record<string, string>;
	/** Current branch per project root (git badge; null hides the badge). */
	branchFor?: (project: string) => string | null;
	onToggleCollapse: (project: string) => void;
	onSwitchProject: (project: string) => void;
	/** Render the current project's grouped session rows under its header. */
	renderProjectSessions: (project: string) => React.ReactNode;
	/** Project menu actions for the current project (delete-all etc.). */
	renderProjectMenu?: (project: string) => React.ReactNode;
	/** Open a new-session draft pre-seeded with this project. */
	onNewSessionInProject?: (project: string) => void;
	/** Delete every session in the project (inline confirm follows). */
	onDeleteProjectSessions?: (project: string) => void;
	/** Open the project root in a terminal. */
	onOpenTerminal?: (project: string) => void;
	/** Right-click on a group header → portal menu. */
	onProjectContextMenu?: (e: React.MouseEvent, project: string) => void;
	/** Sort button on a group header → project-sort popover. */
	onProjectSortClick?: (e: React.MouseEvent) => void;
}

export function SidebarProjectsList({
	groups,
	selectedProject,
	collapsedProjects,
	projectAliases,
	branchFor,
	onToggleCollapse,
	onSwitchProject,
	renderProjectSessions,
	renderProjectMenu,
	onNewSessionInProject,
	onDeleteProjectSessions,
	onOpenTerminal,
	onProjectContextMenu,
	onProjectSortClick,
}: SidebarProjectsListProps) {
	const { t } = useI18n();
	return (
		<>
			{groups.map(pg => {
				const isCurrent = pg.project === selectedProject;
				return (
					<div key={pg.project}>
						<div
							style={{ display: "flex", alignItems: "center", width: "100%" }}
							onContextMenu={(e) => onProjectContextMenu?.(e, pg.project)}
						>
							{onProjectSortClick && (
								<span
									role="button"
									tabIndex={0}
									aria-label={t("sidebar.display.projectSort")}
									onClick={(e) => {
										e.stopPropagation();
										onProjectSortClick(e);
									}}
									onKeyDown={(e) => e.stopPropagation()}
									className="ze-quiet"
									style={{ fontSize: 10, padding: "1px 4px", flexShrink: 0 }}
								>
									↑↓
								</span>
							)}
							<button
								onClick={() => {
									if (!isCurrent) onSwitchProject(pg.project);
									else onToggleCollapse(pg.project);
								}}
								title={pg.project}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 6,
									flex: 1,
									minWidth: 0,
									padding: "9px 0 5px 14px",
									background: "none",
									border: "none",
									cursor: isCurrent ? "default" : "pointer",
									textAlign: "left",
								}}
							>
								<svg
									width="11"
									height="11"
									viewBox="0 0 24 24"
									fill="none"
									stroke={isCurrent ? "var(--accent)" : "var(--text-dim)"}
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									style={{ flexShrink: 0 }}
								>
									<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
								</svg>
								<span
									style={{
										flex: 0,
										minWidth: 0,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										fontSize: 12,
										fontWeight: 700,
										color: isCurrent ? "var(--text)" : "var(--text-muted)",
									}}
								>
									{projectAliases?.[pg.project] ?? getFileName(pg.project)}
								</span>
								{isCurrent && branchFor?.(pg.project) && (
									<span
										title={`Branch: ${branchFor(pg.project)}`}
										style={{
											display: "inline-flex",
											alignItems: "center",
											gap: 3,
											fontSize: 10,
											color: "var(--accent)",
											border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
											borderRadius: 999,
											padding: "0 6px",
											lineHeight: "15px",
											flexShrink: 0,
											maxWidth: 110,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>
										<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ flexShrink: 0 }}>
											<line x1="6" y1="3" x2="6" y2="15" />
											<circle cx="18" cy="6" r="3" />
											<circle cx="6" cy="18" r="3" />
											<path d="M18 9a9 9 0 0 1-9 9" />
										</svg>
										{branchFor(pg.project)}
									</span>
								)}
								<span
									style={{
										fontSize: 10,
										color: "var(--text-dim)",
										flexShrink: 0,
									}}
								>
									{pg.count > 0 ? pg.count : ""}
								</span>
								<svg
									width="9"
									height="9"
									viewBox="0 0 10 10"
									fill="none"
									stroke="var(--text-dim)"
									strokeWidth="1.8"
									strokeLinecap="round"
									strokeLinejoin="round"
									style={{
										flexShrink: 0,
										marginRight: 6,
										transform: collapsedProjects.has(pg.project) ? "rotate(-90deg)" : "rotate(0deg)",
										transition: "transform 0.12s",
									}}
								>
									<polyline points="2 3.5 5 6.5 8 3.5" />
								</svg>
							</button>
							{isCurrent && (onNewSessionInProject || onDeleteProjectSessions || onOpenTerminal) && (
								<span
									className="sidebar-group-actions"
									style={{ display: "flex", alignItems: "center", gap: 2, marginRight: 2 }}
									onClick={(e) => e.stopPropagation()}
								>
									{onNewSessionInProject && (
										<button
											aria-label="New session in project"
											title="New session here"
											style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", padding: 0 }}
											onClick={(e) => {
												e.stopPropagation();
												onNewSessionInProject(pg.project);
											}}
										>
											<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
												<line x1="6" y1="1" x2="6" y2="11" />
												<line x1="1" y1="6" x2="11" y2="6" />
											</svg>
										</button>
									)}
									{onOpenTerminal && (
										<button
											aria-label="Open project in terminal"
											title="Open in terminal"
											style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", padding: 0 }}
											onClick={(e) => {
												e.stopPropagation();
												onOpenTerminal(pg.project);
											}}
										>
											<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
												<polyline points="4 17 10 11 4 5" />
												<line x1="12" y1="19" x2="20" y2="19" />
											</svg>
										</button>
									)}
									{onDeleteProjectSessions && (
										<button
											aria-label="Delete all project sessions"
											title="Delete all sessions in this project"
											style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: 5, color: "var(--status-error)", cursor: "pointer", padding: 0 }}
											onClick={(e) => {
												e.stopPropagation();
												onDeleteProjectSessions(pg.project);
											}}
										>
											<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
												<polyline points="3 6 5 6 21 6" />
												<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
											</svg>
										</button>
									)}
								</span>
							)}
							{isCurrent && renderProjectMenu?.(pg.project)}
						</div>
						{isCurrent &&
							pg.count === 0 &&
							!collapsedProjects.has(pg.project) && (
								<div
									style={{
										padding: "2px 14px 8px",
										fontSize: 11,
										color: "var(--text-dim)",
									}}
								>
									{t("sidebar.no-sessions-in-workspace")}
								</div>
							)}
						{isCurrent &&
							!collapsedProjects.has(pg.project) &&
							renderProjectSessions(pg.project)}
					</div>
				);
			})}
		</>
	);
}

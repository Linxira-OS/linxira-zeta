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
	onToggleCollapse: (project: string) => void;
	onSwitchProject: (project: string) => void;
	/** Render the current project's grouped session rows under its header. */
	renderProjectSessions: (project: string) => React.ReactNode;
	/** Project menu actions for the current project (delete-all etc.). */
	renderProjectMenu?: (project: string) => React.ReactNode;
}

export function SidebarProjectsList({
	groups,
	selectedProject,
	collapsedProjects,
	onToggleCollapse,
	onSwitchProject,
	renderProjectSessions,
	renderProjectMenu,
}: SidebarProjectsListProps) {
	const { t } = useI18n();
	return (
		<>
			{groups.map(pg => {
				const isCurrent = pg.project === selectedProject;
				return (
					<div key={pg.project}>
						<div style={{ display: "flex", alignItems: "center", width: "100%" }}>
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
										flex: 1,
										minWidth: 0,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										fontSize: 12,
										fontWeight: 700,
										color: isCurrent ? "var(--text)" : "var(--text-muted)",
									}}
								>
									{getFileName(pg.project)}
								</span>
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

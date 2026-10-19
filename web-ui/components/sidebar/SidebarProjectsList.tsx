/**
 * Project group list: workspace groups (per-project headers with counts and
 * collapse chevrons). The header row's static face is icon + name + count +
 * chevron only (D3); every action (↑↓ sort / + new session / terminal /
 * delete-all / ⋯ menu) lives in a hover-surfaced cluster with a reserved
 * fixed width so rows never reflow. Available on every project row, not just
 * the selected one.
 */
"use client";

import { useMemo, useState } from "react";
import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type Announcements,
	type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import { moveProjectOrder } from "@/lib/sidebar-prefs";

export interface ProjectGroup {
	project: string;
	count: number;
	/** The seeded default workspace (~/.zeta/workspace) — always pinned first. */
	isDefault?: boolean;
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
	/** Render the project's session rows under its header. */
	renderProjectSessions: (project: string) => React.ReactNode;
	/** Rendered at the group tail (e.g. the empty-sessions fold). */
	renderProjectFooter?: (project: string) => React.ReactNode;
	/** ⋯ menu (project-scoped actions) for any project row. */
	renderProjectMenu?: (project: string) => React.ReactNode;
	/** New-session entry seeded with this project. */
	onNewSessionInProject?: (project: string) => void;
	/** Delete every session in the project (inline confirm follows). */
	onDeleteProjectSessions?: (project: string) => void;
	/** Open the project root in a terminal. */
	onOpenTerminal?: (project: string) => void;
	/** Right-click on a group header → portal menu. */
	onProjectContextMenu?: (e: React.MouseEvent, project: string) => void;
	/** ↑↓ button on a group header → project-sort popover. */
	onProjectSortClick?: (e: React.MouseEvent) => void;
	/** Drag-to-reorder result (rendered order, default workspace first). */
	onReorderProjects?: (orderedPaths: string[]) => void;
}

/** Reserved cluster width: 6×22px buttons + gaps — rows never reflow on hover. */
const CLUSTER_WIDTH = 150;

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
	color: "var(--zeta-alias-text-muted)",
	cursor: "pointer",
} as const;

function ProjectGroupRow({
	group,
	isCurrent,
	branch,
	alias,
	collapsed,
	onToggleCollapse,
	onSwitchProject,
	onNewSessionInProject,
	onDeleteProjectSessions,
	onOpenTerminal,
	onProjectContextMenu,
	onProjectSortClick,
	renderProjectMenu,
	renderProjectSessions,
	renderProjectFooter,
}: {
	group: ProjectGroup;
	isCurrent: boolean;
	branch: string | null;
	alias?: string;
	collapsed: boolean;
	onToggleCollapse: (project: string) => void;
	onSwitchProject: (project: string) => void;
	onNewSessionInProject?: (project: string) => void;
	onDeleteProjectSessions?: (project: string) => void;
	onOpenTerminal?: (project: string) => void;
	onProjectContextMenu?: (e: React.MouseEvent, project: string) => void;
	onProjectSortClick?: (e: React.MouseEvent) => void;
	renderProjectMenu?: (project: string) => React.ReactNode;
	renderProjectSessions: (project: string) => React.ReactNode;
	renderProjectFooter?: (project: string) => React.ReactNode;
}) {
	const { t } = useI18n();
	const [active, setActive] = useState(false);
	const showSessions = !collapsed && group.count > 0;
	// The seeded default workspace is a fixed anchor: it stays first, so it can
	// receive a drop but is never a drag source (no handle is rendered).
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
		id: group.project,
		disabled: group.isDefault ? { draggable: true, droppable: false } : false,
		attributes: { roleDescription: t("sidebar.projects.reorderRole") },
	});
	const clusterVisible = active || isDragging;
	return (
		<div
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				opacity: isDragging ? 0.65 : 1,
				position: "relative",
				zIndex: isDragging ? 1 : undefined,
			}}
		>
			<div
				onMouseEnter={() => setActive(true)}
				onMouseLeave={() => setActive(false)}
				onFocus={() => setActive(true)}
				onBlur={e => {
					if (!e.currentTarget.contains(e.relatedTarget as Node)) setActive(false);
				}}
				style={{ display: "flex", alignItems: "center", width: "100%" }}
				onContextMenu={e => onProjectContextMenu?.(e, group.project)}
			>
				<button
					onClick={() => {
						if (!isCurrent) onSwitchProject(group.project);
						else onToggleCollapse(group.project);
					}}
					title={group.project}
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
						stroke={isCurrent ? "var(--zeta-alias-accent)" : "var(--zeta-alias-text-dim)"}
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						style={{ flexShrink: 0 }}
					>
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
					</svg>
					<span
						style={{
							minWidth: 0,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							fontSize: 12,
							fontWeight: 700,
							color: isCurrent ? "var(--zeta-alias-text)" : "var(--zeta-alias-text-muted)",
						}}
					>
						{alias ?? getFileName(group.project)}
					</span>
				{group.isDefault && (
					<span
						title={t("sidebar.default-workspace")}
						style={{
							fontSize: 10,
							color: "var(--zeta-alias-accent)",
							border: "1px solid color-mix(in srgb, var(--zeta-alias-accent) 35%, transparent)",
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
						{t("sidebar.default-workspace")}
					</span>
				)}
					{isCurrent && branch && (
						<span
							title={t("sidebar.branch-title", { branch })}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 3,
								fontSize: 10,
								color: "var(--zeta-alias-accent)",
								border: "1px solid color-mix(in srgb, var(--zeta-alias-accent) 35%, transparent)",
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
							{branch}
						</span>
					)}
					<span
						style={{
							fontSize: 10,
							color: "var(--zeta-alias-text-dim)",
							flexShrink: 0,
						}}
					>
						{group.count > 0 ? group.count : ""}
					</span>
					<svg
						width="9"
						height="9"
						viewBox="0 0 10 10"
						fill="none"
						stroke="var(--zeta-alias-text-dim)"
						strokeWidth="1.8"
						strokeLinecap="round"
						strokeLinejoin="round"
						style={{
							flexShrink: 0,
							marginRight: 6,
							transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
							transition: "transform 0.12s",
						}}
					>
						<polyline points="2 3.5 5 6.5 8 3.5" />
					</svg>
				</button>
				{/* Hover cluster — fades in on row hover/focus, reserved width */}
				<span
					style={{
						display: "flex",
						alignItems: "center",
						gap: 2,
						marginRight: 2,
						flexShrink: 0,
						width: CLUSTER_WIDTH,
						justifyContent: "flex-end",
						opacity: clusterVisible ? 1 : 0,
						transition: "opacity 0.12s",
						pointerEvents: clusterVisible ? "auto" : "none",
					}}
					onClick={e => e.stopPropagation()}
				>
					{!group.isDefault && (
						<button
							ref={setActivatorNodeRef}
							{...attributes}
							{...listeners}
							aria-label={t("sidebar.projects.reorderHandle")}
							title={t("sidebar.projects.reorderHandle")}
							style={{
								...ACTION_BUTTON_STYLE,
								cursor: isDragging ? "grabbing" : "grab",
								touchAction: "none",
							}}
						>
							<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
								<circle cx="2.5" cy="2" r="1.3" />
								<circle cx="7.5" cy="2" r="1.3" />
								<circle cx="2.5" cy="6" r="1.3" />
								<circle cx="7.5" cy="6" r="1.3" />
								<circle cx="2.5" cy="10" r="1.3" />
								<circle cx="7.5" cy="10" r="1.3" />
							</svg>
						</button>
					)}
					{onProjectSortClick && (
						<button
							aria-label={t("sidebar.display.projectSort")}
							title={t("sidebar.display.projectSort")}
							style={{ ...ACTION_BUTTON_STYLE, fontSize: 10 }}
							onClick={e => {
								e.stopPropagation();
								onProjectSortClick(e);
							}}
						>
							↑↓
						</button>
					)}
					{onNewSessionInProject && (
						<button
							aria-label={t("sidebar.actions.newSession")}
							title={t("sidebar.actions.newSession")}
							style={ACTION_BUTTON_STYLE}
							onClick={e => {
								e.stopPropagation();
								onNewSessionInProject(group.project);
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
							aria-label={t("sidebar.openTerminal")}
							title={t("sidebar.openTerminal")}
							style={ACTION_BUTTON_STYLE}
							onClick={e => {
								e.stopPropagation();
								onOpenTerminal(group.project);
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
							aria-label={t("sidebar.deleteProjectSessions")}
							title={t("sidebar.deleteProjectSessions")}
							style={{ ...ACTION_BUTTON_STYLE, color: "var(--zeta-alias-status-error)" }}
							onClick={e => {
								e.stopPropagation();
								onDeleteProjectSessions(group.project);
							}}
						>
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<polyline points="3 6 5 6 21 6" />
								<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
							</svg>
						</button>
					)}
					{renderProjectMenu?.(group.project)}
				</span>
			</div>
			{group.count === 0 && !collapsed && (
				<div
					style={{
						padding: "2px 14px 8px 38px",
						fontSize: 11,
						color: "var(--zeta-alias-text-dim)",
					}}
				>
					{t("sidebar.no-sessions-in-workspace")}
				</div>
			)}
			{showSessions && renderProjectSessions(group.project)}
			{!collapsed && renderProjectFooter?.(group.project)}
		</div>
	);
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
	renderProjectFooter,
	renderProjectMenu,
	onNewSessionInProject,
	onDeleteProjectSessions,
	onOpenTerminal,
	onProjectContextMenu,
	onProjectSortClick,
	onReorderProjects,
}: SidebarProjectsListProps) {
	const { t } = useI18n();
	const sensors = useSensors(
		// A small activation distance keeps plain clicks on the row (and on the
		// handle) working; the drag only starts after real pointer movement.
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);
	const projectPaths = groups.map(pg => pg.project);
	const announcements = useMemo<Announcements>(() => {
		const nameOf = (id: string | number): string => {
			const path = String(id);
			return projectAliases?.[path] ?? getFileName(path);
		};
		return {
			onDragStart: ({ active }) => t("sidebar.projects.dragStart", { name: nameOf(active.id) }),
			onDragOver: ({ active, over }) =>
				over
					? t("sidebar.projects.dragOver", { name: nameOf(active.id), over: nameOf(over.id) })
					: t("sidebar.projects.dragStart", { name: nameOf(active.id) }),
			onDragEnd: ({ active }) => t("sidebar.projects.dragEnd", { name: nameOf(active.id) }),
			onDragCancel: ({ active }) => t("sidebar.projects.dragCancel", { name: nameOf(active.id) }),
		};
	}, [t, projectAliases]);
	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const from = projectPaths.indexOf(String(active.id));
		const to = projectPaths.indexOf(String(over.id));
		if (from < 0 || to < 0) return;
		onReorderProjects?.(moveProjectOrder(projectPaths, from, to));
	};
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragEnd={handleDragEnd}
			accessibility={{
				announcements,
				screenReaderInstructions: { draggable: t("sidebar.projects.dragInstructions") },
			}}
		>
			<SortableContext items={projectPaths} strategy={verticalListSortingStrategy}>
				{groups.map(pg => (
					<ProjectGroupRow
						key={pg.project}
						group={pg}
						isCurrent={pg.project === selectedProject}
						branch={pg.project === selectedProject ? (branchFor?.(pg.project) ?? null) : null}
						alias={projectAliases?.[pg.project]}
						collapsed={collapsedProjects.has(pg.project)}
						onToggleCollapse={onToggleCollapse}
						onSwitchProject={onSwitchProject}
						onNewSessionInProject={onNewSessionInProject}
						onDeleteProjectSessions={onDeleteProjectSessions}
						onOpenTerminal={onOpenTerminal}
						onProjectContextMenu={onProjectContextMenu}
						onProjectSortClick={onProjectSortClick}
						renderProjectMenu={renderProjectMenu}
						renderProjectSessions={renderProjectSessions}
						renderProjectFooter={renderProjectFooter}
					/>
				))}
			</SortableContext>
		</DndContext>
	);
}

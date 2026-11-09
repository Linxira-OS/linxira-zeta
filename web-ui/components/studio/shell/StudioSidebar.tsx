"use client";

/**
 * StudioSidebar — project → workspace → session.
 *
 * One product rule decides this list: a project exists because a directory was
 * registered in `~/.zeta/agent/resume-projects.json` (shared with the terminal
 * resume picker). There is no machine pseudo-project and no install-path group.
 *
 * Every control maps to a gateway call the shell already owns:
 * `+ project` → folder picker → `PUT /api/projects`,
 * `+ session` → a draft tab in the selected workspace.
 */

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type{ StudioProjectSummary, StudioSessionSummary } from "../adapters/types";

interface Props {
	projects: readonly StudioProjectSummary[];
	projectsLoaded: boolean;
	error: string | null;
	selectedProjectKey: string | null;
	selectedWorkspacePath: string | null;
	sessions: readonly StudioSessionSummary[];
	/** IM/bot/relay conversations, listed only in their own group. */
	imSessions: readonly StudioSessionSummary[];
	/** Whether the "IM / Bot" group is shown; off by default. */
	includeIm: boolean;
	onToggleIm(): void;
	activeSessionId: string | null;
	onSelectProject(key: string): void;
	onSelectWorkspace(path: string): void;
	onSelectSession(session: StudioSessionSummary): void;
	onRegisterProject(): void;
	/** Create a branch/worktree under a project; resolves false on failure. */
	onCreateWorkspace(projectPath: string, branch: string): Promise<boolean>;
	onRemoveProject(path: string): void;
	onNewSession(): void;
	onRefresh(): void;
}

export function StudioSidebar({
	projects,
	projectsLoaded,
	error,
	selectedProjectKey,
	selectedWorkspacePath,
	sessions,
	imSessions,
	includeIm,
	onToggleIm,
	activeSessionId,
	onSelectProject,
	onSelectWorkspace,
	onSelectSession,
	onRegisterProject,
	onCreateWorkspace,
	onRemoveProject,
	onNewSession,
	onRefresh,
}: Props) {
	const { t } = useI18n();
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	/** Project whose inline "new workspace" row is open, plus its draft branch. */
	const [creating, setCreating] = useState<{ projectKey: string; branch: string } | null>(null);
	const [creatingBusy, setCreatingBusy] = useState(false);
	const [creatingError, setCreatingError] = useState<string | null>(null);

	const submitWorkspace = async (project: StudioProjectSummary) => {
		const branch = creating?.branch.trim() ?? "";
		if (!branch) return;
		setCreatingBusy(true);
		setCreatingError(null);
		const ok = await onCreateWorkspace(project.path, branch);
		setCreatingBusy(false);
		if (ok) setCreating(null);
		else setCreatingError(t("studio.workspace.createFailed"));
	};

	const sessionsByWorkspace = useMemo(() => {
		const map = new Map<string, StudioSessionSummary[]>();
		for (const session of sessions) {
			const key = session.workspaceKey ?? session.projectKey ?? "";
			const list = map.get(key);
			if (list) list.push(session);
			else map.set(key, [session]);
		}
		return map;
	}, [sessions]);

	const orphanSessions = useMemo(
		() => sessions.filter(session => session.projectKey === null).slice(0, 20),
		[sessions],
	);

	if (!projectsLoaded) {
		return (
			<aside className="sidebar" aria-busy="true">
				<div className="sb-empty">{t("studio.sidebar.loading")}</div>
			</aside>
		);
	}

	return (
		<aside className="sidebar" aria-label={t("studio.sidebar.label")}>
			<div className="sb-head">
				<span className="sb-title">{t("studio.sidebar.projects")}</span>
				<div className="sb-head-actions">
					<button
						type="button"
						className="icon-btn"
						onClick={onRefresh}
						title={t("studio.action.refresh")}
						aria-label={t("studio.action.refresh")}
					>
						<span aria-hidden>⟳</span>
					</button>
					<button
						type="button"
						className={`icon-btn${includeIm ? " is-active" : ""}`}
						onClick={onToggleIm}
						aria-pressed={includeIm}
						title={t("studio.session.showIm")}
						aria-label={t("studio.session.showIm")}
					>
						<span aria-hidden>IM</span>
					</button>
					<button type="button" className="icon-btn" onClick={onRegisterProject} title={t("studio.action.addProject")} aria-label={t("studio.action.addProject")}>
						<span aria-hidden>+</span>
					</button>
				</div>
			</div>

			{error ? (
				<div className="banner red" role="alert">
					{error}
				</div>
			) : null}

			{projects.length === 0 ? (
				<div className="sb-empty">
					<p>{t("studio.sidebar.empty")}</p>
					<button type="button" className="btn btn-primary" onClick={onRegisterProject}>
						{t("studio.action.addProject")}
					</button>
				</div>
			) : null}

			<div className="sb-scroll">
				{projects.map(project => {
					const open = selectedProjectKey === project.key;
					const isCollapsed = collapsed[project.key] === true;
					return (
						<section key={project.key} className={`sb-project${open ? " is-open" : ""}`}>
							<div className="sb-project-row">
								<button
									type="button"
									className="sb-disclosure"
									aria-expanded={!isCollapsed}
									onClick={() => setCollapsed(previous => ({ ...previous, [project.key]: !isCollapsed }))}
									title={isCollapsed ? t("studio.action.expand") : t("studio.action.collapse")}
								>
									<span aria-hidden>{isCollapsed ? "▸" : "▾"}</span>
								</button>
								<button
									type="button"
									className="sb-project-name"
									onClick={() => onSelectProject(project.key)}
									aria-current={open ? "true" : undefined}
									title={project.path}
								>
									{project.displayName}
									{project.pinned ? <span className="sb-pin" aria-hidden>•</span> : null}
								</button>
								<span className="sb-count">{project.counts.conversations}</span>
								{open ? (
									<button
										type="button"
										className="icon-btn"
										onClick={() => {
											setCreating(c => (c?.projectKey === project.key ? null : { projectKey: project.key, branch: "" }));
											setCreatingError(null);
										}}
										title={t("studio.workspace.add")}
										aria-label={t("studio.workspace.add")}
									>
										<span aria-hidden>+</span>
									</button>
								) : null}
								{project.removable ? (
									<button
										type="button"
										className="icon-btn sb-danger"
										onClick={() => onRemoveProject(project.path)}
										title={t("studio.action.removeProject")}
										aria-label={t("studio.action.removeProject")}
									>
										<span aria-hidden>×</span>
									</button>
								) : null}
							</div>

							{creating?.projectKey === project.key ? (
								<form
									className="sb-create"
									onSubmit={event => {
										event.preventDefault();
										void submitWorkspace(project);
									}}
								>
									<input
										className="input"
										autoFocus
										value={creating?.branch ?? ""}
										placeholder={t("studio.workspace.branchPlaceholder")}
										onChange={event => setCreating(c => (c ? { ...c, branch: event.target.value } : c))}
										onKeyDown={event => {
											if (event.key === "Escape") setCreating(null);
										}}
									/>
									<button type="submit" className="btn btn-primary btn-xs" disabled={creatingBusy || !creating?.branch.trim()}>
										{t("studio.workspace.create")}
									</button>
									{creatingError ? <p className="banner red small">{creatingError}</p> : null}
								</form>
							) : null}

							{isCollapsed ? null : (
								<ul className="sb-workspaces">
									{project.workspaces.map(workspace => {
										const workspaceSessions = sessionsByWorkspace.get(workspace.key) ?? [];
										const active = selectedWorkspacePath === workspace.path;
										return (
											<li key={workspace.key} className="sb-workspace">
												<button
													type="button"
													className={`sb-workspace-row${active ? " is-active" : ""}`}
													onClick={() => onSelectWorkspace(workspace.path)}
													title={workspace.path}
												>
													<span className="sb-branch">{workspace.branch ?? workspace.displayName}</span>
													{workspace.isWorktree ? <span className="sb-tag">{t("studio.sidebar.worktree")}</span> : null}
													<span className="sb-count">{workspaceSessions.length}</span>
												</button>
												<ul className="sb-sessions">
													{workspaceSessions.map(session => (
														<li key={session.id}>
															<button
																type="button"
																className={`sb-session${session.id === activeSessionId ? " is-active" : ""}`}
																onClick={() => onSelectSession(session)}
																title={session.title}
															>
																{session.running ? <span className="sb-running" aria-hidden /> : null}
																<span className="sb-session-title">{session.title}</span>
																<span className="sb-session-count">{session.messageCount}</span>
															</button>
														</li>
													))}
												</ul>
												{active ? (
													<button type="button" className="sb-new" onClick={onNewSession}>
														+ {t("studio.action.newSession")}
													</button>
												) : null}
											</li>
										);
									})}
								</ul>
							)}
						</section>
					);
				})}

				{includeIm && imSessions.length > 0 ? (
					<section className="sb-project" aria-label={t("studio.session.imGroup")}>
						<div className="sb-project-row">
							<span className="sb-project-name">{t("studio.session.imGroup")}</span>
							<span className="sb-count">{imSessions.length}</span>
						</div>
						<ul className="sb-sessions">
							{imSessions.map(session => (
								<li key={session.id}>
									<button
										type="button"
										className={`sb-session${session.id === activeSessionId ? " is-active" : ""}`}
										onClick={() => onSelectSession(session)}
										// IM rows never expose the absolute cwd: the alias or
										// channel is the whole location the operator needs.
										title={session.location ?? session.title}
									>
										{session.running ? <span className="sb-running" aria-hidden /> : null}
										<span className="sb-session-title">{session.title}</span>
										{session.location ? <span className="sb-session-location">{session.location}</span> : null}
										<span className="sb-session-count">{session.messageCount}</span>
									</button>
								</li>
							))}
						</ul>
					</section>
				) : null}

				{orphanSessions.length > 0 ? (
					<section className="sb-project">
						<div className="sb-project-row">
							<span className="sb-project-name muted">{t("studio.sidebar.unregistered")}</span>
						</div>
						<ul className="sb-sessions">
							{orphanSessions.map(session => (
								<li key={session.id}>
									<button
										type="button"
										className={`sb-session${session.id === activeSessionId ? " is-active" : ""}`}
										onClick={() => onSelectSession(session)}
										title={session.cwd}
									>
										<span className="sb-session-title">{session.title}</span>
									</button>
								</li>
							))}
						</ul>
					</section>
				) : null}
			</div>
		</aside>
	);
}

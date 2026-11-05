"use client";

/**
 * StudioGitPage — status, stage, commit, branches, worktrees.
 *
 * Reads come from the Next-owned `/api/git/status` and `/api/worktrees`;
 * every write is a gateway mutation from `git-actions.ts` (pi-vcs addon, no
 * `git` process from the web layer). There is deliberately no "diff preview"
 * pane here yet: `/api/git/diff` is per-file and the file viewer owns it, so
 * this page links to it instead of duplicating the renderer.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { StudioPage } from "./StudioPageHost";
import type { GitFileStatus, GitStatusResponse } from "@/lib/git-types";

interface GitLogEntry {
	sha: string;
	subject: string;
}

interface WorktreeInfo {
	path: string;
	branch: string | null;
	isMain: boolean;
}

interface WorktreesResponse {
	projectRoot: string;
	isGit: boolean;
	isTopLevel: boolean;
	worktrees: WorktreeInfo[];
}

type StatusFilter = "all" | "staged" | "unstaged" | "untracked";

const STATUS_LABEL: Record<GitFileStatus["status"], string> = {
	modified: "M",
	added: "A",
	deleted: "D",
	renamed: "R",
	untracked: "U",
	conflict: "C",
};

async function jsonOrThrow<T>(res: Response, what: string): Promise<T> {
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `${what}: HTTP ${res.status}`);
	}
	return (await res.json()) as T;
}

export function StudioGitPage({ cwd, title }: { cwd: string | null; title: string }) {
	const { t } = useI18n();
	const [status, setStatus] = useState<GitStatusResponse | null>(null);
	const [log, setLog] = useState<GitLogEntry[]>([]);
	const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
	const [branches, setBranches] = useState<Array<{ name: string; current: boolean }>>([]);
	const [filter, setFilter] = useState<StatusFilter>("all");
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!cwd) return;
		try {
			const [statusBody, logBody, worktreeBody, branchBody] = await Promise.all([
				fetch(`/api/git/status?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" }).then(res =>
					jsonOrThrow<GitStatusResponse>(res, "git status"),
				),
				fetch(`/api/git/log?cwd=${encodeURIComponent(cwd)}&limit=20`, { cache: "no-store" }).then(res =>
					jsonOrThrow<{ commits?: GitLogEntry[] }>(res, "git log").catch(() => ({ commits: [] })),
				),
				fetch(`/api/worktrees?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" }).then(res =>
					jsonOrThrow<WorktreesResponse>(res, "worktrees").catch(() => null),
				),
				fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" }).then(res =>
					jsonOrThrow<{ branches?: Array<{ name: string; current: boolean }> }>(res, "branches").catch(
						() => ({ branches: [] as Array<{ name: string; current: boolean }> }),
					),
				),
			]);
			setStatus(statusBody);
			setLog(logBody.commits ?? []);
			setWorktrees(worktreeBody?.worktrees ?? []);
			setBranches(branchBody.branches ?? []);
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}, [cwd]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const visibleFiles = useMemo(() => {
		const files = status?.files ?? [];
		if (filter === "all") return files;
		if (filter === "staged") return files.filter(file => file.indexStatus && file.indexStatus !== " " && file.indexStatus !== "?");
		if (filter === "untracked") return files.filter(file => file.status === "untracked");
		return files.filter(file => file.worktreeStatus && file.worktreeStatus !== " " && file.status !== "untracked");
	}, [status, filter]);

	const mutate = useCallback(
		async (label: string, path: string, body: Record<string, unknown>) => {
			if (!cwd) return null;
			setBusy(label);
			setError(null);
			setNotice(null);
			try {
				const result = await fetch(path, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ cwd, ...body }),
				}).then(res => jsonOrThrow<Record<string, unknown>>(res, label));
				await refresh();
				return result;
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
				return null;
			} finally {
				setBusy(null);
			}
		},
		[cwd, refresh],
	);

	const stage = (paths: string[]) => void mutate("stage", "/api/git/stage", { paths });
	const commit = async () => {
		if (!message.trim()) return;
		const result = await mutate("commit", "/api/git/commit", { message });
		if (result) {
			setMessage("");
			setNotice(t("studio.git.committed"));
		}
	};
	const push = async () => {
		const result = await mutate("push", "/api/git/push", {});
		if (result) setNotice(t("studio.git.pushed"));
	};
	const pull = async () => {
		const result = await mutate("pull", "/api/git/pull", {});
		if (result) setNotice(result.fastForward ? t("studio.git.pulled") : t("studio.git.upToDate"));
	};

	if (!cwd) {
		return (
			<StudioPage title={title}>
				<div className="empty">
					<p className="muted">{t("studio.git.needsWorkspace")}</p>
				</div>
			</StudioPage>
		);
	}

	const totals = status ? { additions: status.additions, deletions: status.deletions } : { additions: 0, deletions: 0 };

	return (
		<StudioPage
			title={title}
			subtitle={cwd}
			actions={
				<>
					<button type="button" className="btn btn-ghost" onClick={() => void refresh()} disabled={busy !== null}>
						{t("studio.action.refresh")}
					</button>
					<button type="button" className="btn btn-ghost" onClick={() => void pull()} disabled={busy !== null}>
						{t("studio.git.pull")}
					</button>
					<button type="button" className="btn btn-ghost" onClick={() => void push()} disabled={busy !== null}>
						{t("studio.git.push")}
					</button>
				</>
			}
		>
			{error ? (
				<div className="banner red" role="alert">
					{error}
				</div>
			) : null}
			{notice ? (
				<div className="banner green" role="status">
					{notice}
				</div>
			) : null}

			<div className="git-grid">
				<section className="card">
					<header className="card-head">
						<h2 className="card-title">{t("studio.git.changes")}</h2>
						<span className="muted">
							+{totals.additions} −{totals.deletions}
						</span>
					</header>
					<div className="seg">
						{(["all", "staged", "unstaged", "untracked"] as StatusFilter[]).map(entry => (
							<button
								key={entry}
								type="button"
								className={`seg-item${filter === entry ? " is-active" : ""}`}
								onClick={() => setFilter(entry)}
							>
								{t(`studio.git.filter.${entry}`)}
							</button>
						))}
					</div>
					{visibleFiles.length === 0 ? (
						<p className="muted small">{t("studio.git.noChanges")}</p>
					) : (
						<ul className="git-files">
							{visibleFiles.map(file => (
								<li key={file.filePath} className="git-file">
									<span className={`git-code git-${file.status}`}>{STATUS_LABEL[file.status]}</span>
									<span className="git-path" title={file.filePath}>
										{file.filePath}
									</span>
									<button type="button" className="btn btn-ghost btn-xs" onClick={() => stage([file.filePath])}>
										{t("studio.git.stage")}
									</button>
								</li>
							))}
						</ul>
					)}
					<div className="git-actions">
						<button
							type="button"
							className="btn btn-ghost"
							onClick={() => void mutate("stage", "/api/git/stage", { all: true })}
							disabled={busy !== null || visibleFiles.length === 0}
						>
							{t("studio.git.stageAll")}
						</button>
					</div>
				</section>

				<section className="card">
					<header className="card-head">
						<h2 className="card-title">{t("studio.git.commit")}</h2>
					</header>
					<textarea
						className="input git-message"
						rows={4}
						value={message}
						placeholder={t("studio.git.messagePlaceholder")}
						onChange={event => setMessage(event.target.value)}
					/>
					<div className="git-actions">
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => void commit()}
							disabled={busy !== null || message.trim().length === 0}
						>
							{t("studio.git.commitAction")}
						</button>
					</div>
					<header className="card-head">
						<h2 className="card-title">{t("studio.git.branches")}</h2>
					</header>
					<ul className="git-branches">
						{branches.map(branch => (
							<li key={branch.name} className="git-branch">
								<span className={branch.current ? "is-current" : undefined}>
									{branch.name}
									{branch.current ? <span className="muted"> · {t("studio.git.current")}</span> : null}
								</span>
								{!branch.current ? (
									<button
										type="button"
										className="btn btn-ghost btn-xs"
										onClick={() => void mutate("checkout", "/api/git/checkout", { branch: branch.name })}
										disabled={busy !== null}
									>
										{t("studio.git.checkout")}
									</button>
								) : null}
							</li>
						))}
					</ul>
				</section>

				<section className="card">
					<header className="card-head">
						<h2 className="card-title">{t("studio.git.history")}</h2>
					</header>
					{log.length === 0 ? (
						<p className="muted small">{t("studio.git.noHistory")}</p>
					) : (
						<ul className="git-log">
							{log.map(entry => (
								<li key={entry.sha} className="git-log-row">
									<code className="git-sha">{entry.sha}</code>
									<span className="git-subject" title={entry.subject}>
										{entry.subject}
									</span>
								</li>
							))}
						</ul>
					)}
					<header className="card-head">
						<h2 className="card-title">{t("studio.git.worktrees")}</h2>
					</header>
					<ul className="git-worktrees">
						{worktrees.map(worktree => (
							<li key={worktree.path} className="git-worktree">
								<span className={worktree.isMain ? "is-current" : undefined}>
									{worktree.branch ?? worktree.path}
								</span>
								<span className="muted small" title={worktree.path}>
									{worktree.path}
								</span>
							</li>
						))}
					</ul>
				</section>
			</div>
		</StudioPage>
	);
}

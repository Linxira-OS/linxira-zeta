import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  CommandRequestId,
  GitBranchListReadModel,
  GitCommitChangesReadModel,
  GitCommitDiffReadModel,
  GitDiffReadModel,
  GitDiffTarget,
  GitLogListReadModel,
  GitOperation,
  GitOperationResult,
  GitRepositoryReadModel,
  GitWorktreeListReadModel,
  StudioClient,
  WorkspaceId,
} from "@/lib/studio-protocol/contract";

import { hostErrorMessage, waitReceipt } from "@/components/studio/primitives/hostError";
import { Icon } from "@/components/studio/primitives/icons";
import { useI18n } from "@/components/studio/i18n";
import { useExecutionTarget } from "./execution-target";

import { GitCommitGraph } from "./GitCommitGraph";
import { GitDiffResizer, useGitDiffHeight } from "./GitDiffResizer";
import { GitMoreActionsMenu } from "./GitMoreActionsMenu";
import { GitPanelSplit } from "./GitPanelSplit";
import { GitTip } from "./GitTip";
import { readGitGraphLayout, writeGitGraphLayout } from "./gitGraphMemory";

type RepositoryHook = {
  readonly repository?: GitRepositoryReadModel;
  readonly loading: boolean;
  readonly error?: string;
  readonly refresh: () => Promise<void>;
};

export function useGitRepository(client: StudioClient, workspaceId?: WorkspaceId): RepositoryHook {
  const { syncRevision } = useExecutionTarget();
  const [repository, setRepository] = useState<GitRepositoryReadModel | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    if (workspaceId === undefined) {
      setRepository(undefined);
      setError(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const value = await client.query("git.repository.get", { workspaceId });
      if (requestGeneration !== generation.current) return;
      setRepository(value);
      setError(undefined);
    } catch (cause) {
      if (requestGeneration !== generation.current) return;
      setRepository(undefined);
      setError(hostErrorMessage(cause, "无法读取 Git 仓库状态"));
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [client, workspaceId]);

  useEffect(() => {
    void refresh();
    const unsubscribe = client.subscribe({ scope: "all" }, (event) => {
      if (event.kind === "git.repository.changed" && event.repository.workspaceId === workspaceId) void refresh();
    });
    return () => {
      generation.current += 1;
      unsubscribe();
    };
  }, [client, refresh, workspaceId, syncRevision]);

  return { ...(repository === undefined ? {} : { repository }), loading, ...(error === undefined ? {} : { error }), refresh };
}

function ask(label: string, initial = ""): string | undefined {
  const value = window.prompt(label, initial)?.trim();
  return value ? value : undefined;
}

function statusLabel(index: string, worktree: string, t: (k: string) => string): string {
  if (index === "conflicted" || worktree === "conflicted") return t("git.conflict");
  if (index !== "unmodified" && worktree !== "unmodified") return t("git.stagedAndWorking");
  if (index !== "unmodified") return t("git.staged");
  return worktree === "untracked" ? t("git.untracked") : t("git.workingTree");
}

function patchLines(patch: string) {
  return patch.split(/\r?\n/u).map((line, index) => {
    const tone = line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : "";
    return <div key={`${index}-${line}`} className={`dl ${tone}`}><span className="dm">{tone === "add" ? "+" : tone === "del" ? "−" : " "}</span><span className="lc">{line}</span></div>;
  });
}

export function GitStatusPanel({ client, workspaceId, focusPath }: { readonly client: StudioClient; readonly workspaceId?: WorkspaceId; readonly focusPath?: string }) {
  const { t } = useI18n();
  const { syncRevision } = useExecutionTarget();
  const repositoryHook = useGitRepository(client, workspaceId);
  const repository = repositoryHook.repository;
  const [branches, setBranches] = useState<GitBranchListReadModel>();
  const [worktrees, setWorktrees] = useState<GitWorktreeListReadModel>();
  const [selected, setSelected] = useState<{ path: string; target: GitDiffTarget }>();
  const [diff, setDiff] = useState<GitDiffReadModel>();
  const [commitMessage, setCommitMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [activeRequest, setActiveRequest] = useState<{ domain: "git"; requestId: CommandRequestId }>();
  const [graphLayout, setGraphLayout] = useState(readGitGraphLayout);
  const [diffHeight, setDiffHeight] = useGitDiffHeight();
  const [log, setLog] = useState<GitLogListReadModel>();
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string>();
  const [logLimit, setLogLimit] = useState(80);
  const [selectedCommit, setSelectedCommit] = useState<string>();
  const commitChanges: GitCommitChangesReadModel | undefined = undefined;
  const commitDiff: GitCommitDiffReadModel | undefined = undefined;
  const changesLoading = false;
  const [selectedCommitPath, setSelectedCommitPath] = useState<string>();
  const detailsGeneration = useRef(0);
  const logGeneration = useRef(0);

  const refreshDetails = useCallback(async () => {
    const requestGeneration = ++detailsGeneration.current;
    if (workspaceId === undefined) {
      setBranches(undefined);
      setWorktrees(undefined);
      return;
    }
    const results = await Promise.allSettled([
      client.query("git.branches.list", { workspaceId }),
      client.query("git.worktrees.list", { workspaceId }),
    ]);
    if (requestGeneration !== detailsGeneration.current) return;
    if (results[0].status === "fulfilled") setBranches(results[0].value);
    else setBranches(undefined);
    if (results[1].status === "fulfilled") setWorktrees(results[1].value);
    else setWorktrees(undefined);
  }, [client, workspaceId]);

  const persistGraphLayout = useCallback((next: typeof graphLayout) => {
    setGraphLayout(next);
    writeGitGraphLayout(next);
  }, []);

  const refreshLog = useCallback(async () => {
    const requestGeneration = ++logGeneration.current;
    if (!graphLayout.open || workspaceId === undefined) {
      setLog(undefined);
      setLogError(undefined);
      setLogLoading(false);
      return;
    }
    setLogLoading(true);
    try {
      const value = await client.query("git.log.list", { workspaceId, limit: logLimit });
      if (requestGeneration !== logGeneration.current) return;
      setLog(value);
      setLogError(undefined);
    } catch (cause) {
      if (requestGeneration !== logGeneration.current) return;
      setLog(undefined);
      setLogError(hostErrorMessage(cause, "无法读取提交历史"));
    } finally {
      if (requestGeneration === logGeneration.current) setLogLoading(false);
    }
  }, [client, graphLayout.open, logLimit, workspaceId]);

  const refreshRepository = repositoryHook.refresh;
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshRepository(), refreshDetails(), refreshLog()]);
  }, [refreshDetails, refreshLog, refreshRepository]);

  useEffect(() => {
    void refreshDetails();
    return () => { detailsGeneration.current += 1; };
  }, [refreshDetails, syncRevision]);

  useEffect(() => {
    void refreshLog();
    if (!graphLayout.open || workspaceId === undefined) return;
    const unsubscribe = client.subscribe({ scope: "all" }, (event) => {
      if (event.kind === "git.repository.changed" && event.repository.workspaceId === workspaceId) void refreshLog();
    });
    return () => {
      logGeneration.current += 1;
      unsubscribe();
    };
  }, [client, graphLayout.open, refreshLog, workspaceId, syncRevision]);

  useEffect(() => {
    if (workspaceId === undefined || selected === undefined) {
      setDiff(undefined);
      return;
    }
    let cancelled = false;
    setDiff(undefined);
    void client.query("git.diff.get", { workspaceId, path: selected.path, target: selected.target }).then(
      (value) => { if (!cancelled) setDiff(value); },
      (cause) => { if (!cancelled) { setDiff(undefined); setNotice(hostErrorMessage(cause, "无法读取 Diff")); } },
    );
    return () => { cancelled = true; };
  }, [client, selected, workspaceId, syncRevision]);

  const execute = useCallback(async (operation: GitOperation) => {
    if (operation.kind !== "clone" && workspaceId === undefined) return false;
    setBusy(true);
    setNotice(undefined);
    try {
      const handle = await client.command("git.execute", {
        ...(workspaceId === undefined ? {} : { workspaceId }),
        operation,
      });
      setActiveRequest({ domain: "git", requestId: handle.requestId });
      const result = await waitReceipt<GitOperationResult>(client, handle.requestId, 5 * 60_000);
      setNotice(result.message);
      await refreshAll();
      return true;
    } catch (cause) {
      setNotice(hostErrorMessage(cause, "Git 操作失败"));
      return false;
    } finally {
      setActiveRequest(undefined);
      setBusy(false);
    }
  }, [client, refreshAll, workspaceId]);

  const cancelActive = useCallback(async () => {
    if (activeRequest === undefined) return;
    try {
      const handle = await client.command("git.execute", {
        operation: { kind: "cancel", requestId: activeRequest.requestId },
      });
      await waitReceipt(client, handle.requestId, 30_000);
      setNotice("已请求取消操作");
    } catch (cause) {
      setNotice(hostErrorMessage(cause, "取消操作失败"));
    }
  }, [activeRequest, client]);

  /**
   * Branch actions only: `/api/git/{branch,checkout}` are the two write routes
   * the gateway serves beyond stage/unstage/commit/fetch/pull/push, which the
   * toolbar buttons already cover.
   */
  const runAdvanced = (value: string) => {
    if (!repository) return;
    switch (value) {
      case "branch.create": { const name = ask("新分支名称"); if (name) void execute({ kind: "branch.create", name, checkout: true }); break; }
      case "branch.switch": { const name = ask("切换到分支", branches?.branches.find((item) => !item.remote && !item.current)?.name); if (name) void execute({ kind: "branch.switch", name }); break; }
      default: setNotice(`该操作没有 Zeta 网关端点：${value}`);
    }
  };

  const staged = useMemo(() => repository?.changes.filter((change) => change.index !== "unmodified") ?? [], [repository]);
  const working = useMemo(() => repository?.changes.filter((change) => change.worktree !== "unmodified") ?? [], [repository]);

  useEffect(() => {
    if (focusPath === undefined || repository === undefined) return;
    const normalized = focusPath.replaceAll("\\", "/");
    const matches = (path: string) => {
      const value = path.replaceAll("\\", "/");
      return value === normalized || value.endsWith(`/${normalized}`) || normalized.endsWith(`/${value}`);
    };
    const workingHit = repository.changes.find((change) => change.worktree !== "unmodified" && matches(change.path));
    const stagedHit = repository.changes.find((change) => change.index !== "unmodified" && matches(change.path));
    const hit = workingHit ?? stagedHit;
    if (hit === undefined) return;
    setSelected({ path: hit.path, target: workingHit !== undefined ? "working" : "staged" });
  }, [focusPath, repository]);

  const graphPanel = (
    <GitCommitGraph
      {...(log === undefined ? {} : { model: log })}
      loading={logLoading}
      {...(logError === undefined ? {} : { error: logError })}
      busy={busy}
      {...(selectedCommit === undefined ? {} : { selectedOid: selectedCommit })}
      {...(commitChanges === undefined ? {} : { changes: commitChanges })}
      changesLoading={changesLoading}
      {...(selectedCommitPath === undefined ? {} : { selectedPath: selectedCommitPath })}
      {...(commitDiff === undefined ? {} : { diff: commitDiff })}
      onRefresh={() => void refreshLog()}
      onSelectCommit={setSelectedCommit}
      onSelectFile={setSelectedCommitPath}
      onLoadMore={() => setLogLimit((value) => Math.min(200, value + 80))}
      onCherryPick={(oid) => void execute({ kind: "cherry-pick", ref: oid })}
      onRevert={(oid) => void execute({ kind: "revert", ref: oid })}
      onCheckout={(oid) => void execute({ kind: "checkout", ref: oid })}
      onCreateBranch={(oid, name) => void execute({ kind: "branch.create", name, startPoint: oid, checkout: true })}
    />
  );
  const wrap = (top: ReactNode) => (
    <GitPanelSplit
      top={top}
      graphOpen={graphLayout.open}
      splitRatio={graphLayout.splitRatio}
      onToggle={() => persistGraphLayout({ ...graphLayout, open: !graphLayout.open })}
      onResizeSplit={(ratio) => persistGraphLayout({ ...graphLayout, splitRatio: ratio })}
      {...(repository && (repository.ahead || repository.behind) ? { meta: <span className="chip gray xs">↑{repository.ahead} ↓{repository.behind}</span> } : {})}
    >
      {graphPanel}
    </GitPanelSplit>
  );

  if (workspaceId === undefined) return wrap(<div className="empty" style={{ padding: 18 }}>请先选择项目</div>);
  if (repositoryHook.loading && repository === undefined) return wrap(<div className="empty" style={{ padding: 18 }}>正在读取 Git 状态…</div>);
  if (repositoryHook.error) return wrap(<div className="empty" style={{ padding: 18 }}><p>{repositoryHook.error}</p><button className="btn small outline" onClick={() => void repositoryHook.refresh()}>重试</button></div>);
  if (!repository?.isRepository) return wrap(<div className="empty" style={{ padding: 18 }}><p>{repository?.unavailableReason ?? "当前项目还不是 Git 仓库"}</p><button className="btn small primary" disabled={busy} onClick={() => void execute({ kind: "init" })}>初始化仓库</button></div>);

  const rows = (title: string, changes: typeof staged, target: GitDiffTarget) => (
    <div className="ch-group">
      <div className="ch-group-title">
        {title}
        <span className="ch-count">{changes.length}</span>
        <span className="spacer" />
        {target === "working" ? (
          <GitTip text={working.length === 0 ? t("git.noChanges") : t("git.stageAll")}>
            <button type="button" className="icon-btn small" aria-label={t("git.stageAll")} disabled={busy || working.length === 0} onClick={() => void execute({ kind: "stage", paths: working.map((change) => change.path) })}>
              <Icon name="plus" extra="sm" />
            </button>
          </GitTip>
        ) : (
          <GitTip text={staged.length === 0 ? t("git.noChanges") : t("git.unstageAll")}>
            <button type="button" className="icon-btn small" aria-label={t("git.unstageAll")} disabled={busy || staged.length === 0} onClick={() => void execute({ kind: "unstage", paths: staged.map((change) => change.path) })}>
              <Icon name="minus" extra="sm" />
            </button>
          </GitTip>
        )}
      </div>
      {changes.map((change) => (
        <div className={`git-change-line${selected?.path === change.path && selected.target === target ? " selected" : ""}`} key={`${target}-${change.path}`}>
          <button className="ch-row" aria-label={`查看 ${change.path} 的 ${target === "staged" ? "暂存" : "工作区"} Diff`} onClick={() => setSelected({ path: change.path, target })}>
            <span className="ch-file ellipsis">{change.path}</span><span className="ch-note">{statusLabel(change.index, change.worktree, t)}</span>
          </button>
          <GitTip text={target === "staged" ? t("git.unstage") : t("git.stage")}>
            <button type="button" className="icon-btn small" aria-label={target === "staged" ? t("git.unstage") : t("git.stage")} disabled={busy} onClick={() => void execute({ kind: target === "staged" ? "unstage" : "stage", paths: [change.path] })}><Icon name={target === "staged" ? "minus" : "plus"} extra="sm" /></button>
          </GitTip>
          {target === "working" ? (
            <GitTip text={t("git.discard")}>
              <button type="button" className="icon-btn small danger" aria-label={t("git.discardChanges")} disabled={busy || !repository.revision} onClick={() => { if (repository.revision && window.confirm(t("git.confirmDiscard", { path: change.path }))) void execute({ kind: "discard", paths: [change.path], expectedRevision: repository.revision }); }}><Icon name="trash" extra="sm" /></button>
            </GitTip>
          ) : null}
        </div>
      ))}
    </div>
  );

  return wrap(<>
    <div className="ch-toolbar git-toolbar">
      <GitTip text={t("common.refresh")}>
        <button type="button" className="icon-btn small" aria-label={t("common.refresh")} disabled={busy} onClick={() => void refreshAll()}><Icon name="refresh" extra="sm" /></button>
      </GitTip>
      <span className="git-branch-label ellipsis"><Icon name="branch" extra="sm" />{repository.branch ?? "detached HEAD"}</span>
      {repository.ahead || repository.behind ? <span className="chip gray xs">↑{repository.ahead} ↓{repository.behind}</span> : null}
      <span className="spacer" />
      {activeRequest ? <button className="btn small danger" onClick={() => void cancelActive()}>{t("common.cancel")}</button> : null}
      <button className="btn small outline" disabled={busy} onClick={() => void execute({ kind: "fetch", prune: true })}>Fetch</button>
      <button className="btn small outline" disabled={busy} onClick={() => void execute({ kind: "pull", strategy: "ff-only" })}>Pull</button>
      <button className="btn small outline" disabled={busy} onClick={() => void execute({ kind: "push" })}>Push</button>
    </div>
    {notice ? <div className="git-notice" role="status">{notice}</div> : null}
    {repository.operation ? <div className="git-operation"><b>{repository.operation}</b> {t("git.inProgress")} <span className="spacer" /><button className="btn small outline" disabled={busy} onClick={() => void execute({ kind: "continue", operation: repository.operation! })}>{t("git.continue")}</button><button className="btn small danger" disabled={busy} onClick={() => void execute({ kind: "abort", operation: repository.operation! })}>{t("git.abort")}</button></div> : null}
    <div className="git-actions">
      <GitMoreActionsMenu disabled={busy} onPick={runAdvanced} />
      <span className="tiny muted">{branches ? branches.branches.length : "—"} branches · {worktrees ? worktrees.worktrees.length : "—"} worktrees · {repository.stashCount} stash</span>
    </div>
    <div className="ch-list">
      {rows(t("git.staged"), staged, "staged")}
      {rows(t("git.workingTree"), working, "working")}
      {repository.changes.length === 0 ? <div className="empty" style={{ padding: 18 }}>{t("git.workingTreeClean")}</div> : null}
    </div>
    <div className="git-commit-box">
      <textarea value={commitMessage} placeholder="Commit message" rows={1} onChange={(event) => setCommitMessage(event.target.value)} />
      <button className="btn small primary" disabled={busy || staged.length === 0 || !commitMessage.trim()} onClick={() => { const message = commitMessage.trim(); if (!message) return; void execute({ kind: "commit", message }).then((completed) => { if (completed) setCommitMessage(""); }); }}>Commit</button>
    </div>
    {selected ? (
      <>
        <GitDiffResizer height={diffHeight} onHeight={setDiffHeight} />
        <div className="ch-diff-slot git-diff-slot" style={{ height: diffHeight }}>
          <div className="diff-toolbar"><Icon name="file-code" extra="sm" /><span className="mono small ellipsis">{selected.path}</span><span className="chip gray xs">{selected.target === "staged" ? "staged" : "working"}</span>{diff?.truncated ? <span className="chip gray xs">{t("common.truncated")}</span> : null}</div>
          <div className="diff-scroll">{diff ? (diff.binary ? <div className="empty">Binary diff</div> : diff.patch.length === 0 && repository.changes.some((change) => change.path === selected.path && change.worktree === "untracked") ? <div className="empty">{t("git.untrackedNoDiff")}</div> : patchLines(diff.patch)) : <div className="empty">{t("git.readingDiff")}</div>}</div>
        </div>
      </>
    ) : null}
  </>);
}

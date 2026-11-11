/**
 * Studio Team workspace: onboarding, overview, tasks, rooms, and the real
 * relationship graph. This is the page the **Team** navigation route opens; its
 * Graph tab embeds the existing relationship graph. Every action names a
 * registered `teamId`; the Host resolves the root. Only a brand-new bootstrap
 * carries a root path, because a Team has to be created somewhere.
 *
 * Local single-user collaboration: there are no accounts, passwords, tokens,
 * or auth checks here. A member id is a Team row, not a credential.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  StudioClient,
  TeamBootstrapPlanResult,
  TeamBootstrapRunSummary,
  TeamDoctorSummary,
  TeamRoomKind,
  TeamRoomView,
  TeamSummary,
  TeamTaskStatus,
  TeamTaskView,
  TeamWorkspaceReadModel,
  TeamWorkspaceTask,
} from "@linxiraos/studio-contract";
import { TeamPage } from "./TeamPage";
import { TeamImChatPane, type ImChatBindingControl } from "./TeamImChatPane";
import { loadImChatCandidates, type ImChatCandidate } from "./teamImChatGateway";
import { hostErrorMessage, waitReceipt } from "./hostError";
import { useI18n } from "./i18n";
import {
  bootstrapProgress,
  lastRoomSeq,
  memberOptions,
  mergeRoomEvents,
  onboardingInput,
  teamLeaseInfo,
  teamTaskActions,
  type OnboardingDraft,
  type TeamTaskAction,
} from "./teamWorkspaceModel";
import "./TeamWorkspacePage.css";

type Tab = "overview" | "onboarding" | "tasks" | "rooms" | "graph" | "im";

const TASK_STATUSES: ReadonlyArray<TeamTaskStatus> = ["pending", "claimed", "review", "done", "cancelled"];

const COPY = {
  en: {
    title: "Team",
    subtitle: "Onboard a Team, dispatch work, and read real room events. Local single-user; no accounts.",
    loading: "Reading the Team database…",
    noTeams: "No Team is registered in this database. Create one with a dry-run plan.",
    refresh: "Refresh",
    doctor: "Doctor",
    healthy: "healthy",
    errors: "errors",
    warnings: "warnings",
    overview: "Overview",
    onboarding: "Onboarding",
    tasks: "Tasks",
    rooms: "Rooms",
    graph: "Graph",
    im: "IM chat",
    imBoundary:
      "Reads the IM backend selector and the canonical gateway transcript; no second transcript store. Local single-user boundary.",
    team: "Team",
    pms: "PMs",
    engineers: "Engineers",
    repos: "Repos",
    roomsCount: "Rooms",
    tasksCount: "Tasks",
    runs: "Bootstrap runs",
    plan: "Plan (dry run)",
    apply: "Apply",
    resume: "Resume",
    rollback: "Rollback",
    name: "Name",
    root: "Root path",
    displayName: "Display name",
    pmList: "PMs (comma or newline)",
    repoList: "Repos (name=clone:URL | name=link:path)",
    engineerList: "Engineers (name:pm:repo[:normal|vibe])",
    roomList: "Rooms (name=shared | name=pm:PM | name)",
    steps: "Steps",
    preflight: "Preflight",
    addPm: "Add PM",
    bindRepo: "Bind repo",
    addEngineer: "Add engineer",
    pm: "PM",
    repo: "Repo",
    engineer: "Engineer",
    execution: "Execution",
    taskKey: "Task key",
    taskTitle: "Title",
    body: "Body",
    assignee: "Assignee",
    createTask: "Create task",
    status: "Status",
    lease: "Lease",
    owner: "Owner",
    none: "none",
    live: "live",
    expired: "expired",
    claim: "Claim",
    renew: "Renew",
    release: "Release",
    submit: "Submit",
    approve: "Approve",
    reject: "Reject",
    cancel: "Cancel",
    assign: "Assign",
    comment: "Comment",
    leaseSeconds: "Lease seconds",
    reason: "Reason",
    events: "Events",
    createRoom: "Create room",
    kind: "Kind",
    members: "Members",
    addMember: "Add member",
    remove: "Remove",
    setKind: "Set kind",
    post: "Post",
    sender: "Sender",
    subscribe: "Subscribe",
    ack: "Ack read",
    acceptedThrough: "accepted",
    readThrough: "read",
    all: "all",
    emptyTasks: "No tasks in this Team.",
    emptyRooms: "No rooms. Create one with a kind and members.",
    emptyEvents: "No room events yet.",
    offlineNote: "Offline is a graph fact, not a task status. A task lease is the queue's only liveness signal.",
    error: "Team operation failed",
  },
  zh: {
    title: "团队",
    subtitle: "引导创建团队、派发任务、读取真实房间事件。本地单用户，无账号体系。",
    loading: "正在读取 Team 数据库…",
    noTeams: "该数据库还没有登记 Team。先用 dry-run 计划创建一个。",
    refresh: "刷新",
    doctor: "体检",
    healthy: "健康",
    errors: "错误",
    warnings: "警告",
    overview: "概览",
    onboarding: "初始化",
    tasks: "任务",
    rooms: "房间",
    graph: "关系图",
    im: "IM 聊天",
    imBoundary: "读取 IM 后端选择器与 canonical 网关 transcript，不新建 transcript store；本地单用户边界。",
    team: "团队",
    pms: "PM",
    engineers: "工程师",
    repos: "仓库",
    roomsCount: "房间",
    tasksCount: "任务",
    runs: "Bootstrap 运行",
    plan: "生成计划（dry run）",
    apply: "执行",
    resume: "续跑",
    rollback: "回滚",
    name: "名称",
    root: "根路径",
    displayName: "显示名",
    pmList: "PM（逗号或换行）",
    repoList: "仓库（name=clone:URL | name=link:path）",
    engineerList: "工程师（name:pm:repo[:normal|vibe]）",
    roomList: "房间（name=shared | name=pm:PM | name）",
    steps: "步骤",
    preflight: "预检",
    addPm: "添加 PM",
    bindRepo: "绑定仓库",
    addEngineer: "添加工程师",
    pm: "PM",
    repo: "仓库",
    engineer: "工程师",
    execution: "执行模式",
    taskKey: "任务键",
    taskTitle: "标题",
    body: "内容",
    assignee: "负责人",
    createTask: "创建任务",
    status: "状态",
    lease: "租约",
    owner: "持有者",
    none: "无",
    live: "有效",
    expired: "过期",
    claim: "认领",
    renew: "续租",
    release: "释放",
    submit: "提交",
    approve: "通过",
    reject: "打回",
    cancel: "取消",
    assign: "指派",
    comment: "评论",
    leaseSeconds: "租约秒数",
    reason: "原因",
    events: "事件",
    createRoom: "创建房间",
    kind: "类型",
    members: "成员",
    addMember: "添加成员",
    remove: "移除",
    setKind: "修改类型",
    post: "发送",
    sender: "发送者",
    subscribe: "订阅",
    ack: "确认已读",
    acceptedThrough: "已送达",
    readThrough: "已读",
    all: "全部",
    emptyTasks: "该 Team 还没有任务。",
    emptyRooms: "还没有房间。选择类型和成员创建一个。",
    emptyEvents: "还没有房间事件。",
    offlineNote: "离线是关系图事实，不是任务状态；任务租约是队列唯一的存活信号。",
    error: "Team 操作失败",
  },
} as const;

type Copy = { [Key in keyof (typeof COPY)["en"]]: string };

function formatTime(seconds: number, locale: string): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString(locale);
}

function formatLease(task: TeamWorkspaceTask, locale: string): string {
  const info = teamLeaseInfo(task, Math.floor(Date.now() / 1000));
  if (info.state === "none") return "—";
  return `${info.state} · ${formatTime(task.leaseExpiresAt ?? 0, locale)}${
    info.state === "live" ? ` (${info.remainingSeconds}s)` : ""
  }`;
}

function statusClass(status: string): string {
  return `tw-status tw-status-${status}`;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="tw-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select className="tw-select" value={value} onChange={event => onChange(event.target.value)}>
      {children}
    </select>
  );
}

export function TeamWorkspacePage({
  client,
  initialTeamId,
  imChat,
  imBinding,
  imCandidates,
}: {
  client: StudioClient;
  /** Existing Team selected by the host route; omit to use the first registered Team. */
  initialTeamId?: string;
  /**
   * Optional IM Chat subpage override. The default pane reads the IM selector
   * candidates and the canonical gateway transcript; it never copies a
   * transcript.
   */
  imChat?: ReactNode;
  /** IM-owner confirmation actions; absent hides the binding controls. */
  imBinding?: ImChatBindingControl;
  /** Injected IM selector rows; when omitted the pane reads `/api/im/sessions`. */
  imCandidates?: readonly ImChatCandidate[];
}) {
  const { resolvedLanguage } = useI18n();
  const copy: Copy = resolvedLanguage.startsWith("zh") ? COPY.zh : COPY.en;
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamId, setTeamId] = useState(initialTeamId ?? "");
  const [workspace, setWorkspace] = useState<TeamWorkspaceReadModel | undefined>();
  const [doctor, setDoctor] = useState<TeamDoctorSummary | undefined>();
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nonce, setNonce] = useState(0);
  const [fetchedCandidates, setFetchedCandidates] = useState<ImChatCandidate[] | undefined>();
  const [imLoading, setImLoading] = useState(false);
  const [imError, setImError] = useState("");

  const reload = useCallback(() => setNonce(value => value + 1), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await client.query("team.list", {});
        if (!active) return;
        setTeams(result.teams);
        setTeamId(current => current || initialTeamId || result.teams[0]?.id || "");
        if (result.teams.length === 0) setTab("onboarding");
        setError("");
      } catch (cause) {
        if (active) setError(hostErrorMessage(cause, copy.error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client, initialTeamId, nonce, copy.error]);

  useEffect(() => {
    if (!teamId) {
      setWorkspace(undefined);
      setDoctor(undefined);
      return;
    }
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const [read, report] = await Promise.all([
          client.query("team.read", { teamId }),
          client.query("team.doctor", { teamId }),
        ]);
        if (!active) return;
        setWorkspace(read);
        setDoctor(report);
        setError("");
      } catch (cause) {
        if (active) setError(hostErrorMessage(cause, copy.error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client, teamId, nonce, copy.error]);

  // The IM tab reads the IM backend selector only while it is open. An
  // injected list (tests/integration) wins; an absent route is reported, not
  // replaced with a locally derived selector.
  useEffect(() => {
    if (tab !== "im" || imChat !== undefined || imCandidates !== undefined) return;
    let active = true;
    setImLoading(true);
    setImError("");
    void loadImChatCandidates()
      .then(rows => {
        if (active) setFetchedCandidates(rows);
      })
      .catch(cause => {
        if (!active) return;
        setFetchedCandidates(undefined);
        setImError(hostErrorMessage(cause, copy.error));
      })
      .finally(() => {
        if (active) setImLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, imChat, imCandidates, nonce, copy.error]);

  const perform = useCallback(
    async (action: () => Promise<unknown>, ok: string) => {
      setBusy(true);
      setError("");
      try {
        await action();
        setNotice(ok);
        reload();
      } catch (cause) {
        setError(hostErrorMessage(cause, copy.error));
      } finally {
        setBusy(false);
      }
    },
    [copy.error, reload],
  );

  const labelFor = useCallback(
    (agentId: string | null) => {
      if (!agentId) return copy.none;
      const pm = workspace?.pms.find(row => row.id === agentId);
      if (pm) return pm.name;
      const engineer = workspace?.engineers.find(row => row.id === agentId);
      if (engineer) return engineer.name;
      return agentId;
    },
    [workspace, copy.none],
  );

  if (loading && !workspace && teams.length === 0) {
    return (
      <div className="team-workspace-page page-wide">
        <div className="tw-empty">{copy.loading}</div>
      </div>
    );
  }

  const errorCount = doctor?.checks.filter(check => !check.ok && check.level === "error").length ?? 0;
  const warningCount = doctor?.checks.filter(check => !check.ok && check.level === "warning").length ?? 0;

  return (
    <div className="team-workspace-page page-wide">
      <header className="tw-head">
        <div>
          <h2 className="tw-title">
            {copy.title}
            {doctor ? (
              <span className={`tw-doctor ${doctor.ok ? "ok" : "fail"}`}>
                {copy.doctor}: {doctor.ok ? copy.healthy : `${errorCount} ${copy.errors}`}
                {warningCount > 0 ? ` · ${warningCount} ${copy.warnings}` : ""}
              </span>
            ) : null}
          </h2>
          <p className="tw-subtitle">{copy.subtitle}</p>
        </div>
        <div className="tw-head-actions">
          {teams.length > 0 ? (
            <Select value={teamId} onChange={setTeamId}>
              {teams.map(team => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          ) : null}
          <button type="button" className="tw-button" onClick={reload} disabled={busy}>
            {copy.refresh}
          </button>
        </div>
      </header>

      {error ? <div className="tw-banner error">{error}</div> : null}
      {notice ? <div className="tw-banner ok">{notice}</div> : null}

      <nav className="tw-tabs" aria-label="Team">
        {(["overview", "onboarding", "tasks", "rooms", "graph"] as const).map(id => (
          <button
            key={id}
            type="button"
            className={`tw-tab${tab === id ? " active" : ""}`}
            onClick={() => setTab(id)}
          >
            {copy[id === "overview" ? "overview" : id === "onboarding" ? "onboarding" : id]}
          </button>
        ))}
        <button
          type="button"
          className={`tw-tab${tab === "im" ? " active" : ""}`}
          onClick={() => setTab("im")}
        >
          {copy.im}
        </button>
      </nav>

      {tab === "graph" ? (
        <TeamPage client={client} />
      ) : tab === "im" ? (
        <div className="tw-body">
          <p className="tw-hint">{copy.imBoundary}</p>
          {imError ? <div className="tw-banner error">{imError}</div> : null}
          {imChat ?? (
            <TeamImChatPane
              candidates={imCandidates ?? fetchedCandidates}
              loading={imLoading}
              binding={imBinding}
            />
          )}
        </div>
      ) : !workspace ? (
        teams.length === 0 ? (
          <section className="tw-empty">
            <h3>{copy.noTeams}</h3>
            <OnboardingPanel
              client={client}
              copy={copy}
              busy={busy}
              perform={perform}
              onDone={result => {
                if (result?.run.teamId) setTeamId(result.run.teamId);
                reload();
              }}
              runs={[]}
            />
          </section>
        ) : (
          <div className="tw-empty">{copy.loading}</div>
        )
      ) : (
        <div className="tw-body">
          {tab === "overview" ? (
            <OverviewTab
              client={client}
              copy={copy}
              workspace={workspace}
              doctor={doctor}
              busy={busy}
              perform={perform}
            />
          ) : null}
          {tab === "onboarding" ? (
            <OnboardingPanel
              client={client}
              copy={copy}
              busy={busy}
              perform={perform}
              onDone={result => {
                if (result?.run.teamId) setTeamId(result.run.teamId);
                reload();
              }}
              runs={workspace.bootstrapRuns}
            />
          ) : null}
          {tab === "tasks" ? (
            <TasksTab
              client={client}
              copy={copy}
              workspace={workspace}
              busy={busy}
              perform={perform}
              labelFor={labelFor}
            />
          ) : null}
          {tab === "rooms" ? (
            <RoomsTab
              client={client}
              copy={copy}
              workspace={workspace}
              busy={busy}
              perform={perform}
              labelFor={labelFor}
              locale={resolvedLanguage}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="tw-card">
      <span className="tw-card-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OverviewTab({
  client,
  copy,
  workspace,
  doctor,
  busy,
  perform,
}: {
  client: StudioClient;
  copy: Copy;
  workspace: TeamWorkspaceReadModel;
  doctor?: TeamDoctorSummary;
  busy: boolean;
  perform: (action: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [pm, setPm] = useState("");
  const [pmName, setPmName] = useState("");
  const [repo, setRepo] = useState("");
  const [bindPm, setBindPm] = useState("");
  const [engineer, setEngineer] = useState("");
  const [engineerPm, setEngineerPm] = useState("");
  const [engineerRepo, setEngineerRepo] = useState("");
  const [execution, setExecution] = useState<"normal" | "vibe">("normal");

  const pms = workspace.pms;
  const repos = workspace.repos;
  const engineerOptions = memberOptions(pms, workspace.engineers).filter(option => option.role === "engineer");

  return (
    <div className="tw-grid">
      <section className="tw-panel tw-cards">
        <Card label={copy.pms} value={workspace.pms.length} />
        <Card label={copy.engineers} value={workspace.engineers.length} />
        <Card label={copy.repos} value={workspace.repos.length} />
        <Card label={copy.roomsCount} value={workspace.rooms.length} />
        <Card label={copy.tasksCount} value={workspace.tasks.length} />
        <Card label={copy.runs} value={workspace.bootstrapRuns.length} />
      </section>

      <section className="tw-panel">
        <h3>{copy.addPm}</h3>
        <div className="tw-form-row">
          <Field label={copy.pm}>
            <input value={pm} onChange={event => setPm(event.target.value)} placeholder="core" />
          </Field>
          <Field label={copy.displayName}>
            <input value={pmName} onChange={event => setPmName(event.target.value)} placeholder="Core PM" />
          </Field>
          <button
            type="button"
            className="tw-button"
            disabled={busy || !pm.trim()}
            onClick={() =>
              void perform(async () => {
                const handle = await client.command("team.pm.add", {
                  teamId: workspace.team.id,
                  pm: pm.trim(),
                  ...(pmName.trim() ? { displayName: pmName.trim() } : {}),
                });
                await waitReceipt(client, handle.requestId);
              }, `PM ${pm.trim()} added`)
            }
          >
            {copy.addPm}
          </button>
        </div>
      </section>

      <section className="tw-panel">
        <h3>{copy.bindRepo}</h3>
        <div className="tw-form-row">
          <Field label={copy.repo}>
            <input value={repo} onChange={event => setRepo(event.target.value)} placeholder="api" />
          </Field>
          <Field label={copy.pm}>
            <Select value={bindPm} onChange={setBindPm}>
              <option value="">—</option>
              {pms.map(pmRow => (
                <option key={pmRow.id} value={pmRow.name}>
                  {pmRow.name}
                </option>
              ))}
            </Select>
          </Field>
          <button
            type="button"
            className="tw-button"
            disabled={busy || !repo.trim() || !bindPm}
            onClick={() =>
              void perform(async () => {
                const handle = await client.command("team.repo.bind", {
                  teamId: workspace.team.id,
                  repo: repo.trim(),
                  pm: bindPm,
                });
                await waitReceipt(client, handle.requestId);
              }, `Repo ${repo.trim()} bound`)
            }
          >
            {copy.bindRepo}
          </button>
        </div>
        <p className="tw-hint">
          {workspace.repos.map(row => row.name).join(", ") || "—"} · {workspace.bindings.length} bindings
        </p>
      </section>

      <section className="tw-panel">
        <h3>{copy.addEngineer}</h3>
        <div className="tw-form-row">
          <Field label={copy.engineer}>
            <input value={engineer} onChange={event => setEngineer(event.target.value)} placeholder="alice" />
          </Field>
          <Field label={copy.pm}>
            <Select value={engineerPm} onChange={setEngineerPm}>
              <option value="">—</option>
              {pms.map(pmRow => (
                <option key={pmRow.id} value={pmRow.name}>
                  {pmRow.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={copy.repo}>
            <Select value={engineerRepo} onChange={setEngineerRepo}>
              <option value="">—</option>
              {repos.map(repoRow => (
                <option key={repoRow.id} value={repoRow.name}>
                  {repoRow.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={copy.execution}>
            <Select value={execution} onChange={value => setExecution(value as "normal" | "vibe")}>
              <option value="normal">normal</option>
              <option value="vibe">vibe</option>
            </Select>
          </Field>
          <button
            type="button"
            className="tw-button"
            disabled={busy || !engineer.trim() || !engineerPm || !engineerRepo}
            onClick={() =>
              void perform(async () => {
                const handle = await client.command("team.engineer.add", {
                  teamId: workspace.team.id,
                  engineer: engineer.trim(),
                  pm: engineerPm,
                  repo: engineerRepo,
                  execution,
                });
                await waitReceipt(client, handle.requestId);
              }, `Engineer ${engineer.trim()} added`)
            }
          >
            {copy.addEngineer}
          </button>
        </div>
        <p className="tw-hint">
          {workspace.engineers.map(row => `${row.name} (${row.execution})`).join(", ") || "—"}
        </p>
      </section>

      <section className="tw-panel">
        <h3>{copy.doctor}</h3>
        <ul className="tw-checks">
          {(doctor?.checks ?? []).map(check => (
            <li key={check.id} className={check.ok ? "ok" : check.level === "error" ? "fail" : "warn"}>
              <code>{check.id}</code> {check.detail}
            </li>
          ))}
        </ul>
        {!doctor ? <p className="tw-hint">{copy.loading}</p> : null}
      </section>

      <section className="tw-panel">
        <h3>{copy.runs}</h3>
        {workspace.bootstrapRuns.length === 0 ? (
          <p className="tw-hint">{copy.none}</p>
        ) : (
          <ul className="tw-runs">
            {workspace.bootstrapRuns.map(run => {
              const progress = bootstrapProgress(run);
              return (
                <li key={run.runId}>
                  <span className={statusClass(run.status)}>{run.status}</span>
                  <code>{run.runId}</code>
                  <span className="tw-hint">
                    {run.mode} · {progress.done}/{progress.total}
                  </span>
                  {run.error ? <span className="tw-error-text">{run.error}</span> : null}
                  <button
                    type="button"
                    className="tw-button"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const handle = await client.command("team.bootstrap.resume", {
                          runId: run.runId,
                          rollbackOnFailure: false,
                        });
                        await waitReceipt(client, handle.requestId);
                      }, `Run ${run.runId} resumed`)
                    }
                  >
                    {copy.resume}
                  </button>
                  <button
                    type="button"
                    className="tw-button danger"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const handle = await client.command("team.bootstrap.rollback", { runId: run.runId });
                        await waitReceipt(client, handle.requestId);
                      }, `Run ${run.runId} rolled back`)
                    }
                  >
                    {copy.rollback}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="tw-hint">{copy.offlineNote}</p>
      </section>
    </div>
  );
}

function OnboardingPanel({
  client,
  copy,
  busy,
  perform,
  onDone,
  runs,
}: {
  client: StudioClient;
  copy: Copy;
  busy: boolean;
  perform: (action: () => Promise<unknown>, ok: string) => Promise<void>;
  onDone: (result?: { run: TeamBootstrapRunSummary }) => void;
  runs: ReadonlyArray<TeamBootstrapRunSummary>;
}) {
  const [draft, setDraft] = useState<OnboardingDraft>({
    name: "",
    root: "",
    displayName: "",
    pms: "",
    repos: "",
    engineers: "",
    rooms: "",
  });
  const [plan, setPlan] = useState<TeamBootstrapPlanResult | undefined>();
  const [rollbackOnFailure, setRollbackOnFailure] = useState(true);

  const update = (field: keyof OnboardingDraft, value: string) =>
    setDraft(current => ({ ...current, [field]: value }));

  const makePlan = async () => {
    const input = onboardingInput(draft);
    await perform(async () => {
      const result = await client.query("team.bootstrap.plan", input);
      setPlan(result);
      if (!result.preflight.ok) throw new Error(result.preflight.errors.join("\n") || "preflight failed");
    }, "Plan ready");
  };

  const apply = async () => {
    const input = onboardingInput(draft);
    await perform(async () => {
      const handle = await client.command("team.bootstrap.apply", {
        ...input,
        rollbackOnFailure,
      });
      const result = await waitReceipt<{ run: TeamBootstrapRunSummary }>(client, handle.requestId);
      onDone(result);
    }, "Bootstrap applied");
  };

  return (
    <div className="tw-onboarding">
      <section className="tw-panel">
        <h3>{copy.onboarding}</h3>
        <div className="tw-form-grid">
          <Field label={copy.name}>
            <input value={draft.name} onChange={event => update("name", event.target.value)} placeholder="acme" />
          </Field>
          <Field label={copy.root}>
            <input value={draft.root} onChange={event => update("root", event.target.value)} placeholder="/work/acme-team" />
          </Field>
          <Field label={copy.displayName}>
            <input value={draft.displayName} onChange={event => update("displayName", event.target.value)} placeholder="Acme" />
          </Field>
          <Field label={copy.pmList}>
            <textarea value={draft.pms} onChange={event => update("pms", event.target.value)} rows={2} />
          </Field>
          <Field label={copy.repoList}>
            <textarea value={draft.repos} onChange={event => update("repos", event.target.value)} rows={3} />
          </Field>
          <Field label={copy.engineerList}>
            <textarea value={draft.engineers} onChange={event => update("engineers", event.target.value)} rows={3} />
          </Field>
          <Field label={copy.roomList}>
            <textarea value={draft.rooms} onChange={event => update("rooms", event.target.value)} rows={2} />
          </Field>
        </div>
        <label className="tw-check">
          <input
            type="checkbox"
            checked={rollbackOnFailure}
            onChange={event => setRollbackOnFailure(event.target.checked)}
          />
          rollbackOnFailure
        </label>
        <div className="tw-form-row">
          <button type="button" className="tw-button" disabled={busy} onClick={() => void makePlan()}>
            {copy.plan}
          </button>
          <button type="button" className="tw-button primary" disabled={busy || !plan} onClick={() => void apply()}>
            {copy.apply}
          </button>
        </div>
        <p className="tw-hint">
          Root is the only path this surface accepts. Existing Team actions use `teamId`; the Host resolves the root.
        </p>
      </section>

      {plan ? (
        <section className="tw-panel">
          <h3>{copy.preflight}</h3>
          <p className={plan.preflight.ok ? "tw-ok" : "tw-error-text"}>
            {plan.preflight.ok ? copy.healthy : plan.preflight.errors.join(" · ")}
          </p>
          <ul className="tw-checks">
            {plan.preflight.checks.map(check => (
              <li key={check.id} className={check.ok ? "ok" : check.level === "error" ? "fail" : "warn"}>
                <code>{check.id}</code> {check.detail}
              </li>
            ))}
          </ul>
          <h3>{copy.steps}</h3>
          <ol className="tw-steps">
            {plan.plan.steps.map(step => (
              <li key={step.stepId}>
                <span className={statusClass(step.status)}>{step.status}</span>
                <code>{step.kind}</code> {step.description}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {runs.length > 0 ? (
        <section className="tw-panel">
          <h3>{copy.runs}</h3>
          <ul className="tw-runs">
            {runs.map(run => {
              const progress = bootstrapProgress(run);
              return (
                <li key={run.runId}>
                  <span className={statusClass(run.status)}>{run.status}</span>
                  <code>{run.runId}</code>
                  <span className="tw-hint">
                    {progress.done}/{progress.total}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function TasksTab({
  client,
  copy,
  workspace,
  busy,
  perform,
  labelFor,
}: {
  client: StudioClient;
  copy: Copy;
  workspace: TeamWorkspaceReadModel;
  busy: boolean;
  perform: (action: () => Promise<unknown>, ok: string) => Promise<void>;
  labelFor: (id: string | null) => string;
}) {
  const [filter, setFilter] = useState<"all" | TeamTaskStatus>("all");
  const [selected, setSelected] = useState<string>("");
  const [taskKey, setTaskKey] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pm, setPm] = useState(workspace.pms[0]?.name ?? "");
  const [assignee, setAssignee] = useState("");
  const [engineer, setEngineer] = useState(workspace.engineers[0]?.id ?? "");
  const [leaseSeconds, setLeaseSeconds] = useState("900");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");

  const tasks = workspace.tasks.filter(view => filter === "all" || view.task.status === filter);
  const selectedView = workspace.tasks.find(view => view.task.taskKey === selected) ?? tasks[0];
  const actions = selectedView ? teamTaskActions(selectedView.task) : [];
  const engineerChoices = memberOptions(workspace.pms, workspace.engineers).filter(option => option.role === "engineer");

  const create = () =>
    perform(async () => {
      const handle = await client.command("team.task.create", {
        teamId: workspace.team.id,
        taskKey: taskKey.trim(),
        title: title.trim(),
        ...(body.trim() ? { body: body.trim() } : {}),
        pm,
        ...(assignee ? { assignee } : {}),
      });
      const view = await waitReceipt<TeamTaskView>(client, handle.requestId);
      setSelected(view.task.taskKey);
      setTaskKey("");
      setTitle("");
      setBody("");
    }, "Task created");

  const act = (action: TeamTaskAction) =>
    perform(async () => {
      if (!selectedView) return;
      const task = selectedView.task;
      if (action === "assign") {
        if (!assignee) throw new Error("assignee is required");
        const handle = await client.command("team.task.assign", {
          teamId: workspace.team.id,
          task: task.taskKey,
          pm,
          assignee,
        });
        await waitReceipt(client, handle.requestId);
        return;
      }
      if (action === "claim") {
        if (!engineer) throw new Error("engineer is required");
        const handle = await client.command("team.task.claim", {
          teamId: workspace.team.id,
          task: task.taskKey,
          agent: engineer,
          leaseSeconds: Number(leaseSeconds) || 900,
        });
        await waitReceipt(client, handle.requestId);
        return;
      }
      if (action === "renew") {
        if (!engineer) throw new Error("engineer is required");
        const handle = await client.command("team.task.renew", {
          teamId: workspace.team.id,
          task: task.taskKey,
          agent: engineer,
          leaseSeconds: Number(leaseSeconds) || 900,
        });
        await waitReceipt(client, handle.requestId);
        return;
      }
      if (action === "release") {
        if (!engineer) throw new Error("engineer is required");
        const handle = await client.command("team.task.release", {
          teamId: workspace.team.id,
          task: task.taskKey,
          agent: engineer,
        });
        await waitReceipt(client, handle.requestId);
        return;
      }
      if (action === "submit") {
        if (!engineer) throw new Error("engineer is required");
        const handle = await client.command("team.task.submit", {
          teamId: workspace.team.id,
          task: task.taskKey,
          agent: engineer,
          ...(body.trim() ? { body: body.trim() } : {}),
        });
        await waitReceipt(client, handle.requestId);
        return;
      }
      if (action === "complete") {
        const handle = await client.command("team.task.complete", {
          teamId: workspace.team.id,
          task: task.taskKey,
          pm,
        });
        await waitReceipt(client, handle.requestId);
        return;
      }
      if (action === "reject") {
        const handle = await client.command("team.task.reject", {
          teamId: workspace.team.id,
          task: task.taskKey,
          pm,
          body: reason || "rejected",
        });
        await waitReceipt(client, handle.requestId);
        setReason("");
        return;
      }
      const handle = await client.command("team.task.cancel", {
        teamId: workspace.team.id,
        task: task.taskKey,
        pm,
      });
      await waitReceipt(client, handle.requestId);
    }, `Task ${action}`);

  return (
    <div className="tw-tasks">
      <section className="tw-panel">
        <h3>{copy.createTask}</h3>
        <div className="tw-form-row">
          <Field label={copy.taskKey}>
            <input value={taskKey} onChange={event => setTaskKey(event.target.value)} placeholder="T-101" />
          </Field>
          <Field label={copy.taskTitle}>
            <input value={title} onChange={event => setTitle(event.target.value)} />
          </Field>
          <Field label={copy.pm}>
            <Select value={pm} onChange={setPm}>
              {workspace.pms.map(row => (
                <option key={row.id} value={row.name}>
                  {row.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={copy.assignee}>
            <Select value={assignee} onChange={setAssignee}>
              <option value="">—</option>
              {engineerChoices.map(option => (
                <option key={option.id} value={option.label}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={copy.body}>
          <textarea value={body} onChange={event => setBody(event.target.value)} rows={2} />
        </Field>
        <button type="button" className="tw-button primary" disabled={busy || !taskKey.trim() || !title.trim()} onClick={() => void create()}>
          {copy.createTask}
        </button>
      </section>

      <div className="tw-task-layout">
        <section className="tw-panel">
          <div className="tw-toolbar">
            <h3>{copy.tasks}</h3>
            <Select value={filter} onChange={value => setFilter(value as "all" | TeamTaskStatus)}>
              <option value="all">{copy.all}</option>
              {TASK_STATUSES.map(status => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </div>
          {tasks.length === 0 ? (
            <p className="tw-hint">{copy.emptyTasks}</p>
          ) : (
            <ul className="tw-task-list">
              {tasks.map(view => {
                const lease = teamLeaseInfo(view.task, Math.floor(Date.now() / 1000));
                return (
                  <li key={view.task.id}>
                    <button
                      type="button"
                      className={`tw-task-row${selectedView?.task.id === view.task.id ? " active" : ""}`}
                      onClick={() => setSelected(view.task.taskKey)}
                    >
                      <span className={statusClass(view.task.status)}>{view.task.status}</span>
                      <span className="tw-task-key">{view.task.taskKey}</span>
                      <span className="tw-task-title">{view.task.title}</span>
                      <span className={`tw-lease ${lease.state}`}>{lease.state}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="tw-panel tw-task-detail">
          {selectedView ? (
            <>
              <h3>{selectedView.task.title}</h3>
              <dl className="tw-detail">
                <dt>{copy.status}</dt>
                <dd>
                  <span className={statusClass(selectedView.task.status)}>{selectedView.task.status}</span>
                </dd>
                <dt>{copy.pm}</dt>
                <dd>{labelFor(selectedView.task.assignedPmId)}</dd>
                <dt>{copy.assignee}</dt>
                <dd>{labelFor(selectedView.task.assigneeAgentId)}</dd>
                <dt>{copy.owner}</dt>
                <dd>{labelFor(selectedView.task.ownerAgentId)}</dd>
                <dt>{copy.lease}</dt>
                <dd>
                  <span className={`tw-lease ${teamLeaseInfo(selectedView.task, Math.floor(Date.now() / 1000)).state}`}>
                    {formatLease(selectedView.task, "en")}
                  </span>
                </dd>
              </dl>
              <p className="tw-body-text">{selectedView.task.body || "—"}</p>

              <div className="tw-action-row">
                <Field label={copy.engineer}>
                  <Select value={engineer} onChange={setEngineer}>
                    {engineerChoices.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={copy.leaseSeconds}>
                  <input value={leaseSeconds} onChange={event => setLeaseSeconds(event.target.value)} />
                </Field>
                <Field label={copy.assignee}>
                  <Select value={assignee} onChange={setAssignee}>
                    <option value="">—</option>
                    {engineerChoices.map(option => (
                      <option key={option.id} value={option.label}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="tw-action-row">
                {actions.map(action => (
                  <button
                    key={action}
                    type="button"
                    className={`tw-button${action === "reject" || action === "cancel" ? " danger" : ""}`}
                    disabled={busy}
                    onClick={() => void act(action)}
                  >
                    {copy[action === "complete" ? "approve" : action]}
                  </button>
                ))}
              </div>
              {selectedView.task.status === "review" ? (
                <Field label={copy.reason}>
                  <input value={reason} onChange={event => setReason(event.target.value)} placeholder="rejection reason" />
                </Field>
              ) : null}
              <div className="tw-action-row">
                <Field label={copy.comment}>
                  <input value={comment} onChange={event => setComment(event.target.value)} />
                </Field>
                <button
                  type="button"
                  className="tw-button"
                  disabled={busy || !comment.trim()}
                  onClick={() =>
                    void perform(async () => {
                      const handle = await client.command("team.task.comment", {
                        teamId: workspace.team.id,
                        task: selectedView.task.taskKey,
                        agent: engineer,
                        body: comment.trim(),
                      });
                      await waitReceipt(client, handle.requestId);
                      setComment("");
                    }, "Comment added")
                  }
                >
                  {copy.comment}
                </button>
              </div>

              <h4>{copy.events}</h4>
              <ul className="tw-events">
                {selectedView.events.map(event => (
                  <li key={event.seq}>
                    <span className="tw-hint">#{event.seq} {new Date(event.at * 1000).toLocaleString()}</span>
                    <code>{event.kind}</code> {event.body}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="tw-hint">{copy.emptyTasks}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function RoomsTab({
  client,
  copy,
  workspace,
  busy,
  perform,
  labelFor,
  locale,
}: {
  client: StudioClient;
  copy: Copy;
  workspace: TeamWorkspaceReadModel;
  busy: boolean;
  perform: (action: () => Promise<unknown>, ok: string) => Promise<void>;
  labelFor: (id: string | null) => string;
  locale: string;
}) {
  const [roomName, setRoomName] = useState(workspace.rooms[0]?.name ?? "");
  const [roomView, setRoomView] = useState<TeamRoomView | undefined>();
  const [viewer, setViewer] = useState(workspace.pms[0]?.id ?? "");
  const [roomBody, setRoomBody] = useState("");
  const [sender, setSender] = useState("");
  const [newRoom, setNewRoom] = useState("");
  const [newKind, setNewKind] = useState<TeamRoomKind>("coordination");
  const [newPm, setNewPm] = useState(workspace.pms[0]?.name ?? "");
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [memberToAdd, setMemberToAdd] = useState("");
  const [kindDraft, setKindDraft] = useState<TeamRoomKind>("coordination");
  const [kindPm, setKindPm] = useState(workspace.pms[0]?.name ?? "");
  const viewRef = useRef<TeamRoomView | undefined>(undefined);
  viewRef.current = roomView;

  const memberChoices = memberOptions(workspace.pms, workspace.engineers);

  useEffect(() => {
    if (!roomName) {
      setRoomView(undefined);
      return;
    }
    let active = true;
    const load = async (afterSeq?: number) => {
      const result = await client.query("team.room.events", {
        teamId: workspace.team.id,
        room: roomName,
        ...(afterSeq !== undefined ? { afterSeq } : {}),
        limit: 100,
        ...(viewer ? { agent: viewer } : {}),
      });
      if (!active) return;
      if (afterSeq === undefined) {
        setRoomView(result);
      } else {
        setRoomView(current =>
          current && current.room.name === roomName
            ? { ...result, events: mergeRoomEvents(current.events, result.events) }
            : result,
        );
      }
      setSender(current => current || result.members[0]?.agentId || "");
    };
    void load().catch(() => undefined);
    const timer = setInterval(() => {
      const seq = lastRoomSeq(viewRef.current?.events ?? []);
      if (seq > 0) void load(seq).catch(() => undefined);
    }, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [client, roomName, viewer, workspace.team.id]);

  const selectedRoom = workspace.rooms.find(room => room.name === roomName);
  const subscription = roomView?.subscription;

  useEffect(() => {
    if (!selectedRoom) return;
    setKindDraft(selectedRoom.kind);
    const owner = workspace.pms.find(pm => pm.id === selectedRoom.pmId);
    if (owner) setKindPm(owner.name);
  }, [selectedRoom?.id, selectedRoom?.kind, selectedRoom?.pmId, workspace.pms]);

  return (
    <div className="tw-rooms">
      <section className="tw-panel">
        <h3>{copy.createRoom}</h3>
        <div className="tw-form-row">
          <Field label={copy.name}>
            <input value={newRoom} onChange={event => setNewRoom(event.target.value)} placeholder="standup" />
          </Field>
          <Field label={copy.kind}>
            <Select value={newKind} onChange={value => setNewKind(value as TeamRoomKind)}>
              <option value="coordination">coordination</option>
              <option value="pm">pm</option>
              <option value="room">room</option>
            </Select>
          </Field>
          {newKind === "pm" ? (
            <Field label={copy.pm}>
              <Select value={newPm} onChange={setNewPm}>
                {workspace.pms.map(pm => (
                  <option key={pm.id} value={pm.name}>
                    {pm.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
        <div className="tw-member-picker">
          {memberChoices.map(member => (
            <label key={member.id} className="tw-check">
              <input
                type="checkbox"
                checked={newMembers.includes(member.id)}
                onChange={event =>
                  setNewMembers(current =>
                    event.target.checked ? [...current, member.id] : current.filter(id => id !== member.id),
                  )
                }
              />
              {member.label}
            </label>
          ))}
        </div>
        <button
          type="button"
          className="tw-button primary"
          disabled={busy || !newRoom.trim()}
          onClick={() =>
            void perform(async () => {
              const handle = await client.command("team.room.create", {
                teamId: workspace.team.id,
                room: newRoom.trim(),
                kind: newKind,
                ...(newKind === "pm" ? { pm: newPm } : {}),
                ...(newMembers.length > 0 ? { members: newMembers } : {}),
              });
              await waitReceipt(client, handle.requestId);
              setRoomName(newRoom.trim());
              setNewRoom("");
            }, "Room created")
          }
        >
          {copy.createRoom}
        </button>
      </section>

      <div className="tw-room-layout">
        <section className="tw-panel">
          <h3>{copy.rooms}</h3>
          {workspace.rooms.length === 0 ? (
            <p className="tw-hint">{copy.emptyRooms}</p>
          ) : (
            <ul className="tw-room-list">
              {workspace.rooms.map(room => (
                <li key={room.id}>
                  <button
                    type="button"
                    className={`tw-room-row${room.name === roomName ? " active" : ""}`}
                    onClick={() => setRoomName(room.name)}
                  >
                    <span className="tw-room-name">#{room.name}</span>
                    <span className={`tw-kind kind-${room.kind}`}>{room.kind}</span>
                    <span className="tw-hint">
                      {room.memberCount} · {room.lastSeq === null ? "—" : `#${room.lastSeq}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="tw-panel tw-room-detail">
          {selectedRoom ? (
            <>
              <div className="tw-toolbar">
                <h3>#{selectedRoom.name}</h3>
                <span className={`tw-kind kind-${selectedRoom.kind}`}>{selectedRoom.kind}</span>
                {selectedRoom.pmId ? <span className="tw-hint">PM {labelFor(selectedRoom.pmId)}</span> : null}
              </div>
              <div className="tw-action-row">
                <Field label={copy.kind}>
                  <Select value={kindDraft} onChange={value => setKindDraft(value as TeamRoomKind)}>
                    <option value="coordination">coordination</option>
                    <option value="pm">pm</option>
                    <option value="room">room</option>
                  </Select>
                </Field>
                {kindDraft === "pm" ? (
                  <Field label={copy.pm}>
                    <Select value={kindPm} onChange={setKindPm}>
                      {workspace.pms.map(pm => (
                        <option key={pm.id} value={pm.name}>
                          {pm.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <button
                  type="button"
                  className="tw-button"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const handle = await client.command("team.room.kind.set", {
                        teamId: workspace.team.id,
                        room: selectedRoom.name,
                        kind: kindDraft,
                        ...(kindDraft === "pm" ? { pm: kindPm } : {}),
                      });
                      await waitReceipt(client, handle.requestId);
                    }, "Room kind updated")
                  }
                >
                  {copy.setKind}
                </button>
              </div>

              <h4>{copy.members}</h4>
              <ul className="tw-members">
                {(roomView?.members ?? workspace.roomMembers[selectedRoom.id] ?? []).map(member => (
                  <li key={member.agentId}>
                    <span>{member.label}</span>
                    <code>{member.role}</code>
                    <button
                      type="button"
                      className="tw-button tiny danger"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          const handle = await client.command("team.room.member.remove", {
                            teamId: workspace.team.id,
                            room: selectedRoom.name,
                            member: member.agentId,
                          });
                          await waitReceipt(client, handle.requestId);
                        }, "Member removed")
                      }
                    >
                      {copy.remove}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="tw-action-row">
                <Field label={copy.addMember}>
                  <Select value={memberToAdd} onChange={setMemberToAdd}>
                    <option value="">—</option>
                    {memberChoices.map(member => (
                      <option key={member.id} value={member.id}>
                        {member.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <button
                  type="button"
                  className="tw-button"
                  disabled={busy || !memberToAdd}
                  onClick={() =>
                    void perform(async () => {
                      const handle = await client.command("team.room.member.add", {
                        teamId: workspace.team.id,
                        room: selectedRoom.name,
                        member: memberToAdd,
                      });
                      await waitReceipt(client, handle.requestId);
                    }, "Member added")
                  }
                >
                  {copy.addMember}
                </button>
              </div>

              <h4>{copy.events}</h4>
              {subscription ? (
                <p className="tw-hint">
                  {copy.acceptedThrough} #{subscription.acceptedThrough} · {copy.readThrough} #{subscription.readThrough}
                </p>
              ) : null}
              <div className="tw-action-row">
                <Field label="viewer">
                  <Select value={viewer} onChange={setViewer}>
                    <option value="">—</option>
                    {memberChoices.map(member => (
                      <option key={member.id} value={member.id}>
                        {member.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <button
                  type="button"
                  className="tw-button"
                  disabled={busy || !viewer}
                  onClick={() =>
                    void perform(async () => {
                      const handle = await client.command("team.room.subscribe", {
                        teamId: workspace.team.id,
                        room: selectedRoom.name,
                        agent: viewer,
                        fromSeq: lastRoomSeq(roomView?.events ?? []),
                      });
                      await waitReceipt(client, handle.requestId);
                    }, "Subscribed")
                  }
                >
                  {copy.subscribe}
                </button>
                <button
                  type="button"
                  className="tw-button"
                  disabled={busy || !viewer || !subscription}
                  onClick={() =>
                    void perform(async () => {
                      const handle = await client.command("team.room.ack", {
                        teamId: workspace.team.id,
                        room: selectedRoom.name,
                        agent: viewer,
                        throughSeq: lastRoomSeq(roomView?.events ?? []),
                      });
                      await waitReceipt(client, handle.requestId);
                    }, "Ack recorded")
                  }
                >
                  {copy.ack}
                </button>
              </div>

              <ul className="tw-event-list">
                {(roomView?.events ?? []).map(event => (
                  <li key={event.seq}>
                    <span className="tw-hint">
                      #{event.seq} {formatTime(event.sentAt, locale)}
                    </span>
                    <strong>{labelFor(event.senderAgentId)}</strong>
                    <span className={`tw-kind kind-${event.kind}`}>{event.kind}</span>
                    <p>{event.body}</p>
                  </li>
                ))}
                {(roomView?.events ?? []).length === 0 ? <li className="tw-hint">{copy.emptyEvents}</li> : null}
              </ul>

              <div className="tw-action-row">
                <Field label={copy.sender}>
                  <Select value={sender} onChange={setSender}>
                    {(roomView?.members ?? []).map(member => (
                      <option key={member.agentId} value={member.agentId}>
                        {member.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={copy.body}>
                  <input
                    value={roomBody}
                    onChange={event => setRoomBody(event.target.value)}
                    onKeyDown={event => {
                      if (event.key !== "Enter" || !roomBody.trim() || !sender) return;
                      void perform(async () => {
                        const handle = await client.command("team.room.post", {
                          teamId: workspace.team.id,
                          room: selectedRoom.name,
                          body: roomBody.trim(),
                          sender,
                        });
                        await waitReceipt(client, handle.requestId);
                        setRoomBody("");
                      }, "Posted");
                    }}
                  />
                </Field>
                <button
                  type="button"
                  className="tw-button primary"
                  disabled={busy || !roomBody.trim() || !sender}
                  onClick={() =>
                    void perform(async () => {
                      const handle = await client.command("team.room.post", {
                        teamId: workspace.team.id,
                        room: selectedRoom.name,
                        body: roomBody.trim(),
                        sender,
                      });
                      await waitReceipt(client, handle.requestId);
                      setRoomBody("");
                    }, "Posted")
                  }
                >
                  {copy.post}
                </button>
              </div>
            </>
          ) : (
            <p className="tw-hint">{copy.emptyRooms}</p>
          )}
        </section>
      </div>
    </div>
  );
}

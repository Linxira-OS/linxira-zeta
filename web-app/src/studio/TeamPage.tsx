/**
 * Team relationship graph.
 *
 * Reads only `team.graph.get`. The Host decides what is real: live main agents,
 * their spawned subagents, and the producers it does not have (`gaps`).
 *
 * The Team root is an ownerless container, never an agent node: it is drawn as
 * a dashed boundary. Path objects (PM workspace, Git repo, DB room, linked
 * worktree) appear only when a producer ships; today the ownership legend says
 * so explicitly instead of inventing them.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  StudioClient,
  TeamEdgeKind,
  TeamGraphGap,
  TeamExecutionMode,
  TeamGraphNode,
  TeamGraphReadModel,
  TeamNodeKind,
  TeamNodeLifetime,
  WorkspaceId,
} from "@linxiraos/studio-contract";
import { AppSelect } from "./AppSelect";
import { hostErrorMessage } from "./hostError";
import { Icon } from "./icons";
import { useI18n } from "./i18n";
import { usePreviewMode } from "./preview/PreviewContext";
import {
  buildTeamLanes,
  isAgentNode,
  teamEdgeCounts,
  teamKindCounts,
  teamLifetimeCounts,
  teamProjectOptions,
} from "./teamGraph";

type Phase = "loading" | "ready" | "error";
type LifetimeFilter = "all" | TeamNodeLifetime;

const LIFETIME_FILTERS: ReadonlyArray<{ id: LifetimeFilter; key: string }> = [
  { id: "all", key: "team.filters.allLifetimes" },
  { id: "persistent", key: "team.lifetime.persistent" },
  { id: "ephemeral", key: "team.lifetime.ephemeral" },
];

const EDGE_KINDS: ReadonlyArray<TeamEdgeKind> = [
  "spawn",
  "assignment",
  "room",
  "contains",
  "binding",
  "worktree-of",
];

/** Ownership objects, in the order the model note lists them. */
const NODE_KINDS: ReadonlyArray<TeamNodeKind> = [
  "pm-workspace",
  "git-repo",
  "db-room",
  "linked-worktree",
  "agent",
  "subagent",
];

const MODE_KEY: Record<TeamExecutionMode, string> = {
  vibe: "team.mode.vibe",
  normal: "team.mode.normal",
  unknown: "team.mode.unknown",
};

const STATUS_KEY: Record<"running" | "idle" | "parked" | "aborted", string> = {
  running: "team.status.running",
  idle: "team.status.idle",
  parked: "team.status.parked",
  aborted: "team.status.aborted",
};

const GAP_KEY: Record<TeamGraphGap["id"], string> = {
  "team-root": "teamRoot",
  "pm-workspaces": "pmWorkspaces",
  "git-repos": "gitRepos",
  "db-rooms": "dbRooms",
  worktrees: "worktrees",
  roles: "roles",
  assignments: "assignments",
  secretary: "secretary",
};

function formatTime(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

function nodeKindLabel(t: (key: string) => string, kind: TeamNodeKind): string {
  return t(`team.nodeKind.${kind}`);
}

function NodeCard({
  node,
  edgeKind,
  parentLabel,
  selected,
  onSelect,
}: {
  node: TeamGraphNode;
  edgeKind?: TeamEdgeKind;
  parentLabel?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const agent = isAgentNode(node);
  return (
    <button
      type="button"
      className={`team-node${selected ? " is-selected" : ""}`}
      data-kind={node.kind}
      data-mode={agent ? node.executionMode : undefined}
      data-lifetime={agent ? node.lifetime : undefined}
      data-status={agent ? node.status : undefined}
      onClick={onSelect}
    >
      {agent ? <span className={`team-status-dot status-${node.status}`} aria-hidden="true" /> : <span className="team-object-glyph" aria-hidden="true" />}
      <span className="team-node-main">
        <span className="team-node-name">{node.displayName}</span>
        <span className="team-node-chips">
          <span className={`team-chip kind-${node.kind}`}>{nodeKindLabel(t, node.kind)}</span>
          {agent && node.kind === "agent" ? (
            <span className="team-chip role-unknown">{t(`team.agentRole.${node.role ?? "unknown"}`)}</span>
          ) : null}
          {!agent && node.kind === "linked-worktree" && node.worktreeKind ? (
            <span className={`team-chip worktree-${node.worktreeKind}`}>{t(`team.worktreeKind.${node.worktreeKind}`)}</span>
          ) : null}
          {agent ? (
            <>
              <span className={`team-chip mode-${node.executionMode}`}>{t(MODE_KEY[node.executionMode])}</span>
              <span className={`team-chip lifetime-${node.lifetime}`}>{t(`team.lifetime.${node.lifetime}`)}</span>
              <span className={`team-chip status-${node.status}`}>{t(STATUS_KEY[node.status])}</span>
            </>
          ) : null}
        </span>
        {agent && node.assignment ? <span className="team-node-assignment">{node.assignment}</span> : null}
        {agent && node.activity && node.activity !== node.assignment ? (
          <span className="team-node-activity">{node.activity}</span>
        ) : null}
        {parentLabel ? <span className="team-node-parent">{t("team.node.spawnedBy", { name: parentLabel })}</span> : null}
        {edgeKind ? <span className={`team-edge-note edge-${edgeKind}`}>{t(`team.edge.${edgeKind}`)}</span> : null}
      </span>
    </button>
  );
}

export function TeamPage({ client }: { client: StudioClient }) {
  const { t, resolvedLanguage } = useI18n();
  const { preview } = usePreviewMode();
  const [phase, setPhase] = useState<Phase>("loading");
  const [graph, setGraph] = useState<TeamGraphReadModel | undefined>(undefined);
  const [error, setError] = useState("");
  const [project, setProject] = useState("all");
  const [lifetime, setLifetime] = useState<LifetimeFilter>("all");
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (preview) return;
    let active = true;
    setPhase("loading");
    setError("");
    void (async () => {
      try {
        const result = await client.query("team.graph.get", {
          ...(project === "all" ? {} : { workspaceId: project as WorkspaceId }),
          ...(lifetime === "all" ? {} : { lifetime }),
        });
        if (!active) return;
        setGraph(result);
        setPhase("ready");
      } catch (cause) {
        if (!active) return;
        setError(hostErrorMessage(cause, t("team.error")));
        setPhase("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [client, project, lifetime, nonce, preview, t]);

  const lanes = useMemo(() => (graph ? buildTeamLanes(graph) : []), [graph]);
  const projects = useMemo(() => (graph ? teamProjectOptions(graph) : []), [graph]);
  const edgeCounts = useMemo(() => teamEdgeCounts(graph?.edges ?? []), [graph]);
  const lifetimeCounts = useMemo(() => teamLifetimeCounts(graph?.nodes ?? []), [graph]);
  const kindCounts = useMemo(() => teamKindCounts(graph?.nodes ?? []), [graph]);
  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map(node => [node.nodeId, node])), [graph]);
  const selectedNode = selected === undefined ? undefined : nodeById.get(selected);
  const filtered = project !== "all" || lifetime !== "all";
  const selectedParentLabel =
    selectedNode?.parentNodeId === undefined ? undefined : nodeById.get(selectedNode.parentNodeId)?.displayName;

  const refresh = useCallback(() => setNonce(value => value + 1), []);

  if (preview) {
    return (
      <div className="team-page page-wide">
        <div className="team-empty">
          <Icon name="network" />
          <h3>{t("team.preview.title")}</h3>
          <p>{t("team.preview.detail")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="team-page page-wide">
      <header className="team-head">
        <div>
          <h2 className="team-title">
            {t("team.title")}
            {graph && graph.gaps.length > 0 ? (
              <span className="team-badge partial" title={t("team.partialHint")}>
                {t("team.partial")}
              </span>
            ) : null}
          </h2>
          <p className="team-subtitle">{t("team.subtitle")}</p>
        </div>
        <div className="team-head-meta">
          {graph ? <span className="muted small">{t("team.generatedAt", { time: formatTime(graph.generatedAt, resolvedLanguage) })}</span> : null}
          <button type="button" className="icon-btn" onClick={refresh} aria-label={t("team.refresh")} data-tip={t("team.refresh")}>
            <Icon name="refresh" />
          </button>
        </div>
      </header>

      <div className="team-filters">
        <div className="team-filter">
          <span>{t("team.filters.project")}</span>
          <AppSelect value={project} onChange={event => setProject(event.target.value)}>
            <option value="all">{t("team.filters.allProjects")}</option>
            {projects.map(option => (
              <option key={option.workspaceId} value={option.workspaceId}>
                {option.name ?? t("team.filters.unnamedProject")}
              </option>
            ))}
          </AppSelect>
        </div>
        <div className="team-filter">
          <span>{t("team.filters.room")}</span>
          <AppSelect value="none" onChange={() => {}} disabled title={t("team.filters.roomsUnavailableHint")}>
            <option value="none">{t("team.filters.roomsUnavailable")}</option>
          </AppSelect>
        </div>
        <div className="team-filter" role="group" aria-label={t("team.filters.lifetime")}>
          <span>{t("team.filters.lifetime")}</span>
          <div className="team-segment">
            {LIFETIME_FILTERS.map(option => (
              <button
                key={option.id}
                type="button"
                className={lifetime === option.id ? "active" : undefined}
                aria-pressed={lifetime === option.id}
                onClick={() => setLifetime(option.id)}
              >
                {t(option.key)}
                {option.id === "persistent" ? <span className="cnt">{lifetimeCounts.persistent}</span> : null}
                {option.id === "ephemeral" ? <span className="cnt">{lifetimeCounts.ephemeral}</span> : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      {phase === "error" ? (
        <div className="banner amber" role="alert">
          <Icon name="alert" />
          <span>
            <b>{t("team.error")}</b> · <span className="banner-detail">{error}</span>
          </span>
          <button type="button" className="btn small outline" onClick={refresh}>
            {t("team.retry")}
          </button>
        </div>
      ) : null}

      {phase === "loading" && graph === undefined ? <p className="muted">{t("team.loading")}</p> : null}

      <section className="team-legend" aria-label={t("team.legend.title")}>
        <div className="team-legend-group">
          <span className="team-legend-title">{t("team.legend.ownership")}</span>
          <span className="team-legend-item team-boundary-item" title={t("team.legend.teamHint")}>
            <span className="team-legend-boundary" />
            {t("team.nodeKind.team")}
            <span className="cnt">{lanes.filter(lane => lane.kind === "team").length}</span>
          </span>
          {NODE_KINDS.map(kind => (
            <span
              key={kind}
              className={`team-legend-item${kindCounts[kind] === 0 ? " is-unavailable" : ""}`}
              title={kindCounts[kind] === 0 ? t("team.legend.unavailable") : undefined}
            >
              <span className={`team-legend-swatch kind-${kind}`} />
              {t(`team.nodeKind.${kind}`)}
              <span className="cnt">{kindCounts[kind]}</span>
            </span>
          ))}
        </div>
        <div className="team-legend-group">
          <span className="team-legend-title">{t("team.legend.roles")}</span>
          {(["pm", "engineer", "secretary", "unknown"] as const).map(role => (
            <span key={role} className="team-legend-item">
              <span className={`team-chip role-${role}`}>{t(`team.agentRole.${role}`)}</span>
            </span>
          ))}
        </div>
        <div className="team-legend-group">
          <span className="team-legend-title">{t("team.legend.modes")}</span>
          {(["vibe", "normal", "unknown"] as const).map(mode => (
            <span key={mode} className="team-legend-item">
              <span className={`team-chip mode-${mode}`}>{t(MODE_KEY[mode])}</span>
            </span>
          ))}
        </div>
        <div className="team-legend-group">
          <span className="team-legend-title">{t("team.legend.lifetime")}</span>
          {(["persistent", "ephemeral"] as const).map(kind => (
            <span key={kind} className="team-legend-item">
              <span className={`team-legend-ring lifetime-${kind}`} />
              {t(`team.lifetime.${kind}`)}
            </span>
          ))}
        </div>
        <div className="team-legend-group">
          <span className="team-legend-title">{t("team.legend.edges")}</span>
          {EDGE_KINDS.map(kind => (
            <span
              key={kind}
              className={`team-legend-item edge-${kind}${edgeCounts[kind] === 0 ? " is-unavailable" : ""}`}
              title={edgeCounts[kind] === 0 ? t("team.legend.unavailable") : undefined}
            >
              <span className={`team-legend-line edge-${kind}`} />
              {t(`team.edge.${kind}`)}
              <span className="cnt">{edgeCounts[kind]}</span>
            </span>
          ))}
        </div>
      </section>

      {graph && graph.truncated ? (
        <div className="banner amber" role="status">
          <Icon name="alert" />
          <span>{t("team.warn.truncated")}</span>
        </div>
      ) : null}
      {graph && graph.incompleteMainIds && graph.incompleteMainIds.length > 0 ? (
        <div className="banner amber" role="status">
          <Icon name="alert" />
          <span>{t("team.warn.incomplete", { count: graph.incompleteMainIds.length })}</span>
        </div>
      ) : null}

      {graph && graph.nodes.length === 0 && phase === "ready" ? (
        <div className="team-empty">
          <Icon name="network" />
          <h3>{filtered ? t("team.empty.filteredTitle") : t("team.empty.title")}</h3>
          <p>{filtered ? t("team.empty.filteredDetail") : t("team.empty.detail")}</p>
          {filtered ? (
            <button type="button" className="btn small outline" onClick={() => { setProject("all"); setLifetime("all"); }}>
              {t("team.empty.clearFilters")}
            </button>
          ) : null}
        </div>
      ) : null}

      {lanes.length > 0 ? (
        <div className="team-container">
          <span className="team-container-label">
            {t("team.nodeKind.team")}
            <span className="team-container-hint">{t("team.container.noAgent")}</span>
          </span>
        <div className="team-lanes">
          {lanes.map(lane => {
            const unassigned = lane.kind === "unassigned";
            const anchor = unassigned ? undefined : lane.nodes.find(node => isAgentNode(node) && node.kind === "agent");
            const rest = anchor === undefined ? lane.nodes : lane.nodes.filter(node => node.nodeId !== anchor.nodeId);
            return (
              <section key={lane.clusterId} className={`team-lane kind-${lane.kind}`} aria-label={lane.label ?? t("team.container.unassigned")}>
                <header className="team-lane-head">
                  <span className="team-lane-title">
                    {lane.kind === "team" ? lane.label : t("team.container.unassigned")}
                  </span>
                  {unassigned ? <span className="team-badge">{t("team.container.noTeamRecord")}</span> : null}
                  {anchor && isAgentNode(anchor) ? (
                    <span className={`team-chip mode-${anchor.executionMode}`}>{t(MODE_KEY[anchor.executionMode])}</span>
                  ) : null}
                  <span className="muted small">{t("team.lane.members", { count: lane.nodes.length })}</span>
                </header>
                <div className="team-lane-body">
                  {anchor ? (
                    <div className="team-main-anchor">
                      <NodeCard
                        node={anchor}
                        selected={selected === anchor.nodeId}
                        onSelect={() => setSelected(anchor.nodeId)}
                      />
                    </div>
                  ) : null}
                  {rest.length > 0 ? (
                    <div className={`team-children${anchor === undefined ? " is-flat" : ""}`}>
                      {rest.map(node => {
                        const edge = lane.edges.find(candidate => candidate.to === node.nodeId);
                        const nestedParent =
                          node.parentNodeId === undefined || node.parentNodeId === anchor?.nodeId
                            ? undefined
                            : nodeById.get(node.parentNodeId)?.displayName;
                        return (
                          <NodeCard
                            key={node.nodeId}
                            node={node}
                            {...(edge ? { edgeKind: edge.kind } : {})}
                            {...(nestedParent ? { parentLabel: nestedParent } : {})}
                            selected={selected === node.nodeId}
                            onSelect={() => setSelected(node.nodeId)}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <p className="team-lane-empty muted small">{t("team.lane.noObjects")}</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      ) : null}

      {selectedNode ? (
        <aside className="team-detail" aria-label={t("team.detail.title")}>
          <div className="team-detail-head">
            <strong>{selectedNode.displayName}</strong>
            <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={() => setSelected(undefined)}>
              <Icon name="x" />
            </button>
          </div>
          <dl>
            <dt>{t("team.detail.kind")}</dt><dd>{nodeKindLabel(t, selectedNode.kind)}</dd>
            {isAgentNode(selectedNode) ? (
              <>
                <dt>{t("team.detail.agent")}</dt><dd>{selectedNode.agentId}</dd>
                <dt>{t("team.detail.role")}</dt>
                <dd>{selectedNode.kind === "agent" ? t(`team.agentRole.${selectedNode.role ?? "unknown"}`) : t("team.nodeKind.subagent")}</dd>
                <dt>{t("team.detail.mode")}</dt><dd>{t(MODE_KEY[selectedNode.executionMode])}</dd>
                <dt>{t("team.detail.lifetime")}</dt><dd>{t(`team.lifetime.${selectedNode.lifetime}`)}</dd>
                <dt>{t("team.detail.status")}</dt><dd>{t(STATUS_KEY[selectedNode.status])}</dd>
                {selectedNode.parentNodeId ? (<><dt>{t("team.detail.parent")}</dt><dd>{selectedParentLabel ?? selectedNode.parentNodeId}</dd></>) : null}
                {selectedNode.assignment ? (<><dt>{t("team.detail.assignment")}</dt><dd>{selectedNode.assignment}</dd></>) : null}
                {selectedNode.sessionId ? (<><dt>{t("team.detail.session")}</dt><dd>{selectedNode.sessionId}</dd></>) : null}
              </>
            ) : (
              <>
                <dt>{t("team.detail.object")}</dt><dd>{selectedNode.objectId ?? selectedNode.nodeId}</dd>
                {selectedNode.kind === "linked-worktree" && selectedNode.worktreeKind ? (
                  <><dt>{t("team.detail.worktreeKind")}</dt><dd>{t(`team.worktreeKind.${selectedNode.worktreeKind}`)}</dd></>
                ) : null}
              </>
            )}
            <dt>{t("team.detail.workspace")}</dt>
            <dd>{selectedNode.workspaceName ?? selectedNode.workspaceId ?? t("team.node.noWorkspace")}</dd>
            <dt>{t("team.detail.created")}</dt><dd>{formatTime(selectedNode.createdAt, resolvedLanguage)}</dd>
            <dt>{t("team.detail.lastActivity")}</dt><dd>{formatTime(selectedNode.lastActivityAt, resolvedLanguage)}</dd>
          </dl>
        </aside>
      ) : null}

      {graph && graph.gaps.length > 0 ? (
        <section className="team-gaps" aria-label={t("team.gaps.title")}>
          <h3>{t("team.gaps.title")}</h3>
          <p className="muted small">{t("team.gaps.detail")}</p>
          <ul>
            {graph.gaps.map(gap => (
              <li key={gap.id}>
                <b>{t(`team.gaps.${GAP_KEY[gap.id]}`)}</b> · {t(`team.gapDetails.${GAP_KEY[gap.id]}`)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

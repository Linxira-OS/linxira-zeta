import type { ModelThinkingConfig } from "./model-thinking.js";
import type { ModelParameterValues, ModelParameterSources, ModelCatalogStatus } from "./model-adaptation.js";
/**
 * Public read models for the P0 surface: environment, capability, diagnostic,
 * session history and home pages (FRONTEND_INTEGRATION.md §12.1).
 *
 * Every model exposes only safe display facts: opaque identities, epochs,
 * versions and pre-redacted text. No absolute paths, PIDs, process handles,
 * private endpoints, tokens or secrets may ever appear in these shapes.
 */

import type {
  AgentId,
  OperatorStateSnapshot,
  StudioRuntimeSettingsSnapshot,
} from "@linxiraos/studio-protocol";

/** Runtime settings projection carried by an optional snapshot field. */
export type RuntimeSettingsReadModel = StudioRuntimeSettingsSnapshot;

import type {
  AuthorityEpoch,
  AuthorityId,
  DiagnosticEntryId,
  EnvironmentId,
  HistoryEntryId,
  RuntimeEpoch,
  RuntimeId,
  SessionId,
  ThreadId,
  WorkspaceId,
} from "./ids.js";

/** Platform family, mirroring the public PlatformPort union. Never implies a path. */
export type PlatformId = "win32" | "darwin" | "linux";

/** CPU architecture of the running platform. */
export type ArchId = "x64" | "arm64";

/**
 * Public (non-secret) part of the Host authority identity. The Renderer may
 * display and compare it; it never includes endpoints, tokens or process
 * information.
 */
export interface PublicAuthorityIdentity {
  readonly authorityId: AuthorityId;
  readonly authorityEpoch: AuthorityEpoch;
}

export type RuntimeConnectionStatus = "connecting" | "connected" | "disconnected" | "unavailable";

export type RuntimeClassification =
  | "unavailable"
  | "managed"
  | "compatible-system"
  | "limited-system"
  | "rejected";

export type RuntimeBackend = "studio-host" | "rpc-ui" | "acp";

/**
 * Why a Runtime never connected (`status === "unavailable"`). Closed union
 * so the Renderer can map to copy without parsing Host English sentences.
 * Present only with `unavailableReason`; never a path, PID or endpoint.
 */
export type RuntimeUnavailableCode =
  | "no-workspace"
  | "workspace-unusable"
  | "not-installed"
  | "resolution-rejected"
  | "resolution-limited"
  | "launch-failed"
  | "handshake-timeout"
  | "spawn-failed"
  | "exited-before-ready"
  | "not-wired";

/**
 * Why a previously connected Runtime dropped (`status === "disconnected"`).
 * Closed union so the Renderer can map copy without parsing Host sentences.
 * Present only with `disconnectReason`; never a path, PID or endpoint.
 */
export type RuntimeDisconnectCode =
  | "pipe-closed"
  | "process-exit"
  | "lease-lost"
  | "host-stop";

/**
 * Automatic relaunch after an unexpected drop. Present on a disconnected
 * connection so the Renderer can explain why a manual reconnect is still
 * needed. Never a path or PID.
 */
export type RuntimeAutoRespawnStatus = "scheduled" | "failed" | "exhausted";

/**
 * Runtime connection facts exposed to the Renderer. Carries only public
 * display facts: opaque identity, epochs, backend and versions. Never
 * carries the runtime PID, process handle, private endpoint or session
 * file path.
 */
export interface RuntimeConnection {
  readonly status: RuntimeConnectionStatus;
  readonly classification: RuntimeClassification;
  /** Opaque runtime identity; present once a runtime has been selected. */
  readonly runtimeId?: RuntimeId;
  /** Monotonic runtime generation; isolates stale runtime state and events. */
  readonly runtimeEpoch?: RuntimeEpoch;
  readonly backend?: RuntimeBackend;
  readonly runtimeVersion?: string;
  readonly upstreamVersion?: string;
  readonly upstreamCommit?: string;
  /** Present only when classification is "rejected". Safe, pre-redacted text. */
  readonly rejectionReason?: string;
  /**
   * Present when `status` is `"unavailable"` and the Host knows why.
   * Closed code for UI mapping; optional next to a pre-redacted sentence.
   */
  readonly unavailableCode?: RuntimeUnavailableCode;
  /** Safe, pre-redacted sentence explaining why the Runtime never connected. */
  readonly unavailableReason?: string;
  /**
   * Present when `status` is `"disconnected"` and the Host knows why.
   * Closed code for UI mapping; optional next to a pre-redacted sentence.
   */
  readonly disconnectCode?: RuntimeDisconnectCode;
  /** Safe, pre-redacted sentence explaining why the Runtime dropped. */
  readonly disconnectReason?: string;
  /** ISO timestamp of the drop; present with `disconnectCode` when known. */
  readonly disconnectedAt?: string;
  /** Automatic relaunch outcome after an unexpected drop. */
  readonly autoRespawn?: RuntimeAutoRespawnStatus;
}

/**
 * What the current surface (Desktop shell or local WebUI) may expose.
 * `terminalAttach`, `previewInput` and `fileReveal` default to off and are
 * only granted per surface policy (FRONTEND_INTEGRATION.md §10).
 */
export interface SurfaceCapabilities {
  readonly terminalAttach: boolean;
  readonly fileReveal: boolean;
  readonly previewInput: boolean;
  readonly openExternal: boolean;
}

export type RuntimeInstallStatus =
  | "not-installed"
  | "installing"
  | "installed"
  | "update-available"
  | "failed";

export type SignatureStatus = "verified" | "unverified" | "unknown";

/**
 * Runtime installer facts for the environment page. Never carries install
 * or fallback paths.
 */
export interface RuntimeInstallState {
  readonly status: RuntimeInstallStatus;
  /** Currently installed runtime version, when one exists. */
  readonly version?: string;
  /**
   * Newest locally discovered signed artifact version. Present when a
   * probe found an artifact (installable or newer than `version`).
   * Never a path.
   */
  readonly availableVersion?: string;
  readonly signature: SignatureStatus;
  /** Safe, pre-redacted message (e.g. a failure reason). */
  readonly message?: string;
}

/** Environment page read model: platform, authority, runtime and installer. */
export interface EnvironmentReadModel {
  readonly platform: PlatformId;
  readonly arch: ArchId;
  readonly authority: PublicAuthorityIdentity;
  readonly runtime: RuntimeConnection;
  readonly installer: RuntimeInstallState;
}

export type DiagnosticLevel = "info" | "warning" | "error";

export type DiagnosticScope = "host" | "runtime" | "bridge" | "installer";

export interface DiagnosticEntry {
  readonly entryId: DiagnosticEntryId;
  readonly scope: DiagnosticScope;
  readonly level: DiagnosticLevel;
  /** Pre-redacted text, safe to display and copy verbatim. */
  readonly message: string;
  /**
   * Structured detail values, already redacted at the Host boundary.
   * Kept as a value record because diagnostic payloads are heterogeneous;
   * every other shape in this contract is exact.
   */
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

/** Diagnostics page read model. `redacted` is a contract guarantee. */
export interface DiagnosticReadModel {
  readonly generatedAt: string;
  readonly authority: PublicAuthorityIdentity;
  readonly entries: ReadonlyArray<DiagnosticEntry>;
  readonly redacted: true;
}

export type SessionHistoryStatus = "active" | "archived" | "closed";

/** One session-history row: opaque ids plus a safe, path-free summary. */
/** IM/bot/relay provenance of a session; absent on personal coding sessions. */
export interface SessionOriginSummary {
  readonly kind: "im";
  readonly channel?: string;
  readonly chatId?: string;
  readonly botSessionId?: string;
  readonly workspaceAlias?: string;
  readonly agentId?: string;
  readonly bindingId?: string;
}

export interface SessionHistoryEntry {
  readonly historyId: HistoryEntryId;
  readonly threadId: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly sessionId?: SessionId;
  /** Safe persisted title; absent while native OMP still considers the session untitled. */
  readonly title?: string;
  /** Safe summary snippet; never a path. */
  readonly summary?: string;
  readonly startedAt: string;
  readonly lastActiveAt: string;
  readonly messageCount: number;
  readonly status: SessionHistoryStatus;
  /** OMP v18 global session pin state; optional for older Hosts. */
  readonly pinned?: boolean;
  /** IM/bot/relay provenance; absent on personal sessions. */
  readonly origin?: SessionOriginSummary;
}

export interface SessionHistoryReadModel {
  readonly entries: ReadonlyArray<SessionHistoryEntry>;
  readonly total: number;
}

/** Why a resident session is waiting for the operator, when it is waiting. */
export type ResidentWaitKind = "approval" | "ask" | "plan";

/** Lifecycle phase of a Runtime session resident in the Host broker. */
export type ResidentSessionPhase = "idle" | "running" | "compacting" | "waiting";

/** Public broker row for one resident Runtime session. */
export interface ResidentSessionRow {
  readonly sessionId: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly phase: ResidentSessionPhase;
  readonly pendingMessages: number;
  readonly waitKind?: ResidentWaitKind;
  readonly lastActivityAt: string;
}

/** Authority-level overview of Runtime sessions resident in the Host broker. */
export interface ResidentsReadModel {
  readonly residents: ReadonlyArray<ResidentSessionRow>;
  readonly activeSessionId?: SessionId;
  readonly generatedAt: string;
}

/**
 * Object kind a Team graph node represents.
 *
 * The Team root is deliberately NOT a node kind: it is an ownerless container
 * (`TeamGraphCluster` kind `"team"`) with no agent, workspace, Git repo, session
 * or `AGENTS.md`. Only the objects below own something:
 * - `pm-workspace`: `pms/<pm>/`, the PM main agent's plain-folder workspace;
 * - `git-repo`: a canonical base repository at `<team>/repos/<repo>` (the only
 *   Git layer); PMs bind to it through DB `repo_bindings`, never a per-PM copy;
 * - `db-room`: a `rooms` row + `room_events`, never a folder;
 * - `linked-worktree`: a worktree of a repository, outside it;
 * - `engineer`: a Team DB engineer record; it carries a live main agent when
 *   one is attached, and stays `offline` otherwise;
 * - `agent`: a live main agent that no Team record claims;
 * - `subagent`: a spawned child; it owns no folder, branch or worktree.
 *
 * Every kind except `agent`/`subagent` comes from the Team DB or a live-agent
 * fact. A missing row is absent, never synthesized.
 */
export type TeamNodeKind =
  | "pm-workspace"
  | "git-repo"
  | "db-room"
  | "linked-worktree"
  | "engineer"
  | "agent"
  | "subagent";

/**
 * Agent role inside a team. `unknown` is the honest value for a live main agent
 * that no PM/engineer/secretary record claims.
 */
export type TeamAgentRole = "pm" | "engineer" | "secretary" | "unknown";

/**
 * How an agent executes. `vibe` is a live director session or a Team engineer
 * recorded as `vibe`; `unknown` is a root whose session is not attached in this
 * process (no mode state to read).
 */
export type TeamExecutionMode = "vibe" | "normal" | "unknown";

/**
 * Whether the node can be revived from its transcript. Derived: a main agent is
 * always persistent; a subagent is persistent when its transcript is retained.
 */
export type TeamNodeLifetime = "persistent" | "ephemeral";

/**
 * Lifecycle state. `offline` is a Team DB record whose main session is not
 * attached in this process, so no live registry status exists.
 */
export type TeamNodeStatus = "running" | "idle" | "parked" | "aborted" | "offline";

/**
 * Edge kinds, all backed by a producer:
 * - `spawn`: registry parentage or a PM-owned persistent subagent row;
 * - `assignment`: Team DB `engineers.pm_id`;
 * - `room`: Team DB `room_members` (member → room);
 * - `contains`: a worktree holds its engineer's workspace;
 * - `binding`: Team DB `repo_bindings` (PM → base repo);
 * - `worktree-of`: Team DB `worktrees.repo_id` (base repo → linked worktree).
 */
export type TeamEdgeKind = "spawn" | "assignment" | "room" | "contains" | "binding" | "worktree-of";

interface TeamGraphNodeBase {
  /** Stable id unique across the graph. Never a filesystem path. */
  readonly nodeId: string;
  readonly kind: TeamNodeKind;
  readonly displayName: string;
  /** Container this object is displayed in; `team` or `unassigned`. */
  readonly clusterId: string;
  /** Structural parent, when the producer knows one. */
  readonly parentNodeId?: string;
  /** Hashed Studio workspace id; never a path. */
  readonly workspaceId?: WorkspaceId;
  /** Workspace basename from the Host inventory; never a path. */
  readonly workspaceName?: string;
  readonly createdAt: string;
  readonly lastActivityAt: string;
}

/** Live agent or subagent. Subagents own no folder, branch or worktree. */
export interface TeamAgentNode extends TeamGraphNodeBase {
  readonly kind: "agent" | "subagent";
  readonly agentId: AgentId;
  /** Root session id for an agent; child transcript scope for a subagent. */
  readonly sessionId?: SessionId;
  /** Present on `agent`; also names a PM-owned Secretary subagent. */
  readonly role?: TeamAgentRole;
  readonly status: TeamNodeStatus;
  readonly executionMode: TeamExecutionMode;
  readonly lifetime: TeamNodeLifetime;
  /** Spawn brief shown as the edge/node label, truncated for display. */
  readonly assignment?: string;
  readonly activity?: string;
}

/**
 * A Team DB ownership object (PM workspace, repo, room, worktree). A PM
 * workspace may also carry the live PM main agent facts; a linked worktree
 * names its branch. Paths are never serialized.
 */
export interface TeamPathNode extends TeamGraphNodeBase {
  readonly kind: "pm-workspace" | "git-repo" | "db-room" | "linked-worktree";
  /** Opaque producer id (team/pm/repo/room/worktree id), never a path. */
  readonly objectId?: string;
  /** For `linked-worktree`: the engineer's `home` or a task worktree. */
  readonly worktreeKind?: "home" | "task";
  /** Worktree branch as recorded by the Team DB, never a path. */
  readonly branch?: string;
  /** Live PM main agent attached to a `pm-workspace`, when one exists. */
  readonly agentId?: AgentId;
  readonly sessionId?: SessionId;
  readonly status?: TeamNodeStatus;
  readonly executionMode?: TeamExecutionMode;
  readonly lifetime?: TeamNodeLifetime;
}

/**
 * A Team DB engineer record. `executionMode` is the recorded Team Vibe/normal
 * mode, and `offline` means no live main session is attached in this process.
 */
export interface TeamEngineerNode extends TeamGraphNodeBase {
  readonly kind: "engineer";
  readonly objectId?: string;
  readonly agentId?: AgentId;
  readonly sessionId?: SessionId;
  readonly status: TeamNodeStatus;
  readonly executionMode: TeamExecutionMode;
  readonly lifetime: TeamNodeLifetime;
}

export type TeamGraphNode = TeamAgentNode | TeamPathNode | TeamEngineerNode;

/** One relationship between two Team graph nodes. */
export interface TeamGraphEdge {
  readonly edgeId: string;
  readonly kind: TeamEdgeKind;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

/**
 * A display container. A `team` cluster is the dashed ownerless boundary; it is
 * never an agent node. `unassigned` groups live agents while no team record
 * exists, and must not be presented as a Team.
 */
export interface TeamGraphCluster {
  readonly clusterId: string;
  readonly kind: "team" | "unassigned";
  /** Team id from `.zeta/team.json`; absent for `unassigned`. */
  readonly teamId?: string;
  /** Team name; absent for `unassigned` (the renderer localizes its label). */
  readonly label?: string;
  /** Nodes displayed inside the boundary. */
  readonly memberCount: number;
}

/** A producer the graph needs but this Host does not have yet. */
export interface TeamGraphGap {
  readonly id:
    | "team-root"
    | "pm-workspaces"
    | "git-repos"
    | "db-rooms"
    | "worktrees"
    | "roles"
    | "assignments"
    | "secretary";
  readonly detail: string;
}

/**
 * Team topology read model. Empty or partial data is first-class: the arrays may
 * be empty and `gaps` names the missing producers instead of fabricating rows.
 */
export interface TeamGraphReadModel {
  readonly generatedAt: string;
  readonly nodes: ReadonlyArray<TeamGraphNode>;
  readonly edges: ReadonlyArray<TeamGraphEdge>;
  readonly clusters: ReadonlyArray<TeamGraphCluster>;
  readonly gaps: ReadonlyArray<TeamGraphGap>;
  /** True when the node cap dropped rows. */
  readonly truncated?: boolean;
  /** Mains whose subagent roster could not be read; their spawn tree is missing. */
  readonly incompleteMainIds?: ReadonlyArray<string>;
}

/** Recent thread row for the home page: opaque id plus a safe title. */
export interface RecentThread {
  readonly threadId: ThreadId;
  /** Absent until native OMP persists a session title. */
  readonly title?: string;
  readonly lastActiveAt: string;
}

/**
 * One workspace row for the workbench/home surfaces. Carries only the
 * opaque workspace id, a basename-only display name and the last-open
 * timestamp. Never a path, cwd or root: paths live in the Host registry.
 */
export interface WorkspaceRecord {
  readonly workspaceId: WorkspaceId;
  /** Basename only. Never a path. */
  readonly name: string;
  readonly lastOpenedAt: string;
  readonly active: boolean;
}

/** Workspace inventory read model; the active workspace is optional. */
export interface WorkspaceListReadModel {
  readonly workspaces: ReadonlyArray<WorkspaceRecord>;
  readonly activeWorkspaceId?: WorkspaceId;
}

/** A workspace-relative Explorer node. Absolute paths never cross the Host boundary. */
export interface WorkspaceFileNode {
  readonly type: "file" | "dir";
  readonly name: string;
  /** Normalized workspace-relative path (forward slashes). */
  readonly path: string;
  readonly children?: ReadonlyArray<WorkspaceFileNode>;
}

/** Current file tree for a registered workspace. */
export interface WorkspaceFileTreeReadModel {
  readonly workspaceId: WorkspaceId;
  readonly nodes: ReadonlyArray<WorkspaceFileNode>;
}

/** Terminal result for a workspace file mutation. */
export interface WorkspaceFileMutationResult {
  readonly applied: boolean;
  readonly kind: "file" | "directory";
  readonly path: string;
}

/** Home page read model: runtime status plus the current read snapshot. */
export interface HomeReadModel {
  readonly authority: PublicAuthorityIdentity;
  readonly runtime: RuntimeConnection;
  readonly snapshot: OperatorStateSnapshot;
  readonly recentThreads: ReadonlyArray<RecentThread>;
  /** Most-recently-opened workspaces; the full list comes from `projects.list`. */
  readonly recentWorkspaces?: ReadonlyArray<WorkspaceRecord>;
}

/** One local calendar day of aggregated token usage. Date is `YYYY-MM-DD`. */
export interface TokenUsageDayPoint {
  readonly date: string;
  readonly totalTokens: number;
}

/** Safe model id for the homepage usage chart legend. Never a path. */
export interface TokenUsageModelRef {
  readonly id: string;
}

/** Per-model tokens for one local calendar day. */
export interface TokenUsageModelDayPoint {
  readonly date: string;
  readonly model: string;
  readonly tokens: number;
}

/** Per-model tokens for one local hour of today (`0`–`23`). */
export interface TokenUsageHourPoint {
  readonly hour: number;
  readonly model: string;
  readonly tokens: number;
}

/**
 * Homepage Token heatmap / curve read model. Aggregates only: no session
 * files, folders, or other filesystem facts.
 */
export interface TokenUsageReadModel {
  readonly generatedAt: string;
  readonly days: ReadonlyArray<TokenUsageDayPoint>;
  readonly models: ReadonlyArray<TokenUsageModelRef>;
  readonly byModel: ReadonlyArray<TokenUsageModelDayPoint>;
  readonly hours: ReadonlyArray<TokenUsageHourPoint>;
  readonly unavailableReason?: string;
}

/**
 * Loopback endpoint of the native `zetacode stats` dashboard, which the statistics
 * page embeds. The Host starts the dashboard on demand and probes it with its
 * own identity header, so `available` reflects a server that answered — not a
 * path that was found on disk. `url` is loopback-only and carries a deep link
 * to the requested section and range.
 */
export interface StatsDashboardReadModel {
  readonly available: boolean;
  /** Loopback dashboard URL with a `#/<section>?range=<range>` deep link. */
  readonly url?: string;
  /** User-facing reason when no dashboard answered. */
  readonly reason?: string;
}

/** Wire API used by a provider or custom model in `models.yml`. */
export type ModelApiKind =
  | "openai-completions"
  | "openai-responses"
  | "openai-codex-responses"
  | "azure-openai-responses"
  | "anthropic-messages"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "google-gemini-cli"
  | "google-vertex";

export type ModelAuthType = "oauth" | "api-key" | "env" | "command" | "none";

/**
 * OMP treats a models.yml `apiKey` as an environment variable name when it
 * looks like one (`FOO_BAR`, all-caps identifiers). Literal keys (`sk-…`)
 * and `!command` values are not env names.
 */
export function isModelEnvConfigName(value: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return false;
  if (/^sk/i.test(value)) return false;
  return value.includes("_") || (value === value.toUpperCase() && value.length >= 4);
}

export type ModelProviderSource = "builtin" | "custom" | "runtime" | "extension";

export type ModelProviderStatus =
  | "available"
  | "not-authenticated"
  | "disabled"
  | "offline"
  | "auth-expired"
  | "config-error"
  | "connection-failed";

export type ModelEntryStatus = "available" | "disabled" | "unavailable";

export type ModelEntrySource = "catalog" | "discovery" | "custom" | "extension";

/**
 * Credential metadata for a provider.
 * `apiKey` echoes the credential value stored in models.yml (plain key for
 * `api-key`, `!command` string for `command`) so the editor can pre-fill it.
 * `envName` is the environment variable name for `env` auth (not a secret).
 * Deliberate choice: the desktop console is a local trusted surface.
 */
export interface ModelAuthMeta {
  readonly type: ModelAuthType;
  readonly hasSecret: boolean;
  readonly account?: string;
  readonly apiKey?: string;
  readonly envName?: string;
}

export interface ModelDiscoveryMeta {
  readonly advertisedReasoning?: boolean;
  readonly type: string;
  readonly timeoutMs?: number;
}

export interface ModelCostMeta {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

export interface ModelLongContextPrice extends ModelCostMeta {
  readonly inputThreshold: number;
  readonly inputThresholdInclusive?: boolean;
}

export interface ModelPricingMeta {
  readonly longContext?: ModelLongContextPrice;
  readonly timeBased?: {
    readonly offPeakMultiplier: number;
    readonly peakWindows: ReadonlyArray<{ readonly weekdays: readonly number[]; readonly startMinute: number; readonly endMinute: number }>;
    readonly effectiveRates?: ReadonlyArray<ModelCostMeta & { readonly effectiveFrom: number; readonly longContext?: ModelLongContextPrice }>;
  };
}

/** Safe subset of OMP `remoteCompaction` exposed for display/edit. */
export interface ModelProviderRemoteCompaction {
  readonly enabled?: boolean;
  readonly endpoint?: string;
  readonly model?: string;
}

/** Partial `models.yml` modelOverrides / extra custom-model fields. */
export interface ModelOverridePatch {
  readonly maxContextWindow?: number;
  readonly thinkingConfig?: ModelThinkingConfig | null;
  readonly parameterSources?: ModelParameterSources;
  /** Native compat.bedrockMessagesApi; fits anthropic-messages payloads to Bedrock constraints. */
  readonly bedrockMessagesApi?: boolean;
  readonly requiresThinkingPresence?: boolean;
  readonly extendedCacheTtlBeta?: boolean;
  readonly kind?: import("./model-kinds.js").ModelKind;
  readonly webSearch?: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly reasoning?: boolean;
  readonly image?: boolean;
  readonly tools?: boolean;
  readonly cost?: ModelCostMeta;
  readonly omitMaxOutputTokens?: boolean;
  readonly premiumMultiplier?: number;
  readonly imageCountBudget?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly contextPromotionTarget?: string;
  readonly compactionModel?: string;
  readonly remoteCompaction?: ModelProviderRemoteCompaction;
  /** Allowed thinking strengths written as `thinking.efforts` in models.yml. */
  readonly thinking?: ReadonlyArray<string>;
}

/** One model row under a provider. Safe display facts only. */
export interface ModelExecutionMetadata {
  readonly serviceTiers?: ReadonlyArray<string>;
  readonly promptCache?: { readonly short?: number; readonly long?: number };
  readonly promptCacheConfig?: { readonly short?: number; readonly long?: number };
  readonly compatibility?: { readonly preferWebsockets?: boolean; readonly useResponsesLite?: boolean; readonly toolMode?: "code_mode_only" };
}
export interface ModelCatalogEntry extends ModelExecutionMetadata {
  readonly thinkingConfig?: ModelThinkingConfig | null;
  readonly parameters?: ModelParameterValues;
  readonly parameterSources?: ModelParameterSources;
  readonly bedrockMessagesApi?: boolean;
  readonly requiresThinkingPresence?: boolean;
  readonly extendedCacheTtlBeta?: boolean;
  readonly kind?: import("./model-kinds.js").ModelKind;
  readonly webSearch?: string;
  readonly id: string;
  readonly name: string;
  readonly selector: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly image: boolean;
  readonly reasoning: boolean;
  readonly tools: boolean;
  readonly cost?: ModelCostMeta;
  readonly pricing?: ModelPricingMeta;
  readonly maxContextWindow?: number;
  readonly status: ModelEntryStatus;
  readonly source: ModelEntrySource;
  readonly api?: string;
  readonly baseUrl?: string;
  readonly omitMaxOutputTokens?: boolean;
  readonly premiumMultiplier?: number;
  readonly imageCountBudget?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly contextPromotionTarget?: string;
  readonly compactionModel?: string;
  readonly remoteCompaction?: ModelProviderRemoteCompaction;
  /** Allowed thinking strengths (`off` / `low` / `medium` / `high` / `xhigh` / `max`). */
  readonly thinking?: ReadonlyArray<string>;
}

/** One configured or discovered provider on the model-config page. */
export interface ModelProviderRecord {
  readonly id: string;
  readonly name: string;
  readonly source: ModelProviderSource;
  readonly status: ModelProviderStatus;
  readonly statusDetail: string;
  readonly api: ModelApiKind | string;
  readonly endpointUrl?: string;
  readonly local: boolean;
  readonly enabled: boolean;
  readonly website?: string;
  readonly note?: string;
  readonly auth: ModelAuthMeta;
  readonly discovery?: ModelDiscoveryMeta;
  readonly headers?: Record<string, string>;
  readonly disableStrictTools?: boolean;
  readonly transport?: "pi-native";
  readonly remoteCompaction?: ModelProviderRemoteCompaction;
  readonly models: ReadonlyArray<ModelCatalogEntry>;
  /** Safe subset of `models.yml` modelOverrides (no secrets). */
  readonly modelOverrides?: Readonly<Record<string, ModelOverridePatch>>;
}

export type ModelPresetAuth = ModelAuthType;

export interface ModelPresetItem {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly api: ModelApiKind | string;
  readonly auth: ReadonlyArray<ModelPresetAuth>;
  readonly endpoint?: string;
  readonly local?: boolean;
  readonly discovery?: string;
  readonly popular?: boolean;
  readonly oauth?: boolean;
}

export interface ModelPresetGroup {
  readonly group: string;
  readonly items: ReadonlyArray<ModelPresetItem>;
}

export type ModelRoleIssueKind =
  | "model-missing"
  | "provider-unauth"
  | "provider-disabled"
  | "provider-down"
  | "model-disabled"
  | "model-unavailable";

export interface ModelRoleIssue {
  readonly kind: ModelRoleIssueKind;
  readonly detail: string;
}

export type ModelRoleStorage = "global" | "project";
export type ModelFallbackRevertPolicy = "cooldown-expiry" | "never";

/** Built-in or custom model role. `scope` is which config file currently owns the assignment. */
export interface ModelRoleRecord {
  readonly id: string;
  readonly alias: string;
  readonly name: string;
  readonly desc: string;
  readonly builtin: boolean;
  readonly primary: string;
  readonly thinking?: string;
  readonly scope: ModelRoleStorage;
  readonly issue?: ModelRoleIssue;
}

export interface AvailableModelRecord extends ModelExecutionMetadata {
  readonly thinkingConfig?: ModelThinkingConfig | null;
  readonly kind?: import("./model-kinds.js").ModelKind;
  readonly webSearch?: string;
  readonly provider: string;
  readonly id: string;
  readonly selector: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly image?: boolean;
  readonly tools?: boolean;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly thinking?: ReadonlyArray<string>;
  readonly cost?: ModelCostMeta;
  readonly pricing?: ModelPricingMeta;
  readonly maxContextWindow?: number;
  readonly api?: string;
}

export interface ModelLoginProviderRecord {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
  readonly authenticated: boolean;
}

/**
 * One web_search provider surfaced to the model-config page. `description`
 * carries the upstream credential-requirement note; `hasCredential` is a
 * Host-side approximation (env var or stored auth), never a secret value.
 */
export interface WebSearchProviderRecord {
  readonly id: string;
  readonly name: string;
  /** Upstream `SEARCH_PROVIDER_OPTIONS` description: which credential this provider needs. */
  readonly description: string;
  /** True when the provider works with no credential at all (scraper engines, public). */
  readonly credentialFree: boolean;
  /** True when the Host detects an env var or stored/OAuth credential. */
  readonly hasCredential: boolean;
  /** Env vars the runtime accepts for this provider's credential (empty for keyless engines). */
  readonly envKeys?: ReadonlyArray<string>;
  /** `zetacode login` provider id when an in-app OAuth login exists; absent otherwise. */
  readonly loginId?: string;
  /** agent.db provider id the engine reads an api_key from; absent when there is no direct key path. */
  readonly apiKeyId?: string;
  /** How the currently detected credential is satisfied (env takes precedence, like the runtime). */
  readonly credentialKind?: "api-key" | "oauth" | "env";
}

/** Per-provider web search options edited in the advanced section. */
export interface WebSearchAdvancedConfig {
  readonly searxng?: {
    readonly endpoint?: string;
    /** True when a token is configured; the value itself never leaves the Host. */
    readonly tokenSet?: boolean;
    readonly basicUsername?: string;
    /** True when a basic-auth password is configured; the value never leaves the Host. */
    readonly passwordSet?: boolean;
    /** Comma-separated SearXNG category filter (`searxng.categories`). */
    readonly categories?: string;
    /** Comma-separated engine names or shortcuts (`searxng.engines`). */
    readonly engines?: string;
    /** Language code such as `en` / `zh-CN` (`searxng.language`). */
    readonly language?: string;
    /** SearXNG safe-search level 0/1/2 (`searxng.safesearch`). */
    readonly safesearch?: number;
  };
  readonly exa?: {
    readonly enabled?: boolean;
    readonly searchDelayMs?: number;
  };
}

/** Web-search configuration section of the model-config read model. */
export interface WebSearchRouting {
  readonly primary: string;
  /** null follows native priority defaults; [] explicitly disables fallback. */
  readonly fallbacks: ReadonlyArray<string> | null;
  readonly defaultCandidates: ReadonlyArray<string>;
  readonly migratedLegacy: boolean;
}
export interface WebSearchConfigReadModel {
  readonly routing?: WebSearchRouting;
  /** `web_search.enabled` — global tool switch. */
  readonly enabled: boolean;
  /** `providers.webSearchOrder` — explicit priority list; empty = built-in order. */
  readonly order: ReadonlyArray<string>;
  /** `providers.webSearchExclude` — providers never used, even as fallbacks. */
  readonly exclude: ReadonlyArray<string>;
  /** `providers.webSearchTimeoutSeconds` — per-provider transport hard timeout. */
  readonly timeoutSeconds: number;
  /** `providers.webSearchGeminiModel` — Gemini grounding model; empty = runtime default. */
  readonly geminiModel: string;
  /** Static catalog of the 23 built-in search providers, in runtime chain order. */
  readonly providers: ReadonlyArray<WebSearchProviderRecord>;
  readonly advanced: WebSearchAdvancedConfig;
}

/**
 * Targeted web-search config write: only the fields explicitly provided are
 * written to `config.yml`; everything else is left untouched. Empty strings
 * clear scalar values except `searxng.token` / `searxng.basicPassword`, where
 * an empty string keeps the existing secret (values are never read back).
 * `searxng.safesearch` uses `null` to delete the key; omitting it keeps it.
 */
export interface ModelWebSearchSetInput {
  readonly routing?: Pick<WebSearchRouting, "primary" | "fallbacks">;
  readonly enabled?: boolean;
  readonly order?: ReadonlyArray<string>;
  readonly exclude?: ReadonlyArray<string>;
  readonly timeoutSeconds?: number;
  readonly geminiModel?: string;
  readonly searxng?: {
    readonly endpoint?: string;
    readonly token?: string;
    readonly basicUsername?: string;
    readonly basicPassword?: string;
    readonly categories?: string;
    readonly engines?: string;
    readonly language?: string;
    /** 0/1/2, or null to delete the key back to the instance default. */
    readonly safesearch?: number | null;
  };
  readonly exa?: {
    readonly enabled?: boolean;
    readonly searchDelayMs?: number;
  };
}

/**
 * Studio-managed web-search credential write: stores an `api_key` credential
 * for the engine in the local OMP credential store (agent.db) so the runtime
 * picks it up natively — no `zetacode login` and no environment variables needed.
 */
export interface ModelWebSearchCredentialSetInput {
  /** Search engine id (catalog id, e.g. `tavily`). */
  readonly providerId: string;
  /** Non-empty API key; the value never leaves the Host after the write. */
  readonly apiKey: string;
}

/** Soft-deletes the Studio-managed api_key credential of a search engine. */
export interface ModelWebSearchCredentialRemoveInput {
  readonly providerId: string;
}

/**
 * Model-config page read model. Paths, API keys and auth-store secrets
 * never appear. `generated*Yml` is Host-built and already redacted.
 */
export interface ModelConfigReadModel {
  readonly catalog?: ModelCatalogStatus;
  readonly providers: ReadonlyArray<ModelProviderRecord>;
  readonly presets: ReadonlyArray<ModelPresetGroup>;
  readonly roles: ReadonlyArray<ModelRoleRecord>;
  readonly cycleOrder: ReadonlyArray<string>;
  readonly availableModels: ReadonlyArray<AvailableModelRecord>;
  readonly loginProviders: ReadonlyArray<ModelLoginProviderRecord>;
  readonly generatedModelsYml: string;
  readonly generatedConfigYml: string;
  readonly runtimeEffectHint: string;
  readonly contentHash?: string;
  readonly loginAvailable: boolean;
  readonly ompAvailable: boolean;
  readonly unavailableReason?: string;
  readonly modelRoleStorage: ModelRoleStorage;
  readonly projectScopeAvailable: boolean;
  readonly modelProviderOrder: ReadonlyArray<string>;
  readonly fallbackChains: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly fallbackRevertPolicy: ModelFallbackRevertPolicy;
  readonly webSearch: WebSearchConfigReadModel;
}

/** Skill origin as OMP discovery would classify it. Never a filesystem path. */
export type SkillScope = "workspace" | "global" | "builtin";

/** Which configured source produced the winning skill of a given name. */
export type SkillSourceKind = "native" | "plugin" | "managed";

/**
 * One configured skill. Paths, SKILL.md body and Host-internal directories
 * never appear. `loaded` / session availability are unknown without Runtime
 * introspection and are therefore omitted.
 */
export interface SkillRecord {
  readonly name: string;
  readonly desc: string;
  readonly scope: SkillScope;
  readonly sourceKind: SkillSourceKind;
  /** Safe display label: OMP / Codex / Claude / OpenCode / GitHub / Agents / 插件 / 托管. */
  readonly sourceLabel: string;
  /** Frontmatter `enabled` is not `false`. */
  readonly enabled: boolean;
  readonly hide: boolean;
  /** Pre-redacted validation problem (e.g. missing description). */
  readonly error?: string;
}

export type PluginSourceKind = "npm" | "marketplace" | "link" | "git";

export type PluginConfigStatus = "configured" | "error";

/** Panel kinds a plugin may declare in `ui.panels`. */
export type PluginPanelKind = "list" | "form" | "chart" | "html";

/** One declared panel: what the plugin says it can render, not a live view. */
export interface PluginPanelRecord {
  readonly id: string;
  readonly title: string;
  readonly kind: PluginPanelKind;
}

/**
 * One configured plugin from the Zeta-native registry
 * (`installed_plugins.json` + the canonical plugin lockfile), the same store the
 * CLI reads. Contribution lists are declared entry names from the package
 * manifest, not Runtime-registered tools.
 */
export interface PluginRecord {
  /** Addressable registry key: `name@marketplace` or the package name. */
  readonly name: string;
  /** Display name from `plugin.json`; falls back to the package name. */
  readonly title: string;
  readonly version: string;
  readonly sourceKind: PluginSourceKind;
  /** Safe display label: npm / 市场 / 链接 / git. */
  readonly srcLabel: string;
  readonly scope: "user" | "project";
  readonly enabled: boolean;
  readonly status: PluginConfigStatus;
  readonly tools: number;
  readonly commands: number;
  readonly hooks: number;
  readonly ui: boolean;
  readonly toolItems: ReadonlyArray<string>;
  readonly commandItems: ReadonlyArray<string>;
  readonly hookItems: ReadonlyArray<string>;
  readonly uiItems: ReadonlyArray<string>;
  /** Panels declared in `plugin.json` / `package.json#zeta.ui`, in order. */
  readonly panels: ReadonlyArray<PluginPanelRecord>;
  readonly err?: string;
}

/**
 * Configured skills + plugins inventory. This is a disk scan of Zeta-native
 * locations, not the Runtime effective/loaded set.
 */
export interface ExtensibilityReadModel {
  readonly skills: ReadonlyArray<SkillRecord>;
  readonly plugins: ReadonlyArray<PluginRecord>;
  /** Pre-redacted collision / parse notes. Never paths. */
  readonly warnings: ReadonlyArray<string>;
  readonly generatedAt: string;
  readonly unavailableReason?: string;
}

/** MCP transport kinds surfaced in the public inventory (no connection details). */
export type McpTransport = "stdio" | "http" | "sse";

/**
 * Configured-only MCP status. Not Runtime connection state
 * (`connected` / reconnecting / error).
 */
export type McpConfigStatus = "enabled" | "disabled" | "shadowed";

/**
 * Last Host-owned one-shot probe for an MCP server. Never includes command,
 * URL, headers, or secrets.
 */
export interface McpLastProbe {
  readonly ok: boolean;
  readonly at: string;
  readonly detail: string;
  readonly toolCount?: number;
}

/**
 * One configured MCP server from Zeta-native mcp.json discovery.
 * Never includes command, args, env, url, headers, or OAuth secrets.
 */
export interface McpServerRecord {
  /** Native per-server instructions policy; absent on older Hosts. */
  readonly instructions?: boolean;
  readonly instructionsWritable?: boolean;
  readonly name: string;
  readonly transport: McpTransport;
  /** Effective enabled after denylist / allowlist / per-entry flags. */
  readonly enabled: boolean;
  readonly status: McpConfigStatus;
  /** Safe display label: 用户 / 项目. */
  readonly sourceLabel: string;
  readonly scope: "user" | "project";
  /** Host-process memory from the last `mcp.test`; omitted until probed. */
  readonly lastProbe?: McpLastProbe;
}

/**
 * Configured MCP server inventory. Disk scan of Zeta-native mcp.json paths,
 * not live MCPManager connection state.
 */
export interface McpReadModel {
  readonly servers: ReadonlyArray<McpServerRecord>;
  /** Pre-redacted parse / collision notes. Never paths. */
  readonly warnings: ReadonlyArray<string>;
  readonly generatedAt: string;
  readonly unavailableReason?: string;
}

/** Terminal result of a Host-owned MCP one-shot connect (`initialize` + `tools/list`). */
export interface McpTestResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly detail: string;
  readonly toolCount?: number;
}

/**
 * Recent Host-owned MCP probe log lines for one server. Pre-redacted;
 * never paths, URLs, or secrets.
 */
export interface McpLogsReadModel {
  readonly name: string;
  readonly lines: ReadonlyArray<string>;
  readonly generatedAt: string;
  readonly emptyReason?: string;
}

/**
 * Configured OMP task-agent definition (Markdown + YAML frontmatter).
 * Disk inventory, not a live Agent Hub instance. Paths never appear.
 */
export type AgentDefinitionSource = "project" | "user" | "bundled" | "plugin";

/** Thinking selectors OMP accepts on agent frontmatter (`thinking-level` / `thinking`). */
export type AgentThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "auto";

export interface AgentDefinitionRecord {
  readonly name: string;
  readonly description: string;
  /** Prompt body below the frontmatter. Empty when the bundled prompt is packed in the runtime. */
  readonly systemPrompt: string;
  readonly tools?: ReadonlyArray<string>;
  readonly spawns?: ReadonlyArray<string> | "*";
  readonly model?: ReadonlyArray<string>;
  readonly thinkingLevel?: AgentThinkingLevel;
  readonly output?: unknown;
  readonly blocking?: boolean;
  readonly structured?: boolean;
  readonly autoloadSkills?: ReadonlyArray<string>;
  readonly readSummarize?: boolean;
  /** `true` = default prewalk target; string = custom model pattern. */
  readonly prewalk?: boolean | string;
  /** `true` = default advisor-role model; string = custom advisor model pattern. */
  readonly advisor?: boolean | string;
  readonly source: AgentDefinitionSource;
  /** Safe display label: 项目 / 用户 / 内置 / 插件. */
  readonly sourceLabel: string;
  readonly editable: boolean;
  readonly canDelete: boolean;
  readonly canFork: boolean;
  /** `task.disabledAgents` overlay. */
  readonly disabled: boolean;
  readonly overrideModel?: string;
  /** `task.agentPrewalk` overlay: `on` / `off` / pattern. */
  readonly prewalkOverride?: string;
  /** `task.agentAdvisor` overlay: `on` / `off` / pattern. */
  readonly advisorOverride?: string;
  readonly contentHash?: string;
  readonly error?: string;
  /** Bundled agents whose system prompt lives in the runtime binary. */
  readonly promptPacked?: boolean;
}

/**
 * Effective task-agent roster (first-wins by name) plus picker catalogs.
 * Not the Runtime loaded set.
 */
export interface AgentDefinitionsReadModel {
  readonly agents: ReadonlyArray<AgentDefinitionRecord>;
  /** Pre-redacted collision / parse notes. Never paths. */
  readonly warnings: ReadonlyArray<string>;
  readonly builtinToolNames: ReadonlyArray<string>;
  readonly roleAliases: ReadonlyArray<string>;
  readonly projectScopeAvailable: boolean;
  readonly generatedAt: string;
  readonly unavailableReason?: string;
}

export type ConfigRuntimeEffect = "immediate" | "new-session" | "restart-process";

/** Terminal result of a provider connection smoke test. Never a Runtime snapshot. */
export interface ModelProviderTestResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly detail: string;
  /** HTTP status observed on a successful reachability probe (any response counts). */
  readonly httpStatus?: number;
  /** Number of retries performed (only timeout-class failures are retried). */
  readonly retryCount?: number;
}

/**
 * One model returned by a discovery probe. Never a secret.
 *
 * The metadata fields are present only when the endpoint actually reported
 * them (OpenAI-compatible `context_length` / `max_model_len`, Gemini's
 * `inputTokenLimit`, OpenRouter modalities). Absent means "unknown" — OMP's
 * bundled catalog and its own defaults fill the gap at load time, so callers
 * must not substitute values of their own.
 */
export interface ModelDiscoveryModel {
  readonly thinkingConfig?: ModelThinkingConfig;
  readonly api?: string;
  readonly kind?: import("./model-kinds.js").ModelKind;
  readonly webSearch?: string;
  readonly id: string;
  readonly name: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly reasoning?: boolean;
  readonly image?: boolean;
}

/** Terminal result of a non-persisting discovery probe. */
export interface ModelDiscoveryResult {
  readonly ok: boolean;
  readonly found: number;
  readonly usable: number;
  readonly models: ReadonlyArray<ModelDiscoveryModel>;
  readonly latencyMs: number;
  readonly detail: string;
  readonly httpStatus?: number;
}

/** Terminal result of a model-config mutation. Never a Runtime snapshot. */
export interface ConfigWriteResult {
  readonly applied: boolean;
  readonly runtimeEffect: ConfigRuntimeEffect;
  readonly message?: string;
  readonly contentHash?: string;
}

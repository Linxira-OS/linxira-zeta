/**
 * Studio Team workspace contract fragment.
 *
 * This is the only public surface the Work Studio Team renderer uses. Every
 * operation names a registered `teamId`; the Host resolves the Team root from
 * that row. The single explicit path in this contract is the bootstrap root a
 * new Team is created at — routine reads and mutations never accept a path.
 *
 * No accounts, passwords, tokens or credentials exist here. Roles are Team
 * rows (PM, engineer, PM-owned Secretary); a local single user owns the store.
 */

/** Public Team row; the Host keeps `rootPath` private. */
export interface TeamSummary {
	readonly id: string;
	readonly name: string;
	readonly createdAt: number;
}

export type TeamTaskStatus = "pending" | "claimed" | "review" | "done" | "cancelled";

export interface TeamWorkspacePm {
	readonly id: string;
	readonly name: string;
}

export interface TeamWorkspaceEngineer {
	readonly id: string;
	readonly name: string;
	readonly pmId: string;
	readonly execution: "normal" | "vibe";
}

/** A canonical base repository or linked primary checkout. `basePath` stays in the Host. */
export interface TeamWorkspaceRepo {
	readonly id: string;
	readonly name: string;
	readonly defaultBranch: string;
	readonly remoteUrl?: string;
}

export interface TeamWorkspaceBinding {
	readonly repoId: string;
	readonly pmId: string;
}

/** A linked worktree; the absolute path is deliberately omitted. */
export interface TeamWorkspaceWorktree {
	readonly id: string;
	readonly repoId: string;
	readonly pmId: string;
	readonly engineerId: string;
	readonly kind: "home" | "task";
	readonly name: string;
	readonly branch: string;
	readonly baseBranch: string;
}

export type TeamRoomKind = "pm" | "coordination" | "room";

export interface TeamRoomSummary {
	readonly id: string;
	readonly name: string;
	readonly kind: TeamRoomKind;
	readonly pmId: string | null;
	readonly memberCount: number;
	readonly lastSeq: number | null;
	readonly lastSentAt: number | null;
}

export interface TeamRoomMember {
	readonly agentId: string;
	readonly role: string;
	/** Host-resolved display label; unknown ids stay as their id. */
	readonly label: string;
}

export interface TeamRoomEvent {
	readonly seq: number;
	readonly sentAt: number;
	readonly senderAgentId: string;
	readonly kind: string;
	readonly body: string;
	readonly replyTo: number | null;
	readonly mentions: ReadonlyArray<string>;
}

/** Durable delivery cursor for one room member. */
export interface TeamRoomSubscription {
	readonly roomId: string;
	readonly agentId: string;
	/** Highest seq a real transport/host accepted for delivery. */
	readonly acceptedThrough: number;
	/** Highest seq the member explicitly acknowledged as read. */
	readonly readThrough: number;
	readonly subscribedAt: number;
	readonly updatedAt: number;
}

export interface TeamRoomView {
	readonly room: TeamRoomSummary;
	readonly members: ReadonlyArray<TeamRoomMember>;
	readonly events: ReadonlyArray<TeamRoomEvent>;
	readonly subscription?: TeamRoomSubscription;
}

export interface TeamTaskEvent {
	readonly seq: number;
	readonly at: number;
	readonly actorAgentId: string;
	readonly kind: string;
	readonly body: string;
	readonly fromStatus: TeamTaskStatus | null;
	readonly toStatus: TeamTaskStatus | null;
	readonly reqIds: ReadonlyArray<string>;
	readonly leaseExpiresAt: number | null;
}

export interface TeamWorkspaceTask {
	readonly id: string;
	readonly taskKey: string;
	readonly title: string;
	readonly body: string;
	readonly status: TeamTaskStatus;
	readonly assignedPmId: string;
	readonly assigneeAgentId: string | null;
	readonly ownerAgentId: string | null;
	readonly ownerRole: string | null;
	readonly leaseExpiresAt: number | null;
	readonly reqIds: ReadonlyArray<string>;
	readonly revision: number;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface TeamTaskView {
	readonly task: TeamWorkspaceTask;
	readonly events: ReadonlyArray<TeamTaskEvent>;
}

export type TeamBootstrapMode = "team" | "engineer";
export type TeamBootstrapRunStatus = "planned" | "running" | "done" | "failed" | "compensated" | "rolled_back";
export type TeamBootstrapStepStatus = "planned" | "running" | "done" | "failed" | "compensated";

export interface TeamBootstrapStepSummary {
	readonly stepId: string;
	readonly seq: number;
	readonly kind: string;
	readonly description: string;
	readonly createdByRun: boolean;
	readonly status: TeamBootstrapStepStatus;
	readonly error?: string;
}

export interface TeamBootstrapRunSummary {
	readonly runId: string;
	readonly teamId: string | null;
	readonly mode: TeamBootstrapMode;
	readonly status: TeamBootstrapRunStatus;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly error: string | null;
	readonly steps: ReadonlyArray<TeamBootstrapStepSummary>;
}

export interface TeamBootstrapCheck {
	readonly id: string;
	readonly ok: boolean;
	readonly detail: string;
	readonly level: "error" | "warning";
}

export interface TeamBootstrapPreflight {
	readonly ok: boolean;
	readonly errors: ReadonlyArray<string>;
	readonly warnings: ReadonlyArray<string>;
	readonly checks: ReadonlyArray<TeamBootstrapCheck>;
}

/** A dry-run plan. The Team root and step payloads stay in the Host. */
export interface TeamBootstrapPlanView {
	readonly version: 1;
	readonly mode: TeamBootstrapMode;
	readonly teamId: string;
	readonly displayName: string;
	readonly steps: ReadonlyArray<TeamBootstrapStepSummary>;
	readonly preflight: TeamBootstrapPreflight;
}

/** Bootstrap input mirrors `team/bootstrap.ts`; only `root` carries a path. */
export interface TeamBootstrapPmInput {
	readonly name: string;
	readonly displayName?: string;
}

export interface TeamBootstrapRepoInput {
	readonly name: string;
	readonly clone?: string;
	readonly link?: string;
	readonly bindPms?: ReadonlyArray<string>;
}

export interface TeamBootstrapEngineerInput {
	readonly name: string;
	readonly pm: string;
	readonly repo: string;
	readonly execution?: "normal" | "vibe";
}

export interface TeamBootstrapRoomInput {
	readonly name: string;
	readonly kind?: TeamRoomKind;
	readonly pm?: string;
	readonly shared?: boolean;
	readonly members?: ReadonlyArray<string>;
}

export interface TeamBootstrapInput {
	readonly name: string;
	readonly root: string;
	readonly displayName?: string;
	readonly pms: ReadonlyArray<TeamBootstrapPmInput>;
	readonly repos?: ReadonlyArray<TeamBootstrapRepoInput>;
	readonly engineers?: ReadonlyArray<TeamBootstrapEngineerInput>;
	readonly rooms?: ReadonlyArray<TeamBootstrapRoomInput>;
	readonly engineerOnly?: boolean;
}

export interface TeamBootstrapApplyInput extends TeamBootstrapInput {
	readonly rollbackOnFailure?: boolean;
}

export interface TeamBootstrapResultView {
	readonly run: TeamBootstrapRunSummary;
	readonly doctor: TeamDoctorSummary;
}

export interface TeamBootstrapRollbackView {
	readonly run: TeamBootstrapRunSummary;
	readonly errors: ReadonlyArray<string>;
}

export interface TeamDoctorCheck {
	readonly id: string;
	readonly level: "error" | "warning";
	readonly ok: boolean;
	readonly detail: string;
}

export interface TeamDoctorSummary {
	readonly teamId: string;
	readonly ok: boolean;
	readonly checks: ReadonlyArray<TeamDoctorCheck>;
}

/** Complete Team workspace snapshot; real rows only, no fabricated agents. */
export interface TeamWorkspaceReadModel {
	readonly team: TeamSummary;
	readonly pms: ReadonlyArray<TeamWorkspacePm>;
	readonly engineers: ReadonlyArray<TeamWorkspaceEngineer>;
	readonly repos: ReadonlyArray<TeamWorkspaceRepo>;
	readonly bindings: ReadonlyArray<TeamWorkspaceBinding>;
	readonly worktrees: ReadonlyArray<TeamWorkspaceWorktree>;
	readonly rooms: ReadonlyArray<TeamRoomSummary>;
	readonly roomMembers: Readonly<Record<string, ReadonlyArray<TeamRoomMember>>>;
	readonly tasks: ReadonlyArray<TeamTaskView>;
	readonly bootstrapRuns: ReadonlyArray<TeamBootstrapRunSummary>;
	readonly warnings: ReadonlyArray<string>;
}

export interface TeamListResult {
	readonly teams: ReadonlyArray<TeamSummary>;
}

export interface TeamRoomEventsQuery {
	readonly teamId: string;
	readonly room: string;
	/** Return events newer than this sequence; omit for the newest page. */
	readonly afterSeq?: number;
	readonly limit?: number;
	/** Optional member whose subscription cursor is returned. */
	readonly agent?: string;
}

export interface TeamTaskShowQuery {
	readonly teamId: string;
	readonly task: string;
}

export interface TeamBootstrapRunsQuery {
	readonly teamId: string;
}

export interface TeamBootstrapRunsResult {
	readonly runs: ReadonlyArray<TeamBootstrapRunSummary>;
}

export interface TeamBootstrapPlanResult {
	readonly plan: TeamBootstrapPlanView;
	readonly preflight: TeamBootstrapPreflight;
}

export interface TeamPmAddCommand {
	readonly teamId: string;
	readonly pm: string;
	readonly displayName?: string;
}

export interface TeamRepoBindCommand {
	readonly teamId: string;
	readonly repo: string;
	readonly pm: string;
}

export interface TeamEngineerAddCommand {
	readonly teamId: string;
	readonly engineer: string;
	readonly pm: string;
	readonly repo: string;
	readonly execution?: "normal" | "vibe";
}

export interface TeamRoomCreateCommand {
	readonly teamId: string;
	readonly room: string;
	readonly kind?: TeamRoomKind;
	readonly pm?: string;
	readonly shared?: boolean;
	readonly members?: ReadonlyArray<string>;
}

export interface TeamRoomPostCommand {
	readonly teamId: string;
	readonly room: string;
	readonly body: string;
	readonly sender?: string;
	readonly replyTo?: number;
}

export interface TeamRoomSubscribeCommand {
	readonly teamId: string;
	readonly room: string;
	readonly agent: string;
	readonly fromSeq?: number;
}

export interface TeamRoomAckCommand {
	readonly teamId: string;
	readonly room: string;
	readonly agent: string;
	readonly throughSeq: number;
}

export interface TeamRoomMemberAddCommand {
	readonly teamId: string;
	readonly room: string;
	/** PM, engineer, Secretary, or registered live agent id. */
	readonly member: string;
	readonly role?: string;
}

export interface TeamRoomMemberRemoveCommand {
	readonly teamId: string;
	readonly room: string;
	readonly member: string;
}

export interface TeamRoomKindSetCommand {
	readonly teamId: string;
	readonly room: string;
	readonly kind: TeamRoomKind;
	/** Required when switching to a PM room that has no owner yet. */
	readonly pm?: string;
}

export interface TeamTaskCreateCommand {
	readonly teamId: string;
	readonly taskKey: string;
	readonly title: string;
	readonly body?: string;
	readonly pm: string;
	readonly assignee?: string;
	readonly reqIds?: ReadonlyArray<string>;
}

export interface TeamTaskAssignCommand {
	readonly teamId: string;
	readonly task: string;
	readonly pm: string;
	readonly assignee: string;
	readonly body?: string;
}

export interface TeamTaskClaimCommand {
	readonly teamId: string;
	readonly task: string;
	readonly agent: string;
	readonly leaseSeconds?: number;
	readonly body?: string;
}

export interface TeamTaskRenewCommand {
	readonly teamId: string;
	readonly task: string;
	readonly agent: string;
	readonly leaseSeconds?: number;
	readonly body?: string;
}

export interface TeamTaskReleaseCommand {
	readonly teamId: string;
	readonly task: string;
	readonly agent: string;
	readonly body?: string;
}

export interface TeamTaskSubmitCommand {
	readonly teamId: string;
	readonly task: string;
	readonly agent: string;
	readonly body?: string;
	readonly reqIds?: ReadonlyArray<string>;
}

export interface TeamTaskCompleteCommand {
	readonly teamId: string;
	readonly task: string;
	readonly pm: string;
	readonly body?: string;
	readonly reqIds?: ReadonlyArray<string>;
}

export interface TeamTaskRejectCommand {
	readonly teamId: string;
	readonly task: string;
	readonly pm: string;
	readonly body: string;
}

export interface TeamTaskCancelCommand {
	readonly teamId: string;
	readonly task: string;
	readonly pm: string;
	readonly body?: string;
}

export interface TeamTaskCommentCommand {
	readonly teamId: string;
	readonly task: string;
	readonly agent: string;
	readonly body: string;
}

export type TeamBootstrapApplyCommand = TeamBootstrapApplyInput;

export interface TeamBootstrapResumeCommand {
	readonly runId: string;
	readonly rollbackOnFailure?: boolean;
}

export interface TeamBootstrapRollbackCommand {
	readonly runId: string;
}

export interface TeamQueryInputMap {
	"team.list": Readonly<Record<string, never>>;
	"team.read": { readonly teamId: string };
	"team.doctor": { readonly teamId: string };
	"team.room.events": TeamRoomEventsQuery;
	"team.task.show": TeamTaskShowQuery;
	"team.bootstrap.plan": TeamBootstrapInput;
	"team.bootstrap.runs": TeamBootstrapRunsQuery;
}

export interface TeamQueryResultMap {
	"team.list": TeamListResult;
	"team.read": TeamWorkspaceReadModel;
	"team.doctor": TeamDoctorSummary;
	"team.room.events": TeamRoomView;
	"team.task.show": TeamTaskView;
	"team.bootstrap.plan": TeamBootstrapPlanResult;
	"team.bootstrap.runs": TeamBootstrapRunsResult;
}

export interface TeamCommandInputMap {
	"team.pm.add": TeamPmAddCommand;
	"team.repo.bind": TeamRepoBindCommand;
	"team.engineer.add": TeamEngineerAddCommand;
	"team.room.create": TeamRoomCreateCommand;
	"team.room.post": TeamRoomPostCommand;
	"team.room.subscribe": TeamRoomSubscribeCommand;
	"team.room.ack": TeamRoomAckCommand;
	"team.room.member.add": TeamRoomMemberAddCommand;
	"team.room.member.remove": TeamRoomMemberRemoveCommand;
	"team.room.kind.set": TeamRoomKindSetCommand;
	"team.task.create": TeamTaskCreateCommand;
	"team.task.assign": TeamTaskAssignCommand;
	"team.task.claim": TeamTaskClaimCommand;
	"team.task.renew": TeamTaskRenewCommand;
	"team.task.release": TeamTaskReleaseCommand;
	"team.task.submit": TeamTaskSubmitCommand;
	"team.task.complete": TeamTaskCompleteCommand;
	"team.task.reject": TeamTaskRejectCommand;
	"team.task.cancel": TeamTaskCancelCommand;
	"team.task.comment": TeamTaskCommentCommand;
	"team.bootstrap.apply": TeamBootstrapApplyCommand;
	"team.bootstrap.resume": TeamBootstrapResumeCommand;
	"team.bootstrap.rollback": TeamBootstrapRollbackCommand;
}

export interface TeamCommandResultMap {
	"team.pm.add": TeamWorkspaceReadModel;
	"team.repo.bind": TeamWorkspaceReadModel;
	"team.engineer.add": TeamWorkspaceReadModel;
	"team.room.create": TeamWorkspaceReadModel;
	"team.room.post": TeamRoomEvent;
	"team.room.subscribe": TeamRoomSubscription;
	"team.room.ack": TeamRoomSubscription;
	"team.room.member.add": TeamWorkspaceReadModel;
	"team.room.member.remove": TeamWorkspaceReadModel;
	"team.room.kind.set": TeamWorkspaceReadModel;
	"team.task.create": TeamTaskView;
	"team.task.assign": TeamTaskView;
	"team.task.claim": TeamTaskView;
	"team.task.renew": TeamTaskView;
	"team.task.release": TeamTaskView;
	"team.task.submit": TeamTaskView;
	"team.task.complete": TeamTaskView;
	"team.task.reject": TeamTaskView;
	"team.task.cancel": TeamTaskView;
	"team.task.comment": TeamTaskView;
	"team.bootstrap.apply": TeamBootstrapResultView;
	"team.bootstrap.resume": TeamBootstrapResultView;
	"team.bootstrap.rollback": TeamBootstrapRollbackView;
}

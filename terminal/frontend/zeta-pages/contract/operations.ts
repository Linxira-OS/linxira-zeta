/**
 * Local operation-map subset for the zeta-owned Team/Rooms pages.
 *
 * Only the queries and commands those pages call are declared. Shapes are
 * copied from the Host contract and remain type-only; the transport forwards
 * the exact `{ queryName, input }` / `{ commandName, input }` envelopes.
 */
import type {
	LocalRoomEventReadModel,
	LocalRoomMemberReadModel,
	LocalRoomPostReadModel,
	LocalRoomResidentReadModel,
	LocalRoomSummaryReadModel,
} from "./read-models";
import type { LocalRoomContactsReadModel, LocalRoomSnapshotReadModel } from "./read-models";
import type { TeamGraphReadModel, TeamNodeLifetime } from "./read-models";
import type { AgentId, CommandRequestId, IdempotencyKey, SessionId, WorkspaceId } from "./ids";
import type {
	TeamBootstrapInput,
	TeamBootstrapPlanResult,
	TeamBootstrapResultView,
	TeamBootstrapRollbackView,
	TeamBootstrapRunSummary,
	TeamDoctorSummary,
	TeamFileDataQuery,
	TeamFileDataResult,
	TeamFileReadQuery,
	TeamFileReadResult,
	TeamFilesQuery,
	TeamFilesResult,
	TeamListResult,
	TeamRoomCreateCommand,
	TeamRoomEventsQuery,
	TeamRoomKindSetCommand,
	TeamRoomMemberAddCommand,
	TeamRoomMemberRemoveCommand,
	TeamRoomPostCommand,
	TeamRoomSubscribeCommand,
	TeamRoomAckCommand,
	TeamRoomSubscription,
	TeamRoomView,
	TeamTaskAssignCommand,
	TeamTaskCancelCommand,
	TeamTaskClaimCommand,
	TeamTaskCommentCommand,
	TeamTaskCompleteCommand,
	TeamTaskCreateCommand,
	TeamTaskRejectCommand,
	TeamTaskReleaseCommand,
	TeamTaskRenewCommand,
	TeamTaskShowQuery,
	TeamTaskSubmitCommand,
	TeamTaskView,
	TeamPmAddCommand,
	TeamRepoBindCommand,
	TeamEngineerAddCommand,
	TeamPlanActionCommand,
	TeamPlanCreateCommand,
	TeamBootstrapApplyCommand,
	TeamBootstrapResumeCommand,
	TeamBootstrapRollbackCommand,
	TeamWorkspaceReadModel,
	TeamRoomEvent,
} from "./team";

export type EmptyInput = Readonly<Record<string, never>>;

export interface QueryInputMap {
	"team.graph.get": {
		readonly workspaceId?: WorkspaceId;
		readonly lifetime?: TeamNodeLifetime;
		/** One main's team; omit for every cluster. */
		readonly clusterId?: string;
	};
	"rooms.list": { readonly viewerId?: string };
	"room.get": { readonly roomId: string };
	"room.log.read": { readonly roomId: string; readonly afterSeq?: number; readonly limit?: number };
	"room.contacts.list": { readonly roomId: string };
	"team.list": EmptyInput;
	"team.files.list": TeamFilesQuery;
	"team.files.read": TeamFileReadQuery;
	"team.files.data": TeamFileDataQuery;
	"team.read": { readonly teamId: string };
	"team.doctor": { readonly teamId: string };
	"team.room.events": TeamRoomEventsQuery;
	"team.task.show": TeamTaskShowQuery;
	"team.bootstrap.plan": TeamBootstrapInput;
}

export interface QueryResultMap {
	"team.graph.get": TeamGraphReadModel;
	"rooms.list": { readonly rooms: ReadonlyArray<LocalRoomSummaryReadModel> };
	"room.get": LocalRoomSnapshotReadModel;
	"room.log.read": {
		readonly roomId: string;
		readonly events: ReadonlyArray<LocalRoomEventReadModel>;
		readonly lastSeq: number;
	};
	"room.contacts.list": LocalRoomContactsReadModel;
	"team.list": TeamListResult;
	"team.files.list": TeamFilesResult;
	"team.files.read": TeamFileReadResult;
	"team.files.data": TeamFileDataResult;
	"team.read": TeamWorkspaceReadModel;
	"team.doctor": TeamDoctorSummary;
	"team.room.events": TeamRoomView;
	"team.task.show": TeamTaskView;
	"team.bootstrap.plan": TeamBootstrapPlanResult;
}

export type QueryName = keyof QueryInputMap & keyof QueryResultMap;
export type QueryInput<TName extends QueryName> = QueryInputMap[TName];
export type QueryResult<TName extends QueryName> = QueryResultMap[TName];

export interface CommandInputMap {
	"room.create": {
		readonly roomKind: "super" | "repo" | "main";
		readonly name: string;
		readonly repoRoot?: string;
	};
	"room.member.add": {
		readonly roomId: string;
		readonly memberId: string;
		readonly role: "super" | "repo" | "main" | "resident";
		readonly displayName?: string;
		readonly repoRoot?: string;
		readonly homeSessionId?: string;
	};
	"room.member.remove": { readonly roomId: string; readonly memberId: string };
	"room.post": {
		readonly roomId: string;
		readonly body: string;
		readonly mode?: "parallel" | "serial" | "mention";
		readonly mentions?: ReadonlyArray<string>;
		readonly replyTo?: number;
	};
	"room.markRead": { readonly roomId: string; readonly memberId?: string; readonly seq: number };
	"room.round.stop": { readonly roomId: string; readonly roundId: string };
	"room.resident.park": { readonly roomId: string; readonly agentId: string };
	"room.resident.revive": { readonly roomId: string; readonly agentId: string };
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
	"team.plan.create": TeamPlanCreateCommand;
	"team.plan.action": TeamPlanActionCommand;
	"team.bootstrap.apply": TeamBootstrapApplyCommand;
	"team.bootstrap.resume": TeamBootstrapResumeCommand;
	"team.bootstrap.rollback": TeamBootstrapRollbackCommand;
}

export interface CommandResultMap {
	"room.create": LocalRoomSummaryReadModel;
	"room.member.add": LocalRoomMemberReadModel;
	"room.member.remove": { readonly removed: true };
	"room.post": LocalRoomPostReadModel;
	"room.markRead": { readonly roomId: string; readonly seq: number };
	"room.round.stop": LocalRoomEventReadModel;
	"room.resident.park": LocalRoomResidentReadModel;
	"room.resident.revive": LocalRoomResidentReadModel;
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
	"team.plan.create": TeamWorkspaceReadModel;
	"team.plan.action": TeamWorkspaceReadModel;
	"team.bootstrap.apply": TeamBootstrapResultView;
	"team.bootstrap.resume": TeamBootstrapResultView;
	"team.bootstrap.rollback": TeamBootstrapRollbackView;
}

export type CommandName = keyof CommandInputMap & keyof CommandResultMap;
export type CommandInput<TName extends CommandName> = CommandInputMap[TName];
export type CommandResult<TName extends CommandName> = CommandResultMap[TName];

export interface ClientError {
	readonly code: string;
	readonly message: string;
}

export interface ClientQueryRequest<TName extends QueryName = QueryName> {
	readonly queryName: TName;
	readonly input: QueryInput<TName>;
}

export type ClientQueryResponse<TName extends QueryName = QueryName> =
	| { readonly ok: true; readonly queryName: TName; readonly result: QueryResult<TName> }
	| { readonly ok: false; readonly queryName: TName; readonly error: ClientError };

export interface ClientCommandRequest<TName extends CommandName = CommandName> {
	readonly commandName: TName;
	readonly input: CommandInput<TName>;
	readonly idempotencyKey: IdempotencyKey;
	readonly requestId: CommandRequestId;
}

export interface ClientCommandAccepted<TName extends CommandName = CommandName> {
	readonly commandName: TName;
	readonly requestId: CommandRequestId;
	readonly status: "accepted";
	readonly acceptedAt: string;
}

export interface CommandOptions {
	readonly idempotencyKey?: IdempotencyKey;
}

export interface CommandStateBase<TName extends CommandName = CommandName> {
	readonly requestId: CommandRequestId;
	readonly commandName: TName;
}

export interface CommandHandle<TName extends CommandName = CommandName> extends CommandStateBase<TName> {
	readonly status: "local_pending";
	readonly idempotencyKey: IdempotencyKey;
	readonly issuedAt: string;
}

export type CommandReceipt<TName extends CommandName = CommandName> =
	| (CommandStateBase<TName> & {
			readonly status: "completed";
			readonly result: CommandResult<TName>;
			readonly observedAt: string;
	  })
	| (CommandStateBase<TName> & {
			readonly status: "failed";
			readonly error: ClientError;
			readonly observedAt: string;
	  })
	| (CommandStateBase<TName> & {
			readonly status: "rejected";
			readonly reason: string;
			readonly observedAt: string;
	  })
	| (CommandStateBase<TName> & {
			readonly status: "outcome_unknown";
			readonly reason: string;
			readonly observedAt: string;
	  });

export type CommandState<TName extends CommandName = CommandName> =
	| (CommandStateBase<TName> & {
			readonly status: "local_pending";
			readonly idempotencyKey: IdempotencyKey;
			readonly issuedAt: string;
	  })
	| (CommandStateBase<TName> & {
			readonly status: "accepted";
			readonly acceptedAt: string;
	  })
	| CommandReceipt<TName>;

export interface ClientEventBase {
	readonly authorityEpoch: number;
	readonly runtimeEpoch?: number;
	readonly stateVersion: number;
	readonly cursor: string;
	readonly occurredAt: string;
}

export type ClientEvent =
	| (ClientEventBase & { readonly kind: "state.changed" })
	| (ClientEventBase & { readonly kind: "command.accepted"; readonly accepted: ClientCommandAccepted })
	| (ClientEventBase & { readonly kind: "command.receipt"; readonly receipt: CommandReceipt })
	| (ClientEventBase & { readonly kind: "resync.required"; readonly reason: string })
	| (ClientEventBase & { readonly kind: "diagnostics.changed" });

export type SubscriptionScope =
	| { readonly scope: "all" }
	| { readonly scope: "runtime" }
	| { readonly scope: "thread"; readonly threadId: string }
	| { readonly scope: "command"; readonly requestId: CommandRequestId };

export type Unsubscribe = () => void;

export interface ClientBootstrap {
	readonly contractVersion: number;
	readonly commandManifestHash?: string;
	readonly stateVersion?: number;
	readonly cursor?: string;
}

/** Scope handed to `openContext`; the pages never open a context, the transport supports it. */
export interface ClientContextScope {
	readonly sessionId?: SessionId;
	readonly workspaceId?: WorkspaceId;
	readonly threadId?: string;
}

export interface ClientTransport {
	readonly supportsContexts?: boolean;
	openContext?(scope: ClientContextScope): Promise<ClientTransport>;
	bootstrap(): Promise<ClientBootstrap>;
	query<TName extends QueryName>(request: ClientQueryRequest<TName>): Promise<ClientQueryResponse<TName>>;
	command<TName extends CommandName>(request: ClientCommandRequest<TName>): Promise<ClientCommandAccepted<TName>>;
	subscribe(scope: SubscriptionScope, listener: (event: ClientEvent) => void): Unsubscribe;
	close(): Promise<void>;
}

/** The product client surface the pages consume. */
export interface StudioClient {
	bootstrap(): Promise<ClientBootstrap>;
	query<TName extends QueryName>(name: TName, input: QueryInput<TName>): Promise<QueryResult<TName>>;
	command<TName extends CommandName>(
		name: TName,
		input: CommandInput<TName>,
		options?: CommandOptions,
	): Promise<CommandHandle<TName>>;
	subscribe(scope: SubscriptionScope, listener: (event: ClientEvent) => void): Unsubscribe;
	close(): Promise<void>;
}

export type { AgentId, CommandRequestId, IdempotencyKey, SessionId, WorkspaceId };

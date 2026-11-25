/** Opaque branded public identifiers carried by the product client contract. */
type Brand<T, TName extends string> = T & { readonly __brand: TName };

export type AuthorityEpoch = Brand<number, "AuthorityEpoch">;
export type RuntimeEpoch = Brand<number, "RuntimeEpoch">;
export type StateVersion = Brand<number, "StateVersion">;
export type EnvironmentId = Brand<string, "EnvironmentId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type ThreadId = Brand<string, "ThreadId">;
export type SessionId = Brand<string, "SessionId">;
export type AgentId = Brand<string, "AgentId">;
export type CommandRequestId = Brand<string, "CommandRequestId">;
export type InteractionId = Brand<string, "InteractionId">;
export type IdempotencyKey = Brand<string, "IdempotencyKey">;
export type EventCursor = Brand<string, "EventCursor">;

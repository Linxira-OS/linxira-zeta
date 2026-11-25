/**
 * Remote-object protocols of the main-owned agent singletons, as spoken by a
 * worker's proxies to the main thread's instances (see `./agents`).
 */
import type { IrcDeliveryReceipt, IrcMessage } from "../../irc/irc-types";
import type { IrcWaitFilter, UnansweredSend } from "../../irc/bus";
import type { AwaitHoldOptions, AwaitWaiter } from "../../registry/agent-awaits";
import type { AdoptOptions, AgentReleaseOptions } from "../../registry/agent-lifecycle";
import type {
	AgentHistorySummary,
	AgentRef,
	AgentRefExpectation,
	AgentRegistryApi,
	AgentStatus,
	RegisterInput,
	RegistryListener,
} from "../../registry/agent-registry";
import type { AgentSessionHandle } from "../../session/agent-session-handle";
import type { RpcMethod } from "../rpc";

/** Remote-object kind of the main `AgentRegistry`. */
export const AGENT_REGISTRY_KIND = "agent-registry";
/** Remote-object kind of the main `AgentLifecycleManager`. */
export const AGENT_LIFECYCLE_KIND = "agent-lifecycle";
/** Remote-object kind of the main `IrcBus`. */
export const IRC_BUS_KIND = "irc-bus";
/** Remote-object kind of main's per-worker session bridge. */
export const AGENT_SESSION_BRIDGE_KIND = "agent-session-bridge";
/** Remote-object kind of a worker's session publisher. */
export const AGENT_SESSION_HOST_KIND = "agent-session-host";

/** `AgentRegistryApi` (with its `awaits`) over the link. */
export type AgentRegistryProtocol = {
	register: RpcMethod<[input: RegisterInput], AgentRef>;
	/** Register a workspace's main agent; the id and session id are main-assigned. */
	registerRoot: RpcMethod<[input: Omit<RegisterInput, "id"> & { id?: string; sessionId: string }], AgentRef>;
	/** The root ref for a workspace, when one is registered. */
	workspaceMain: RpcMethod<[workspaceId: string | undefined], AgentRef | undefined>;
	/** Resolve a main alias (`Main`, a workspace name) to a concrete registry id. */
	resolveMainAlias: RpcMethod<[requested: string, callerId: string], string | undefined>;
	registerIfAvailable: RpcMethod<[input: RegisterInput, expected: AgentRef | null], AgentRef | undefined>;
	reopen: RpcMethod<[id: string, expected: AgentRef], AgentRef | undefined>;
	setHistory: RpcMethod<[id: string, history: AgentHistorySummary, expectedSessionFile?: string], boolean>;
	setStatus: RpcMethod<[id: string, status: AgentStatus, expected?: AgentRefExpectation], boolean>;
	markResultAccepted: RpcMethod<[id: string, expected?: AgentRefExpectation, responseAt?: number], boolean>;
	staleAcceptedRuns: RpcMethod<[], AgentRef[]>;
	setActivity: RpcMethod<[id: string, activity: string, expected?: AgentRefExpectation], void>;
	attachSession: RpcMethod<
		[id: string, session: AgentSessionHandle, sessionFile?: string | null, expected?: AgentRefExpectation],
		boolean
	>;
	detachSession: RpcMethod<[id: string, expected?: AgentRefExpectation], boolean>;
	unregister: RpcMethod<[id: string, expected?: AgentRefExpectation], boolean>;
	get: RpcMethod<[id: string], AgentRef | undefined>;
	list: RpcMethod<[], AgentRef[]>;
	listVisibleTo: RpcMethod<[id: string], AgentRef[]>;
	isRunning: RpcMethod<[ref: AgentRef], boolean>;
	/** One forwarding subscription per worker; returns a sync unsubscribe. */
	subscribe: RpcMethod<[listener: RegistryListener], () => void>;
	awaitsHold: RpcMethod<[waiter: string, awaited: readonly string[], options: AwaitHoldOptions], () => void>;
	awaitsBlocksOn: RpcMethod<[agent: string, target: string, sentAt: number], boolean>;
	awaitsBlockedVia: RpcMethod<[agent: string, target: string, sentAt: number], readonly string[] | undefined>;
	awaitsWaitersOn: RpcMethod<[target: string], AwaitWaiter[]>;
	/** One forwarding subscription per worker; returns a sync unsubscribe. */
	awaitsSubscribe: RpcMethod<[listener: () => void], () => void>;
};

/** `AgentLifecycleApi` over the link (the persisted reviver factory and teardown stay main-only). */
export type AgentLifecycleProtocol = {
	adopt: RpcMethod<[id: string, opts: AdoptOptions, expected?: AgentRefExpectation], void>;
	has: RpcMethod<[id: string, expected?: AgentRefExpectation], boolean>;
	reclaimDeadCorpse: RpcMethod<[id: string, expected: AgentRef], boolean>;
	manages: RpcMethod<[registry: AgentRegistryApi], boolean>;
	isParking: RpcMethod<[id: string, expected?: AgentRefExpectation], boolean>;
	park: RpcMethod<[id: string], void>;
	ensureLive: RpcMethod<[id: string], AgentSessionHandle>;
	release: RpcMethod<[id: string, expected?: AgentRefExpectation, options?: AgentReleaseOptions], boolean>;
};

/** `IrcBusApi` over the link. */
export type IrcBusProtocol = {
	send: RpcMethod<[msg: Omit<IrcMessage, "id" | "ts">], IrcDeliveryReceipt>;
	/** Queued messages for an agent, oldest first; `peek` leaves them queued. */
	inbox: RpcMethod<[agentId: string, opts?: { peek?: boolean }], IrcMessage[]>;
	sentSince: RpcMethod<[from: string, to: string, sinceTs: number], boolean>;
	unansweredSends: RpcMethod<[from: string, sinceTs: number], UnansweredSend[]>;
	lastMessageAt: RpcMethod<[from: string, to: string], number | undefined>;
	wait: RpcMethod<
		[
			agentId: string,
			filter: IrcWaitFilter,
			timeoutMs: number,
			signal?: AbortSignal,
			options?: { drainPending?: boolean },
		],
		IrcMessage | null
	>;
	take: RpcMethod<[agentId: string, from?: string], IrcMessage | undefined>;
	park: RpcMethod<[msg: Omit<IrcMessage, "id" | "ts">], IrcMessage>;
	unreadCount: RpcMethod<[agentId: string], number>;
	recordReply: RpcMethod<[from: string, to: string], void>;
};

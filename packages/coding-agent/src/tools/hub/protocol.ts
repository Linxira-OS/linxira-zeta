/**
 * Hub data contracts shared by the tool half, renderers, and studio projections.
 *
 * The old pi-tui `tools/hub` module also owned TUI components; 19.2 removed it.
 * These are the data-only definitions the coding agent still needs.
 */
import type { DaemonState } from "@linxiraos/pi-tui/tools/daemon";
import type { DaemonSnapshot, DaemonSpec } from "../../launch/protocol";
export type { DaemonSnapshot, DaemonSpec };
import type { OutputMeta } from "../output-meta-format";
import type { StructuredSubagentOutput } from "../../task/task-details";

export type HubOp =
	| "send"
	| "wait"
	| "inbox"
	| "list"
	| "jobs"
	| "cancel"
	| "start"
	| "ps"
	| "logs"
	| "stop"
	| "restart"
	| "describe";

export interface HubPeerInfo {
	id: string;
	displayName: string;
	kind: string;
	status: string;
	parentId?: string;
	unread: number;
	lastActivity: number;
	activity?: string;
}

export type HubListStatus = "running" | "idle" | "parked";
export const DEFAULT_HUB_LIST_LIMIT = 32;
export const MAX_HUB_LIST_LIMIT = 100;

export interface HubRosterCounts {
	running: number;
	idle: number;
	parked: number;
	shown: number;
	truncated: number;
}

export interface JobSnapshot {
	id: string;
	type: "bash" | "task" | "eval";
	status: "running" | "completed" | "failed" | "cancelled";
	label: string;
	durationMs: number;
	exitCode?: number;
	resolvedModel?: string;
	resolvedModelIdentity?: string;
	resolvedThinkingLevel?: string;
	advisor?: boolean;
	resultText?: string;
	errorText?: string;
	meta?: OutputMeta;
	artifactError?: OutputMeta["artifactError"];
	structured?: StructuredSubagentOutput;
	agentUrlId?: string;
}

export type CancelStatus = "cancelled" | "not_found" | "already_completed";

export interface CancelOutcome {
	id: string;
	status: CancelStatus;
	message: string;
}

export interface AgentActivitySnapshot {
	id: string;
	parentId?: string;
	activity?: string;
	ageMs: number;
	live: boolean;
	acceptedAt?: number;
}

export interface IrcMessage {
	id: string;
	from: string;
	to: string;
	body: string;
	ts: number;
	replyTo?: string;
	metadata?: Record<string, unknown>;
	wakeRelay?: boolean;
}

export interface IrcDeliveryReceipt {
	to: string;
	outcome: "injected" | "woken" | "revived" | "queued" | "failed";
	error?: string;
}

export interface CoordinationDetails {
	meta?: OutputMeta;
	op: HubOp;
	from?: string;
	to?: string;
	receipts?: IrcDeliveryReceipt[];
	waited?: IrcMessage | null;
	inbox?: IrcMessage[];
	peers?: HubPeerInfo[];
	counts?: HubRosterCounts;
	jobs?: JobSnapshot[];
	cancelled?: { id: string; status: CancelStatus }[];
	agents?: AgentActivitySnapshot[];
	status?: "peer-waiting-on-you";
}

export interface LaunchParams {
	op: "start" | "list" | "logs" | "wait" | "send" | "stop" | "restart" | "describe" | "mode";
	name?: string;
	application?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	pty?: boolean;
	ready?: { log?: string; port?: number; host?: string; timeout?: number };
	restart?: "no" | "on-failure" | "always";
	persist?: boolean;
	detached?: boolean;
	lines?: number;
	head?: boolean;
	grep?: string;
	follow?: boolean;
	cursor?: number;
	for?: "ready" | "exit";
	pattern?: string;
	text?: string;
	enter?: boolean;
	keys?: string[];
	signal?: "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGQUIT" | "SIGKILL";
	timeout?: number;
	mode?: "persist" | "session" | "detached";
}

export interface LaunchToolDetails {
	op: LaunchParams["op"];
	daemon?: DaemonSnapshot;
	daemons?: DaemonSnapshot[];
	cursor?: number;
	timedOut?: boolean;
	state?: DaemonState;
	terminalRows?: string[];
	matched?: string;
	spec?: DaemonSpec;
}

export type HubDetails = CoordinationDetails | LaunchToolDetails;

export type HubRenderArgs = {
	op?: string;
	to?: string;
	message?: string;
	replyTo?: string;
	await?: boolean;
	from?: string;
	peek?: boolean;
	ids?: string[];
	readyMatch?: string;
	readyPending?: ("log" | "port")[];
	persist: boolean;
	detached: boolean;
};

export function isWaitingPollDetails(details: unknown): boolean {
	const d = details as CoordinationDetails | undefined;
	if (!d || !Array.isArray(d.jobs) || d.jobs.length === 0) return false;
	if (d.cancelled?.length) return false;
	return d.jobs.every(job => job.status === "running");
}

export function readyPendingSummary(daemon: DaemonSnapshot, ready?: LaunchParams["ready"]): string[] {
	const parts: string[] = [];
	for (const condition of daemon.readyPending ?? []) {
		if (condition === "log") {
			parts.push(ready?.log ? `log pattern /${ready.log}/ never matched` : "the log pattern never matched");
		} else {
			parts.push(
				ready?.port !== undefined
					? `port ${ready.port} on ${ready.host ?? "127.0.0.1"} never accepted connections`
					: "the port never accepted connections",
			);
		}
	}
	return parts;
}

export function waitPendingSummary(daemon: DaemonSnapshot, params: Pick<LaunchParams, "for" | "pattern">): string[] {
	if (params.pattern) return [`output pattern /${params.pattern}/ never matched`];
	if ((params.for ?? "exit") === "exit") return [`process exit (still ${daemon.state})`];
	const pending = readyPendingSummary(daemon);
	return pending.length > 0 ? pending : [`readiness (still ${daemon.state})`];
}

export const LIST_STATUS_ORDER: Record<string, number> = { running: 0, idle: 1, parked: 2 };

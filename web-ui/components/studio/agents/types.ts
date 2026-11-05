/**
 * Agent Hub view model.
 *
 * Ported from OMP Studio (MIT) `AgentHub.tsx` (`HubAgent` / `HubStatus`), minus
 * the Studio transport types: everything here is derived from Zeta's subagent
 * roster (`/api/agent/:id/subagents`) by `gateway.ts`. The Agent Hub is
 * read-only over Zeta — there is no steer/cancel/revive route — so the model
 * carries no capability flags.
 */

export type HubStatus = "starting" | "running" | "idle" | "parked" | "reviving" | "aborted" | "failed" | "released";

export interface HubMetrics {
	tokens: number;
	requests: number;
	tools: number;
	cost: number;
	durationMs?: number;
	contextTokens?: number;
	contextWindow?: number;
}

export interface HubAgent {
	id: string;
	name: string;
	/** `sub` for a spawned child, `advisor` for a parked advisor record. */
	kind: "sub" | "advisor";
	parentId?: string;
	status: HubStatus;
	/** Raw runtime status, shown in the identity block (`taskStatus` when present). */
	rawStatus?: string;
	task: string;
	stage?: string;
	completionPercent?: number;
	modelRole?: string;
	resolvedModel?: string;
	fallback?: string;
	readOnly: boolean;
	unread: number;
	outputPath?: string;
	patchPath?: string;
	branchName?: string;
	nestedPatchPaths?: string[];
	isolated?: boolean;
	/** Start of the run in epoch ms. */
	startedAt?: number;
	/** Last observed activity in epoch ms. */
	lastActivity: number;
	hasLiveSession: boolean;
	hasTranscript: boolean;
	/** Roster children, by id, as reported by `parentId`. */
	children: string[];
	generation: number;
	metrics?: HubMetrics;
}

/** Roster view mode: a flat list, or grouped under the agent that spawned it. */
export type HubView = "flat" | "tree";

/** Right-hand face of the detail column. */
export type HubTab = "overview" | "transcript" | "output";

/** One row of a subagent transcript, as the pane renders it. */
export interface HubTranscriptRow {
	id: string;
	role: "user" | "assistant" | "system";
	text: string;
	ts: number;
}

/**
 * Mirror the backend session's subagent roster into the attached TUI.
 *
 * The gateway already projects the same rows the Agent Hub renders and streams
 * them at `/api/agent/:id/subagents/events` (snapshot + lifecycle/progress in
 * the RPC frame vocabulary). The attached client re-emits those payloads on
 * the local observability bus, so the existing `SessionObserverRegistry`,
 * `/agents`, `/hub`, the subagent HUD and the pinned badge all work unchanged.
 *
 * Rows that only exist on disk (persisted/parked) are part of the snapshot for
 * the web roster; the TUI's live registry intentionally lists only sessions it
 * has seen start, so a terminal row is emitted once and then left alone.
 */

import type { AgentStatus } from "@linxiraos/pi-tui/overlays/agent-hub-types";
import {
	TASK_SUBAGENT_LIFECYCLE_CHANNEL,
	TASK_SUBAGENT_PROGRESS_CHANNEL,
} from "@linxiraos/pi-tui/overlays/session-observer-registry";
import type { AgentProgress, AgentSource } from "@linxiraos/pi-tui/tools/task";
import { logger } from "@linxiraos/pi-utils";
import type { SubagentLifecyclePayload, SubagentProgressPayload } from "../task";
import { emitSubagentFrame, type EventBus } from "../utils/event-bus";
import type { BackendClient } from "./client";

/** The subset of a gateway roster row this mirror consumes. */
export interface BackendSubagentRow {
	id: string;
	displayName?: string;
	kind?: "sub" | "advisor";
	status: AgentStatus;
	taskStatus?: AgentProgress["status"];
	index?: number;
	agent?: string;
	agentSource?: string;
	description?: string;
	task?: string;
	assignment?: string;
	sessionFile?: string | null;
	detached?: boolean;
	parentToolCallId?: string;
	progress?: Partial<AgentProgress> & {
		lastIntent?: string;
		currentTool?: string;
		toolCount?: number;
		requests?: number;
		tokens?: number;
		contextTokens?: number;
		contextWindow?: number;
		cost?: number;
		durationMs?: number;
		recentOutput?: string[];
	};
}

/** Gateway SSE frames (see `server/web-gateway/subagents.ts`). */
type MirrorFrame =
	| ({ type: "subagent_snapshot"; subagents?: BackendSubagentRow[] } & Record<string, unknown>)
	| { type: "subagent_lifecycle"; payload: SubagentLifecyclePayload }
	| { type: "subagent_progress"; payload: SubagentProgressPayload }
	| { type: "subagent_status"; subagent: BackendSubagentRow }
	| { type: "subagent_removed"; id: string };

const AGENT_SOURCES: ReadonlySet<string> = new Set([
	"builtin",
	"user",
	"project",
	"extension",
	"plugin",
	"mcp",
	"unknown",
] as const);

function agentSource(value: string | undefined): AgentSource {
	return (value && AGENT_SOURCES.has(value) ? value : "unknown") as AgentSource;
}

/** Registry status → observer lifecycle status. */
export function lifecycleStatus(
	row: Pick<BackendSubagentRow, "status" | "taskStatus">,
): SubagentLifecyclePayload["status"] {
	if (row.taskStatus === "aborted" || row.status === "aborted") return "aborted";
	if (row.taskStatus === "failed") return "failed";
	if (row.taskStatus === "completed") return "completed";
	if (row.status === "running" || row.taskStatus === "pending" || row.taskStatus === "running") return "started";
	// `idle` and `parked` are terminal for this run; a later turn emits `started` again.
	return "completed";
}

/** Project one roster row onto the lifecycle payload the observer registry consumes. */
export function lifecycleFromRow(row: BackendSubagentRow): SubagentLifecyclePayload {
	return {
		id: row.id,
		agent: row.agent ?? row.displayName ?? row.kind ?? "subagent",
		agentSource: agentSource(row.agentSource),
		description: row.description ?? row.task,
		status: lifecycleStatus(row),
		sessionFile: row.sessionFile ?? undefined,
		parentToolCallId: row.parentToolCallId,
		index: row.index ?? 0,
		detached: row.detached,
	};
}

/** Project a roster row's bounded progress onto an `AgentProgress` snapshot. */
export function progressFromRow(row: BackendSubagentRow): SubagentProgressPayload | undefined {
	const raw = row.progress;
	if (!raw) return undefined;
	const status = row.taskStatus ?? (row.status === "running" ? "running" : "completed");
	const progress: AgentProgress = {
		index: row.index ?? raw.index ?? 0,
		id: row.id,
		agent: row.agent ?? row.displayName ?? "subagent",
		agentSource: agentSource(row.agentSource),
		status,
		task: row.task ?? row.description ?? "",
		assignment: row.assignment,
		description: row.description,
		lastIntent: raw.lastIntent,
		currentTool: raw.currentTool,
		recentTools: raw.recentTools ?? [],
		recentOutput: raw.recentOutput ?? [],
		toolCount: raw.toolCount ?? 0,
		requests: raw.requests ?? 0,
		tokens: raw.tokens ?? 0,
		contextTokens: raw.contextTokens,
		contextWindow: raw.contextWindow,
		cost: raw.cost ?? 0,
		durationMs: raw.durationMs ?? 0,
		...(raw as Partial<AgentProgress>),
	};
	return {
		index: progress.index,
		agent: progress.agent,
		agentSource: progress.agentSource,
		task: progress.task,
		parentToolCallId: row.parentToolCallId,
		assignment: row.assignment,
		progress,
		sessionFile: row.sessionFile ?? undefined,
		detached: row.detached,
	};
}

/** Feed one parsed SSE frame into the local observer buses. */
export function applySubagentFrame(
	frame: MirrorFrame,
	eventBus: EventBus | undefined,
	subagentEventBus: EventBus | undefined,
	known: Map<string, BackendSubagentRow>,
): void {
	switch (frame.type) {
		case "subagent_snapshot": {
			const rows = frame.subagents ?? [];
			const seen = new Set<string>();
			for (const row of rows) {
				seen.add(row.id);
				known.set(row.id, row);
				if (lifecycleStatus(row) === "started") {
					emitSubagentFrame(eventBus, subagentEventBus, TASK_SUBAGENT_LIFECYCLE_CHANNEL, lifecycleFromRow(row));
				}
				const progress = progressFromRow(row);
				if (progress) {
					emitSubagentFrame(eventBus, subagentEventBus, TASK_SUBAGENT_PROGRESS_CHANNEL, progress);
				}
			}
			// A row that vanished from the authoritative roster while it was live
			// ended without a lifecycle frame (backend restart or registry prune).
			for (const [id, row] of known) {
				if (seen.has(id)) continue;
				if (lifecycleStatus(row) === "started") {
					emitSubagentFrame(eventBus, subagentEventBus, TASK_SUBAGENT_LIFECYCLE_CHANNEL, {
						...lifecycleFromRow(row),
						status: "aborted",
					});
				}
				known.delete(id);
			}
			return;
		}
		case "subagent_lifecycle":
			known.set(frame.payload.id, {
				...(known.get(frame.payload.id) ?? {
					id: frame.payload.id,
					status: "running",
				}),
				status:
					frame.payload.status === "started" ? "running" : frame.payload.status === "aborted" ? "aborted" : "idle",
				taskStatus:
					frame.payload.status === "started"
						? "running"
						: frame.payload.status === "completed"
							? "completed"
							: frame.payload.status === "failed"
								? "failed"
								: "aborted",
			});
			emitSubagentFrame(eventBus, subagentEventBus, TASK_SUBAGENT_LIFECYCLE_CHANNEL, frame.payload);
			return;
		case "subagent_progress":
			emitSubagentFrame(eventBus, subagentEventBus, TASK_SUBAGENT_PROGRESS_CHANNEL, frame.payload);
			return;
		case "subagent_status": {
			const row = frame.subagent;
			const previous = known.get(row.id);
			known.set(row.id, row);
			// Status is the authoritative row state; emit a lifecycle transition
			// only when it changed, so repeated snapshots do not restart rows.
			if (!previous || lifecycleStatus(row) !== lifecycleStatus(previous)) {
				emitSubagentFrame(eventBus, subagentEventBus, TASK_SUBAGENT_LIFECYCLE_CHANNEL, lifecycleFromRow(row));
			}
			return;
		}
		case "subagent_removed": {
			const row = known.get(frame.id);
			known.delete(frame.id);
			if (!row) return;
			if (lifecycleStatus(row) === "started") {
				emitSubagentFrame(eventBus, subagentEventBus, TASK_SUBAGENT_LIFECYCLE_CHANNEL, {
					...lifecycleFromRow(row),
					status: "aborted",
				});
			}
			return;
		}
	}
}

/** Tail the roster SSE stream until `signal` aborts. */
export async function mirrorSubagents(options: {
	client: BackendClient;
	sessionId: string;
	eventBus?: EventBus;
	subagentEventBus?: EventBus;
	signal: AbortSignal;
}): Promise<void> {
	const known = new Map<string, BackendSubagentRow>();
	try {
		for await (const frame of options.client.subagentEvents(options.sessionId, { signal: options.signal })) {
			applySubagentFrame(frame as unknown as MirrorFrame, options.eventBus, options.subagentEventBus, known);
		}
	} catch (error) {
		if (options.signal.aborted) return;
		logger.debug("backend subagent mirror closed", { error: String(error) });
	}
}

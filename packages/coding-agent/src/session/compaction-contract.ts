/**
 * Public compaction-service contract for consumers outside `session/`.
 *
 * `@linxiraos/zeta/session/compaction-contract` is the stable import path for
 * commit-hook listeners (durable indexes, window learning) and progress UI. It
 * re-exports types only from the internal implementation so the internal file
 * layout stays free to change; the consumer entry point does not.
 *
 * Access at runtime:
 * - `AgentSession.onCompactionCommit(listener)` → unsubscribe.
 * - Progress: the `compaction_phase` event on the normal session event stream.
 */

import type { CompactionCommitNotification, CompactionPhaseEvent } from "./compaction/service";

export type {
	CompactionCommitListener,
	CompactionCommitNotification,
	CompactionPhase,
	CompactionPhaseDetail,
	CompactionPhaseEvent,
	CompactionPhaseMethod,
	CompactionTerminalPhase,
	CompactionTrigger,
	CompactionWorkPhase,
} from "./compaction/service";

export {
	COMPACTION_FIDELITY_PRESERVE_KEY,
	type CompactionFidelity,
	type FidelityQaPair,
	type FidelityTracking,
	readCompactionFidelity,
} from "./compaction/fidelity";

/** Host-agnostic progress a consumer can render without re-deriving phase semantics. */
export type CompactionProgressStage =
	| "planning"
	| "summarizing"
	| "archiving"
	| "committing"
	| "failed"
	| "aborted";

export interface CompactionProgress {
	passId: string;
	trigger: "manual" | "auto" | "speculation";
	stage: CompactionProgressStage;
	/** Stable English label for hosts/CLI/web; presentation may translate it. */
	label: string;
	terminal: boolean;
	method?: string;
	reason?: string;
	at: number;
	tokensBefore?: number;
	entryId?: string;
	errorMessage?: string;
}

/**
 * Map one `compaction_phase` event to renderable progress. Single source of truth
 * for every surface (TUI loaders, RPC hosts, Studio); consumers never re-implement
 * phase→label rules.
 */
export function compactionProgressOf(event: CompactionPhaseEvent): CompactionProgress {
	const base = {
		passId: event.passId,
		trigger: event.trigger,
		...(event.method ? { method: event.method } : {}),
		...(event.reason ? { reason: event.reason } : {}),
		at: event.at,
		...(event.detail?.tokensBefore !== undefined ? { tokensBefore: event.detail.tokensBefore } : {}),
		...(event.detail?.entryId ? { entryId: event.detail.entryId } : {}),
		...(event.detail?.errorMessage ? { errorMessage: event.detail.errorMessage } : {}),
	};
	switch (event.phase) {
		case "plan":
			return { ...base, stage: "planning", label: "planning", terminal: false };
		case "summarize":
			return {
				...base,
				stage: "summarizing",
				label: event.method === "remote" ? "server summarizing" : "summarizing",
				terminal: false,
			};
		case "archive":
			return {
				...base,
				stage: "archiving",
				label: event.method === "snapcompact" ? "archiving" : "compacting",
				terminal: false,
			};
		case "commit":
			return { ...base, stage: "committing", label: "committing", terminal: true };
		case "failed":
			return { ...base, stage: "failed", label: "failed", terminal: true };
		case "aborted":
			return { ...base, stage: "aborted", label: "cancelled", terminal: true };
	}
}

/**
 * Compaction service: the one owner of a compaction pass's progress and commit
 * notification.
 *
 * Scope split (deliberate, see document/adr-compaction-service.md):
 * - this service owns **planning + execution progress + commit notification**;
 * - `CompactionAgent` (`./agent`) owns **producing the summary** (context build,
 *   summarizer call, summary artifact);
 * - the five methods and their policy order stay in `../compaction-methods.ts`
 *   and the shared manual/auto/speculation pipeline stays in
 *   `../session-maintenance.ts`.
 *
 * The service never runs a summary, never picks a model, and never appends an
 * entry. It serializes phase emissions for one pass, guarantees one terminal
 * phase, and fans a committed entry out to commit listeners exactly once.
 */

import { logger } from "@linxiraos/pi-utils";
import type { CompactionEntry } from "../session-entries";
import type { CompactionFidelity } from "./fidelity";

export type CompactionTrigger = "manual" | "auto" | "speculation";

/** Non-terminal progress phases. */
export type CompactionWorkPhase = "plan" | "summarize" | "archive" | "commit";
/** Terminal outcomes; `aborted` is cancellation only. */
export type CompactionTerminalPhase = "failed" | "aborted";
export type CompactionPhase = CompactionWorkPhase | CompactionTerminalPhase;

/** Method that ran the pass. `extension` = hook-provided, `experimental` = notebook rollover. */
export type CompactionPhaseMethod =
	| "remote"
	| "snapcompact"
	| "handoff"
	| "shake"
	| "soft"
	| "experimental"
	| "extension";

export interface CompactionPhaseDetail {
	tokensBefore?: number;
	tokensAfter?: number;
	entryId?: string;
	durationMs?: number;
	summaryChars?: number;
	errorMessage?: string;
	fidelity?: { qa: number; paths: number; ids: number; constraints: number; unfinished: number };
}

/** Progress event for one compaction pass; also part of `AgentSessionEvent`. */
export interface CompactionPhaseEvent {
	type: "compaction_phase";
	passId: string;
	trigger: CompactionTrigger;
	phase: CompactionPhase;
	method?: CompactionPhaseMethod;
	reason?: string;
	at: number;
	detail?: CompactionPhaseDetail;
}

export interface CompactionCommitNotification {
	passId: string;
	/** Armed speculative splice only: the speculation pass that produced the summary. */
	sourcePassId?: string;
	trigger: CompactionTrigger;
	method?: CompactionPhaseMethod;
	reason?: string;
	entry: CompactionEntry;
	/** The discarded region: branch entry ids strictly before `firstKeptEntryId`, in order. */
	cutPoint: { firstKeptEntryId: string; discardedEntryIds: string[] };
	tokensBefore: number;
	tokensAfter?: number;
	fidelity?: CompactionFidelity;
}

export type CompactionCommitListener = (commit: CompactionCommitNotification) => void | Promise<void>;

export interface CompactionPassInput {
	trigger: CompactionTrigger;
	method?: CompactionPhaseMethod;
	reason?: string;
	tokensBefore?: number;
}

/** Minimal event sink: `SessionMaintenance` forwards these through `emitSessionEvent`. */
export type CompactionPhaseEmitter = (event: CompactionPhaseEvent) => Promise<void>;

let passSequence = 0;

function nextPassId(): string {
	passSequence += 1;
	return `cmp-${Date.now().toString(36)}-${passSequence.toString(36)}`;
}

export class CompactionService {
	readonly #emit: CompactionPhaseEmitter;
	readonly #listeners = new Set<CompactionCommitListener>();

	constructor(emit: CompactionPhaseEmitter) {
		this.#emit = emit;
	}

	/**
	 * Subscribe to committed compactions. Listeners run in registration order,
	 * awaited, after the entry is durable and before the `session_compact`
	 * extension emit. A listener throw is isolated and never fails the commit.
	 * Returns an unsubscribe function.
	 */
	onCommit(listener: CompactionCommitListener): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	/**
	 * Open a pass. The caller emits `plan` once its method/cut point is decided;
	 * the service does not emit on construction so a pass never announces a plan
	 * it cannot describe yet.
	 */
	beginPass(input: CompactionPassInput): CompactionPass {
		return new CompactionPass(nextPassId(), input, this.#emit);
	}

	/** Fan a durable entry out to commit listeners. Never throws. */
	async notifyCommitted(commit: CompactionCommitNotification): Promise<void> {
		for (const listener of [...this.#listeners]) {
			try {
				await listener(commit);
			} catch (error) {
				// Isolated by contract: a consumer bug must not fail or roll back a commit.
				logger.warn("Compaction commit listener failed", {
					passId: commit.passId,
					entryId: commit.entry.id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}
}

/** One compaction pass, serialized phase by phase. */
export class CompactionPass {
	readonly id: string;
	readonly #emit: CompactionPhaseEmitter;
	readonly #trigger: CompactionTrigger;
	#method: CompactionPhaseMethod | undefined;
	#reason: string | undefined;
	#tokensBefore: number | undefined;
	#startedAt = Date.now();
	#lastPhase: CompactionPhase | undefined;
	#committed = false;
	#settled = false;

	constructor(id: string, input: CompactionPassInput, emit: CompactionPhaseEmitter) {
		this.id = id;
		this.#emit = emit;
		this.#trigger = input.trigger;
		this.#method = input.method;
		this.#reason = input.reason;
		this.#tokensBefore = input.tokensBefore;
	}

	/** Which pipeline opened this pass. */
	get trigger(): CompactionTrigger {
		return this.#trigger;
	}

	get committed(): boolean {
		return this.#committed;
	}

	/** Emit `plan`. Repeated on a method fallback inside the same pass. */
	async plan(input: CompactionPassInput = {}): Promise<void> {
		if (this.#committed || this.#settled) return;
		if (input.method !== undefined) this.#method = input.method;
		if (input.reason !== undefined) this.#reason = input.reason;
		if (input.tokensBefore !== undefined) this.#tokensBefore = input.tokensBefore;
		await this.#send("plan", { tokensBefore: this.#tokensBefore });
	}

	/** Emit the work phase actually about to run. */
	async enter(phase: "summarize" | "archive", detail: CompactionPhaseDetail = {}): Promise<void> {
		if (this.#committed || this.#settled) return;
		if (this.#lastPhase !== "plan" && this.#lastPhase !== "summarize" && this.#lastPhase !== "archive") return;
		await this.#send(phase, { tokensBefore: this.#tokensBefore, ...detail });
	}

	/** Mark the pass committed and emit `commit`. Terminal for this pass. */
	async commit(detail: CompactionPhaseDetail = {}): Promise<void> {
		if (this.#committed || this.#settled) return;
		this.#committed = true;
		await this.#send("commit", { tokensBefore: this.#tokensBefore, durationMs: Date.now() - this.#startedAt, ...detail });
	}

	/**
	 * Emit the terminal phase for a pass that did not commit. `aborted` is
	 * cancellation only; callers pass it from a cancel classification, never from
	 * a provider/parse/projection error.
	 */
	async settle(outcome: "failed" | "aborted", detail: CompactionPhaseDetail = {}): Promise<void> {
		if (this.#settled || this.#committed) return;
		this.#settled = true;
		await this.#send(outcome, {
			tokensBefore: this.#tokensBefore,
			durationMs: Date.now() - this.#startedAt,
			...detail,
		});
	}

	async #send(phase: CompactionPhase, detail: CompactionPhaseDetail): Promise<void> {
		this.#lastPhase = phase;
		const event: CompactionPhaseEvent = {
			type: "compaction_phase",
			passId: this.id,
			trigger: this.#trigger,
			phase,
			...(this.#method ? { method: this.#method } : {}),
			...(this.#reason ? { reason: this.#reason } : {}),
			at: Date.now(),
			...(Object.keys(detail).length > 0 ? { detail } : {}),
		};
		try {
			await this.#emit(event);
		} catch {
			// Phase emission is observability; it must never fail the compaction.
		}
	}
}

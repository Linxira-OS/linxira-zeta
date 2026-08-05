/**
 * ZetaContextManager - Dual state machine for context-aware caching and compression.
 *
 * ## State Machine A: Threshold → Memory Write
 * Monitors context token usage before each model call. When the token count exceeds
 * `zeta.contextCache.thresholdTokens` (default 400K), injects a SoftToolRequirement
 * for `memory_edit` so the model writes important information to persistent memory
 * before it gets evicted by compaction.
 *
 * ## State Machine B: EndTurn → Compression
 * Monitors queued messages before dequeue. When an endTurn tag is detected on the
 * last assistant message, triggers `runAutoCompaction` to reduce context size.
 *
 * Integration: instantiated in AgentSession, registers hooks on the Agent.
 */

import type { Agent, SoftToolRequirement } from "@zeta/pi-agent-core";
import type { AssistantMessage } from "@zeta/pi-ai";
import type { Settings } from "../config/settings";
import type { ContextUsage } from "../extensibility/extensions/types";
import type { CompactionCheckResult } from "./session-maintenance";

// ═══════════════════════════════════════════════════════════════════════════
// Host Interface
// ═══════════════════════════════════════════════════════════════════════════

export interface ZetaContextManagerHost {
	readonly settings: Settings;
	getContextUsage(options?: { contextWindow?: number }): ContextUsage | undefined;
	runAutoCompaction(
		reason: "threshold",
		willRetry: boolean,
		deferred?: boolean,
		allowDefer?: boolean,
		options?: {
			autoContinue?: boolean;
			triggerContextTokens?: number;
			suppressContinuation?: boolean;
			suppressHandoff?: boolean;
		},
	): Promise<CompactionCheckResult>;
	/** The last assistant message in the active context (for endTurn detection). */
	findLastAssistantMessage(): AssistantMessage | undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_THRESHOLD_TOKENS = 400_000;
const DEFAULT_MEMORY_WRITE_ENABLED = true;
const DEFAULT_ENDTURN_COMPACTION_ENABLED = true;
const DEFAULT_ENABLED = false;

// ═══════════════════════════════════════════════════════════════════════════
// ZetaContextManager
// ═══════════════════════════════════════════════════════════════════════════

export class ZetaContextManager {
	readonly #host: ZetaContextManagerHost;
	#detachBeforeModelCall: (() => void) | undefined;
	#detachBeforeQueueDequeue: (() => void) | undefined;
	/** Whether State Machine A has an active memory-write requirement. */
	#pendingMemoryWrite = false;
	/** Stable id for the current memory-write SoftToolRequirement. */
	#memoryWriteId = "";
	/** Whether the last endTurn check already triggered compaction (debounce). */
	#endTurnCompactionPending = false;

	constructor(host: ZetaContextManagerHost) {
		this.#host = host;
	}

	// ── Registration ────────────────────────────────────────────────────────

	/** Register both state machine hooks on the agent. Returns the detach cleanup function. */
	register(agent: Agent): void {
		this.#detachBeforeModelCall = agent.addBeforeModelCallHook(async signal => {
			await this.#checkThresholdAndMaybeMemoryWrite(signal);
		});
		this.#detachBeforeQueueDequeue = agent.addBeforeQueuedMessageDequeueHook(async signal => {
			await this.#checkEndTurnAndMaybeCompact(signal);
		});
	}

	/** Detach both hooks. Idempotent. */
	unregister(): void {
		this.#detachBeforeModelCall?.();
		this.#detachBeforeModelCall = undefined;
		this.#detachBeforeQueueDequeue?.();
		this.#detachBeforeQueueDequeue = undefined;
		this.#pendingMemoryWrite = false;
		this.#endTurnCompactionPending = false;
	}

	// ── State Machine A: Threshold → Memory Write ───────────────────────────

	/**
	 * Check context usage before each model call. If tokens exceed the threshold,
	 * set the pending memory-write flag so `nextToolChoiceDirective()` can inject
	 * a SoftToolRequirement for `memory_edit`.
	 */
	async #checkThresholdAndMaybeMemoryWrite(_signal?: AbortSignal): Promise<void> {
		if (!this.#getEnabled()) return;
		if (!this.#getMemoryWriteEnabled()) return;

		const usage = this.#host.getContextUsage();
		if (!usage) return;

		const threshold = this.#getThresholdTokens();
		if (usage.tokens >= threshold) {
			if (!this.#pendingMemoryWrite) {
				this.#pendingMemoryWrite = true;
				this.#memoryWriteId = `zeta-memory-${Date.now()}`;
			}
		} else {
			// Clear the requirement when back below threshold
			this.#pendingMemoryWrite = false;
		}
	}

	/** Whether State Machine A has an active memory-write requirement. */
	needsMemoryWrite(): boolean {
		return this.#pendingMemoryWrite && this.#getEnabled() && this.#getMemoryWriteEnabled();
	}

	/**
	 * Build a SoftToolRequirement for `memory_edit` when the threshold is exceeded.
	 * Returns undefined when no memory write is needed.
	 */
	getMemoryWriteRequirement(): SoftToolRequirement | undefined {
		if (!this.needsMemoryWrite()) return undefined;

		return {
			soft: true,
			id: this.#memoryWriteId,
			toolName: "memory_edit",
			reminder: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "Your context is approaching the token limit. Please use the `memory_edit` tool to save important information to persistent memory before it gets evicted by compaction.",
						},
					],
					timestamp: Date.now(),
				},
			],
		};
	}

	/** Clear the memory-write requirement after the model has called memory_edit. */
	clearMemoryWrite(): void {
		this.#pendingMemoryWrite = false;
	}

	// ── State Machine B: EndTurn → Compression ──────────────────────────────

	/**
	 * Check for endTurn on the last assistant message before queued messages are
	 * consumed. If detected, trigger `runAutoCompaction` to reduce context size.
	 */
	async #checkEndTurnAndMaybeCompact(signal?: AbortSignal): Promise<void> {
		if (!this.#getEnabled()) return;
		if (!this.#getEndTurnCompactionEnabled()) return;
		if (this.#endTurnCompactionPending) return;

		const lastMsg = this.#host.findLastAssistantMessage();
		if (!lastMsg) return;

		// Check for endTurn: stopReason is "stop" with stopDetails.type === "end_turn"
		if (lastMsg.stopReason !== "stop") return;
		if (lastMsg.stopDetails?.type !== "end_turn") return;

		this.#endTurnCompactionPending = true;
		try {
			const usage = this.#host.getContextUsage();
			await this.#host.runAutoCompaction("threshold", false, false, true, {
				triggerContextTokens: usage?.tokens,
				suppressContinuation: true,
			});
		} finally {
			this.#endTurnCompactionPending = false;
		}

		signal?.throwIfAborted();
	}

	// ── Settings Helpers ────────────────────────────────────────────────────

	#getEnabled(): boolean {
		return this.#host.settings.get("zeta.contextCache.enabled") ?? DEFAULT_ENABLED;
	}

	#getThresholdTokens(): number {
		return this.#host.settings.get("zeta.contextCache.thresholdTokens") ?? DEFAULT_THRESHOLD_TOKENS;
	}

	#getMemoryWriteEnabled(): boolean {
		return this.#host.settings.get("zeta.contextCache.memoryWriteEnabled") ?? DEFAULT_MEMORY_WRITE_ENABLED;
	}

	#getEndTurnCompactionEnabled(): boolean {
		return (
			this.#host.settings.get("zeta.contextCache.endTurnCompactionEnabled") ?? DEFAULT_ENDTURN_COMPACTION_ENABLED
		);
	}
}

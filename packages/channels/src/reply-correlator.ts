/**
 * Reply correlation for inbound chat messages.
 *
 * An agent turn does not name the message it answers, so a bridge that keeps a
 * global FIFO and shifts it on every `turn_end` sends one chat's answer to
 * another chat — and a Studio/attach prompt on the same session (which also
 * ends turns) steals a waiting IM reply.
 *
 * This correlator keys every delivered message by the IRC record id it was
 * injected with, and matches the turn that actually answers it through the
 * session's IRC wake-turn observer (`AgentSession.setIrcWakeTurnObserver`),
 * which receives exactly the records a wake turn was started for. Turns that
 * answer no delivered record (Studio/attach prompts, agent-to-agent IRC) are
 * ignored. The auto-reply hook correlates exactly by the message id it hands
 * back. Sessions without the observer (stubs, older embeddings) fall back to
 * ordered per-session consumption, preserving the previous behavior.
 */

import { logger } from "@linxiraos/pi-utils";
import type { ChannelId } from "./channel";

/** A reply that goes back to one IM chat. */
export interface ChatReplyTarget {
	kind: "chat";
	channelId: ChannelId;
	peer: string;
	/** Platform message id being answered, when the platform provided one. */
	messageId?: string;
}

/** A reply consumed by an in-process caller instead of an IM chat. */
export interface SinkReplyTarget {
	kind: "sink";
	deliver(text: string): void;
	/** Deliver the turn even when it produced no text (delegation timeouts etc.). */
	allowEmpty?: boolean;
}

export type ReplyTarget = ChatReplyTarget | SinkReplyTarget;

export interface ReplyCorrelatorOptions {
	/** Delivers a chat reply inside and outside an observation. */
	sendText(target: { channelId: ChannelId; peer: string }, text: string): void | Promise<void>;
	/** Pending replies older than this are dropped (default 10 minutes). */
	ttlMs?: number;
	/** Upper bound on pending replies; the oldest is evicted past it. */
	maxPending?: number;
	now?: () => number;
}

/** Guards against a lost turn holding a slot forever (mirrors the old direct-reply TTL). */
const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_PENDING = 64;

interface PendingReply {
	recordId: string;
	target: ReplyTarget;
	expiresAt: number;
}

/** The IRC record id a turn input carries (`details.id` of an `irc:incoming` record). */
function recordReplyId(record: unknown): string | undefined {
	if (!record || typeof record !== "object" || !("details" in record)) return undefined;
	const details = record.details;
	if (!details || typeof details !== "object" || !("id" in details)) return undefined;
	return typeof details.id === "string" && details.id !== "" ? details.id : undefined;
}

export class ReplyCorrelator {
	readonly #options: ReplyCorrelatorOptions;
	readonly #ttlMs: number;
	readonly #maxPending: number;
	readonly #now: () => number;
	/** Delivered, unanswered messages keyed by the IRC record id they were injected with. */
	readonly #pending = new Map<string, PendingReply>();
	/** Delivery order; only the fallback path and eviction read it. */
	readonly #order: PendingReply[] = [];
	/** Replies the current wake turn answers (one open observation per session). */
	#active: PendingReply[] | null = null;
	#fallback = false;

	constructor(options: ReplyCorrelatorOptions) {
		this.#options = options;
		this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
		this.#maxPending = Math.max(1, options.maxPending ?? DEFAULT_MAX_PENDING);
		this.#now = options.now ?? Date.now;
	}

	/** Enable ordered consumption for sessions without a wake-turn observer. */
	enableFallback(): void {
		this.#fallback = true;
	}

	/** Register the reply expected from `recordId` (the IRC message id being delivered). */
	expect(recordId: string, target: ReplyTarget): void {
		this.#prune();
		if (this.#pending.has(recordId)) return;
		const entry: PendingReply = { recordId, target, expiresAt: this.#now() + this.#ttlMs };
		this.#pending.set(recordId, entry);
		this.#order.push(entry);
		while (this.#order.length > this.#maxPending) {
			const oldest = this.#order[0];
			if (!oldest) break;
			this.#remove(oldest.recordId);
		}
	}

	/** Drop an expectation whose delivery failed. */
	forget(recordId: string): void {
		this.#remove(recordId);
	}

	/** Exact correlation for the IRC auto-reply hook, which hands back the original message. */
	take(recordId: string): ReplyTarget | null {
		const entry = this.#pending.get(recordId);
		if (!entry) return null;
		this.#remove(recordId);
		return entry.target;
	}

	/**
	 * Session wake-turn observer: claim the pending replies whose records this
	 * turn answers. Returns `undefined` for a turn that answers no delivered
	 * message (Studio/attach prompt, agent-to-agent traffic).
	 */
	observe(records: readonly unknown[]): ((error?: unknown) => void) | undefined {
		this.#prune();
		const matched: PendingReply[] = [];
		for (const record of records) {
			const id = recordReplyId(record);
			if (!id) continue;
			const entry = this.#pending.get(id);
			if (entry && !matched.includes(entry)) matched.push(entry);
		}
		if (matched.length === 0) return undefined;
		for (const entry of matched) this.#remove(entry.recordId);
		const observation = matched;
		this.#active = observation;
		return () => {
			// The turn settled without text: drop the claim so a later unrelated
			// turn can never be attributed to these messages.
			if (this.#active === observation) this.#active = null;
		};
	}

	/**
	 * Feed one `turn_end` text. Returns true when the turn answered a pending
	 * chat message (the caller should not fall through to other reply paths).
	 */
	onTurnText(text: string): boolean {
		const body = text.trim();
		const active = this.#active;
		if (active) {
			if (body === "" && !active.every(entry => entry.target.kind === "sink" && entry.target.allowEmpty)) {
				// A tool-call-only turn; the run's text may follow on a later turn.
				return false;
			}
			this.#active = null;
			for (const entry of active) this.#deliver(entry.target, body);
			return true;
		}
		if (!this.#fallback) return false;
		this.#prune();
		const entry = this.#order[0];
		if (!entry) return false;
		this.#remove(entry.recordId);
		const allowEmpty = entry.target.kind === "sink" && entry.target.allowEmpty === true;
		if (body !== "" || allowEmpty) this.#deliver(entry.target, body);
		return true;
	}

	/** Pending replies still waiting for a turn. */
	get pendingCount(): number {
		return this.#pending.size;
	}

	/** Drop every pending reply (host/router shutdown). */
	clear(): void {
		this.#pending.clear();
		this.#order.length = 0;
		this.#active = null;
	}

	#deliver(target: ReplyTarget, text: string): void {
		try {
			if (target.kind === "chat") {
				void Promise.resolve(
					this.#options.sendText({ channelId: target.channelId, peer: target.peer }, text),
				).catch(error => {
					logger.warn("Channel reply delivery failed", {
						channel: target.channelId,
						error: error instanceof Error ? error.message : String(error),
					});
				});
				return;
			}
			target.deliver(text);
		} catch (error) {
			logger.warn("Channel reply delivery failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	#prune(): void {
		const now = this.#now();
		if (this.#order.length > 0) {
			for (const entry of [...this.#order]) {
				if (entry.expiresAt <= now) this.#remove(entry.recordId);
			}
		}
		if (this.#active) {
			this.#active = this.#active.filter(entry => entry.expiresAt > now);
			if (this.#active.length === 0) this.#active = null;
		}
	}

	#remove(recordId: string): void {
		this.#pending.delete(recordId);
		const index = this.#order.findIndex(entry => entry.recordId === recordId);
		if (index >= 0) this.#order.splice(index, 1);
	}
}

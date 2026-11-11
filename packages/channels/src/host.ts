/**
 * ChannelHost — bridges IM channels into the coordinator `AgentSession`.
 *
 * Inbound: each channel message becomes an `IrcMessage` delivered through
 * `AgentSession.deliverIrcMessage` (the same IRC injection path agents use),
 * so interrupts, asides, plan-mode handling, and ephemeral auto-replies all
 * behave identically to IRC traffic. `channels.allowedPeers` is enforced
 * before that injection, so an unauthorized sender never reaches a turn.
 *
 * Outbound: the agent's final reply to a channel message is forwarded back to
 * the sender. Two paths exist:
 * - a real woken turn → the turn's final assistant text is captured from the
 *   `turn_end` session event;
 * - the IRC ephemeral auto-reply path (busy session with async disabled, or
 *   plan-mode idle) → `IrcBridge` reports the reply text through the
 *   `onAutoReply` hook.
 *
 * Replies are correlated per delivered message (`ReplyCorrelator`), not by a
 * global turn queue: two chats never swap answers, and a Studio/attach prompt
 * on the same session never consumes an IM reply slot.
 *
 * The agent can also push progress proactively with the `channel_send` tool
 * (Phase 3); working-tool output is never forwarded automatically.
 */

import type { AssistantMessage, TextContent } from "@linxiraos/pi-ai";
import { logger, Snowflake } from "@linxiraos/pi-utils";
import { CHANNEL_PEER_REFUSED_TEXT, isPeerAllowedFor, type ChannelAllowlists, type PeerIdentity } from "./auth";
import type { ChannelInstanceId, ChannelSendOptions } from "./channel";
import { ReplyCorrelator } from "./reply-correlator";
import type { ChannelSession, ChannelSessionEvent, IrcMessage } from "./types";

/** Outbound sink: resolves a channel + peer to a `sendText` call. */
export type ChannelSendFn = (
	instanceId: ChannelInstanceId,
	to: string,
	text: string,
	options?: ChannelSendOptions,
) => Promise<void>;

/** Outcome of one inbound injection. */
export type ChannelDeliveryResult = { ok: true } | { ok: false; reason: "peer-not-allowed" | "duplicate" };

/** One refusal per unauthorized peer per minute — enough to be explicit, not a spam vector. */
const REFUSAL_COOLDOWN_MS = 60_000;

/** Second-line in-memory dedupe (routeInbound owns the durable per-channel state). */
const DELIVERED_ID_TTL_MS = 24 * 60 * 60_000;
const MAX_DELIVERED_IDS = 512;

function assistantText(message: AssistantMessage | undefined): string {
	if (message?.role !== "assistant" || !Array.isArray(message.content)) return "";
	return message.content
		.filter((content): content is TextContent => content.type === "text")
		.map(content => content.text)
		.join("")
		.trim();
}

export class ChannelHost {
	readonly #session: ChannelSession;
	readonly #send: ChannelSendFn;
	readonly #allow: ChannelAllowlists;
	readonly #replies: ReplyCorrelator;
	readonly #deliveredIds = new Map<string, number>();
	readonly #refusedAt = new Map<string, number>();
	#unsubscribe: (() => void) | null = null;
	#observerInstalled = false;
	#lastInbound: { instanceId: ChannelInstanceId; peer: string } | null = null;

	constructor(session: ChannelSession, send: ChannelSendFn, allow: ChannelAllowlists) {
		this.#session = session;
		this.#send = send;
		this.#allow = allow;
		this.#replies = new ReplyCorrelator({
			sendText: (target, text) =>
				this.#send(
					target.instanceId,
					target.peer,
					text,
					target.messageId ? { replyToMessageId: target.messageId } : undefined,
				),
		});
	}

	get session(): ChannelSession {
		return this.#session;
	}

	/** Most recent successfully injected inbound (channel, peer) — the default
	 *  target for `channel_send` calls that omit `to`/`channel`. */
	get lastInbound(): { instanceId: ChannelInstanceId; peer: string } | null {
		return this.#lastInbound;
	}

	/** Attach the session event listener + IRC auto-reply hook, and correlate
	 *  wake-turn replies through the session's observer when it exposes one. */
	start(): void {
		if (this.#unsubscribe) return;
		this.#unsubscribe = this.#session.subscribe(event => this.#onSessionEvent(event));
		this.#session.setIrcAutoReplyListener((msg, replyText) => this.#onAutoReply(msg, replyText));
		const observer = this.#session.setIrcWakeTurnObserver;
		if (typeof observer === "function") {
			try {
				observer.call(this.#session, records => this.#replies.observe(records));
				this.#observerInstalled = true;
			} catch (error) {
				logger.warn("Channel wake-turn observer unavailable", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		if (!this.#observerInstalled) this.#replies.enableFallback();
	}

	/** Detach listeners, release the observer, and drop pending reply bindings. */
	stop(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		this.#session.setIrcAutoReplyListener(null);
		if (this.#observerInstalled) {
			this.#session.setIrcWakeTurnObserver?.(undefined);
			this.#observerInstalled = false;
		}
		this.#replies.clear();
		this.#deliveredIds.clear();
		this.#refusedAt.clear();
	}

	/**
	 * Inject one inbound channel message into the coordinator session and
	 * bind the sender so the turn's final reply returns to them.
	 */
	async deliver(
		instanceId: ChannelInstanceId,
		peer: string,
		body: string,
		messageId?: string,
		identity?: Omit<PeerIdentity, "peer">,
	): Promise<ChannelDeliveryResult> {
		// Authorization is the FIRST inbound check, mirroring `routeInbound`:
		// an unauthorized sender must never reach dispatch or start a turn.
		if (!isPeerAllowedFor(instanceId, { peer, ...identity }, this.#allow)) {
			logger.warn("Channel message refused: peer not in instance allowlist", { instance: instanceId, peer });
			this.#refuse(instanceId, peer);
			return { ok: false, reason: "peer-not-allowed" };
		}
		const dedupeKey = messageId ? `${instanceId}\u0000${messageId}` : undefined;
		if (dedupeKey && this.#hasDelivered(dedupeKey)) {
			logger.debug("Duplicate channel message ignored", { instance: instanceId, messageId });
			return { ok: false, reason: "duplicate" };
		}
		const agentId = this.#session.getAgentId();
		if (!agentId) throw new Error("Session has no agent id");
		const recordId = Snowflake.next();
		const msg: IrcMessage = {
			id: recordId,
			from: peer,
			to: agentId,
			body,
			ts: Date.now(),
		};
		// Registered before delivery: a wake turn can start synchronously inside
		// `deliverIrcMessage`, and the observer must find the expectation.
		this.#replies.expect(recordId, {
			kind: "chat",
			instanceId,
			peer,
			...(messageId !== undefined && messageId !== "" ? { messageId } : {}),
		});
		if (dedupeKey) this.#rememberDelivered(dedupeKey);
		try {
			await this.#session.deliverIrcMessage(msg, { expectsReply: true });
			this.#lastInbound = { instanceId, peer };
			return { ok: true };
		} catch (error) {
			this.#replies.forget(recordId);
			if (dedupeKey) this.#deliveredIds.delete(dedupeKey);
			throw error;
		}
	}

	/** Explicit refusal for an unauthorized sender, rate limited per peer. */
	#refuse(instanceId: ChannelInstanceId, peer: string): void {
		const key = `${instanceId}\u0000${peer}`;
		const now = Date.now();
		const last = this.#refusedAt.get(key) ?? 0;
		if (now - last < REFUSAL_COOLDOWN_MS) return;
		this.#refusedAt.set(key, now);
		void this.#send(instanceId, peer, CHANNEL_PEER_REFUSED_TEXT).catch(error => {
			logger.warn("Channel refusal delivery failed", {
				instance: instanceId,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}

	#hasDelivered(key: string): boolean {
		const at = this.#deliveredIds.get(key);
		if (at === undefined) return false;
		if (Date.now() - at > DELIVERED_ID_TTL_MS) {
			this.#deliveredIds.delete(key);
			return false;
		}
		return true;
	}

	#rememberDelivered(key: string): void {
		this.#deliveredIds.set(key, Date.now());
		while (this.#deliveredIds.size > MAX_DELIVERED_IDS) {
			const oldest = this.#deliveredIds.keys().next();
			if (oldest.done) break;
			this.#deliveredIds.delete(oldest.value);
		}
	}

	#onSessionEvent(event: ChannelSessionEvent): void {
		if (event.type !== "turn_end") return;
		this.#replies.onTurnText(assistantText(event.message as AssistantMessage));
	}

	#onAutoReply(msg: IrcMessage, replyText: string): void {
		// Exact correlation: the hook hands back the message being answered.
		const target = this.#replies.take(msg.id);
		if (!target || target.kind !== "chat") return;
		const body = replyText.trim();
		if (!body) return;
		void this.#send(target.instanceId, target.peer, body).catch(error => {
			logger.warn("Channel auto-reply delivery failed", {
				instance: target.instanceId,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}
}

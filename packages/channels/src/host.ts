/**
 * ChannelHost — bridges IM channels into the coordinator `AgentSession`.
 *
 * Inbound: each channel message becomes an `IrcMessage` delivered through
 * `AgentSession.deliverIrcMessage` (the same IRC injection path agents use),
 * so interrupts, asides, plan-mode handling, and ephemeral auto-replies all
 * behave identically to IRC traffic.
 *
 * Outbound: the agent's final reply to a channel message is forwarded back
 * to the sender. Two paths exist:
 * - a real woken turn → the turn's final assistant text is captured from the
 *   `turn_end` session event;
 * - the IRC ephemeral auto-reply path (busy session with async disabled, or
 *   plan-mode idle) → `IrcBridge` reports the reply text through the
 *   `onAutoReply` hook.
 *
 * The agent can also push progress proactively with the `channel_send` tool
 * (Phase 3); working-tool output is never forwarded automatically.
 */

import type { AssistantMessage, TextContent } from "@linxiraos/pi-ai";
import { logger, Snowflake } from "@linxiraos/pi-utils";
import type { ChannelId } from "./channel";
import type { ChannelSession, ChannelSessionEvent, IrcMessage } from "./types";

/** Outbound sink: resolves a channel + peer to a `sendText` call. */
export type ChannelSendFn = (
	channelId: ChannelId,
	to: string,
	text: string,
) => Promise<void>;

interface PendingReply {
	channelId: ChannelId;
	peer: string;
}

function assistantText(message: AssistantMessage | undefined): string {
	if (message?.role !== "assistant" || !Array.isArray(message.content))
		return "";
	return message.content
		.filter((content): content is TextContent => content.type === "text")
		.map((content) => content.text)
		.join("")
		.trim();
}

export class ChannelHost {
	readonly #session: ChannelSession;
	readonly #send: ChannelSendFn;
	readonly #allowedPeers: readonly string[];
	#pending: PendingReply[] = [];
	#unsubscribe: (() => void) | null = null;
	#lastInbound: { channelId: ChannelId; peer: string } | null = null;

	constructor(
		session: ChannelSession,
		send: ChannelSendFn,
		allowedPeers?: readonly string[],
	) {
		this.#session = session;
		this.#send = send;
		this.#allowedPeers = allowedPeers ?? [];
	}

	get session(): ChannelSession {
		return this.#session;
	}

	/** Most recent successfully injected inbound (channel, peer) — the default
	 *  target for `channel_send` calls that omit `to`/`channel`. */
	get lastInbound(): { channelId: ChannelId; peer: string } | null {
		return this.#lastInbound;
	}

	/** Attach the session event listener + IRC auto-reply hook. */
	start(): void {
		if (this.#unsubscribe) return;
		this.#unsubscribe = this.#session.subscribe((event) =>
			this.#onSessionEvent(event),
		);
		this.#session.setIrcAutoReplyListener((msg, replyText) =>
			this.#onAutoReply(msg, replyText),
		);
	}

	/** Detach listeners and drop pending reply bindings. */
	stop(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		this.#session.setIrcAutoReplyListener(null);
		this.#pending = [];
	}

	/**
	 * Inject one inbound channel message into the coordinator session and
	 * bind the sender so the turn's final reply returns to them.
	 */
	async deliver(
		channelId: ChannelId,
		peer: string,
		body: string,
	): Promise<void> {
		// Optional allowlist: when configured, only listed peers may reach the
		// agent (empty allowlist = everyone, unchanged behavior).
		if (this.#allowedPeers.length > 0 && !this.#allowedPeers.includes(peer)) {
			logger.debug("Channel message from non-allowed peer dropped", {
				channel: channelId,
				peer,
			});
			return;
		}
		const agentId = this.#session.getAgentId();
		if (!agentId) throw new Error("Session has no agent id");
		const msg: IrcMessage = {
			id: Snowflake.next(),
			from: peer,
			to: agentId,
			body,
			ts: Date.now(),
		};
		this.#pending.push({ channelId, peer });
		try {
			await this.#session.deliverIrcMessage(msg, { expectsReply: true });
			this.#lastInbound = { channelId, peer };
		} catch (error) {
			this.#pending = this.#pending.filter(
				(p) => !(p.channelId === channelId && p.peer === peer),
			);
			throw error;
		}
	}

	#onSessionEvent(event: ChannelSessionEvent): void {
		if (event.type !== "turn_end") return;
		const pending = this.#pending.shift();
		if (!pending) return;
		const text = assistantText(event.message as AssistantMessage);
		if (!text) return;
		void this.#send(pending.channelId, pending.peer, text).catch((error) => {
			logger.warn("Channel reply delivery failed", {
				channel: pending.channelId,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}

	#onAutoReply(_msg: IrcMessage, replyText: string): void {
		const pending = this.#pending.shift();
		if (!pending) return;
		const body = replyText.trim();
		if (!body) return;
		void this.#send(pending.channelId, pending.peer, body).catch((error) => {
			logger.warn("Channel auto-reply delivery failed", {
				channel: pending.channelId,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}
}

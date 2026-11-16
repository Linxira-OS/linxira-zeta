import { isRecord } from "@linxiraos/pi-utils";
import type { AgentSessionWrapper } from "../web-gateway/agents.js";
import type {
	ConversationLiveReplay,
	ConversationMessageItem,
	ConversationRuntimeEvent,
	ConversationStreamEvent,
	SessionId,
} from "./protocol/index.js";
import { CONVERSATION_LIMITS } from "./protocol/contracts/conversation.js";
import { truncateUtf8, utf8ByteLength } from "./protocol/conversation-text.js";
import { parseConversationRuntimeEvent } from "./protocol/conversation-validation.js";
import { projectConversationItems } from "./conversation-projector.js";
import { computerResultProjection } from "./services/computer-result-projection.js";

const feeds = new WeakMap<AgentSessionWrapper, ConversationFeed>();
let eventSeq = 0;

/** One bounded projector per resident Runtime, shared by all authorized observers. */
export function conversationFeed(wrapper: AgentSessionWrapper): ConversationFeed {
	let feed = feeds.get(wrapper);
	if (feed === undefined) {
		feed = new ConversationFeed(wrapper);
		feeds.set(wrapper, feed);
	}
	return feed;
}

export class ConversationFeed {
	readonly #listeners = new Set<(event: ConversationStreamEvent) => void>();
	readonly #events: Array<{ event: ConversationStreamEvent; bytes: number }> = [];
	readonly #messages = new Map<string, { parentId: string | null; createdAt: string }>();
	readonly #tools = new Map<string, { messageId: string; turnId: string }>();
	#bytes = 0;
	#sequence = 0;
	#turnId = crypto.randomUUID();
	#assistantId: string | undefined;
	#parentId: string | null = null;
	#overflowed = false;
	#captures = 0;
	#idle = true;

	constructor(readonly wrapper: AgentSessionWrapper) {
		this.#idle = !wrapper.isRunning();
		for (const entry of wrapper.getSession().sessionManager.getBranchView()) {
			if (entry.type === "message" && (entry.message.role === "assistant" || entry.message.role === "user"))
				this.#parentId = entry.id;
		}
		wrapper.onEvent(event => this.#observe(event as unknown as Record<string, unknown>));
		const partial = wrapper.getSession().agent.state.streamMessage;
		if (partial && (partial.role === "assistant" || partial.role === "user")) {
			const id = wrapper.getSession().sessionManager.reserveMessageEntryId(partial);
			this.#observe({ type: "message_start", message: partial, sessionEntryId: id });
			if (partial.role === "assistant") {
				for (const [index, block] of partial.content.entries()) {
					if (block.type === "text" || block.type === "thinking")
						this.#delta(id, index, block.type, block.type === "text" ? block.text : block.thinking);
				}
			}
		}
	}

	subscribe(listener: (event: ConversationStreamEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	replay(): ConversationLiveReplay {
		return this.#overflowed
			? {
					status: "resyncRequired",
					watermark: this.#sequence,
					events: [],
					reason: "live conversation replay exceeded its bounded capacity",
				}
			: { status: "complete", watermark: this.#sequence, events: this.#events.map(frame => frame.event) };
	}

	/** Retain the live tail across an awaited persisted-page read. */
	async capture<T>(read: () => Promise<T>): Promise<{ page: T; live: ConversationLiveReplay }> {
		this.#captures++;
		try {
			const page = await read();
			return { page, live: this.replay() };
		} finally {
			this.#captures--;
			if (this.#captures === 0 && this.#idle) this.#clearReplay();
		}
	}

	#clearReplay(): void {
		this.#events.length = 0;
		this.#bytes = 0;
		this.#overflowed = false;
	}

	#emit(update: ConversationRuntimeEvent): void {
		const parsed = parseConversationRuntimeEvent(update);
		const event: ConversationStreamEvent = {
			streamSeq: ++this.#sequence,
			eventSeq: ++eventSeq,
			stateVersion: this.wrapper.getSession().getStateVersion(),
			occurredAt: new Date().toISOString(),
			update: parsed,
		};
		const bytes = utf8ByteLength(JSON.stringify(event));
		this.#events.push({ event, bytes });
		this.#bytes += bytes;
		while (
			this.#events.length > CONVERSATION_LIMITS.LIVE_REPLAY_MAX_EVENTS ||
			this.#bytes > CONVERSATION_LIMITS.LIVE_REPLAY_MAX_BYTES
		) {
			this.#bytes -= this.#events.shift()!.bytes;
			this.#overflowed = true;
		}
		for (const listener of this.#listeners) {
			try {
				listener(event);
			} catch {
				/* A detached consumer cannot interrupt Runtime delivery. */
			}
		}
	}

	#delta(messageId: string, index: number, blockType: "text" | "thinking", text: string): void {
		while (text.length > 0) {
			const delta = truncateUtf8(text, CONVERSATION_LIMITS.DELTA_MAX_BYTES).text;
			this.#emit({
				kind: "conversation.message.delta",
				sessionId: this.wrapper.realSessionId as SessionId,
				turnId: this.#turnId,
				messageId,
				blockId: `${blockType}:${index}`,
				blockType,
				delta,
			});
			text = text.slice(delta.length);
		}
	}

	#observe(event: Record<string, unknown>): void {
		if (event.type === "agent_start") {
			if (this.#captures === 0) this.#clearReplay();
			this.#idle = false;
		}
		const sessionId = this.wrapper.realSessionId as SessionId;
		const message = isRecord(event.message) ? event.message : undefined;
		const messageId =
			message === undefined ? undefined : this.wrapper.getSession().sessionManager.reserveMessageEntryId(message);
		if (event.type === "turn_start") this.#turnId = crypto.randomUUID();
		if (
			event.type === "message_start" &&
			message &&
			messageId &&
			(message.role === "user" || message.role === "assistant")
		) {
			const createdAt = new Date(
				typeof message.timestamp === "number" ? message.timestamp : Date.now(),
			).toISOString();
			this.#messages.set(messageId, { parentId: this.#parentId, createdAt });
			this.#parentId = messageId;
			if (message.role === "assistant") this.#assistantId = messageId;
			this.#emit({
				kind: "conversation.message.started",
				sessionId,
				turnId: this.#turnId,
				messageId,
				role: message.role,
				createdAt,
			});
		}
		if (event.type === "message_update" && messageId && isRecord(event.assistantMessageEvent)) {
			const delta = event.assistantMessageEvent;
			if ((delta.type === "text_delta" || delta.type === "thinking_delta") && typeof delta.delta === "string")
				this.#delta(
					messageId,
					Number(delta.contentIndex),
					delta.type === "text_delta" ? "text" : "thinking",
					delta.delta,
				);
		}
		if (
			event.type === "message_end" &&
			message &&
			messageId &&
			(message.role === "user" || message.role === "assistant")
		) {
			const prior = this.#messages.get(messageId);
			const projected = projectConversationItems(
				[{ id: messageId, createdAt: prior?.createdAt, message }],
				undefined,
			)[0];
			if (projected?.kind === "message") {
				const item: ConversationMessageItem = { ...projected, parentId: prior?.parentId ?? null };
				const error =
					typeof message.errorMessage === "string" && message.errorMessage !== ""
						? { message: truncateUtf8(message.errorMessage, CONVERSATION_LIMITS.NOTICE_MESSAGE_MAX_CHARS).text }
						: undefined;
				this.#emit({
					kind: "conversation.message.completed",
					sessionId,
					turnId: this.#turnId,
					messageId,
					item,
					...(error === undefined ? {} : { error }),
				});
			}
			this.#messages.delete(messageId);
		}
		if (
			event.type === "tool_execution_start" &&
			this.#assistantId &&
			typeof event.toolCallId === "string" &&
			typeof event.toolName === "string"
		) {
			this.#tools.set(event.toolCallId, { messageId: this.#assistantId, turnId: this.#turnId });
			this.#emit({
				kind: "conversation.tool.started",
				sessionId,
				turnId: this.#turnId,
				messageId: this.#assistantId,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				startedAt: new Date().toISOString(),
			});
		}
		if (
			(event.type === "tool_execution_update" || event.type === "tool_execution_end") &&
			typeof event.toolCallId === "string"
		) {
			const tool = this.#tools.get(event.toolCallId);
			const result = isRecord(event.result)
				? event.result
				: isRecord(event.partialResult)
					? event.partialResult
					: undefined;
			if (tool && result) {
				const output = Array.isArray(result.content)
					? result.content
							.filter(isRecord)
							.filter(block => block.type === "text" && typeof block.text === "string")
							.map(block => block.text)
							.join("\n")
					: "";
				const clipped = truncateUtf8(output, CONVERSATION_LIMITS.TEXT_BLOCK_MAX_BYTES);
				if (event.type === "tool_execution_end") {
					const computerData = computerResultProjection(result.details);
					this.#emit({
						kind: "conversation.tool.completed",
						sessionId,
						turnId: tool.turnId,
						toolCallId: event.toolCallId,
						result: {
							type: "toolResult",
							toolCallId: event.toolCallId,
							output: clipped.text,
							isError: event.isError === true,
							...(computerData === undefined ? {} : { data: computerData }),
							...(clipped.truncated ? { truncated: true } : {}),
						},
						completedAt: new Date().toISOString(),
					});
					this.#tools.delete(event.toolCallId);
				} else
					this.#emit({
						kind: "conversation.tool.updated",
						sessionId,
						turnId: tool.turnId,
						toolCallId: event.toolCallId,
						updateMode: "replace",
						output: clipped.text,
						...(clipped.truncated ? { truncated: true } : {}),
					});
			}
		}
		if (event.type === "turn_end")
			this.#emit({
				kind: message?.stopReason === "aborted" ? "conversation.turn.aborted" : "conversation.turn.completed",
				sessionId,
				turnId: this.#turnId,
			});
		if (event.type === "notice" && typeof event.message === "string")
			this.#emit({
				kind: "conversation.notice",
				sessionId,
				level: event.level === "error" || event.level === "warning" ? event.level : "info",
				message: truncateUtf8(event.message, CONVERSATION_LIMITS.NOTICE_MESSAGE_MAX_CHARS).text,
			});
		if (event.type === "agent_end") {
			this.#messages.clear();
			this.#tools.clear();
			this.#assistantId = undefined;
			this.#idle = true;
			if (this.#captures === 0) this.#clearReplay();
		}
	}
}

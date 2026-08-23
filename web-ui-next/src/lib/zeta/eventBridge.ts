import type { Event } from "@opencode-ai/sdk/v2/client";
import type { EventPipeline, EventPipelineInput } from "@/sync/event-pipeline";
import {
	collectToolResults,
	contentToText,
	convertZetaMessage,
	normalizeZetaDir,
	synthMessageId,
	type ZetaContentBlock,
	type ZetaMessage,
	type ZetaSessionInfo,
} from "./convert";

/**
 * Zeta SSE bridge implementing the sync layer's EventPipeline contract.
 *
 * OpenChamber consumes ONE global opencode event stream (`/global/event`).
 * Zeta exposes per-session SSE (`/api/agent/[id]/events`) plus a running-set
 * discovery stream (`/api/agent/running/events`). This bridge:
 *   1. subscribes to the running-set stream and mirrors its session set with
 *      one EventSource per live session,
 *   2. translates each zeta AgentSessionEvent into zero or more opencode
 *      Events consumed by `applyDirectoryEvent` (mapping table below),
 *   3. delivers them through the SAME onEvents callback the upstream pipeline
 *      feeds, so routing/batching/watchdogs in sync-context stay untouched.
 *
 * Translation table (zeta → opencode Event):
 *   agent_start                          → session.status busy
 *   agent_end                            → session.idle
 *   auto_retry_start{attempt,delayMs,…}  → session.status retry
 *   auto_retry_end{success:false}        → session.idle
 *   message_start/update/end, turn_end   → message.updated + message.part.updated×blocks
 *                                          (full snapshots; ids synthesized via synthMessageId)
 *   tool_execution_start/update/end      → message.part.updated (tool part state machine)
 *   todo_reminder{todos}                 → todo.updated
 *   anything else                        → dropped (queue_update, mode_changed,
 *                                          compaction_*, bash_chunk, notice, …)
 *
 * A synthetic `zeta.heartbeat` event is emitted every 15s so the sync layer's
 * stale-stream watchdog (20s silence ⇒ full resync) stays calm on idle servers.
 */

const HEARTBEAT_INTERVAL_MS = 15_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface RunningFrame {
	type?: string;
	runningSessionIds?: string[];
}

interface ZetaEventFrame extends Record<string, unknown> {
	type?: string;
	sessionId?: string;
	message?: ZetaMessage;
	partial?: ZetaMessage;
	assistantMessageEvent?: { type?: string; partial?: ZetaMessage; message?: ZetaMessage };
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	partialResult?: { content?: string | ZetaContentBlock[] };
	method?: string;
	options?: Array<string | { label?: string; description?: string }>;
	id?: string;
	title?: string;
	attempt?: number;
	maxAttempts?: number;
	delayMs?: number;
	errorMessage?: string;
	success?: boolean;
	todos?: Array<{ id?: string; content?: string; status?: string; priority?: string }>;
}

function textOfResult(value: { content?: string | ZetaContentBlock[] } | undefined): string {
	return value ? contentToText(value.content) : "";
}

export function createZetaEventPipeline(input: EventPipelineInput): EventPipeline {
	const deliver = input.onEvents
		? (directory: string, payloads: readonly Event[]) => input.onEvents?.(directory, payloads)
		: (directory: string, payloads: readonly Event[]) => {
			for (const payload of payloads) input.onEvent?.(directory, payload);
		};

	const emit = (sessionId: string, events: Event[]): void => {
		if (events.length === 0) return;
		const directory = sessionDirectories.get(sessionId) ?? sessionId;
		for (const event of events) {
			const routed = input.routeDirectory?.(directory, event) || directory;
			deliver(routed, [event]);
		}
	};

	let disposed = false;
	let failures = 0;
	const sessionStreams = new Map<string, EventSource>();
	const sessionDirectories = new Map<string, string>();
	/** Sessions with an open SSE stream at some point (reconcile candidates). */
	const everStreamed = new Set<string>();
	const currentAssistant = new Map<string, string>();
	const lastUserBySession = new Map<string, string>();

	function convertSnapshot(sessionId: string, raw: ZetaMessage | undefined): Event[] {
		if (!raw || typeof raw !== "object") return [];
		const isAssistant = raw.role === "assistant" || raw.role === "bashExecution" || raw.role === "custom";
		if (isAssistant && !lastUserBySession.has(sessionId)) {
			// Joined the stream mid-turn: no user frame has been seen, so the
			// synthesized assistant would carry an empty parentID and break
			// turn grouping. A full HTTP reconciliation is authoritative.
			void reconcileSession(sessionId);
			return [];
		}
		const { info, parts } = convertZetaMessage(raw, sessionId, {
			parentMessageId: raw.role === "user" ? undefined : lastUserBySession.get(sessionId),
		});
		const mid = String(info.id);
		if (raw.role === "user") lastUserBySession.set(sessionId, mid);
		if (isAssistant) currentAssistant.set(sessionId, mid);
		const events: Event[] = [
			{ type: "message.updated", properties: { info } } as unknown as Event,
		];
		for (const part of parts) {
			events.push({ type: "message.part.updated", properties: { sessionID: sessionId, part } } as unknown as Event);
		}
		return events;
	}

	function toolPartEvent(
		sessionId: string,
		frame: ZetaEventFrame,
		status: "pending" | "running" | "completed" | "error",
		output: string,
	): Event {
		const callId = String(frame.toolCallId ?? "");
		const messageID = currentAssistant.get(sessionId) ?? `z_assistant_pending_${sessionId}`;
		const existing = pendingToolInputs.get(callId);
		const part = {
			id: callId,
			callID: callId,
			sessionID: sessionId,
			messageID,
			type: "tool",
			tool: String(frame.toolName ?? existing?.toolName ?? "tool"),
			state: {
				status,
				input: (existing?.args ?? frame.args ?? {}) as Record<string, unknown>,
				output,
				time: { start: Date.now() },
			},
		};
		return { type: "message.part.updated", properties: { sessionID: sessionId, part } } as unknown as Event;
	}

	const pendingToolInputs = new Map<string, { args?: unknown; toolName?: string }>();

	function handleSessionFrame(sessionId: string, frame: ZetaEventFrame): void {
		switch (frame.type) {
			case "agent_start":
				emit(sessionId, [statusEvent(sessionId, { type: "busy" })]);
				break;
			case "agent_end":
				currentAssistant.delete(sessionId);
				emit(sessionId, [{ type: "session.idle", properties: { sessionID: sessionId } } as unknown as Event]);
				break;
			case "auto_retry_start": {
				const attempt = typeof frame.attempt === "number" ? frame.attempt : 1;
				const delayMs = typeof frame.delayMs === "number" ? frame.delayMs : 0;
				emit(sessionId, [statusEvent(sessionId, {
					type: "retry",
					attempt,
					message: frame.errorMessage ?? "retrying",
					next: Date.now() + delayMs,
				})]);
				break;
			}
			case "auto_retry_end":
				if (frame.success === false) {
					currentAssistant.delete(sessionId);
					emit(sessionId, [{ type: "session.idle", properties: { sessionID: sessionId } } as unknown as Event]);
				}
				break;
			case "message_start":
			case "message_update":
			case "message_end":
			case "turn_end": {
				const raw = frame.message
					?? frame.partial
					?? frame.assistantMessageEvent?.partial
					?? frame.assistantMessageEvent?.message;
				emit(sessionId, convertSnapshot(sessionId, raw));
				break;
			}
			case "tool_execution_start": {
				const callId = String(frame.toolCallId ?? "");
				pendingToolInputs.set(callId, { args: frame.args, toolName: frame.toolName });
				emit(sessionId, [toolPartEvent(sessionId, frame, "running", "")]);
				break;
			}
			case "tool_execution_update":
				emit(sessionId, [toolPartEvent(sessionId, frame, "running", textOfResult(frame.partialResult))]);
				break;
			case "tool_execution_end":
				emit(sessionId, [toolPartEvent(sessionId, frame, frame.isError ? "error" : "completed", textOfResult(frame.result))]);
				break;
			case "todo_reminder": {
				const todos = (frame.todos ?? []).map((todo, index) => ({
					id: todo.id ?? `t${index}`,
					status: todo.status ?? "pending",
					...(todo.priority ? { priority: todo.priority } : {}),
				}));
				emit(sessionId, [
					{ type: "todo.updated", properties: { sessionID: sessionId, todos } } as unknown as Event,
				]);
				break;
			}
			case "extension_ui_request": {
				if (frame.method === "select") {
					emit(sessionId, [{
						type: "question.asked",
						properties: {
							id: String(frame.id ?? ""),
							sessionID: sessionId,
							questions: [{
								question: String(frame.title ?? ""),
								header: "",
								options: (frame.options ?? []).map((option) =>
									typeof option === "string"
										? { label: option, description: "" }
										: { label: String(option?.label ?? ""), description: String(option?.description ?? "") },
								),
							}],
						},
					} as unknown as Event]);
				}
				break;
			}
			case "extension_ui_resolved": {
				const requestID = String(frame.id ?? "");
				if (!requestID) break;
				emit(sessionId, [
					{ type: "question.replied", properties: { sessionID: sessionId, requestID } } as unknown as Event,
					{ type: "permission.replied", properties: { sessionID: sessionId, requestID } } as unknown as Event,
				]);
				break;
			}
 			default:
 				// connected, queue_update, mode_changed, compaction_*, bash_chunk,
				// notice, confirm/input/editor requests, state_changed, …
 				break;
		}
	}

	function openSessionStream(sessionId: string): void {
		if (disposed || sessionStreams.has(sessionId)) return;
		everStreamed.add(sessionId);
		const es = new EventSource(`/api/agent/${encodeURIComponent(sessionId)}/events`);
		es.onmessage = (event: MessageEvent<string>) => {
			let frame: ZetaEventFrame;
			try {
				frame = JSON.parse(event.data) as ZetaEventFrame;
			} catch {
				return;
			}
			try {
				handleSessionFrame(sessionId, frame);
			} catch (error) {
				console.warn("[zeta-bridge] frame translation failed", frame.type, error);
			}
		};
		es.onerror = () => {
			// EventSource reconnects natively; surface only terminal closure.
			if (es.readyState === EventSource.CLOSED) {
				sessionStreams.delete(sessionId);
			}
		};
		sessionStreams.set(sessionId, es);
	}
	/**
	 * HTTP reconciliation for races where a whole turn completes before the
	 * per-session SSE connects (zeta turns can finish in <100ms). Emits the
	 * full message list; the reducer's unchanged-check makes repeats no-ops.
	 */
	async function reconcileSession(sessionId: string): Promise<void> {
		if (disposed) return;
		try {
			const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}?deferThinking=1&deferMedia=1`);
			if (!res.ok) return;
			const data = await res.json() as { context?: { messages?: ZetaMessage[] } };
			const messages = data?.context?.messages ?? [];
			if (messages.length === 0) return;
			const toolResults = collectToolResults(messages);
			let lastUser = "";
			const events: Event[] = [];
			for (const message of messages) {
				if (message.role === "toolResult") continue;
				const { info, parts } = convertZetaMessage(message, sessionId, {
					toolResults,
					parentMessageId: message.role === "user" ? undefined : lastUser || undefined,
					assumeComplete: true,
				});
				const mid = String(info.id);
				if (message.role === "user") lastUser = mid;
				events.push({ type: "message.updated", properties: { info } } as unknown as Event);
				for (const part of parts) {
					events.push({ type: "message.part.updated", properties: { sessionID: sessionId, part } } as unknown as Event);
				}
			}
			events.push({ type: "session.idle", properties: { sessionID: sessionId } } as unknown as Event);
			emit(sessionId, events);
		} catch {
			// Reconciliation is best-effort.
		}
	}

	function closeSessionStream(sessionId: string): void {
		const es = sessionStreams.get(sessionId);
		sessionStreams.delete(sessionId);
		es?.close();
		if (!everStreamed.has(sessionId)) return;
		// Small delay: the run-end frame can arrive before the gateway flushes
		// the final messages to the session file this fetch reads.
		setTimeout(() => void reconcileSession(sessionId), 600);
	}

	let runningStream: EventSource | undefined;

	function openRunningStream(): void {
		if (disposed) return;
		runningStream?.close();
		const es = new EventSource("/api/agent/running/events");
		runningStream = es;
		es.onopen = () => {
			failures = 0;
			input.onReconnect?.();
		};
		es.onmessage = (event: MessageEvent<string>) => {
			let frame: RunningFrame;
			try {
				frame = JSON.parse(event.data) as RunningFrame;
			} catch {
				return;
			}
			if (frame.type !== "running" || !Array.isArray(frame.runningSessionIds)) return;
			const next = new Set(frame.runningSessionIds);
			for (const sid of next) openSessionStream(sid);
			for (const sid of [...sessionStreams.keys()]) {
				if (!next.has(sid)) closeSessionStream(sid);
			}
		};
		es.onerror = () => {
			input.onDisconnect?.("zeta-running-stream-error");
			if (es.readyState === EventSource.CLOSED && !disposed) {
				failures += 1;
				const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(failures, 5));
				setTimeout(() => {
					if (!disposed && runningStream === es) openRunningStream();
				}, delay);
			}
		};
	}

	/** Refresh id→cwd resolution data (also seeds directories before events). */
	refreshDirectories();
	async function refreshDirectories(): Promise<void> {
		try {
			const res = await fetch("/api/sessions");
			if (!res.ok) return;
			const data = await res.json() as { sessions?: ZetaSessionInfo[] };
			for (const info of data.sessions ?? []) {
				sessionDirectories.set(info.id, normalizeZetaDir(info.cwd) || info.cwd);
			}
		} catch {
			// Directory labels are best-effort; routing falls back to session id.
		}
	}
	const directoryTimer = setInterval(() => void refreshDirectories(), 20_000);

	// Keep the sync-layer watchdog calm: it escalates when NO event arrives for
	// 20s. Unknown event types are ignored by the reducer but count as activity.
	const heartbeatTimer = setInterval(() => {
		if (disposed) return;
		const directory = [...sessionDirectories.values()][0] ?? "";
		deliver(directory, [{ type: "zeta.heartbeat", properties: {} } as unknown as Event]);
	}, HEARTBEAT_INTERVAL_MS);

	openRunningStream();

	return {
		cleanup: () => {
			disposed = true;
			clearInterval(directoryTimer);
			clearInterval(heartbeatTimer);
			for (const sid of [...sessionStreams.keys()]) closeSessionStream(sid);
			runningStream?.close();
			runningStream = undefined;
		},
		reconnect: (reason?: string) => {
			void reason;
			openRunningStream();
			for (const sid of [...sessionStreams.keys()]) {
				closeSessionStream(sid);
				openSessionStream(sid);
			}
		},
	};
}

// Re-exported for adapter tests.
export { collectToolResults, convertZetaMessage, synthMessageId };

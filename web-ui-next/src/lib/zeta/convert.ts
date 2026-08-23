/**
 * Zeta ⇄ OpenChamber data-model converters.
 *
 * The ported UI stores opencode-shaped entities (Session/Message/Part) in its
 * sync stores; the zeta gateway speaks its own wire model (SessionInfo,
 * role/content-block messages, parallel entryIds). Every conversion between
 * the two lives here so both the REST adapter (ZetaGatewayService) and the
 * SSE bridge (eventBridge) emit identical ids and shapes.
 *
 * Identity rule: zeta messages carry NO id on the wire (only a positional
 * `entryIds[i]` in session context). We synthesize stable ids from
 * `role + timestamp` so live SSE snapshots upsert onto the same entity as
 * history loads without a tree lookup.
 */

export interface ZetaSessionInfo {
	path?: string;
	id: string;
	cwd: string;
	name?: string;
	created: string;
	modified: string;
	messageCount?: number;
	firstMessage?: string;
	parentSessionId?: string;
	projectRoot?: string;
	worktreeBranch?: string;
	tag?: string;
}

export type ZetaContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; source?: { type?: string; media_type?: string; data?: string; url?: string } }
	| { type: "thinking"; thinking: string }
	| { type: "toolCall"; toolCallId?: string; id?: string; toolName?: string; name?: string; input?: unknown; arguments?: unknown };

export interface ZetaMessage {
	role: "user" | "assistant" | "toolResult" | "custom" | "bashExecution";
	content: string | ZetaContentBlock[];
	timestamp?: number;
	attribution?: string;
	model?: string;
	provider?: string;
	usage?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		totalTokens?: number;
		cost?: { total?: number };
	};
	duration?: number;
	stopReason?: string;
	errorMessage?: string;
	customType?: string;
	display?: string;
	details?: unknown;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	command?: string;
	output?: string;
	exitCode?: number;
	cancelled?: boolean;
}

/** Deterministic message id shared by live events and history loads. */
export function synthMessageId(message: Pick<ZetaMessage, "role" | "timestamp">, salt = ""): string {
	return `z_${message.role}_${message.timestamp ?? 0}${salt ? `_${salt}` : ""}`;
}

export function normalizeZetaDir(value: string | undefined | null): string {
	if (!value) return "";
	return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function zetaSessionToSession(info: ZetaSessionInfo): Record<string, unknown> {
	const created = Date.parse(info.created);
	const updated = Date.parse(info.modified);
	const cwd = normalizeZetaDir(info.cwd) || info.cwd;
	const root = normalizeZetaDir(info.projectRoot) || cwd;
	return {
		id: info.id,
		title: info.name || info.firstMessage || "Untitled",
		directory: cwd,
		projectID: root,
		worktree: cwd,
		parentID: info.parentSessionId,
		version: "zeta",
		time: {
			created: Number.isFinite(created) ? created : 0,
			updated: Number.isFinite(updated) ? updated : 0,
		},
		metadata: {
			zetaPath: info.path,
			zetaTag: info.tag,
			zetaWorktreeBranch: info.worktreeBranch,
			messageCount: info.messageCount,
		},
	};
}

function blockText(block: ZetaContentBlock): string {
	if (typeof block === "string") return block;
	if (block.type === "text") return block.text ?? "";
	if (block.type === "thinking") return block.thinking ?? "";
	if (block.type === "image") return "[image]";
	if (block.type === "toolCall") return "";
	return "";
}

export function contentToText(content: string | ZetaContentBlock[] | undefined): string {
	if (!content) return "";
	if (typeof content === "string") return content;
	return content.map(blockText).join("");
}

interface ConvertResult {
	info: Record<string, unknown>;
	parts: Record<string, unknown>[];
}

/**
 * Convert one zeta message into an opencode Message plus its flat Part list.
 * `toolResults` pairs toolResult messages (keyed by toolCallId) into the
 * assistant tool parts' terminal state.
 */
export function convertZetaMessage(
	message: ZetaMessage,
	sessionID: string,
	options: {
		salt?: string;
		toolResults?: Map<string, ZetaMessage>;
		forceRole?: "user" | "assistant";
		parentMessageId?: string;
		/** History loads: mark assistant messages completed even without duration. */
		assumeComplete?: boolean;
	} = {},
): ConvertResult {
	const mid = synthMessageId(message, options.salt);
	const ts = typeof message.timestamp === "number" ? message.timestamp : Date.now();
	const blocks: ZetaContentBlock[] = Array.isArray(message.content)
		? message.content
		: [{ type: "text", text: String(message.content ?? "") }];

	let info: Record<string, unknown>;
	if ((options.forceRole ?? message.role) === "assistant") {
		const usage = message.usage;
		const [providerID = "", ...modelRest] = (message.model ?? "").split("/");
		// Context-window fill mirrors zeta's calculatePromptTokens (input +
		// cacheRead + cacheWrite); totalTokens includes output, which would
		// overstate the fill and break parity with the runtime's own gauge.
		const promptTokens = (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0);
		info = {
			id: mid,
			sessionID,
			role: "assistant",
			parentID: options.parentMessageId ?? "",
			agent: "build",
			mode: "build",
			modelID: modelRest.join("/") || message.model || "unknown",
			providerID: message.provider || providerID || "zeta",
			path: { cwd: "", root: "" },
			cost: usage?.cost?.total ?? 0,
			tokens: {
				total: promptTokens > 0 ? promptTokens : (usage?.totalTokens ?? 0),
				input: usage?.input ?? 0,
				output: usage?.output ?? 0,
				reasoning: 0,
				cache: { read: usage?.cacheRead ?? 0, write: usage?.cacheWrite ?? 0 },
			},
			finish: message.stopReason,
			error: message.errorMessage ? { name: "Error", message: message.errorMessage } : undefined,
			time: {
				created: ts,
				completed: message.duration && message.duration > 0
					? ts + Math.round(message.duration)
					: options.assumeComplete ? ts : undefined,
			},
		};
	} else {
		info = {
			id: mid,
			sessionID,
			role: "user",
			agent: "build",
			model: { providerID: "zeta", modelID: "" },
			time: { created: ts },
		};
	}

	const parts: Record<string, unknown>[] = [];
	blocks.forEach((block, index) => {
		switch (block.type) {
			case "text": {
				if (!block.text) return;
				parts.push({
					id: `${mid}#${index}`,
					sessionID,
					messageID: mid,
					type: "text",
					text: block.text,
					time: { start: ts },
				});
				break;
			}
			case "thinking": {
				if (!block.thinking) return;
				parts.push({
					id: `${mid}#r${index}`,
					sessionID,
					messageID: mid,
					type: "reasoning",
					text: block.thinking,
					time: { start: ts },
				});
				break;
			}
			case "image": {
				const source = block.source ?? {};
				const url = source.url ?? (source.data ? `data:${source.media_type ?? "image/png"};base64,${source.data}` : "");
				if (!url) return;
				parts.push({
					id: `${mid}#f${index}`,
					sessionID,
					messageID: mid,
					type: "file",
					mime: source.media_type ?? "image/png",
					url,
				});
				break;
			}
			case "toolCall": {
				const callId = block.toolCallId ?? block.id ?? `${mid}#c${index}`;
				const result = options.toolResults?.get(callId);
				const isError = result?.isError === true;
				const outputText = result ? contentToText(result.content) : "";
				parts.push({
					id: callId,
					callID: callId,
					sessionID,
					messageID: mid,
					type: "tool",
					tool: block.toolName ?? block.name ?? "tool",
					state: {
						status: isError ? "error" : result ? "completed" : "pending",
						input: (block.input ?? block.arguments ?? {}) as Record<string, unknown>,
						output: outputText,
						time: { start: ts, end: result ? result.timestamp : undefined },
					},
				});
				break;
			}
			default:
				break;
		}
	});

	// Non-blocked roles rendered as single synthetic parts.
	if (message.role === "bashExecution") {
		parts.length = 0;
		parts.push({
			id: `${mid}#b`,
			callID: `${mid}#b`,
			sessionID,
			messageID: mid,
			type: "tool",
			tool: "bash",
			state: {
				status: message.cancelled ? "error" : "completed",
				input: { command: message.command ?? "", description: "shell" },
				output: message.output ?? "",
				metadata: { exitCode: message.exitCode },
				time: { start: ts, end: ts },
			},
		});
		info = { ...info, role: "assistant", parentID: "", agent: "build", mode: "build", providerID: "zeta", modelID: "bash", path: { cwd: "", root: "" }, cost: 0, tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: ts, completed: ts } };
	} else if (message.role === "custom") {
		parts.push({
			id: `${mid}#s`,
			sessionID,
			messageID: mid,
			type: "text",
			text: message.display ?? contentToText(message.content),
			synthetic: true,
			time: { start: ts },
		});
	}

	return { info, parts };
}

/** Build toolResults lookup from interleaved toolResult messages. */
export function collectToolResults(messages: ZetaMessage[]): Map<string, ZetaMessage> {
	const map = new Map<string, ZetaMessage>();
	for (const m of messages) {
		if (m.role === "toolResult" && m.toolCallId) map.set(m.toolCallId, m);
	}
	return map;
}

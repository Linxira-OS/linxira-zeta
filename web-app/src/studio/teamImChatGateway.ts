/**
 * IM chat data from the running IM backend gateway.
 *
 * Two canonical owners, both owned by the IM integration:
 * - `GET /api/im/sessions` is the IM selector's candidate read model. It is the
 *   single authority for the stable `NN-NNNNN` number, the display label, and
 *   the latest completed-task summary. This module only decodes it: it never
 *   renumbers, sorts, or derives a second selector.
 * - `GET /api/sessions/:id` is the persisted transcript of the selected
 *   candidate. Its `messageMetadata` carries the immutable per-message route
 *   snapshot (workspace/agent/binding) the IM ingress wrote, so a reply that
 *   arrives after a switch still names the repo/agent it belongs to. Its
 *   `controlEvents` carry the switch handshakes the IM owner appended.
 *
 * The pane keeps no transcript store: every render is a read of these routes.
 * `firstMessage`, `info.taskSummary`, and selector fields are deliberately not
 * read here; a missing completed summary stays missing instead of borrowing a
 * first user message.
 */
import type { SessionId } from "@linxiraos/studio-contract";
import { defaultGatewayFetch, gatewayJson, type GatewayFetch } from "./settings/gatewayRequest";
import { isRecord } from "./typeGuards";

/** Task-summary state the IM selector reports for a candidate. */
export type ImChatSummaryState = "completed" | "incomplete" | "unknown";

/**
 * One candidate row as the IM selector sent it. `selector` is the visible
 * number; `canonicalSessionId` is a background key and never a label.
 */
export interface ImChatCandidate {
	readonly selector: string;
	readonly canonicalSessionId: SessionId;
	/** Transcript id the gateway route resolves; absent until a transcript exists. */
	readonly transcriptSessionId?: SessionId;
	readonly label: string;
	readonly latestTaskSummary?: string;
	readonly summaryState: ImChatSummaryState;
	readonly bindingId?: string;
	readonly workspaceAlias?: string;
	readonly workspaceId?: string;
	/** Additive: present only when the IM selector includes the platform. */
	readonly channel?: string;
	readonly tag?: string;
	readonly isPm: boolean;
	readonly lastActiveAt?: string;
}

/** Immutable delivery route the IM ingress recorded on one message. */
export interface ImChatOrigin {
	readonly workspaceAlias?: string;
	readonly agentId?: string;
	readonly bindingId?: string;
	readonly sessionId?: string;
}

/** One rendered transcript row, mapped from the canonical gateway message. */
export interface ImChatBubble {
	readonly itemId: string;
	readonly role: "user" | "assistant" | "system" | "tool";
	readonly text: string;
	readonly toolName?: string;
	readonly createdAt?: string;
	readonly origin?: ImChatOrigin;
	/** Assistant replies link back to the inbound platform message id. */
	readonly replyToMessageId?: string;
}

export interface ImChatControlEvent {
	readonly entryId: string;
	readonly action: "switch_request" | "switch_confirm" | "switch_cancel";
	readonly requestId: string;
	readonly from: ImChatOrigin;
	readonly to: ImChatOrigin;
	readonly sentAt?: string;
}

export interface ImChatTranscript {
	readonly bubbles: ReadonlyArray<ImChatBubble>;
	readonly controls: ReadonlyArray<ImChatControlEvent>;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function summaryState(value: unknown): ImChatSummaryState {
	return value === "completed" || value === "incomplete" || value === "unknown" ? value : "unknown";
}

/**
 * `GET /api/im/sessions` → candidate rows. A malformed row is skipped rather
 * than repaired: a wrong label or a invented number would be worse than a
 * missing row.
 */
export async function loadImChatCandidates(
	fetcher: GatewayFetch = defaultGatewayFetch,
): Promise<ImChatCandidate[]> {
	const payload = await gatewayJson(fetcher, "/api/im/sessions");
	if (!isRecord(payload) || !Array.isArray(payload.sessions)) {
		throw new Error("IM selector response is malformed");
	}
	const rows: ImChatCandidate[] = [];
	for (const entry of payload.sessions) {
		if (!isRecord(entry)) continue;
		const selector = optionalString(entry, "selector");
		const canonicalSessionId = optionalString(entry, "canonicalSessionId");
		const transcriptSessionId = optionalString(entry, "transcriptSessionId");
		const label = optionalString(entry, "label");
		if (selector === undefined || canonicalSessionId === undefined || label === undefined) continue;
		const latestTaskSummary = optionalString(entry, "latestTaskSummary");
		const bindingId = optionalString(entry, "bindingId");
		const workspaceAlias = optionalString(entry, "workspaceAlias");
		const workspaceId = optionalString(entry, "workspaceId");
		const channel = optionalString(entry, "channel");
		const tag = optionalString(entry, "tag");
		const lastActiveAt = optionalString(entry, "lastActiveAt");
		rows.push({
			selector,
			canonicalSessionId: canonicalSessionId as SessionId,
			...(transcriptSessionId === undefined ? {} : { transcriptSessionId: transcriptSessionId as SessionId }),
			label,
			...(latestTaskSummary === undefined ? {} : { latestTaskSummary }),
			summaryState: latestTaskSummary === undefined ? summaryState(entry.status) : "completed",
			...(bindingId === undefined ? {} : { bindingId }),
			...(workspaceAlias === undefined ? {} : { workspaceAlias }),
			...(workspaceId === undefined ? {} : { workspaceId }),
			...(channel === undefined ? {} : { channel }),
			...(tag === undefined ? {} : { tag }),
			...(lastActiveAt === undefined ? {} : { lastActiveAt }),
			isPm: entry.isPm === true,
		});
	}
	return rows;
}

function parseOrigin(value: unknown): ImChatOrigin | undefined {
	if (!isRecord(value)) return undefined;
	const workspaceAlias = optionalString(value, "workspaceAlias");
	const agentId = optionalString(value, "agentId");
	const bindingId = optionalString(value, "bindingId");
	const sessionId = optionalString(value, "sessionId");
	if (workspaceAlias === undefined && agentId === undefined && bindingId === undefined && sessionId === undefined) {
		return undefined;
	}
	return {
		...(workspaceAlias === undefined ? {} : { workspaceAlias }),
		...(agentId === undefined ? {} : { agentId }),
		...(bindingId === undefined ? {} : { bindingId }),
		...(sessionId === undefined ? {} : { sessionId }),
	};
}

/** Route metadata is IM-owned; any other or malformed metadata is ignored. */
function parseMessageMetadata(value: unknown): { origin?: ImChatOrigin; replyToMessageId?: string } {
	if (!isRecord(value) || value.source !== "im") return {};
	const origin = parseOrigin(value.route);
	const replyToMessageId = optionalString(value, "replyToMessageId");
	return {
		...(origin === undefined ? {} : { origin }),
		...(replyToMessageId === undefined ? {} : { replyToMessageId }),
	};
}

function parseControlEvent(value: unknown): ImChatControlEvent | undefined {
	if (!isRecord(value) || !isRecord(value.metadata)) return undefined;
	const metadata = value.metadata;
	if (metadata.source !== "im_control") return undefined;
	const action = metadata.action;
	if (action !== "switch_request" && action !== "switch_confirm" && action !== "switch_cancel") return undefined;
	const entryId = optionalString(value, "entryId");
	const requestId = optionalString(metadata, "requestId");
	const from = parseOrigin(metadata.from);
	const to = parseOrigin(metadata.to);
	if (entryId === undefined || requestId === undefined || from === undefined || to === undefined) return undefined;
	const sentAt = optionalString(metadata, "sentAt");
	return {
		entryId,
		action,
		requestId,
		from,
		to,
		...(sentAt === undefined ? {} : { sentAt }),
	};
}

function messageRole(value: unknown): ImChatBubble["role"] | undefined {
	switch (value) {
		case "user":
			return "user";
		case "assistant":
			return "assistant";
		case "toolResult":
			return "tool";
		case "custom":
		case "bashExecution":
		case "compaction":
			return "system";
		default:
			return undefined;
	}
}

function blockText(block: unknown): { text?: string; toolName?: string } {
	if (!isRecord(block)) return {};
	if (block.type === "text" && typeof block.text === "string") return { text: block.text };
	if (block.type === "toolCall") {
		return { toolName: optionalString(block, "toolName") ?? optionalString(block, "name") ?? "tool" };
	}
	if (block.type === "toolResult") {
		return { toolName: optionalString(block, "toolName") ?? "tool" };
	}
	return {};
}

/** Canonical messages are either a plain string or text/tool blocks. */
function messageBody(value: unknown): { text: string; toolName?: string } {
	if (typeof value === "string") return { text: value.trim() };
	if (!Array.isArray(value)) return { text: "" };
	const texts: string[] = [];
	let toolName: string | undefined;
	for (const block of value) {
		const part = blockText(block);
		if (part.text !== undefined) texts.push(part.text);
		if (part.toolName !== undefined && toolName === undefined) toolName = part.toolName;
	}
	return { text: texts.join("\n").trim(), ...(toolName === undefined ? {} : { toolName }) };
}

function messageTime(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim() !== "") return value;
	if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
	return undefined;
}

function parseBubbles(context: Record<string, unknown>): ImChatBubble[] {
	if (!Array.isArray(context.messages)) return [];
	const entryIds = Array.isArray(context.entryIds) ? context.entryIds : [];
	const metadataRows = Array.isArray(context.messageMetadata) ? context.messageMetadata : [];
	const bubbles: ImChatBubble[] = [];
	for (const [index, message] of context.messages.entries()) {
		if (!isRecord(message)) continue;
		const role = messageRole(message.role);
		if (role === undefined) continue;
		const body = messageBody(message.content);
		if (body.text === "" && body.toolName === undefined) continue;
		const entryId = entryIds[index];
		if (typeof entryId !== "string" || entryId === "") continue;
		const metadata = parseMessageMetadata(metadataRows[index]);
		const createdAt = messageTime(message.timestamp);
		bubbles.push({
			itemId: entryId,
			role,
			text: body.text,
			...(body.toolName === undefined ? {} : { toolName: body.toolName }),
			...(createdAt === undefined ? {} : { createdAt }),
			...(metadata.origin === undefined ? {} : { origin: metadata.origin }),
			...(metadata.replyToMessageId === undefined ? {} : { replyToMessageId: metadata.replyToMessageId }),
		});
	}
	return bubbles;
}

function parseControls(context: Record<string, unknown>): ImChatControlEvent[] {
	if (!Array.isArray(context.controlEvents)) return [];
	const controls: ImChatControlEvent[] = [];
	for (const value of context.controlEvents) {
		const control = parseControlEvent(value);
		if (control !== undefined) controls.push(control);
	}
	return controls;
}

/**
 * `GET /api/sessions/:id` → the canonical transcript, including the IM route
 * metadata and switch handshakes when the backend recorded them. Older
 * transcripts simply have no metadata; the bubbles still render.
 */
export async function loadImChatTranscript(
	sessionId: SessionId,
	fetcher: GatewayFetch = defaultGatewayFetch,
): Promise<ImChatTranscript> {
	const payload = await gatewayJson(
		fetcher,
		`/api/sessions/${encodeURIComponent(String(sessionId))}?limit=100`,
	);
	if (!isRecord(payload) || !isRecord(payload.context)) {
		throw new Error("Session transcript response is malformed");
	}
	return {
		bubbles: parseBubbles(payload.context),
		controls: parseControls(payload.context),
	};
}

import { isRecord } from "@linxiraos/pi-utils";
import type { ConversationContentBlock, ConversationItem, JsonValue } from "./protocol/contracts/conversation.js";
import { CONVERSATION_LIMITS } from "./protocol/contracts/conversation.js";
import { truncateUtf8 } from "./protocol/conversation-text.js";
import { computerResultProjection, hasComputerResultDetails } from "./services/computer-result-projection.js";
import { conversationMessageSource } from "./ops/message-source.js";

export interface TranscriptRecord {
	readonly id: string;
	readonly createdAt: string | undefined;
	readonly message: unknown;
	readonly metadata?: unknown;
	readonly client?: unknown;
}
function stringField(value: Record<string, unknown>, key: string): string | undefined {
	return typeof value[key] === "string" ? value[key] : undefined;
}
function numberField(value: Record<string, unknown>, key: string): number | undefined {
	return typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : undefined;
}
function booleanField(value: Record<string, unknown>, key: string): boolean | undefined {
	return typeof value[key] === "boolean" ? value[key] : undefined;
}
function isoFromMilliseconds(value: number | undefined): string | undefined {
	if (value === undefined || value <= 0 || !Number.isFinite(new Date(value).getTime())) return undefined;
	return new Date(value).toISOString();
}
function textBlock(text: string): ConversationContentBlock {
	const clipped = truncateUtf8(text, CONVERSATION_LIMITS.TEXT_BLOCK_MAX_BYTES);
	return clipped.truncated
		? { type: "text", text: clipped.text, truncated: true }
		: { type: "text", text: clipped.text };
}

function thinkingBlock(text: string): ConversationContentBlock {
	const clipped = truncateUtf8(text, CONVERSATION_LIMITS.TEXT_BLOCK_MAX_BYTES);
	return clipped.truncated
		? { type: "thinking", text: clipped.text, truncated: true }
		: { type: "thinking", text: clipped.text };
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (depth >= CONVERSATION_LIMITS.JSON_VALUE_MAX_DEPTH) return false;
	if (Array.isArray(value)) return value.every(item => isJsonValue(item, depth + 1));
	if (isRecord(value)) return Object.values(value).every(item => isJsonValue(item, depth + 1));
	return false;
}

function messageContentBlocks(content: unknown): ConversationContentBlock[] {
	if (typeof content === "string") return [textBlock(content)];
	if (!Array.isArray(content)) return [];
	const blocks: ConversationContentBlock[] = [];
	for (const block of content) {
		if (!isRecord(block)) continue;
		const type = stringField(block, "type");
		if (type === "text") {
			const text = stringField(block, "text");
			if (text !== undefined) blocks.push(textBlock(text));
			continue;
		}
		if (type === "thinking") {
			const text = stringField(block, "thinking");
			if (text !== undefined && text !== "") blocks.push(thinkingBlock(text));
			continue;
		}
		if (type === "toolCall") {
			const toolCallId = stringField(block, "toolCallId") ?? stringField(block, "id");
			const toolName = stringField(block, "toolName") ?? stringField(block, "name");
			if (toolCallId === undefined || toolName === undefined) continue;
			const args = block.input ?? block.arguments;
			blocks.push(
				isJsonValue(args)
					? { type: "toolCall", toolCallId, toolName, arguments: args }
					: { type: "toolCall", toolCallId, toolName },
			);
		}
	}
	return blocks;
}
export function plainText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!isRecord(block)) continue;
		if (stringField(block, "type") !== "text") continue;
		const text = stringField(block, "text");
		if (text !== undefined) parts.push(text);
	}
	return parts.join("\n");
}
function toolResultBlock(message: Record<string, unknown>): ConversationContentBlock | undefined {
	const toolCallId = stringField(message, "toolCallId");
	if (toolCallId === undefined || toolCallId === "") return undefined;
	const toolName = stringField(message, "toolName");
	const output = plainText(message.content);
	const clipped = truncateUtf8(output, CONVERSATION_LIMITS.TEXT_BLOCK_MAX_BYTES);
	const data = hasComputerResultDetails(message.details) ? computerResultProjection(message.details) : message.details;
	return {
		type: "toolResult",
		toolCallId,
		...(toolName === undefined ? {} : { toolName }),
		...(output === "" ? {} : { output: clipped.text }),
		...(isJsonValue(data) ? { data } : {}),
		isError: booleanField(message, "isError") === true,
	};
}

/**
 * Project the gateway's message list onto the protocol's public items.
 *
 * Only the contract's public kinds are emitted: `user`/`assistant` messages,
 * compaction summaries (Zeta's compaction entry arrives as a `custom` message
 * with `customType: "compaction"`), and tool results attached to the assistant
 * item that called them. Other message roles (bash/python execution, custom
 * messages) have no public kind and are omitted rather than invented.
 *
 * `createdAt` comes from the persisted entry timestamp, then the message's own
 * ms timestamp, then the previous item (entries written without either inherit
 * their predecessor's instant); a record with no timestamp at all is skipped.
 */
export function projectConversationItems(
	records: readonly TranscriptRecord[],
	fallbackCreatedAt: string | undefined,
): ConversationItem[] {
	const items: ConversationItem[] = [];
	let parentId: string | null = null;
	let previousCreatedAt = fallbackCreatedAt;
	let lastAssistantContent: ConversationContentBlock[] | undefined;
	for (const record of records) {
		if (!isRecord(record.message)) continue;
		const message = record.message;
		const createdAt = record.createdAt ?? isoFromMilliseconds(numberField(message, "timestamp")) ?? previousCreatedAt;
		if (createdAt === undefined) continue;
		previousCreatedAt = createdAt;
		const role = stringField(message, "role");
		if (role === "user" || role === "assistant") {
			const content = messageContentBlocks(message.content);
			const source = role === "user" ? conversationMessageSource(record.metadata, record.client) : undefined;
			items.push({
				kind: "message",
				itemId: record.id,
				parentId,
				createdAt,
				role,
				content,
				...(source ? { source } : {}),
			});
			lastAssistantContent = role === "assistant" ? content : undefined;
			parentId = record.id;
			continue;
		}
		if (role === "toolResult") {
			const block = toolResultBlock(message);
			if (block !== undefined && lastAssistantContent !== undefined) lastAssistantContent.push(block);
			continue;
		}
		if (role === "custom" && stringField(message, "customType") === "compaction") {
			const summary = truncateUtf8(plainText(message.content), CONVERSATION_LIMITS.COMPACTION_SUMMARY_MAX_BYTES);
			items.push({ kind: "compaction", itemId: record.id, parentId, createdAt, summary: summary.text });
			parentId = record.id;
			lastAssistantContent = undefined;
		}
	}
	return items;
}

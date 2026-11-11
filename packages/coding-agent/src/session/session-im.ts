import { isRecord } from "@linxiraos/pi-utils";

/**
 * Canonical IM provenance carried by one durable transcript entry.
 *
 * The IM channel layer owns the inbound write; this module owns the shape, so
 * every client/read model agrees on one metadata set instead of adding a
 * parallel `initiatedBy` or a second transcript store. Metadata is attached to
 * the entry, never to the provider payload, so it cannot alter the LLM prompt.
 *
 * Invariants:
 * - One logical message has exactly one metadata object on its user entry.
 * - `route` is a snapshot taken when the message was delivered. A later
 *   `!workspace` switch must not rewrite it: the task already delivered to A
 *   stays attributed to A even after the chat is bound to B.
 * - Control events (`switch_request` / `switch_confirm` / `switch_cancel`) are
 *   metadata on an `im_control` entry, not user prompts and not assistant
 *   messages, so they never enter the LLM context.
 * - `messageId` is the platform message id; a reply links back with
 *   `replyToMessageId`, and both keep the same sender/chat/instance bubble
 *   identity.
 */
export interface ImAttachmentRef {
	/** Stable platform attachment id, when it has one. */
	readonly id?: string;
	readonly name?: string;
	readonly mimeType?: string;
	readonly size?: number;
}

/**
 * Workspace/agent/session association captured at delivery time. Alias and ids
 * are attribution labels, never authorization inputs and never paths.
 */
export interface ImRouteSnapshot {
	readonly workspaceAlias?: string;
	readonly agentId?: string;
	readonly sessionId?: string;
	readonly botSessionId?: string;
	readonly bindingId?: string;
}

/** Per-message identity shared by the inbound user entry and its reply bubble. */
export interface ImMessageIdentity {
	readonly platform: string;
	readonly instance?: string;
	readonly chatId: string;
	readonly threadId?: string;
	readonly senderId?: string;
	readonly senderName?: string;
	readonly messageId: string;
	readonly sentAt: string;
}

/** Metadata on the real inbound user entry (`role: "user"`). */
export interface ImUserMessageMetadata extends ImMessageIdentity {
	readonly source: "im";
	readonly attachments?: readonly ImAttachmentRef[];
	/** Route the message was actually delivered to; immutable after append. */
	readonly route: ImRouteSnapshot;
}

/** Metadata on an assistant entry that answers an IM message. */
export interface ImReplyMetadata extends ImMessageIdentity {
	readonly source: "im";
	/** Inbound platform message id this reply answers. */
	readonly replyToMessageId: string;
	readonly route: ImRouteSnapshot;
}

export type ImMessageMetadata = ImUserMessageMetadata | ImReplyMetadata;

export type ImSwitchAction = "switch_request" | "switch_confirm" | "switch_cancel";
/** What a staged switch will do when confirmed; absent on legacy rows reads as `"target"`. */
export type ImSwitchOperation = "target" | "unbind";

/**
 * A workspace/agent switch handshake. `request` proposes `to`; `confirm`
 * commits it; `cancel` discards it. The IM owner stores pending state and
 * isolates the pending key; the transcript only keeps this immutable record.
 */
export interface ImSwitchControlMetadata extends ImMessageIdentity {
	readonly source: "im_control";
	readonly action: ImSwitchAction;
	/** Correlates request/confirm/cancel for one pending switch. */
	readonly requestId: string;
	/** Confirmed operation; legacy rows without it are a target switch. */
	readonly operation?: ImSwitchOperation;
	/** Binding that was active when the control message arrived. */
	readonly from: ImRouteSnapshot;
	/** Proposed/confirmed target; for `cancel` it is the abandoned proposal. */
	readonly to: ImRouteSnapshot;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function identityFromRecord(record: Record<string, unknown>): ImMessageIdentity | undefined {
	const platform = optionalString(record, "platform");
	const chatId = optionalString(record, "chatId");
	const messageId = optionalString(record, "messageId");
	const sentAt = optionalString(record, "sentAt");
	if (!platform || !chatId || !messageId || !sentAt) return undefined;
	const instance = optionalString(record, "instance");
	const threadId = optionalString(record, "threadId");
	const senderId = optionalString(record, "senderId");
	const senderName = optionalString(record, "senderName");
	return {
		platform,
		chatId,
		messageId,
		sentAt,
		...(instance === undefined ? {} : { instance }),
		...(threadId === undefined ? {} : { threadId }),
		...(senderId === undefined ? {} : { senderId }),
		...(senderName === undefined ? {} : { senderName }),
	};
}

function routeFromRecord(record: unknown): ImRouteSnapshot | undefined {
	if (!isRecord(record)) return undefined;
	const workspaceAlias = optionalString(record, "workspaceAlias");
	const agentId = optionalString(record, "agentId");
	const sessionId = optionalString(record, "sessionId");
	const botSessionId = optionalString(record, "botSessionId");
	const bindingId = optionalString(record, "bindingId");
	return {
		...(workspaceAlias === undefined ? {} : { workspaceAlias }),
		...(agentId === undefined ? {} : { agentId }),
		...(sessionId === undefined ? {} : { sessionId }),
		...(botSessionId === undefined ? {} : { botSessionId }),
		...(bindingId === undefined ? {} : { bindingId }),
	};
}

function attachmentsFromRecord(value: unknown): readonly ImAttachmentRef[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const attachments: ImAttachmentRef[] = [];
	for (const item of value) {
		if (!isRecord(item)) continue;
		const id = optionalString(item, "id");
		const name = optionalString(item, "name");
		const mimeType = optionalString(item, "mimeType");
		const size = typeof item.size === "number" && Number.isFinite(item.size) ? item.size : undefined;
		if (id === undefined && name === undefined && mimeType === undefined && size === undefined) continue;
		attachments.push({
			...(id === undefined ? {} : { id }),
			...(name === undefined ? {} : { name }),
			...(mimeType === undefined ? {} : { mimeType }),
			...(size === undefined ? {} : { size }),
		});
	}
	return attachments.length > 0 ? attachments : undefined;
}

/** Validate an entry-level message metadata object. Unknown shapes read as absent. */
export function normalizeImMessageMetadata(value: unknown): ImMessageMetadata | undefined {
	if (!isRecord(value) || value.source !== "im") return undefined;
	const identity = identityFromRecord(value);
	const route = routeFromRecord(value.route);
	if (!identity || !route) return undefined;
	const replyToMessageId = optionalString(value, "replyToMessageId");
	if (replyToMessageId) return { source: "im", ...identity, replyToMessageId, route };
	const attachments = attachmentsFromRecord(value.attachments);
	return { source: "im", ...identity, ...(attachments === undefined ? {} : { attachments }), route };
}

/** Validate an `im_control` entry metadata object. Unknown shapes read as absent. */
export function normalizeImSwitchControlMetadata(value: unknown): ImSwitchControlMetadata | undefined {
	if (!isRecord(value) || value.source !== "im_control") return undefined;
	const action = value.action;
	if (action !== "switch_request" && action !== "switch_confirm" && action !== "switch_cancel") return undefined;
	const operation = value.operation;
	if (operation !== undefined && operation !== "target" && operation !== "unbind") return undefined;
	const requestId = optionalString(value, "requestId");
	const identity = identityFromRecord(value);
	const from = routeFromRecord(value.from);
	const to = routeFromRecord(value.to);
	if (!requestId || !identity || !from || !to) return undefined;
	return {
		source: "im_control",
		...identity,
		action,
		requestId,
		...(operation === undefined ? {} : { operation }),
		from,
		to,
	};
}

/** True when a metadata object is a user-visible inbound message (not a reply). */
export function isImUserMessageMetadata(metadata: ImMessageMetadata): metadata is ImUserMessageMetadata {
	return metadata.source === "im" && !("replyToMessageId" in metadata);
}

/** True when a metadata object is an assistant reply to an inbound message. */
export function isImReplyMetadata(metadata: ImMessageMetadata): metadata is ImReplyMetadata {
	return metadata.source === "im" && "replyToMessageId" in metadata;
}

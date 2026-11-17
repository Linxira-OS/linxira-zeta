import { normalizeImMessageMetadata, isImUserMessageMetadata } from "../../../session/session-im";
import { normalizeSessionClient } from "../../../session/session-client";
import type { ConversationMessageItem } from "../protocol/index";
import { truncateUtf8 } from "../protocol/conversation-text";

/** Entry metadata only. No session-origin, current binding or current run fallback. */
export function conversationMessageSource(metadata: unknown, entryClient?: unknown): ConversationMessageItem["source"] {
	const im = normalizeImMessageMetadata(metadata);
	if (im && isImUserMessageMetadata(im)) {
		return {
			kind: "im",
			platform: truncateUtf8(im.platform, 512).text,
			...(im.instance ? { instance: truncateUtf8(im.instance, 512).text } : {}),
			...(im.senderId ? { senderId: truncateUtf8(im.senderId, 512).text } : {}),
			...(im.senderName ? { senderName: truncateUtf8(im.senderName, 512).text } : {}),
		};
	}
	const client = normalizeSessionClient(entryClient);
	return client ? { kind: "client", client } : undefined;
}

/**
 * IM transcript provenance — durable consumer only.
 *
 * The channel layer owns the inbound write; this test reads a transcript that
 * already carries the canonical metadata and asserts what every viewer needs:
 * the real user row keeps its sender/chat/route, a later binding switch does
 * not rewrite it, and control handshakes stay out of the LLM message list.
 */

import { describe, expect, test } from "bun:test";
import { parseSessionContent } from "@linxiraos/zeta/session/session-loader";
import {
	isImReplyMetadata,
	isImUserMessageMetadata,
	normalizeImMessageMetadata,
	normalizeImSwitchControlMetadata,
} from "@linxiraos/zeta/session/session-im";
import { isImSession } from "@linxiraos/zeta/session/session-origin";
import { buildWebSessionContext } from "../src/server/web-gateway/sessions";

const TS = "2026-07-01T09:00:00.000Z";

const ROUTE_A = { workspaceAlias: "alpha", agentId: "agent-a", sessionId: "sess-a", botSessionId: "bot-a" };
const ROUTE_B = { workspaceAlias: "beta", agentId: "agent-b", sessionId: "sess-b", botSessionId: "bot-b" };

function identity(messageId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		platform: "wechat",
		instance: "instance-1",
		chatId: "chat-1",
		threadId: "thread-1",
		senderId: "user-1",
		senderName: "Alice",
		messageId,
		sentAt: TS,
		...overrides,
	};
}

function userEntry(metadata: Record<string, unknown>, parentId: string | null = null): Record<string, unknown> {
	return {
		type: "message",
		id: `user-${metadata.messageId as string}`,
		parentId,
		timestamp: TS,
		message: { role: "user", content: "hello", timestamp: 0 },
		metadata,
	};
}

function assistantEntry(metadata: Record<string, unknown>): Record<string, unknown> {
	return {
		type: "message",
		id: "assistant-1",
		parentId: "user-m1",
		timestamp: TS,
		message: { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 0, provider: "p", model: "m" },
		metadata,
	};
}

function transcript(): string {
	const header = {
		type: "session",
		version: 3,
		id: "session-id",
		cwd: "/repo",
		timestamp: TS,
		origin: { kind: "im", botSessionId: "bot-a", workspaceAlias: "alpha" },
	};
	const inboundA = {
		source: "im",
		...identity("m1"),
		route: ROUTE_A,
		attachments: [{ id: "att-1", name: "photo.jpg", mimeType: "image/jpeg", size: 42 }],
	};
	const replyA = { source: "im", ...identity("m1"), replyToMessageId: "m1", route: ROUTE_A };
	const control = {
		type: "im_control",
		id: "control-1",
		parentId: "assistant-1",
		timestamp: TS,
		metadata: {
			source: "im_control",
			action: "switch_request",
			requestId: "req-1",
			...identity("m2"),
			from: ROUTE_A,
			to: ROUTE_B,
		},
	};
	const inboundB = { source: "im", ...identity("m3"), route: ROUTE_B };
	return [header, userEntry(inboundA), assistantEntry(replyA), control, userEntry(inboundB, "control-1")]
		.map(entry => JSON.stringify(entry))
		.join("\n");
}

describe("IM transcript provenance", () => {
	test("the real inbound user row keeps sender/chat/route and its reply links back", () => {
		const entries = parseSessionContent(transcript()).entries;
		const context = buildWebSessionContext(entries as never, undefined);

		// Control handshakes are not LLM messages.
		expect(context.messages.map(message => message.role)).toEqual(["user", "assistant", "user"]);
		expect(context.controlEvents).toHaveLength(1);
		expect(context.controlEvents?.[0]?.metadata.action).toBe("switch_request");

		const first = context.messageMetadata?.[0];
		expect(first?.source).toBe("im");
		expect(first && isImUserMessageMetadata(first)).toBe(true);
		expect(first?.senderName).toBe("Alice");
		expect(first?.senderId).toBe("user-1");
		expect(first?.chatId).toBe("chat-1");
		expect(first?.messageId).toBe("m1");
		expect(first?.route).toEqual(ROUTE_A);

		const reply = context.messageMetadata?.[1];
		expect(reply && isImReplyMetadata(reply)).toBe(true);
		expect(reply && "replyToMessageId" in reply ? reply.replyToMessageId : undefined).toBe("m1");
		expect(reply?.route).toEqual(ROUTE_A);

		// A later binding to beta must not rewrite the already-delivered alpha row.
		const second = context.messageMetadata?.[2];
		expect(second?.route).toEqual(ROUTE_B);
		expect(context.messageMetadata?.[0]?.route).toEqual(ROUTE_A);
	});

	test("an entry without IM metadata contributes no provenance row", () => {
		const header = { type: "session", version: 3, id: "plain", cwd: "/repo", timestamp: TS };
		const plain = {
			type: "message",
			id: "plain-user",
			parentId: null,
			timestamp: TS,
			message: { role: "user", content: "hi", timestamp: 0 },
		};
		const context = buildWebSessionContext(
			parseSessionContent(`${JSON.stringify(header)}\n${JSON.stringify(plain)}`).entries as never,
			undefined,
		);
		expect(context.messages).toHaveLength(1);
		expect(context.messageMetadata).toBeUndefined();
		expect(context.controlEvents).toBeUndefined();
	});

	test("validators reject a malformed row instead of inventing a route", () => {
		expect(normalizeImMessageMetadata({ source: "im", platform: "wechat" })).toBeUndefined();
		expect(
			normalizeImSwitchControlMetadata({ source: "im_control", action: "switch_request", requestId: "r" }),
		).toBeUndefined();
		// A Team origin is not an IM-bound session and stays visible in normal lists.
		expect(isImSession({ kind: "team", teamId: "t" })).toBe(false);
		expect(isImSession(undefined)).toBe(false);
	});
});

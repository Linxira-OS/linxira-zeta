import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConversationMessageItem } from "@linxiraos/studio-contract";
import { parseConversationTranscriptPage } from "@linxiraos/studio-protocol";
import { buildPersistedTimeline, emptyConversationState } from "./conversationViewModel";
import { ConversationItemView } from "./ConversationItemView";
import { UserMessageSource } from "./UserMessageSource";

const at = "2026-11-14T12:00:00.000Z";
const message = (id: string, role: "user" | "assistant", source?: ConversationMessageItem["source"]): ConversationMessageItem => ({ kind: "message", itemId: id, parentId: null, createdAt: at, role, content: [{ type: "text", text: `body-${id}` }], ...(source ? { source } : {}) });

describe("per-message user bubble attribution", () => {
	test("mixed interfaces remain user rows on the right with independent source labels", () => {
		const items = [
			message("web", "user", { kind: "client", client: "web" }),
			message("feishu", "user", { kind: "im", platform: "feishu", instance: "work-bot", senderName: "Alice" }),
			message("telegram", "user", { kind: "im", platform: "telegram", instance: "personal-bot", senderName: "Bob" }),
			message("tui", "user", { kind: "client", client: "cli" }),
			message("legacy", "user"), message("answer", "assistant"),
		];
		const rows = buildPersistedTimeline({ ...emptyConversationState(), items });
		expect(rows.map(row => row.type)).toEqual(["user", "user", "user", "user", "user", "assistant"]);
		const html = rows.map(row => renderToStaticMarkup(<ConversationItemView row={row} />));
		for (const bubble of html.slice(0, 5)) expect(bubble).toContain('class="ev ev-user"');
		expect(html[5]).toContain('class="ev ev-assistant"');
		expect(html[0]).toContain("Web"); expect(html[0]).not.toContain("work-bot");
		expect(html[1]).toContain("Feishu"); expect(html[1]).toContain("work-bot"); expect(html[1]).toContain("Alice"); expect(html[1]).not.toContain("Bob");
		expect(html[2]).toContain("personal-bot"); expect(html[2]).toContain("Bob"); expect(html[2]).not.toContain("Alice");
		expect(html[3]).toContain("TUI / CLI"); expect(html[4]).toContain("Unknown source");
	});
	test("labels escape sender content and never consult a current channel", () => {
		const html = renderToStaticMarkup(<UserMessageSource source={{ kind: "im", platform: "feishu", instance: "a", senderName: "<script>" }} />);
		expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
	});
	test("strict transcript parser preserves allowed message provenance", () => {
		const page = parseConversationTranscriptPage({ sessionId: "s", runtimeEpoch: 1, branchLeafId: null, items: [message("im", "user", { kind: "im", platform: "feishu", instance: "a", senderId: "u" })], headCursor: "h", hasMoreBefore: false });
		expect(page.items[0]).toMatchObject({ role: "user", source: { platform: "feishu", instance: "a", senderId: "u" } });
	});
});

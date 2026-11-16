import { afterEach, expect, test } from "bun:test";
import { Agent } from "@linxiraos/pi-agent-core";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { TempDir } from "@linxiraos/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { AgentSession } from "../src/session/agent-session";
import { SessionManager } from "../src/session/session-manager";
import { convertToLlm } from "../src/session/messages";
import { AgentSessionWrapper } from "../src/server/web-gateway/agents";
import { conversationFeed } from "../src/server/studio-host/conversation-feed";
import type { ConversationStreamEvent } from "../src/server/studio-host/protocol";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

const resources: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const dispose of resources.splice(0).reverse()) await dispose(); });

function runtime(answer: string) {
	const directory = TempDir.createSync("zeta-studio-feed-");
	resources.push(() => directory.remove());
	const auth = createInMemoryAuthStorage();
	auth.keys.setRuntime("anthropic", "test-key");
	const mock = createMockModel({ responses: [{ content: [answer] }, { content: [answer + "-again"] }] });
	const agent = new Agent({ initialState: { model: getBundledModel("anthropic", "claude-sonnet-4-5"), systemPrompt: ["Test"], tools: [] }, getApiKey: () => "test-key", convertToLlm, streamFn: mock.stream });
	const session = new AgentSession({ agent, sessionManager: SessionManager.inMemory(directory.path()), settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }), modelRegistry: new ModelRegistry(auth, directory.join("models.yml")) });
	resources.push(() => session.dispose());
	const wrapper = new AgentSessionWrapper(session, session.sessionId, null);
	return { session, wrapper, feed: conversationFeed(wrapper) };
}

test("real runtime deltas retain persisted identity and independent session sequences", async () => {
	const a = runtime("private-a"), b = runtime("private-b");
	const eventsA: ConversationStreamEvent[] = [], eventsB: ConversationStreamEvent[] = [];
	const detachA = a.feed.subscribe(event => eventsA.push(event));
	b.feed.subscribe(event => eventsB.push(event));
	await Promise.all([a.session.prompt("question-a"), b.session.prompt("question-b")]);
	await Promise.all([a.session.settleInFlightMessagePersistence(), b.session.settleInFlightMessagePersistence()]);
	for (const [runtime, events, answer, foreign] of [[a, eventsA, "private-a", "private-b"], [b, eventsB, "private-b", "private-a"]] as const) {
		const updates = events.map(event => event.update);
		const delta = updates.find(update => update.kind === "conversation.message.delta");
		expect(delta).toMatchObject({ kind: "conversation.message.delta", delta: answer });
		const completed = updates.filter(update => update.kind === "conversation.message.completed");
		const persisted = runtime.session.sessionManager.getEntries().filter(entry => entry.type === "message");
		for (const update of completed) {
			if (update.kind !== "conversation.message.completed") continue;
			expect(update.item.itemId).toBe(update.messageId);
			expect(persisted.some(entry => entry.id === update.messageId)).toBe(true);
		}
		expect(JSON.stringify(updates)).not.toContain(foreign);
		expect(events.map(event => event.streamSeq)).toEqual(events.map((_, index) => index + 1));
		expect(runtime.feed.replay()).toMatchObject({ status: "complete", watermark: events.length });
	}
	detachA();
	const count = eventsA.length;
	await a.session.prompt("another-a");
	expect(eventsA.length).toBe(count);
});

test("an awaited page read retains completion frames until its recovery watermark is captured", async () => {
	const live = runtime("answer-during-page-read");
	const release = Promise.withResolvers<void>();
	const capture = live.feed.capture(async () => { await release.promise; return "page-before-turn"; });
	await live.session.prompt("finish while history is loading");
	release.resolve();
	const result = await capture;
	expect(result.page).toBe("page-before-turn");
	expect(result.live.status).toBe("complete");
	const completed = result.live.events.filter(event => event.update.kind === "conversation.message.completed");
	expect(completed.some(event => event.update.kind === "conversation.message.completed" && event.update.item.role === "assistant")).toBe(true);
	expect(result.live.watermark).toBeGreaterThan(0);
	expect(live.feed.replay()).toMatchObject({ status: "complete", watermark: result.live.watermark, events: [] });
});

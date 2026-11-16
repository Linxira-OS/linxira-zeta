import { expect, test } from "bun:test";
import { Agent, type AgentEvent, agentMessageIdentity } from "@linxiraos/pi-agent-core";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { SessionManager } from "../src/session/session-manager";

test("stream start, immutable deltas and persisted completion share one entry ID", async () => {
	const mock = createMockModel({ responses: [{ content: ["first"] }, { content: ["second"] }] });
	const agent = new Agent({ initialState: { model: mock.model, systemPrompt: [], tools: [] }, streamFn: mock.stream });
	const manager = SessionManager.inMemory();
	const starts: string[] = [], ends: string[] = [];
	let active: string | undefined;
	agent.subscribe((event: AgentEvent) => {
		if (event.type !== "message_start" && event.type !== "message_update" && event.type !== "message_end") return;
		const id = manager.reserveMessageEntryId(event.message);
		if (event.message.role === "assistant") {
			if (event.type === "message_start") { starts.push(id); active = id; }
			else { if (active === undefined) throw new Error("assistant delta preceded start"); expect(id).toBe(active); }
			if (event.type === "message_end") ends.push(id);
		}
		if (event.type === "message_end" && (event.message.role === "user" || event.message.role === "assistant")) expect(manager.appendMessage(event.message)).toBe(id);
	});
	await agent.prompt("one");
	await agent.prompt("two");
	expect(ends).toEqual(starts);
	expect(new Set(starts).size).toBe(2);
	const messages = manager.getEntries().filter(entry => entry.type === "message");
	expect(messages.filter(entry => entry.message.role === "assistant").map(entry => entry.id)).toEqual(starts);
	expect(agentMessageIdentity(messages[0]!.message)).toBeDefined();
	expect(JSON.stringify(messages)).not.toContain("agent-message-identity");
});

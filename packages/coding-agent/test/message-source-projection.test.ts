import { describe, expect, test } from "bun:test";
import { SessionManager } from "../src/session/session-manager";
import { MemorySessionStorage } from "../src/session/session-storage";
import { buildImUserMessageMetadata } from "../src/session/session-im";
import { buildWebSessionContext } from "../src/server/web-gateway/sessions";
import { conversationMessageSource } from "../src/server/studio-host/ops/message-source";
import { projectConversationItems } from "../src/server/studio-host/ops/session";
import { Agent } from "@linxiraos/pi-agent-core";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { AgentSession } from "../src/session/agent-session";
import { convertToLlm } from "../src/session/messages";
import { AgentSessionWrapper } from "../src/server/web-gateway/agents";
import { conversationFeed } from "../src/server/studio-host/conversation-feed";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

const at = "2026-11-14T12:00:00.000Z";
function inbound(instance: string, senderName: string) {
	return buildImUserMessageMetadata({
		platform: "feishu",
		instance,
		senderName,
		senderId: senderName.toLowerCase(),
		chatId: "chat",
		messageId: instance,
		sentAt: at,
		route: { agentId: "Main", sessionId: "shared" },
	});
}

describe("message source projection", () => {
	test("mixed messages bound to one main retain their own immutable interface and sender", () => {
		const first = inbound("office", "Alice"),
			second = inbound("personal", "Bob");
		expect(conversationMessageSource(first, "web")).toEqual({
			kind: "im",
			platform: "feishu",
			instance: "office",
			senderName: "Alice",
			senderId: "alice",
		});
		expect(conversationMessageSource(second, "cli")).toEqual({
			kind: "im",
			platform: "feishu",
			instance: "personal",
			senderName: "Bob",
			senderId: "bob",
		});
		expect(conversationMessageSource(undefined, "web")).toEqual({ kind: "client", client: "web" });
		expect(conversationMessageSource(undefined)).toBeUndefined();
		expect(JSON.stringify(conversationMessageSource(first))).not.toContain("route");
	});
	test("gateway projection preserves aligned per-message client and IM stamps without changing role", () => {
		const entries = [
			{ type: "session", version: 3, id: "s", cwd: "/project", timestamp: at },
			{
				type: "message",
				id: "w",
				parentId: null,
				timestamp: at,
				client: "web",
				message: { role: "user", content: "from Web", timestamp: 0 },
			},
			{
				type: "message",
				id: "a",
				parentId: "w",
				timestamp: at,
				client: "web",
				metadata: inbound("office", "Alice"),
				message: { role: "user", content: "from Alice", timestamp: 0 },
			},
			{
				type: "message",
				id: "b",
				parentId: "a",
				timestamp: at,
				metadata: inbound("personal", "Bob"),
				message: { role: "user", content: "from Bob", timestamp: 0 },
			},
			{
				type: "message",
				id: "old",
				parentId: "b",
				timestamp: at,
				message: { role: "user", content: "unknown", timestamp: 0 },
			},
		];
		const context = buildWebSessionContext(entries as never, "old");
		expect(context.messages.map(message => message.role)).toEqual(["user", "user", "user", "user"]);
		expect(context.messageClients).toEqual(["web", "web", null, null]);
		expect(context.messageMetadata?.map(metadata => metadata?.instance ?? null)).toEqual([
			null,
			"office",
			"personal",
			null,
		]);
		expect(context.messageMetadata?.[1]?.senderName).toBe("Alice");
		const projected = projectConversationItems(
			context.messages.map((message, index) => ({
				id: context.entryIds[index]!,
				createdAt: at,
				message,
				metadata: context.messageMetadata?.[index],
				client: context.messageClients?.[index],
			})),
			at,
		);
		expect(projected.map(item => (item.kind === "message" ? [item.role, item.source] : item.kind))).toEqual([
			["user", { kind: "client", client: "web" }],
			["user", { kind: "im", platform: "feishu", instance: "office", senderName: "Alice", senderId: "alice" }],
			["user", { kind: "im", platform: "feishu", instance: "personal", senderName: "Bob", senderId: "bob" }],
			["user", undefined],
		]);
	});
	test("new user entry stamps actual manager client while explicit IM metadata wins", async () => {
		const manager = SessionManager.create("/project", "/sessions", new MemorySessionStorage(), { client: "cli" });
		try {
			const id = manager.appendMessage({ role: "user", content: "local", timestamp: 0 });
			const imId = manager.appendMessage(
				{ role: "user", content: "inbound", timestamp: 0 },
				inbound("office", "Alice"),
			);
			const webId = manager.appendMessage({ role: "user", content: "attached Web", timestamp: 0 }, undefined, "web");
			expect(manager.getEntries().find(entry => entry.id === webId)).toMatchObject({ client: "web" });
			const entry = manager.getEntries().find(entry => entry.id === id);
			const imEntry = manager.getEntries().find(entry => entry.id === imId);
			expect(entry).toMatchObject({ type: "message", client: "cli" });
			expect(imEntry).toMatchObject({
				type: "message",
				client: "cli",
				metadata: { instance: "office", senderName: "Alice" },
			});
		} finally {
			await manager.close();
		}
	});
	test("immediate and queued clients agree in live completed bubbles and persisted history", async () => {
		const auth = createInMemoryAuthStorage();
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let calls = 0;
		const mock = createMockModel({
			handler: async () => {
				if (++calls === 1) {
					started.resolve();
					await release.promise;
				}
				return { content: ["local response"] };
			},
		});
		auth.keys.setRuntime(mock.model.provider, "fixture");
		const manager = SessionManager.inMemory();
		const session = new AgentSession({
			agent: new Agent({
				initialState: { model: mock.model, tools: [], systemPrompt: [] },
				getApiKey: () => "fixture",
				convertToLlm,
				streamFn: mock.stream,
			}),
			sessionManager: manager,
			settings: Settings.isolated({ "compaction.enabled": false, "todo.enabled": false, "retry.enabled": false }),
			modelRegistry: new ModelRegistry(auth),
		});
		const wrapper = new AgentSessionWrapper(session, session.sessionId, null);
		const live = new Map<string, unknown>();
		const unsubscribe = conversationFeed(wrapper).subscribe(event => {
			if (event.update.kind !== "conversation.message.completed" || event.update.item.role !== "user") return;
			const text = event.update.item.content
				.filter(block => block.type === "text")
				.map(block => block.text)
				.join("");
			live.set(text, event.update.item.source);
		});
		try {
			const prompt = session.prompt("initial-web", { client: "web" });
			await started.promise;
			await session.steer("queued-desktop", undefined, { client: "desktop" });
			await session.followUp("queued-automation", undefined, { client: "automation" });
			await session.prompt("aside-cli", { client: "cli", streamingBehavior: "aside" });
			release.resolve();
			await prompt;
			await session.waitForIdle();
			const entries = manager
				.getEntries()
				.flatMap(entry =>
					entry.type === "message" && entry.message.role === "user"
						? [{ client: entry.client, message: entry.message }]
						: [],
				);
			for (const [text, client] of [
				["initial-web", "web"],
				["queued-desktop", "desktop"],
				["queued-automation", "automation"],
				["aside-cli", "cli"],
			] as const) {
				const entry = entries.find(entry =>
					typeof entry.message.content === "string"
						? entry.message.content === text
						: entry.message.content.some(block => block.type === "text" && block.text === text),
				);
				expect(entry?.client).toBe(client);
				expect(live.get(text!)).toEqual({ kind: "client", client });
			}
		} finally {
			release.resolve();
			unsubscribe();
			await session.dispose();
			await manager.close();
			auth.close();
		}
	});
});

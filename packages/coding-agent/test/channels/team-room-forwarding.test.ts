/** Real router, IrcBridge, SessionManager, RoomLog and per-message reply correlation. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { YAML } from "bun";
import type { IrcMessage } from "@linxiraos/pi-tui/tools/irc";
import { runImControl, type ImControlDeps } from "../../src/channels/im-control";
import { SessionRouter } from "../../src/channels/session-router";
import { WebConfig } from "../../src/config/web-config";
import { AgentRegistry } from "../../src/registry/agent-registry";
import { AgentLifecycleManager } from "../../src/registry/agent-lifecycle";
import { IrcBus } from "../../src/irc/bus";
import { RoomService } from "../../src/rooms/service";
import { roomRuntime } from "../../src/rooms/transport";
import { IrcBridge } from "../../src/session/irc-bridge";
import type { AgentSession } from "../../src/session/agent-session";
import type { AgentSessionEvent } from "../../src/session/agent-session-events";
import { normalizeImMessageMetadata } from "../../src/session/session-im";
import { SessionManager } from "../../src/session/session-manager";
import { ensureTeam, history, leaveTeam, resetTeamRoomsForTests, snapshot } from "../../src/vibe/team-rooms";
import { ImControlTool } from "../../src/tools/im-control";
import type { ToolSession } from "../../src/tools";

const deps: ImControlDeps = {
	listModels: async () => [],
	setChatModel: async () => ({ ok: false, error: "unused" }),
	getChatModel: async () => null,
	getChannelStatus: () => [],
};

describe("owner-directed Team IM forwarding", () => {
	let dir: string;
	let rooms: RoomService;
	let manager: SessionManager;
	let router: SessionRouter;
	let session: AgentSession;
	let enabled: boolean;
	let observer: ((records: readonly unknown[]) => (() => void) | undefined) | undefined;
	const events = new Set<(event: AgentSessionEvent) => void>();
	const deliveries: IrcMessage[] = [];
	const sent: Array<{ instance: string; peer: string; text: string }> = [];

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-team-im-forward-"));
		resetTeamRoomsForTests();
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
		IrcBus.resetGlobalForTests();
		rooms = new RoomService(path.join(dir, "rooms.db"));
		roomRuntime(() => rooms);
		manager = SessionManager.create(dir, path.join(dir, "sessions"));
		manager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "ready" }],
			provider: "fixture",
			model: "fixture",
			timestamp: 0,
		} as never);
		enabled = false;
		observer = undefined;
		events.clear();
		deliveries.length = 0;
		sent.length = 0;
		const bridge = new IrcBridge({
			agent: { appendMessage: () => {}, steer: () => {} } as never,
			sessionManager: manager,
			isDisposed: () => false,
			isStreaming: () => false,
			planModeEnabled: () => false,
			emitSessionEvent: async () => {},
			wakeForIrc: () => {},
		});
		session = {
			getAgentId: () => "Main",
			getTeamModeState: () => (enabled ? { enabled: true } : undefined),
			sessionManager: manager,
			subscribe: (listener: (event: AgentSessionEvent) => void) => {
				events.add(listener);
				return () => {
					events.delete(listener);
				};
			},
			setIrcWakeTurnObserver: (next: typeof observer) => {
				observer = next;
			},
			deliverIrcMessage: async (message: IrcMessage) => {
				deliveries.push(message);
				return bridge.deliver(message);
			},
			emitIrcRelayObservation: () => {},
			dispose: async () => {},
		} as unknown as AgentSession;
		AgentRegistry.global().register({ id: "Main", displayName: "Main", kind: "main", status: "idle", session });
		const configFile = path.join(dir, "web.yml");
		await Bun.write(
			configFile,
			YAML.stringify({
				channels: {
					instances: [
						{
							id: "telegram-personal",
							platform: "telegram",
							label: "Telegram",
							enabled: true,
							agentProfile: "mainp",
							allow: { peers: ["chat-a"] },
							credentials: { botToken: "fixture" },
						},
						{
							id: "feishu-work",
							platform: "feishu",
							label: "Feishu",
							enabled: true,
							agentProfile: "mainp",
							allow: { peers: ["chat-b"] },
							credentials: {},
						},
					],
				},
				imAgents: [
					{
						id: "mainp",
						label: "Main",
						persona: { mode: "workspace" },
						location: { kind: "workspace", workspace: "main" },
						tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
						memory: {},
					},
				],
			}),
		);
		const webConfig = await WebConfig.load(configFile);
		router = new SessionRouter({
			coordinator: session,
			webConfig,
			getLastInbound: () => ({ channelId: "feishu-work", peer: "chat-b" }),
			sendText: async (instance, peer, text) => {
				sent.push({ instance, peer, text });
			},
			defaultCwd: dir,
		});
	});

	afterEach(async () => {
		await router.stopAll();
		await manager.close();
		rooms.close();
		resetTeamRoomsForTests();
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
		IrcBus.resetGlobalForTests();
		await fs.rm(dir, { recursive: true, force: true });
	});

	function scope() {
		return {
			ownerId: "Main",
			parentSessionId: manager.getSessionId(),
			parentSessionFile: manager.getSessionFile() ?? null,
		};
	}

	function answer(record: IrcMessage, text: string): void {
		const finish = observer?.([
			{ role: "custom", customType: "irc:incoming", details: { id: record.id, metadata: record.metadata } },
		]);
		for (const emit of events)
			emit({
				type: "turn_end",
				message: { role: "assistant", content: [{ type: "text", text }] },
				turnIndex: 1,
				toolResults: [],
			} as unknown as AgentSessionEvent);
		finish?.();
	}

	test("two IM instances on one main retain real user provenance and reply to their own chats out of order", async () => {
		expect(
			(
				await router.deliverToAgent("Main", "telegram-personal", "chat-a", "Alice asks", {
					messageId: "tg-1",
					userId: "alice",
					senderName: "Alice",
					threadId: "topic-a",
					sentAt: 1_700_000_000_000,
				})
			).ok,
		).toBe(true);
		expect(
			(
				await router.deliverToAgent("Main", "feishu-work", "chat-b", "Bob asks", {
					messageId: "fs-2",
					userId: "bob",
					senderName: "Bob",
					sentAt: 1_700_000_000_001,
				})
			).ok,
		).toBe(true);
		const rows = manager.getEntries().filter(entry => entry.type === "message" && entry.message.role === "user");
		expect(rows).toHaveLength(2);
		const identities = rows.map(entry =>
			entry.type === "message" ? normalizeImMessageMetadata(entry.metadata) : undefined,
		);
		expect(identities[0]).toMatchObject({
			source: "im",
			platform: "telegram",
			instance: "telegram-personal",
			chatId: "chat-a",
			senderId: "alice",
			senderName: "Alice",
			messageId: "tg-1",
		});
		expect(identities[1]).toMatchObject({
			source: "im",
			platform: "feishu",
			instance: "feishu-work",
			chatId: "chat-b",
			senderId: "bob",
			senderName: "Bob",
			messageId: "fs-2",
		});
		answer(deliveries[1]!, "answer Bob");
		answer(deliveries[0]!, "answer Alice");
		await Promise.resolve();
		await Promise.resolve();
		expect(sent).toEqual([
			{ instance: "feishu-work", peer: "chat-b", text: "answer Bob" },
			{ instance: "telegram-personal", peer: "chat-a", text: "answer Alice" },
		]);
		await router.setAgentTarget("telegram-personal", "chat-a");
		expect(rows[0]?.type === "message" && normalizeImMessageMetadata(rows[0].metadata)).toEqual(identities[0]);
		expect(rooms.listRooms()).toEqual([]);
	});

	test("one-shot forwarding requires active Team main and authentic source row; ordinary routing stays intact", async () => {
		await router.deliverToAgent("Main", "telegram-personal", "chat-a", "source body", {
			messageId: "tg-forward",
			userId: "alice",
			senderName: "Alice",
		});
		const rejected = await runImControl(
			router,
			"coordinator",
			{ operation: "route_team_room", body: "owner summary", messageId: "tg-forward" },
			deps,
		);
		expect(rejected.isError).toBe(true);
		enabled = true;
		const owner = scope();
		ensureTeam(owner);
		const before = await router.bindingFor("telegram-personal", "chat-a");
		const result = await runImControl(
			router,
			"coordinator",
			{ operation: "route_team_room", body: "owner summary", messageId: "tg-forward" },
			deps,
		);
		expect(result.isError).toBeUndefined();
		const event = history(owner).events[0]!;
		expect(event.senderId).toBe("Main");
		expect(event.body).toContain("instance=telegram-personal chat=chat-a message=tg-forward");
		expect(event.body).toContain("owner summary");
		expect(event.metadata).toMatchObject({
			platform: "telegram",
			instance: "telegram-personal",
			chatId: "chat-a",
			senderId: "alice",
			senderName: "Alice",
			messageId: "tg-forward",
		});
		expect(await router.bindingFor("telegram-personal", "chat-a")).toBe(before);
		expect(
			manager.getEntries().filter(entry => entry.type === "message" && entry.message.role === "user"),
		).toHaveLength(1);
		const bad = await runImControl(
			router,
			"coordinator",
			{ operation: "route_team_room", body: "forged", messageId: "does-not-exist" },
			deps,
		);
		expect(bad.isError).toBe(true);
		expect(history(owner).events).toHaveLength(1);
		await router.deliverToAgent("Main", "feishu-work", "chat-b", "ordinary next", { messageId: "fs-next" });
		expect(history(owner).events).toHaveLength(1);
		expect(snapshot(owner).mains.members.map(member => member.agentId)).toEqual(["Main"]);
		leaveTeam(owner);
		expect(
			(
				await runImControl(
					router,
					"coordinator",
					{ operation: "route_team_room", body: "after exit", messageId: "fs-next" },
					deps,
				)
			).isError,
		).toBe(true);
	});

	test("messageId collisions across instances require the stored entry id; source fields cannot be overridden", async () => {
		await router.deliverToAgent("Main", "telegram-personal", "chat-a", "one", {
			messageId: "same-id",
			userId: "alice",
		});
		await router.deliverToAgent("Main", "feishu-work", "chat-b", "two", { messageId: "same-id", userId: "bob" });
		enabled = true;
		const owner = scope();
		ensureTeam(owner);
		const rows = manager.getEntries().filter(entry => entry.type === "message" && entry.message.role === "user");
		const ambiguous = await runImControl(
			router,
			"coordinator",
			{ operation: "route_team_room", body: "summary", messageId: "same-id" },
			deps,
		);
		expect(ambiguous.isError).toBe(true);
		const precise = await runImControl(
			router,
			"coordinator",
			{ operation: "route_team_room", body: "Alice summary", messageId: "same-id", sourceEntryId: rows[0]!.id },
			deps,
		);
		expect(precise.isError).toBeUndefined();
		expect(history(owner).events[0]?.metadata).toMatchObject({ instance: "telegram-personal", senderId: "alice" });
		expect(
			(
				await runImControl(
					router,
					"unknown-caller",
					{ operation: "route_team_room", body: "forged", messageId: "same-id", sourceEntryId: rows[0]!.id },
					deps,
				)
			).isError,
		).toBe(true);
	});

	test("a current IM wake turn cannot forward a different chat's earlier message", async () => {
		await router.deliverToAgent("Main", "telegram-personal", "chat-a", "Alice", {
			messageId: "alice-old",
			userId: "alice",
		});
		await router.deliverToAgent("Main", "feishu-work", "chat-b", "Bob", { messageId: "bob-current", userId: "bob" });
		enabled = true;
		const owner = scope();
		ensureTeam(owner);
		const current = deliveries[1]!;
		const finish = observer?.([
			{ role: "custom", customType: "irc:incoming", details: { id: current.id, metadata: current.metadata } },
		]);
		expect(
			(
				await runImControl(
					router,
					"coordinator",
					{ operation: "route_team_room", body: "wrong chat", messageId: "alice-old" },
					deps,
				)
			).isError,
		).toBe(true);
		expect(
			(
				await runImControl(
					router,
					"coordinator",
					{ operation: "route_team_room", body: "Bob summary", messageId: "bob-current" },
					deps,
				)
			).isError,
		).toBeUndefined();
		finish?.();
		expect(history(owner).events[0]?.metadata).toMatchObject({ instance: "feishu-work", senderId: "bob" });
	});

	test("a worker cannot use an inherited main IM sink to forge owner forwarding", async () => {
		AgentRegistry.global().register({
			id: "worker",
			displayName: "worker",
			kind: "sub",
			parentId: "Main",
			status: "idle",
			session,
		});
		let invoked = false;
		const tool = new ImControlTool({
			getAgentId: () => "worker",
			imControl: async () => {
				invoked = true;
				return { text: "unreachable" };
			},
		} as unknown as ToolSession);
		const result = await tool.execute("forward", { operation: "route_team_room", body: "forged", messageId: "any" });
		expect(result.isError).toBe(true);
		expect(invoked).toBe(false);
	});

	test("external IM cannot directly target a worker", async () => {
		AgentRegistry.global().register({
			id: "worker",
			displayName: "worker",
			kind: "sub",
			parentId: "Main",
			status: "idle",
			session,
		});
		const result = await router.deliverToAgent("worker", "telegram-personal", "chat-a", "bypass owner", {
			messageId: "worker-ingress",
		});
		expect(result.ok).toBe(false);
		expect(deliveries).toHaveLength(0);
	});
});

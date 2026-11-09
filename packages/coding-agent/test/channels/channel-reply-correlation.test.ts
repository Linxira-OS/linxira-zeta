/**
 * SessionRouter reply correlation: a workspace/bot session can be shared by
 * several chats (and by Studio, which prompts the same session directly). A
 * reply must go to the chat whose delivered message the turn answers, never to
 * another chat and never to a Studio/attach turn.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConfigRootDir, setAgentDir } from "@linxiraos/pi-utils";
import type { IrcMessage } from "@linxiraos/pi-channels";
import { SessionRouter } from "../../src/channels/session-router";
import { WebConfig } from "../../src/config/web-config";
import type { LoadExtensionsResult } from "../../src/extensibility/extensions/types";
import * as sdk from "../../src/sdk";
import type { AgentSession } from "../../src/session/agent-session";
import type { AgentSessionEvent } from "../../src/session/agent-session-events";
import { EventBus } from "../../src/utils/event-bus";

interface ObservedStub {
	session: AgentSession;
	deliveries: IrcMessage[];
	/** Simulate the wake turn that answers these delivered records. */
	turn(recordIds: string[], text: string): void;
	/** Simulate a prompt typed into Studio on the same session. */
	studioTurn(text: string): void;
}

function makeObservedStub(agentId: string): ObservedStub {
	const listeners = new Set<(event: AgentSessionEvent) => void>();
	const deliveries: IrcMessage[] = [];
	let observer: ((records: readonly unknown[]) => ((error?: unknown) => void) | undefined) | null = null;

	const emitTurn = (text: string): void => {
		const event = {
			type: "turn_end",
			turnIndex: 1,
			message: { role: "assistant", content: [{ type: "text", text }] },
			toolResults: [],
		} as unknown as AgentSessionEvent;
		for (const listener of listeners) listener(event);
	};

	const session = {
		getAgentId: () => agentId,
		subscribe: (listener: (event: AgentSessionEvent) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		deliverIrcMessage: async (msg: IrcMessage) => {
			deliveries.push(msg);
			return "woken" as const;
		},
		setIrcWakeTurnObserver: (next: typeof observer) => {
			observer = next ?? null;
		},
		agent: {
			state: { systemPrompt: [] as string[] },
			setSystemPrompt: () => {},
		},
		dispose: async () => {},
	} as unknown as AgentSession;

	return {
		session,
		deliveries,
		turn(recordIds, text) {
			observer?.(recordIds.map(id => ({ role: "custom", customType: "irc:incoming", details: { id } })));
			emitTurn(text);
		},
		studioTurn(text) {
			emitTurn(text);
		},
	};
}

function mockWorkspaceSessions(byCwd: Map<string, ObservedStub>): void {
	vi.spyOn(sdk, "createAgentSession").mockImplementation(async options => {
		const cwd = options?.cwd ?? "";
		const stub = byCwd.get(cwd);
		if (!stub) throw new Error(`unexpected workspace cwd: ${cwd}`);
		return {
			session: stub.session,
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		};
	});
}

describe("SessionRouter reply correlation", () => {
	const cleanups: Array<() => Promise<void>> = [];
	const originalAgentDir = process.env.ZETA_CODING_AGENT_DIR;
	let testAgentDir: string;

	// A bot session's transcript is written under the real sessions root
	// (`SessionManager.getDefaultSessionDir(defaultCwd)`); isolate it so this
	// suite never leaves temp-workspace buckets in ~/.zeta/agent/sessions.
	beforeAll(async () => {
		testAgentDir = await mkdtemp(join(tmpdir(), "zeta-correlate-agent-"));
		setAgentDir(testAgentDir);
	});
	afterAll(async () => {
		await rm(testAgentDir, { recursive: true, force: true });
		if (originalAgentDir) {
			setAgentDir(originalAgentDir);
		} else {
			setAgentDir(join(getConfigRootDir(), "agent"));
			delete process.env.ZETA_CODING_AGENT_DIR;
		}
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	async function makeRouter(): Promise<{
		router: SessionRouter;
		sent: Array<{ channelId: string; peer: string; text: string }>;
	}> {
		const configDir = await mkdtemp(join(tmpdir(), "zeta-correlate-"));
		cleanups.push(() => rm(configDir, { recursive: true, force: true }));
		const webConfig = await WebConfig.load(join(configDir, "web.yml"));
		const sent: Array<{ channelId: string; peer: string; text: string }> = [];
		const router = new SessionRouter({
			coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
			webConfig,
			getLastInbound: () => null,
			sendText: async (channelId, peer, text) => {
				sent.push({ channelId, peer, text });
			},
			defaultCwd: configDir,
		});
		cleanups.push(async () => {
			await router.stopAll();
		});
		return { router, sent };
	}

	test("two chats on one workspace each receive their own answer", async () => {
		const dir = await mkdtemp(join(tmpdir(), "zeta-correlate-web-"));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const stub = makeObservedStub("agent-web");
		mockWorkspaceSessions(new Map([[dir, stub]]));

		const { router, sent } = await makeRouter();
		await router.open(dir, "web");

		expect(await router.deliverDirect("web", "feishu", "chat-a", "from a")).toEqual({ ok: true });
		expect(await router.deliverDirect("web", "wechat", "chat-b", "from b")).toEqual({ ok: true });
		expect(stub.deliveries).toHaveLength(2);

		stub.turn([stub.deliveries[0]!.id], "answer a");
		expect(sent).toEqual([{ channelId: "feishu", peer: "chat-a", text: "answer a" }]);

		stub.turn([stub.deliveries[1]!.id], "answer b");
		expect(sent).toEqual([
			{ channelId: "feishu", peer: "chat-a", text: "answer a" },
			{ channelId: "wechat", peer: "chat-b", text: "answer b" },
		]);
	});

	test("a Studio/attach turn on the workspace session consumes no IM reply slot", async () => {
		const dir = await mkdtemp(join(tmpdir(), "zeta-correlate-studio-"));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const stub = makeObservedStub("agent-web");
		mockWorkspaceSessions(new Map([[dir, stub]]));

		const { router, sent } = await makeRouter();
		await router.open(dir, "web");
		await router.deliverDirect("web", "feishu", "chat-a", "question");

		stub.studioTurn("studio answer");
		expect(sent).toEqual([]);

		stub.turn([stub.deliveries[0]!.id], "real answer");
		expect(sent).toEqual([{ channelId: "feishu", peer: "chat-a", text: "real answer" }]);
	});

	test("cross-workspace rejection: another workspace's turn never replies to this chat", async () => {
		const dirA = await mkdtemp(join(tmpdir(), "zeta-correlate-a-"));
		const dirB = await mkdtemp(join(tmpdir(), "zeta-correlate-b-"));
		cleanups.push(() => rm(dirA, { recursive: true, force: true }));
		cleanups.push(() => rm(dirB, { recursive: true, force: true }));
		const stubA = makeObservedStub("agent-a");
		const stubB = makeObservedStub("agent-b");
		mockWorkspaceSessions(
			new Map([
				[dirA, stubA],
				[dirB, stubB],
			]),
		);

		const { router, sent } = await makeRouter();
		await router.open(dirA, "a");
		await router.open(dirB, "b");
		await router.deliverDirect("a", "feishu", "chat-a", "question for a");

		stubB.studioTurn("answer from the wrong workspace");
		expect(sent).toEqual([]);

		stubA.turn([stubA.deliveries[0]!.id], "answer from a");
		expect(sent).toEqual([{ channelId: "feishu", peer: "chat-a", text: "answer from a" }]);
	});

	test("two chats sharing one bot session each receive their own answer", async () => {
		const { router, sent } = await makeRouter();
		const shared = makeObservedStub("bot-shared");
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async () => ({
			session: shared.session,
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		await router.ensureRelaySession("/tmp/zeta-correlate-bot.jsonl");
		const created = await router.createBotSession("shared");
		if (!created.ok) throw new Error(created.error);
		const id = created.entry.id;

		await router.deliverToBotSession(id, "telegram", "peer-a", "from a");
		await router.deliverToBotSession(id, "telegram", "peer-b", "from b");
		expect(shared.deliveries).toHaveLength(2);

		shared.turn([shared.deliveries[0]!.id], "answer a");
		expect(sent).toEqual([{ channelId: "telegram", peer: "peer-a", text: "answer a" }]);

		shared.turn([shared.deliveries[1]!.id], "answer b");
		expect(sent).toEqual([
			{ channelId: "telegram", peer: "peer-a", text: "answer a" },
			{ channelId: "telegram", peer: "peer-b", text: "answer b" },
		]);
	});
});

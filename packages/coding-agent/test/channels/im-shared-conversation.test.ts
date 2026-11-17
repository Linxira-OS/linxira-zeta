/**
 * Explicit many-entrance → one-conversation contract.
 *
 * These tests pin the boundary the Settings chooser and the IM router share:
 * one `sessionId` may be named by several entrances only with the same target,
 * profile and model; materialization reuses one transcript; restart preserves
 * the selection; unbind leaves sibling entrances and the transcript intact;
 * replies follow the message that woke the turn, not the latest delivery.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { join } from "node:path";
import { getConfigRootDir, setAgentDir } from "@linxiraos/pi-utils";
import { type ImBinding, validateImBindings } from "../../src/channels/im-config";
import { SessionRouter } from "../../src/channels/session-router";
import { WebConfig } from "../../src/config/web-config";
import type { LoadExtensionsResult } from "../../src/extensibility/extensions/types";
import * as sdk from "../../src/sdk";
import type { AgentSession } from "../../src/session/agent-session";
import type { AgentSessionEvent } from "../../src/session/agent-session-events";
import { EventBus } from "../../src/utils/event-bus";

const PROFILE = {
	id: "companion",
	label: "Companion",
	persona: { mode: "workspace" as const },
	location: { kind: "workspace" as const, workspace: "main" },
	tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
	memory: {},
};
const ANALYST = { ...PROFILE, id: "analyst", label: "Analyst" };

const INSTANCE = {
	id: "wechat",
	platform: "wechat" as const,
	label: "WeChat",
	enabled: true,
	agentProfile: PROFILE.id,
	allow: { peers: ["peer-a"] },
	credentials: {},
};
const SECOND_INSTANCE = {
	id: "telegram",
	platform: "telegram" as const,
	label: "Telegram",
	enabled: true,
	agentProfile: PROFILE.id,
	allow: { peers: ["peer-b"] },
	credentials: {},
};

function binding(overrides: Partial<ImBinding> = {}): ImBinding {
	return {
		id: "b_0123456789abcdef",
		instanceId: "wechat",
		platform: "wechat",
		chatId: "peer-a",
		agentProfileId: PROFILE.id,
		sessionId: "shared-conversation",
		target: { kind: "workspace", workspace: "main" },
		role: "answer",
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("shared binding validation", () => {
	test("two instances and chats may name one conversation with the same target/profile", () => {
		const rows = validateImBindings(
			[
				binding(),
				binding({ id: "b_fedcba9876543210", instanceId: "telegram", platform: "telegram", chatId: "peer-b" }),
			],
			[INSTANCE, SECOND_INSTANCE],
			[PROFILE],
		);
		expect(rows).toHaveLength(2);
		expect(new Set(rows.map(row => row.sessionId))).toEqual(new Set(["shared-conversation"]));
	});

	test("same profile alone does not allow a different conversation key", () => {
		const rows = validateImBindings(
			[
				binding(),
				binding({
					id: "b_fedcba9876543210",
					instanceId: "telegram",
					platform: "telegram",
					chatId: "peer-b",
					sessionId: "other",
				}),
			],
			[INSTANCE, SECOND_INSTANCE],
			[PROFILE],
		);
		expect(rows.map(row => row.sessionId)).toEqual(["shared-conversation", "other"]);
	});

	test("conflicting target, profile or explicit model cannot hijack a shared conversation", () => {
		const second = binding({
			id: "b_fedcba9876543210",
			instanceId: "telegram",
			platform: "telegram",
			chatId: "peer-b",
		});
		expect(() =>
			validateImBindings(
				[binding(), { ...second, target: { kind: "workspace", workspace: "other" } }],
				[INSTANCE, SECOND_INSTANCE],
				[PROFILE],
			),
		).toThrow(/same target/);
		expect(() =>
			validateImBindings(
				[binding(), { ...second, agentProfileId: ANALYST.id }],
				[INSTANCE, SECOND_INSTANCE],
				[PROFILE, ANALYST],
			),
		).toThrow(/same agent profile/);
		expect(() =>
			validateImBindings(
				[binding({ model: { provider: "p", model: "a" } }), { ...second, model: { provider: "p", model: "b" } }],
				[INSTANCE, SECOND_INSTANCE],
				[PROFILE],
			),
		).toThrow(/same model/);
	});

	test("an existing conversation entry rejects a mismatched target/profile", () => {
		const conversation = [
			{
				id: "shared-conversation",
				target: { kind: "workspace" as const, workspace: "main" },
				agentProfileId: PROFILE.id,
			},
		];
		expect(() =>
			validateImBindings(
				[binding({ target: { kind: "workspace", workspace: "other" } })],
				[INSTANCE],
				[PROFILE],
				conversation,
			),
		).toThrow(/selected conversation/);
		expect(() =>
			validateImBindings([binding({ agentProfileId: ANALYST.id })], [INSTANCE], [PROFILE, ANALYST], conversation),
		).toThrow(/selected conversation/);
	});
});

describe("shared conversation persistence and router delivery", () => {
	const cleanups: Array<() => Promise<void>> = [];
	let testAgentDir: string;
	let configDir: string;
	let configFile: string;
	const originalAgentDir = process.env.ZETA_CODING_AGENT_DIR;

	beforeAll(async () => {
		testAgentDir = await mkdtemp(join(tmpdir(), "zeta-shared-agent-"));
		setAgentDir(testAgentDir);
	});

	afterAll(async () => {
		await rm(testAgentDir, { recursive: true, force: true });
		if (originalAgentDir) setAgentDir(originalAgentDir);
		else {
			setAgentDir(path.join(getConfigRootDir(), "agent"));
			delete process.env.ZETA_CODING_AGENT_DIR;
		}
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	});

	async function loadConfig(prefix: string): Promise<WebConfig> {
		configDir = await mkdtemp(join(tmpdir(), prefix));
		configFile = join(configDir, "web.yml");
		cleanups.push(() => rm(configDir, { recursive: true, force: true }));
		await Bun.write(
			configFile,
			JSON.stringify({
				channels: { instances: [INSTANCE, SECOND_INSTANCE] },
				imAgents: [PROFILE, ANALYST],
				remote: {},
			}),
		);
		return WebConfig.load(configFile);
	}

	/** Bot session stub with an observable wake-turn path for reply correlation. */
	function makeWakeBotSession(agentId: string, nativeId: string) {
		type Wake = { id: string; body: string };
		const listeners = new Set<(event: AgentSessionEvent) => void>();
		const pending: Wake[] = [];
		const controls: Array<{ id: string; metadata: Record<string, unknown> }> = [];
		let observer: ((records: readonly unknown[]) => ((error?: unknown) => void) | undefined) | undefined;
		const manager = {
			getSessionId: () => nativeId,
			getOrigin: () => undefined,
			setOrigin: async () => {},
			getSessionName: () => "Shared chat",
			setSessionName: async () => {},
			appendImControl: (metadata: Record<string, unknown>): string => {
				const id = `im-control-${controls.length + 1}`;
				controls.push({ id, metadata });
				return id;
			},
		};
		const session = {
			sessionManager: manager,
			getAgentId: () => agentId,
			agent: {
				state: { systemPrompt: [] as string[] },
				setSystemPrompt: () => {},
			},
			subscribe: (listener: (event: AgentSessionEvent) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			deliverIrcMessage: async (message: { id: string; body: string }) => {
				pending.push({ id: message.id, body: message.body });
				return "woken" as const;
			},
			setIrcWakeTurnObserver: (fn: typeof observer) => {
				observer = fn;
			},
			dispose: async () => {},
		} as unknown as AgentSession;
		const wake = (recordId: string): void => {
			const record = pending.find(item => item.id === recordId);
			if (!record) throw new Error(`unknown wake ${recordId}`);
			observer?.([{ details: { id: record.id } }]);
			for (const listener of listeners) {
				listener({
					type: "turn_end",
					turnIndex: 1,
					message: { role: "assistant", content: [{ type: "text", text: `${record.body}-reply` }] },
					toolResults: [],
				} as unknown as AgentSessionEvent);
			}
		};
		return { session, pending, controls, wake };
	}

	test("setImConversationModel moves every entrance and the entry together", async () => {
		const config = await loadConfig("zeta-shared-config-");
		await config.upsertBotSession({
			id: "shared-conversation",
			name: "Shared chat",
			tag: "bot",
			sessionFile: join(configDir, "shared.jsonl"),
			cwd: configDir,
			target: { kind: "workspace", workspace: "main" },
			agentProfileId: PROFILE.id,
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		await config.setImBindings([
			binding(),
			binding({ id: "b_fedcba9876543210", instanceId: "telegram", platform: "telegram", chatId: "peer-b" }),
		]);
		await config.setImConversationModel("wechat", "peer-a", { provider: "acme", model: "fast" });
		const reloaded = await WebConfig.load(configFile);
		expect(reloaded.getImBindings().map(row => row.model)).toEqual([
			{ provider: "acme", model: "fast" },
			{ provider: "acme", model: "fast" },
		]);
		expect(reloaded.getBotSession("shared-conversation")?.model).toEqual({ provider: "acme", model: "fast" });
	});

	test("two entrances deliver into one transcript, replies follow the waking message, and restart keeps the id", async () => {
		const config = await loadConfig("zeta-shared-router-");
		const sent: Array<{
			channelId: string;
			peer: string;
			text: string;
			options?: { replyToMessageId?: string; threadId?: string };
		}> = [];
		const router = new SessionRouter({
			coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
			webConfig: config,
			getLastInbound: () => null,
			sendText: async (channelId, peer, text, options) => {
				sent.push({ channelId, peer, text, ...(options ? { options } : {}) });
			},
			defaultCwd: configDir,
		});
		cleanups.push(async () => {
			await router.stopAll();
		});
		const stub = makeWakeBotSession("bot-shared", "native-shared-id");
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async () => ({
			session: stub.session,
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		const created = await router.createBotSession("Shared chat");
		if (!created.ok) throw new Error(created.error);
		const sessionId = created.entry.id;
		expect(await router.setActiveBotSession("wechat", "peer-a", sessionId, { threadId: "ta" })).toEqual({
			ok: true,
			id: sessionId,
		});
		expect(await router.setActiveBotSession("telegram", "peer-b", sessionId, { threadId: "tb" })).toEqual({
			ok: true,
			id: sessionId,
		});

		const bindings = config.getImBindings();
		expect(bindings).toHaveLength(2);
		expect(bindings.every(row => row.sessionId === sessionId)).toBe(true);
		const first = config.findImBinding("wechat", "peer-a", { threadId: "ta" })!;
		const second = config.findImBinding("telegram", "peer-b", { threadId: "tb" })!;
		expect(await router.ensureImBindingSession(first)).toEqual({ ok: true, id: sessionId });
		expect(await router.ensureImBindingSession(second)).toEqual({ ok: true, id: sessionId });
		const entry = config.getBotSession(sessionId);
		expect(entry).toBeDefined();
		expect(entry?.nativeSessionId).toBe("native-shared-id");
		expect(entry?.agentProfileId).toBe(PROFILE.id);
		expect(entry?.target).toEqual({ kind: "workspace", workspace: "main" });
		expect(config.getBotSessions().filter(row => row.sessionFile === entry?.sessionFile)).toHaveLength(1);

		expect(
			await router.deliverToBotSession(sessionId, "wechat", "peer-a", "from-a", {
				threadId: "ta",
				messageId: "platform-a",
			}),
		).toEqual({ ok: true });
		expect(
			await router.deliverToBotSession(sessionId, "telegram", "peer-b", "from-b", {
				threadId: "tb",
				messageId: "platform-b",
			}),
		).toEqual({ ok: true });
		expect(stub.pending.map(item => item.body)).toEqual(["from-a", "from-b"]);
		// Wake the queued turns in reverse delivery order: each reply must still
		// return to the chat/thread of the message it answers.
		stub.wake(stub.pending[1]!.id);
		stub.wake(stub.pending[0]!.id);
		expect(sent).toEqual([
			{
				channelId: "telegram",
				peer: "peer-b",
				text: "from-b-reply",
				options: { replyToMessageId: "platform-b", threadId: "tb" },
			},
			{
				channelId: "wechat",
				peer: "peer-a",
				text: "from-a-reply",
				options: { replyToMessageId: "platform-a", threadId: "ta" },
			},
		]);

		// Unbind exactly one entrance; the sibling and the transcript remain.
		await router.requestWorkspaceUnbind("wechat", "peer-a", { threadId: "ta" });
		expect((await router.confirmWorkspaceSwitch("wechat", "peer-a", { threadId: "ta" }, undefined)).ok).toBe(true);
		expect(stub.controls.map(control => control.metadata.action)).toEqual(["switch_request", "switch_confirm"]);
		expect(stub.controls[0]!.metadata).toMatchObject({
			source: "im_control",
			platform: "wechat",
			instance: "wechat",
			chatId: "peer-a",
			threadId: "ta",
			operation: "unbind",
			from: { sessionId, botSessionId: sessionId, workspaceAlias: "main", agentId: PROFILE.id },
			to: { workspaceAlias: "main" },
		});
		expect(await router.activeBotSessionIdFor("wechat", "peer-a", { threadId: "ta" })).toBeNull();
		expect(await router.activeBotSessionIdFor("telegram", "peer-b", { threadId: "tb" })).toBe(sessionId);
		expect(config.getBotSession(sessionId)).toBeDefined();

		// Restart roundtrip: reload the same web.yml and resolve the same entry.
		await router.stopAll();
		const reloaded = await WebConfig.load(configFile);
		expect(reloaded.getBotSession(sessionId)?.nativeSessionId).toBe("native-shared-id");
		expect(reloaded.findImBinding("telegram", "peer-b", { threadId: "tb" })?.sessionId).toBe(sessionId);
		const restarted = new SessionRouter({
			coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
			webConfig: reloaded,
			getLastInbound: () => null,
			sendText: async () => {},
			defaultCwd: configDir,
		});
		cleanups.push(async () => {
			await restarted.stopAll();
		});
		expect(await restarted.activeBotSessionIdFor("telegram", "peer-b", { threadId: "tb" })).toBe(sessionId);
		const stillThere = reloaded.findImBinding("telegram", "peer-b", { threadId: "tb" })!;
		expect(await restarted.ensureImBindingSession(stillThere)).toEqual({ ok: true, id: sessionId });
	});

	test("concurrent first deliveries start exactly one runtime per conversation", async () => {
		const config = await loadConfig("zeta-shared-coalesce-");
		const gate = Promise.withResolvers<void>();
		const stub = makeWakeBotSession("bot-coalesce", "native-coalesce");
		let factories = 0;
		const router = new SessionRouter({
			coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
			webConfig: config,
			getLastInbound: () => null,
			sendText: async () => {},
			defaultCwd: configDir,
			createBotSessionRuntime: async () => {
				factories += 1;
				await gate.promise;
				return stub.session;
			},
		});
		cleanups.push(async () => {
			await router.stopAll();
		});
		await config.upsertBotSession({
			id: "shared-coalesce",
			name: "Shared coalesce",
			tag: "bot",
			sessionFile: join(configDir, "shared-coalesce.jsonl"),
			cwd: configDir,
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		const entry = config.getBotSession("shared-coalesce")!;
		const first = router.ensureBotSession(entry);
		const second = router.ensureBotSession(entry);
		gate.resolve();
		const [a, b] = await Promise.all([first, second]);
		expect(factories).toBe(1);
		expect(a.ok).toBe(true);
		expect(b.ok).toBe(true);
		if (!a.ok || !b.ok) return;
		expect(a.session).toBe(stub.session);
		expect(b.session).toBe(stub.session);
		const settled = await router.ensureBotSession(entry);
		expect(settled).toEqual({ ok: true, session: stub.session });
		expect(factories).toBe(1);
	});

	test("a shared conversation refuses a conflicting remap instead of forking", async () => {
		const config = await loadConfig("zeta-shared-remap-");
		const router = new SessionRouter({
			coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
			webConfig: config,
			getLastInbound: () => null,
			sendText: async () => {},
			defaultCwd: configDir,
		});
		cleanups.push(async () => {
			await router.stopAll();
		});
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async () => ({
			session: makeWakeBotSession("bot-remap", "native-remap").session,
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		const created = await router.createBotSession("Remap chat");
		if (!created.ok) throw new Error(created.error);
		await router.setActiveBotSession("wechat", "peer-a", created.entry.id);
		await router.setActiveBotSession("telegram", "peer-b", created.entry.id);
		const shared = config.findImBinding("wechat", "peer-a")!;
		expect(await router.ensureImBindingSession(shared)).toEqual({ ok: true, id: created.entry.id });
		const result = await router.ensureImBindingSession({ ...shared, agentProfileId: ANALYST.id });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("cannot be remapped");
		expect(config.getBotSessions().filter(row => row.id === created.entry.id)).toHaveLength(1);
	});
});

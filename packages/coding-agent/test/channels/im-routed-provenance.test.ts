/**
 * Served/TUI IM routing writes a real `role: user` transcript row through the
 * real router + IrcBridge + SessionManager. No model call, no fake transcript.
 */

import { afterEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { YAML } from "bun";
import { setAgentDir } from "@linxiraos/pi-utils";
import type { IrcMessage } from "@linxiraos/pi-channels";
import { SessionRouter } from "../../src/channels/session-router";
import { WebConfig } from "../../src/config/web-config";
import { IrcBridge } from "../../src/session/irc-bridge";
import type { AgentSession } from "../../src/session/agent-session";
import { normalizeImMessageMetadata } from "../../src/session/session-im";
import { SessionManager } from "../../src/session/session-manager";
import * as sdk from "../../src/sdk";
import type { LoadExtensionsResult } from "../../src/extensibility/extensions/types";
import { EventBus } from "../../src/utils/event-bus";

const dirs: string[] = [];
const originalAgentDir = process.env.ZETA_CODING_AGENT_DIR;

afterEach(async () => {
	vi.restoreAllMocks();
	for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	if (originalAgentDir) setAgentDir(originalAgentDir);
	else delete process.env.ZETA_CODING_AGENT_DIR;
});

async function makeRouter(): Promise<{
	router: SessionRouter;
	webConfig: WebConfig;
	dir: string;
	deliveries: IrcMessage[];
	manager: SessionManager;
}> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-provenance-"));
	dirs.push(dir);
	const agentDir = path.join(dir, "agent");
	await fs.mkdir(agentDir, { recursive: true });
	setAgentDir(agentDir);
	const file = path.join(dir, "web.yml");
	await Bun.write(
		file,
		YAML.stringify({
			channels: {
				instances: [
					{
						id: "telegram",
						platform: "telegram",
						label: "Telegram",
						enabled: true,
						agentProfile: "mainp",
						allow: { peers: ["peer-a"] },
						credentials: { botToken: "t" },
					},
				],
			},
			imAgents: [
				{
					id: "mainp",
					label: "P",
					persona: { mode: "workspace" },
					location: { kind: "workspace", workspace: "main" },
					tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
					memory: {},
				},
			],
			remote: { workspaces: [{ alias: "other", path: dir }] },
		}),
	);
	const webConfig = await WebConfig.load(file);
	const manager = SessionManager.create(dir, path.join(dir, "sessions"));
	// A lazy new transcript is not written until an assistant row; a real relay
	// already has history, so seed the same state a restart would find.
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "relay ready" }],
		provider: "p",
		model: "m",
		timestamp: 0,
	} as never);

	const deliveries: IrcMessage[] = [];
	type Observer = (records: readonly unknown[]) => (() => void) | undefined;
	const observers = new Set<Observer>();
	const bridge = new IrcBridge({
		agent: {
			appendMessage: () => {},
			steer: () => {},
			emitExternalEvent: () => {},
		} as never,
		sessionManager: manager,
		isDisposed: () => false,
		isStreaming: () => false,
		planModeEnabled: () => false,
		emitSessionEvent: async () => {},
		wakeForIrc: (records: never[]) => {
			for (const observer of observers) observer(records);
		},
	});
	const session = {
		getAgentId: () => "bot-shared",
		subscribe: () => () => {},
		deliverIrcMessage: async (msg: IrcMessage) => {
			deliveries.push(msg);
			return bridge.deliver(msg);
		},
		setIrcWakeTurnObserver: (next: Observer | null) => {
			if (next) {
				observers.add(next);
				return () => observers.delete(next);
			}
			return () => {};
		},
		agent: {
			state: { systemPrompt: [] as string[] },
			setSystemPrompt: () => {},
		},
		sessionManager: manager,
		dispose: async () => {},
	} as unknown as AgentSession;
	vi.spyOn(sdk, "createAgentSession").mockImplementation(async () => ({
		session,
		extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
		setToolUIContext: () => {},
		eventBus: new EventBus(),
	}));

	const router = new SessionRouter({
		coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
		webConfig,
		getLastInbound: () => null,
		sendText: async () => {},
		defaultCwd: dir,
	});
	return { router, webConfig, dir, deliveries, manager };
}

describe("served IM provenance", () => {
	test("real user row carries sender/thread/time/attachments and an immutable route", async () => {
		const { router, webConfig, manager, deliveries } = await makeRouter();
		await router.ensureRelaySession(path.join(os.tmpdir(), "zeta-provenance-relay.jsonl"));
		const created = await router.createBotSession("shared");
		if (!created.ok) throw new Error(created.error);
		await webConfig.patchImBinding("telegram", "peer-a", {}, { threadId: "t1", userId: "u1" });
		const context = {
			threadId: "t1",
			userId: "u1",
			senderName: "Alice",
			messageId: "platform-42",
			sentAt: 1_700_000_000_000,
			attachments: [{ name: "note.txt", mime: "text/plain", size: 3 }],
		};
		const delivered = await router.deliverToBotSession(created.entry.id, "telegram", "peer-a", "hello", context);
		expect(delivered).toEqual({ ok: true });

		const userRow = manager
			.getEntries()
			.filter(entry => entry.type === "message" && entry.message.role === "user")
			.at(-1);
		if (!userRow || userRow.type !== "message") throw new Error("user row missing");
		const metadata = normalizeImMessageMetadata(userRow.metadata);
		expect(metadata).toMatchObject({
			source: "im",
			platform: "telegram",
			instance: "telegram",
			chatId: "peer-a",
			threadId: "t1",
			senderId: "u1",
			senderName: "Alice",
			messageId: "platform-42",
			sentAt: new Date(1_700_000_000_000).toISOString(),
			attachments: [{ name: "note.txt", mimeType: "text/plain", size: 3 }],
			route: { workspaceAlias: "main", agentId: "mainp" },
		});
		expect(userRow.message.content).toEqual([{ type: "text", text: "hello" }]);
		expect(deliveries[0]?.metadata?.messageId).toBe("platform-42");
		const initialRoute = metadata?.route;

		// A later switch must not rewrite the route already captured on the row.
		await router.requestWorkspaceSwitch(
			"telegram",
			"peer-a",
			{ kind: "workspace", workspace: "other" },
			{ threadId: "t1", userId: "u1" },
		);
		expect((await router.confirmWorkspaceSwitch("telegram", "peer-a", { threadId: "t1", userId: "u1" })).ok).toBe(
			true,
		);
		const reread = manager
			.getEntries()
			.filter(entry => entry.type === "message" && entry.message.role === "user")
			.at(-1);
		if (!reread || reread.type !== "message") throw new Error("user row missing after switch");
		expect(normalizeImMessageMetadata(reread.metadata)?.route).toEqual(initialRoute);
	});
});

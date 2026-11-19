/**
 * Served/TUI IM routing writes a real user transcript row when AgentSession
 * consumes the incoming message. Only the model provider is simulated.
 */

import { afterEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { YAML } from "bun";
import { Agent } from "@linxiraos/pi-agent-core";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { setAgentDir } from "@linxiraos/pi-utils";
import type { IrcMessage } from "@linxiraos/pi-channels";
import { SessionRouter } from "../../src/channels/session-router";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { WebConfig } from "../../src/config/web-config";
import { AgentSession } from "../../src/session/agent-session";
import { convertToLlm } from "../../src/session/messages";
import { normalizeImMessageMetadata } from "../../src/session/session-im";
import { SessionManager } from "../../src/session/session-manager";
import { createInMemoryAuthStorage } from "../helpers/agent-session-setup";

const dirs: string[] = [];
const cleanups: Array<() => void | Promise<void>> = [];
const originalAgentDir = process.env.ZETA_CODING_AGENT_DIR;

afterEach(async () => {
	vi.restoreAllMocks();
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
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
	session: AgentSession;
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

	const auth = createInMemoryAuthStorage();
	cleanups.push(() => auth.close());
	const model = createMockModel({ handler: () => ({ content: ["received"] }) });
	auth.keys.setRuntime(model.provider, "fixture-key");
	const session = new AgentSession({
		agent: new Agent({
			getApiKey: () => "fixture-key",
			initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
			convertToLlm,
			streamFn: model.stream,
		}),
		sessionManager: manager,
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry: new ModelRegistry(auth, path.join(dir, "models.yml")),
	});
	cleanups.push(() => session.dispose());
	const deliveries: IrcMessage[] = [];
	const deliver = session.deliverIrcMessage.bind(session);
	vi.spyOn(session, "deliverIrcMessage").mockImplementation(message => {
		deliveries.push(message);
		return deliver(message);
	});

	const router = new SessionRouter({
		coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
		webConfig,
		getLastInbound: () => null,
		sendText: async () => {},
		defaultCwd: dir,
		createBotSessionRuntime: async () => session,
	});
	cleanups.push(() => router.stopAll());
	return { router, webConfig, dir, deliveries, manager, session };
}

describe("served IM provenance", () => {
	test("real user row carries sender/thread/time/attachments and an immutable route", async () => {
		const { router, webConfig, dir, manager, deliveries, session } = await makeRouter();
		await router.ensureRelaySession(path.join(dir, "relay.jsonl"));
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
		await session.waitForIdle();

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
		if (!("content" in userRow.message)) throw new Error("user row has no content");
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

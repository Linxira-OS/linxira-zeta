/**
 * `!session list/use` are zero-AI commands scoped to the exact
 * instance/chat/thread/sender. One shared entrance may move to another
 * conversation without moving a sibling; success replies name the session and
 * its short selector, never its raw id.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { join } from "node:path";
import { getConfigRootDir, setAgentDir } from "@linxiraos/pi-utils";
import { SessionRouter } from "../../src/channels/session-router";
import { routeWorkspaceCommand, type WorkspaceRouterDeps } from "../../src/channels/workspace-router";
import { type BotSessionEntry, WebConfig } from "../../src/config/web-config";
import type { AgentSession } from "../../src/session/agent-session";

const PROFILE = {
	id: "companion",
	label: "Companion",
	persona: { mode: "workspace" as const },
	location: { kind: "workspace" as const, workspace: "main" },
	tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
	memory: {},
};
const INSTANCE = {
	id: "wechat",
	platform: "wechat" as const,
	label: "WeChat",
	enabled: true,
	agentProfile: PROFILE.id,
	allow: { peers: ["peer-a"] },
	credentials: {},
};

function binding(
	id: string,
	sessionId: string,
	opts: { threadId?: string; userId?: string; role?: "answer" | "mention" | "observe" } = {},
): Record<string, unknown> {
	return {
		id,
		instanceId: "wechat",
		platform: "wechat",
		chatId: "peer-a",
		...(opts.threadId ? { threadId: opts.threadId } : {}),
		...(opts.userId ? { userId: opts.userId } : {}),
		agentProfileId: PROFILE.id,
		sessionId,
		target: { kind: "workspace", workspace: "main" },
		role: opts.role ?? "answer",
		createdAt: "2026-01-01T00:00:00.000Z",
	};
}

function botSession(id: string, name: string, createdAt: string): BotSessionEntry {
	return {
		id,
		name,
		tag: "bot",
		sessionFile: join(tmpdir(), `zeta-shared-command-${id}.jsonl`),
		cwd: tmpdir(),
		target: { kind: "workspace", workspace: "main" },
		agentProfileId: PROFILE.id,
		createdAt,
	};
}

describe("!session commands across shared entrances", () => {
	const cleanups: Array<() => Promise<void>> = [];
	let testAgentDir: string;
	let configDir: string;
	const originalAgentDir = process.env.ZETA_CODING_AGENT_DIR;

	beforeAll(async () => {
		testAgentDir = await mkdtemp(join(tmpdir(), "zeta-shared-command-agent-"));
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

	async function setup() {
		configDir = await mkdtemp(join(tmpdir(), "zeta-shared-command-"));
		cleanups.push(() => rm(configDir, { recursive: true, force: true }));
		const configFile = join(configDir, "web.yml");
		await Bun.write(
			configFile,
			JSON.stringify({
				channels: { instances: [INSTANCE] },
				imAgents: [PROFILE],
				remote: {},
			}),
		);
		const config = await WebConfig.load(configFile);
		await config.upsertBotSession(
			botSession("shared-a", "Shared conversation A", new Date(Date.now() - 1000).toISOString()),
		);
		await config.upsertBotSession(botSession("other-b", "Other conversation B", new Date().toISOString()));
		await config.setImBindings([
			binding("b_0123456789abcdef", "shared-a", { threadId: "ta" }),
			binding("b_fedcba9876543210", "shared-a", { threadId: "tb", role: "mention" }),
			binding("b_aaaaaaaaaaaaaaaa", "shared-a", { threadId: "ta", userId: "u1", role: "mention" }),
		]);
		const manager = {
			getSessionId: () => "native-command",
			getOrigin: () => undefined,
			setOrigin: async () => {},
			getSessionName: () => "Other conversation B",
			setSessionName: async () => {},
		};
		const session = {
			sessionManager: manager,
			getAgentId: () => "bot-command",
			agent: { state: { systemPrompt: [] as string[] }, setSystemPrompt: () => {} },
			subscribe: () => () => {},
			setIrcWakeTurnObserver: () => {},
			dispose: async () => {},
		} as unknown as AgentSession;
		let starts = 0;
		const router = new SessionRouter({
			coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
			webConfig: config,
			getLastInbound: () => null,
			sendText: async () => {},
			defaultCwd: configDir,
			createBotSessionRuntime: async () => {
				starts += 1;
				return session;
			},
		});
		cleanups.push(async () => {
			await router.stopAll();
		});
		return { config, router, starts: () => starts };
	}

	function deps(
		router: SessionRouter,
		sent: Array<{ text: string; options?: { replyToMessageId?: string; threadId?: string } }>,
		context: { threadId?: string; userId?: string; messageId?: string } = {},
	): WorkspaceRouterDeps {
		return {
			router,
			channelId: "wechat",
			instanceId: "wechat",
			peer: "peer-a",
			...(context.threadId ? { threadId: context.threadId } : {}),
			...(context.userId ? { userId: context.userId } : {}),
			...(context.messageId ? { messageId: context.messageId } : {}),
			sendText: async (text, options) => {
				sent.push({ text, ...(options ? { options } : {}) });
			},
			fallback: async () => {},
			planRequest: async () => {},
		};
	}

	test("list/use switch only the exact thread, leave siblings, and name the target", async () => {
		const { config, router, starts } = await setup();
		const sent: Array<{ text: string; options?: { replyToMessageId?: string; threadId?: string } }> = [];
		const snapshot = await router.listSessionCandidates();
		const selectorB = snapshot.candidates.find(candidate => candidate.canonicalSessionId === "other-b")?.selector;
		const selectorA = snapshot.candidates.find(candidate => candidate.canonicalSessionId === "shared-a")?.selector;
		expect(selectorA).toBeDefined();
		expect(selectorB).toBeDefined();

		expect(
			await routeWorkspaceCommand(
				"!session list",
				"peer-a",
				deps(router, sent, { threadId: "ta", messageId: "m1" }),
			),
		).toBe(true);
		expect(sent[0]!.text).toContain(`${selectorA} Shared conversation A`);
		expect(sent[0]!.text).toContain("[当前]");
		expect(sent[0]!.options).toEqual({ threadId: "ta", replyToMessageId: "m1" });

		expect(
			await routeWorkspaceCommand(
				`!session use ${selectorB}`,
				"peer-a",
				deps(router, sent, { threadId: "ta", messageId: "m2" }),
			),
		).toBe(true);
		expect(config.findImBinding("wechat", "peer-a", { threadId: "ta" })?.sessionId).toBe("other-b");
		expect(config.findImBinding("wechat", "peer-a", { threadId: "tb" })?.sessionId).toBe("shared-a");
		// Same chat+thread but a different sender is a different entrance.
		expect(config.findImBinding("wechat", "peer-a", { threadId: "ta", userId: "u1" })?.sessionId).toBe("shared-a");
		expect(config.getBotSession("shared-a")).toBeDefined();
		expect(starts()).toBe(1);
		const success = sent[1]!;
		expect(success.text).toContain("Other conversation B");
		expect(success.text).toContain(selectorB!);
		expect(success.text).not.toContain("other-b");
		expect(success.options).toEqual({ threadId: "ta", replyToMessageId: "m2" });

		// Full-width `！` is the same command; switching back affects only this thread.
		expect(
			await routeWorkspaceCommand(
				`！session use ${selectorA}`,
				"peer-a",
				deps(router, sent, { threadId: "ta", messageId: "m3" }),
			),
		).toBe(true);
		expect(config.findImBinding("wechat", "peer-a", { threadId: "ta" })?.sessionId).toBe("shared-a");
		expect(config.findImBinding("wechat", "peer-a", { threadId: "tb" })?.sessionId).toBe("shared-a");
		expect(config.findImBinding("wechat", "peer-a", { threadId: "ta", userId: "u1" })?.sessionId).toBe("shared-a");
		expect(sent[2]!.text).toContain("Shared conversation A");
		expect(sent[2]!.text).not.toContain("shared-a");
	});
});

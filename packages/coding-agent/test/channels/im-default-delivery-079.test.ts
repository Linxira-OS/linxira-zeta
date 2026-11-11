/**
 * REQ-079: an instance may run without a PM; an unbound chat lands on the
 * default-workspace bot; ordinary repository agents appear only when the
 * operator explicitly binds them.
 */

import { afterEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { YAML } from "bun";
import { setAgentDir } from "@linxiraos/pi-utils";
import { SessionRouter } from "../../src/channels/session-router";
import { WebConfig } from "../../src/config/web-config";
import type { LoadExtensionsResult } from "../../src/extensibility/extensions/types";
import * as sdk from "../../src/sdk";
import type { AgentSession } from "../../src/session/agent-session";
import { EventBus } from "../../src/utils/event-bus";

const dirs: string[] = [];
const originalAgentDir = process.env.ZETA_CODING_AGENT_DIR;

afterEach(async () => {
	vi.restoreAllMocks();
	for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	if (originalAgentDir) setAgentDir(originalAgentDir);
	else delete process.env.ZETA_CODING_AGENT_DIR;
});

async function setup(): Promise<{ router: SessionRouter; config: WebConfig; defaultDir: string; repoDir: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-req079-"));
	dirs.push(root);
	const defaultDir = path.join(root, "default");
	const repoDir = path.join(root, "repo");
	await fs.mkdir(defaultDir, { recursive: true });
	await fs.mkdir(repoDir, { recursive: true });
	await fs.mkdir(path.join(root, "agent"), { recursive: true });
	setAgentDir(path.join(root, "agent"));
	const configFile = path.join(root, "web.yml");
	await Bun.write(
		configFile,
		YAML.stringify({
			channels: {
				instances: [
					{
						id: "telegram",
						platform: "telegram",
						label: "Telegram",
						enabled: true,
						agentProfile: "companion",
						allow: { peers: ["peer-a"] },
						credentials: { botToken: "t" },
					},
				],
			},
			imAgents: [
				{
					id: "companion",
					label: "Companion",
					persona: { mode: "workspace" },
					// No PM/team location: a new instance runs in the default workspace.
					location: { kind: "workspace", workspace: "main" },
					tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
					memory: {},
				},
			],
			remote: { workspaces: [{ alias: "repo", path: repoDir }] },
		}),
	);
	const config = await WebConfig.load(configFile);
	vi.spyOn(sdk, "createAgentSession").mockImplementation(async () => ({
		session: {
			getAgentId: () => "agent-default",
			subscribe: () => () => {},
			deliverIrcMessage: async () => "woken" as const,
			agent: { state: { systemPrompt: [] as string[] }, setSystemPrompt: () => {} },
			dispose: async () => {},
		} as unknown as AgentSession,
		extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
		setToolUIContext: () => {},
		eventBus: new EventBus(),
	}));
	const router = new SessionRouter({
		coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
		webConfig: config,
		getLastInbound: () => null,
		sendText: async () => {},
		defaultCwd: defaultDir,
	});
	await router.open(repoDir, "repo");
	return { router, config, defaultDir, repoDir };
}

describe("REQ-079 default IM delivery", () => {
	test("an instance without a PM resolves the default-workspace bot", async () => {
		const { router, config, defaultDir, repoDir } = await setup();
		expect(config.getImAgent("companion")?.location).toEqual({ kind: "workspace", workspace: "main" });

		const route = await router.resolveChatTarget("telegram", "unbound");
		expect(route).toMatchObject({ kind: "bot" });
		if (route.kind !== "bot") throw new Error("expected default bot");
		const entry = config.getBotSession(route.id);
		expect(entry?.cwd).toBe(defaultDir);
		expect(entry?.workspaceAlias).toBe("main");
		expect(entry?.target).toEqual({ kind: "workspace", workspace: "main" });
		expect(entry?.cwd).not.toBe(repoDir);
	});

	test("an unconfigured instance falls back to the relay, never a repository agent", async () => {
		const { router, repoDir } = await setup();
		expect(await router.resolveChatTarget("missing", "unbound")).toEqual({ kind: "relay" });
		// The repo is registered but never selected by default.
		expect(router.list().map(workspace => workspace.alias)).toEqual(["repo"]);
		expect(repoDir).toContain("repo");
	});

	test("an ordinary repo agent is reachable only through an explicit binding", async () => {
		const { router, config, repoDir } = await setup();
		expect(await router.resolveChatTarget("telegram", "unbound")).toMatchObject({ kind: "bot" });
		expect(await router.resolveChatTarget("telegram", "explicit")).toMatchObject({ kind: "bot" });

		expect(await router.bindChat("telegram", "explicit", "repo")).toEqual({ ok: true, alias: "repo" });
		const bound = await router.resolveChatTarget("telegram", "explicit");
		expect(bound).toMatchObject({ kind: "bot" });
		if (bound.kind !== "bot") throw new Error("expected bound repo session");
		expect(config.getBotSession(bound.id)?.cwd).toBe(repoDir);
		expect(config.getBotSession(bound.id)?.target).toEqual({ kind: "workspace", workspace: "repo" });
	});
});

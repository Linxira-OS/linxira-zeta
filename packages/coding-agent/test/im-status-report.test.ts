/**
 * D8 — `@status` answers which workspace this chat lands on, whether the route
 * is direct or relay, whether the persona is active, which memory backend the
 * workspace uses, and the report policy — without invoking a model.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SessionRouter } from "../src/channels/session-router";
import { routeWorkspaceCommand } from "../src/channels/workspace-router";
import { Settings } from "../src/config/settings";
import { WebConfig } from "../src/config/web-config";
import { initializeDefaultWorkspace } from "../src/default-workspace";
import type { LoadExtensionsResult } from "../src/extensibility/extensions/types";
import * as sdk from "../src/sdk";
import type { AgentSession } from "../src/session/agent-session";
import { EventBus } from "../src/utils/event-bus";

setDefaultTimeout(30_000);

describe("IM status report (D8)", () => {
	let workspace: string;
	let repo: string;
	let previousOverride: string | undefined;
	let router: SessionRouter;
	const sent: string[] = [];

	beforeEach(async () => {
		workspace = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-status-ws-"));
		repo = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-status-repo-"));
		previousOverride = process.env.ZETA_DEFAULT_WORKSPACE;
		process.env.ZETA_DEFAULT_WORKSPACE = workspace;
		await initializeDefaultWorkspace({ workspace });
		const webConfig = await WebConfig.load(
			path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zeta-status-cfg-")), "web.yml"),
		);
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async options => ({
			session: {
				getAgentId: () => `agent-${path.basename(options?.cwd ?? "")}`,
				subscribe: () => () => {},
				deliverIrcMessage: async () => "woken" as const,
				dispose: async () => {},
			} as unknown as AgentSession,
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		router = new SessionRouter({
			coordinator: {
				getAgentId: () => "coordinator",
				settings: Settings.isolated({ "channels.reportPolicy": "silent" }),
			} as unknown as AgentSession,
			webConfig,
			getLastInbound: () => null,
			sendText: async (_channel, _to, text) => {
				sent.push(text);
			},
			defaultCwd: workspace,
		});
		sent.length = 0;
		expect((await router.open(repo, "repo")).ok).toBe(true);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await router.stopAll();
		if (previousOverride === undefined) delete process.env.ZETA_DEFAULT_WORKSPACE;
		else process.env.ZETA_DEFAULT_WORKSPACE = previousOverride;
		fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
		fs.rmSync(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
	});

	test("relay chat reports default workspace, persona, mnemopi, and report policy", async () => {
		const status = await router.statusSnapshot("feishu", "peer-1");
		expect(status.route).toBe("relay");
		expect(status.workspaceDir).toBe(path.resolve(workspace));
		expect(status.personaActive).toBe(true);
		expect(status.memoryBackend).toBe("mnemopi");
		expect(status.reportPolicy).toBe("silent");
	});

	test("@status prints workspace, route, persona, memory, and report policy", async () => {
		await routeWorkspaceCommand("@status", "peer-1", {
			router,
			channelId: "feishu",
			peer: "peer-1",
			sendText: async text => {
				sent.push(text);
			},
			planRequest: async () => {},
			fallback: async () => {},
			channelStatus: () => [{ id: "feishu", running: true }],
		});
		const text = sent.join("\n");
		expect(text).toContain(`当前工作区: ${path.resolve(workspace)} (main)`);
		expect(text).toContain("路由: relay (main)");
		expect(text).toContain("人设: 生效");
		expect(text).toContain("记忆: mnemopi");
		expect(text).toContain("汇报策略: silent");
	});

	test("direct chat reports the repo and its off backend, no persona", async () => {
		expect((await router.bindChat("telegram", "peer-2", "repo")).ok).toBe(true);
		const status = await router.statusSnapshot("telegram", "peer-2");
		expect(status.route).toBe("direct");
		expect(status.workspaceAlias).toBe("repo");
		expect(status.workspaceDir).toBe(path.resolve(repo));
		expect(status.personaActive).toBe(false);
		expect(status.memoryBackend).toBe("off");
	});

	test("@status follows the settings merge when the project files disagree", async () => {
		// The legacy project file opts in; `config.yml` is merged on top of it and
		// turns memory off. A hand-rolled file probe would report mnemopi.
		fs.mkdirSync(path.join(repo, ".zeta"), { recursive: true });
		fs.writeFileSync(
			path.join(repo, ".zeta", "settings.json"),
			JSON.stringify({ memory: { backend: "mnemopi" } }),
			"utf8",
		);
		fs.writeFileSync(path.join(repo, ".zeta", "config.yml"), "memory:\n  backend: off\n", "utf8");
		expect((await router.bindChat("telegram", "peer-3", "repo")).ok).toBe(true);

		const status = await router.statusSnapshot("telegram", "peer-3");
		expect(status.memoryBackend).toBe("off");
		expect(status.memoryBackendSource).toBe("project");

		sent.length = 0;
		await routeWorkspaceCommand("@status", "peer-3", {
			router,
			channelId: "telegram",
			peer: "peer-3",
			sendText: async text => {
				sent.push(text);
			},
			planRequest: async () => {},
			fallback: async () => {},
			channelStatus: () => [{ id: "telegram", running: true }],
		});
		expect(sent.join("\n")).toContain("记忆: off (project)");
	});
});

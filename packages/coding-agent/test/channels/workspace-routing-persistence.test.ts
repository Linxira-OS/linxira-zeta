/**
 * Workspace routing persistence — what `@workspace use` / `@workspace relay` /
 * `!lang` leave in web.yml, and whether the GUI can still round-trip it.
 *
 * `@workspace use` is a runtime override; `!lang` (and `!session use`) persist
 * session-only rows that carry no `workspaceAlias`. Those rows must validate,
 * because the GUI writes the whole `remote.sessionMappings` array back through
 * `PUT /api/web-config` — a row the router wrote must never 400 that PUT.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { SessionRouter } from "../../src/channels/session-router";
import { routeWorkspaceCommand, type WorkspaceRouterDeps } from "../../src/channels/workspace-router";
import { WebConfig } from "../../src/config/web-config";
import type { LoadExtensionsResult } from "../../src/extensibility/extensions/types";
import * as sdk from "../../src/sdk";
import type { AgentSession } from "../../src/session/agent-session";
import { EventBus } from "../../src/utils/event-bus";
import { handleWebConfigPut } from "../../src/server/web-gateway/web-config";

describe("workspace routing persistence", () => {
	let agentDir: string;
	let repo: string;
	let webConfig: WebConfig;
	let router: SessionRouter;
	let sent: string[];
	let savedAgentDir: string | undefined;

	beforeEach(async () => {
		agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-routing-persist-"));
		repo = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-routing-repo-"));
		savedAgentDir = process.env.ZETA_CODING_AGENT_DIR;
		process.env.ZETA_CODING_AGENT_DIR = agentDir;
		refreshDirsFromEnv();
		WebConfig.resetShared();
		webConfig = await WebConfig.load(path.join(agentDir, "web.yml"));
		sent = [];
		router = new SessionRouter({
			coordinator: { getAgentId: () => "coordinator" } as unknown as AgentSession,
			webConfig,
			getLastInbound: () => ({ channelId: "feishu", peer: "peer-1" }),
			sendText: async (_channel, _to, text) => {
				sent.push(text);
			},
		});
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
		expect((await router.open(repo, "repo")).ok).toBe(true);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await router.stopAll();
		WebConfig.resetShared();
		if (savedAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
		else process.env.ZETA_CODING_AGENT_DIR = savedAgentDir;
		refreshDirsFromEnv();
		fs.rmSync(agentDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
		fs.rmSync(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
	});

	function deps(): WorkspaceRouterDeps {
		return {
			router,
			channelId: "feishu",
			peer: "peer-1",
			sendText: async text => {
				sent.push(text);
			},
			planRequest: async () => {},
			fallback: async () => {},
			channelStatus: () => [],
		};
	}

	test("@workspace relay drops the bot-session pointer so inbound goes to the coordinator", async () => {
		// A chat that was pointed at a default-space bot session.
		await webConfig.updateChatMapping("feishu", "peer-1", { sessionId: "abc123" });
		expect(await router.activeBotSessionIdFor("feishu", "peer-1")).toBe("abc123");

		expect(await routeWorkspaceCommand("@workspace relay", "peer-1", deps())).toBe(true);
		expect(await router.activeBotSessionIdFor("feishu", "peer-1")).toBeNull();
		// The inbound bridge's two decisions after a relay switch.
		expect(await router.resolveChatTarget("feishu", "peer-1")).toEqual({ kind: "relay" });
		expect(await router.resolveRoute("feishu", "peer-1")).toBe("relay");
	});

	test("@workspace use then relay then !lang round-trips through a full-array PUT", async () => {
		expect(await routeWorkspaceCommand("@workspace use repo", "peer-1", deps())).toBe(true);
		expect(await router.resolveChatTarget("feishu", "peer-1")).toEqual({ kind: "workspace", alias: "repo" });

		expect(await routeWorkspaceCommand("@workspace relay", "peer-1", deps())).toBe(true);
		expect(await router.resolveChatTarget("feishu", "peer-1")).toEqual({ kind: "relay" });

		expect(await routeWorkspaceCommand("!lang zh", "peer-1", deps())).toBe(true);
		expect(await router.languageFor("feishu", "peer-1")).toBe("zh");

		// The router wrote a session-only row; the GUI reads the array and PUTs
		// it back whole. Nothing the router persisted may be rejected.
		const rows = (await WebConfig.load(path.join(agentDir, "web.yml"))).getSessionMappings();
		expect(rows).toEqual([{ platform: "feishu", chatId: "peer-1", lang: "zh" }]);
		const response = await handleWebConfigPut(
			new Request("http://gateway/api/web-config", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path: "remote.sessionMappings", value: rows }),
			}),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });

		// `@workspace use` still wins over the persisted row on the next message.
		expect(await routeWorkspaceCommand("@workspace use repo", "peer-1", deps())).toBe(true);
		expect(await router.resolveChatTarget("feishu", "peer-1")).toEqual({ kind: "workspace", alias: "repo" });
	});

	test("clearing a chat's last session field does not leave an empty row", async () => {
		await webConfig.updateChatMapping("feishu", "peer-1", { sessionId: "abc123" });
		await webConfig.updateChatMapping("feishu", "peer-1", { sessionId: null });
		expect((await WebConfig.load(path.join(agentDir, "web.yml"))).getSessionMappings()).toEqual([]);
	});
});

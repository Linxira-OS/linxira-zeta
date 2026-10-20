/**
 * D8c — the three landing sources resolve to one workspace each:
 *   - a chat with no repository selected → the default workspace (relay),
 *   - an IM bot chat → the default workspace (relay) unless it switches,
 *   - an explicit repository selection → that repository (direct).
 * Unknown aliases never guess: the chat stays on relay.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SessionRouter } from "../src/channels/session-router";
import { routeWorkspaceCommand } from "../src/channels/workspace-router";
import { Settings } from "../src/config/settings";
import { WebConfig } from "../src/config/web-config";
import type { LoadExtensionsResult } from "../src/extensibility/extensions/types";
import * as sdk from "../src/sdk";
import type { AgentSession } from "../src/session/agent-session";
import { EventBus } from "../src/utils/event-bus";

setDefaultTimeout(30_000);

function stubSession(agentId: string): AgentSession {
	return {
		getAgentId: () => agentId,
		subscribe: () => () => {},
		deliverIrcMessage: async () => "woken" as const,
		dispose: async () => {},
	} as unknown as AgentSession;
}

describe("landing rules (D8c)", () => {
	let defaultWorkspace: string;
	let repo: string;
	let webConfig: WebConfig;
	let router: SessionRouter;
	const sent: string[] = [];

	beforeEach(async () => {
		defaultWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-landing-main-"));
		repo = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-landing-repo-"));
		webConfig = await WebConfig.load(
			path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zeta-landing-cfg-")), "web.yml"),
		);
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async options => ({
			session: stubSession(`agent-${path.basename(options?.cwd ?? "")}`),
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		router = new SessionRouter({
			coordinator: {
				getAgentId: () => "coordinator",
				settings: Settings.isolated(),
			} as unknown as AgentSession,
			webConfig,
			getLastInbound: () => null,
			sendText: async (_channel, _to, text) => {
				sent.push(text);
			},
			defaultCwd: defaultWorkspace,
		});
		sent.length = 0;
		const opened = await router.open(repo, "repo");
		expect(opened.ok).toBe(true);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await router.stopAll();
		fs.rmSync(defaultWorkspace, { recursive: true, force: true });
		fs.rmSync(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
	});

	test("a chat with no repository selected lands on the default workspace via relay", async () => {
		expect(await router.resolveRoute("feishu", "unknown-peer")).toBe("relay");
		const snapshot = await router.statusSnapshot("feishu", "unknown-peer");
		expect(snapshot.route).toBe("relay");
		expect(snapshot.workspaceAlias).toBeNull();
		expect(snapshot.workspaceDir).toBe(path.resolve(defaultWorkspace));
	});

	test("an IM bot chat switches to a repo with @workspace use and back with @workspace relay", async () => {
		const deps = {
			router,
			channelId: "feishu",
			peer: "im-peer",
			sendText: async (text: string) => {
				sent.push(text);
			},
			planRequest: async () => {},
			fallback: async () => {},
		};

		expect(await routeWorkspaceCommand("@workspace use repo", "im-peer", deps)).toBe(true);
		expect(await router.resolveRoute("feishu", "im-peer")).toBe("direct");
		expect((await router.statusSnapshot("feishu", "im-peer")).workspaceDir).toBe(path.resolve(repo));

		expect(await routeWorkspaceCommand("@workspace relay", "im-peer", deps)).toBe(true);
		expect(await router.resolveRoute("feishu", "im-peer")).toBe("relay");
	});

	test("an explicit persisted binding selects that repository (direct)", async () => {
		const bound = await router.bindChat("telegram", "tg-peer", "repo");
		expect(bound.ok).toBe(true);
		expect(await router.resolveRoute("telegram", "tg-peer")).toBe("direct");

		await router.unbindChat("telegram", "tg-peer");
		expect(await router.resolveRoute("telegram", "tg-peer")).toBe("relay");
	});

	test("an unknown alias never guesses; the chat stays on relay", async () => {
		const deps = {
			router,
			channelId: "wechat",
			peer: "wx-peer",
			sendText: async (text: string) => {
				sent.push(text);
			},
			planRequest: async () => {},
			fallback: async () => {},
		};
		expect(await routeWorkspaceCommand("@workspace use nope", "wx-peer", deps)).toBe(true);
		expect(await router.resolveRoute("wechat", "wx-peer")).toBe("relay");
		expect(sent.join("\n")).toContain("Unknown workspace");
	});
});

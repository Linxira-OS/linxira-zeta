/**
 * Scenario S4 — IM chat agent targeting. `@agent use` writes a runtime
 * override that beats the workspace binding; clearing it falls back; an
 * unknown or ambiguous id reports candidates. `@team` routes to a team's host
 * agent (the team plugin installs the mapping; here it is a fake).
 */

import { afterEach, describe, expect, test, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { join } from "node:path";
import { SessionRouter, COORDINATOR_ALIAS, type AgentTargetInfo } from "../src/channels/session-router";
import { routeWorkspaceCommand, type WorkspaceRouterDeps } from "../src/channels/workspace-router";
import { WebConfig } from "../src/config/web-config";
import type { AgentSession } from "../src/session/agent-session";
import * as sdk from "../src/sdk";
import type { LoadExtensionsResult } from "../src/extensibility/extensions/types";
import { EventBus } from "../src/utils/event-bus";

const AGENTS: AgentTargetInfo[] = [
	{ address: "Main", id: "Main", role: "main", status: "running", local: true },
	{ address: "zeta/Main", id: "Main", role: "main", status: "running", workspaceAlias: "zeta", local: false },
	{ address: "alpha/worker", id: "worker", role: "sub", status: "idle", workspaceAlias: "alpha", local: false },
	{ address: "beta/worker", id: "worker", role: "sub", status: "idle", workspaceAlias: "beta", local: false },
];

function makeCoordinator(): AgentSession {
	return {
		getAgentId: () => "Main",
		deliverIrcMessage: async () => "injected" as const,
	} as unknown as AgentSession;
}

function makeStubSession(id: string): AgentSession {
	return {
		getAgentId: () => id,
		subscribe: () => () => {},
		deliverIrcMessage: async () => "woken" as const,
		dispose: async () => {},
	} as unknown as AgentSession;
}

describe("session-router agent target (S4)", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	});

	async function makeRouter(): Promise<{ router: SessionRouter; sent: string[] }> {
		const webConfig = await WebConfig.load(join(await mkdtemp(join(tmpdir(), "zeta-agent-target-")), "web.yml"));
		const sent: string[] = [];
		const router = new SessionRouter({
			coordinator: makeCoordinator(),
			webConfig,
			getLastInbound: () => null,
			sendText: async text => {
				sent.push(text);
			},
			listAgentTargets: () => AGENTS,
			listTeams: () => ["build"],
			resolveTeamHost: name => (name === "build" ? "zeta/Main" : undefined),
		});
		cleanups.push(() => router.stopAll());
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async options => ({
			session: makeStubSession(`agent-${path.basename(options?.cwd ?? "")}`),
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		return { router, sent };
	}

	function deps(router: SessionRouter, sent: string[]): WorkspaceRouterDeps {
		return {
			router,
			channelId: "feishu",
			peer: "chat-1",
			sendText: async text => {
				sent.push(text);
			},
			fallback: async () => {},
			planRequest: async () => {},
		};
	}

	test("`@agent use` overrides the workspace binding and `@agent use` alone clears it", async () => {
		const { router, sent } = await makeRouter();
		const dir = await mkdtemp(join(tmpdir(), "zeta-target-ws-"));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		expect((await router.open(dir)).ok).toBe(true);
		await router.setRuntimeBinding("feishu", "chat-1", path.basename(dir));

		expect(await router.resolveChatTarget("feishu", "chat-1")).toEqual({
			kind: "workspace",
			alias: path.basename(dir),
		});

		expect(await routeWorkspaceCommand("@agent use zeta/Main", "chat-1", deps(router, sent))).toBe(true);
		expect(router.agentTargetFor("feishu", "chat-1")).toBe("zeta/Main");
		expect(await router.resolveChatTarget("feishu", "chat-1")).toEqual({
			kind: "agent",
			target: "zeta/Main",
			local: false,
		});
		expect(sent.at(-1)).toContain("zeta/Main");

		expect(await routeWorkspaceCommand("@agent use", "chat-1", deps(router, sent))).toBe(true);
		expect(router.agentTargetFor("feishu", "chat-1")).toBeUndefined();
		expect(await router.resolveChatTarget("feishu", "chat-1")).toEqual({
			kind: "workspace",
			alias: path.basename(dir),
		});

		await router.setRuntimeBinding("feishu", "chat-1", COORDINATOR_ALIAS);
		expect(await router.resolveChatTarget("feishu", "chat-1")).toEqual({ kind: "relay" });
	});

	test("an unknown id reports candidates and leaves routing untouched", async () => {
		const { router, sent } = await makeRouter();
		expect(await routeWorkspaceCommand("@agent use ghost", "chat-1", deps(router, sent))).toBe(true);
		expect(router.agentTargetFor("feishu", "chat-1")).toBeUndefined();
		expect(sent.at(-1)).toMatch(/Unknown agent "ghost"/);
		expect(sent.at(-1)).toContain("zeta/Main");
	});

	test("a bare id owned by two workspaces is ambiguous, never picked arbitrarily", async () => {
		const { router, sent } = await makeRouter();
		expect(await routeWorkspaceCommand("@agent use worker", "chat-1", deps(router, sent))).toBe(true);
		expect(router.agentTargetFor("feishu", "chat-1")).toBeUndefined();
		expect(sent.at(-1)).toMatch(/Ambiguous agent "worker"/);
		expect(sent.at(-1)).toContain("alpha/worker");
		expect(sent.at(-1)).toContain("beta/worker");
	});

	test("`@agent list` prints local and remote agents with role/status", async () => {
		const { router, sent } = await makeRouter();
		expect(await routeWorkspaceCommand("@agent list", "chat-1", deps(router, sent))).toBe(true);
		const output = sent.at(-1) ?? "";
		expect(output).toContain("Main [main · running] — local");
		expect(output).toContain("zeta/Main [main · running] — workspace zeta");
		expect(output).toContain("This chat → relay coordinator (main)");
	});

	test("`@team build` routes to the fake host agent; unknown teams list the available ones", async () => {
		const { router, sent } = await makeRouter();
		expect(await routeWorkspaceCommand("@team build", "chat-1", deps(router, sent))).toBe(true);
		expect(router.agentTargetFor("feishu", "chat-1")).toBe("zeta/Main");

		expect(await routeWorkspaceCommand("@team nope", "chat-1", deps(router, sent))).toBe(true);
		expect(sent.at(-1)).toMatch(/Unknown team "nope"/);
		expect(sent.at(-1)).toContain("build");
		// The failed lookup did not change the previous routing decision.
		expect(router.agentTargetFor("feishu", "chat-1")).toBe("zeta/Main");
	});
});

/**
 * Workspace router command contracts — `@workspace` management commands plus
 * the remote `@plan <title>` trigger.
 */
import { describe, expect, test } from "bun:test";
import { routeWorkspaceCommand, type WorkspaceRouterDeps } from "../../src/channels/workspace-router";

function makeDeps(overrides: Partial<WorkspaceRouterDeps> = {}): {
	deps: WorkspaceRouterDeps;
	calls: {
		sent: string[];
		opened: string[];
		listed: number;
		plans: string[];
		fallbacks: { body: string; peer: string }[];
	};
} {
	const calls = {
		sent: [] as string[],
		opened: [] as string[],
		listed: 0,
		plans: [] as string[],
		fallbacks: [] as { body: string; peer: string }[],
	};
	const deps: WorkspaceRouterDeps = {
		listWorkspaces: () => {
			calls.listed += 1;
			return [];
		},
		registerWorkspace: () => {},
		unregisterWorkspace: () => {},
		openWorkspaceSession: async dir => {
			calls.opened.push(dir);
		},
		closeWorkspaceSession: async () => {},
		sendText: async text => {
			calls.sent.push(text);
		},
		fallback: async (body, peer) => {
			calls.fallbacks.push({ body, peer });
		},
		planRequest: async title => {
			calls.plans.push(title);
		},
		...overrides,
	};
	return { deps, calls };
}

describe("routeWorkspaceCommand", () => {
	test("@plan <title> triggers planRequest with the title and acks without fallback", async () => {
		const { deps, calls } = makeDeps();
		await routeWorkspaceCommand("@plan 优化登录流程", "peer-1", deps);

		expect(calls.plans).toEqual(["优化登录流程"]);
		expect(calls.sent).toContain("已开始制定计划…");
		expect(calls.fallbacks).toEqual([]);
	});

	test("@plan without a title prints usage and never starts a plan", async () => {
		const { deps, calls } = makeDeps();
		await routeWorkspaceCommand("@plan", "peer-1", deps);

		expect(calls.plans).toEqual([]);
		expect(calls.sent).toContain("Usage: @plan <task title>");
	});

	test("plain messages still route through fallback", async () => {
		const { deps, calls } = makeDeps();
		await routeWorkspaceCommand("hello world", "peer-2", deps);

		expect(calls.fallbacks).toEqual([{ body: "hello world", peer: "peer-2" }]);
		expect(calls.plans).toEqual([]);
	});

	test("@workspace list keeps its existing contract", async () => {
		const dirs = ["/a", "/b"];
		const { deps, calls } = makeDeps({ listWorkspaces: () => dirs });
		await routeWorkspaceCommand("@workspace list", "peer-1", deps);

		expect(calls.sent).toEqual(["Registered workspaces:\n  /a\n  /b"]);
		expect(calls.plans).toEqual([]);
		expect(calls.fallbacks).toEqual([]);
	});

	test("@workspace open registers and opens the directory", async () => {
		const { mkdtemp } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const dir = await mkdtemp(join(tmpdir(), "zeta-ws-"));
		const { deps, calls } = makeDeps();
		await routeWorkspaceCommand(`@workspace open ${dir}`, "peer-1", deps);

		expect(calls.opened).toEqual([dir]);
		expect(calls.sent).toEqual([`Workspace opened: ${dir}`]);
	});
});

import { parsePlanApprovalReply } from "../../src/server/zeta-server";

describe("parsePlanApprovalReply", () => {
	test("maps numeric replies to approval modes", () => {
		expect(parsePlanApprovalReply("1")).toBe("preserve");
		expect(parsePlanApprovalReply("2")).toBe("compact");
		expect(parsePlanApprovalReply("3")).toBe("fresh");
		expect(parsePlanApprovalReply("4")).toBe("cancel");
	});

	test("rejects non-matching or padded replies", () => {
		expect(parsePlanApprovalReply("5")).toBeNull();
		expect(parsePlanApprovalReply("12")).toBeNull();
		expect(parsePlanApprovalReply("执行")).toBeNull();
		expect(parsePlanApprovalReply("")).toBeNull();
	});
});

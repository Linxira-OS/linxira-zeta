import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@linxiraos/zeta/config/settings";
import { createAnalysisMcpApprovalAdapter } from "@linxiraos/zeta/mcp/analysis-precedence-approval";
import {
	buildAnalysisMcpRefreshInputFromRuntime,
	createAnalysisMcpPrecedenceHook,
	type AnalysisMcpToolLike,
} from "@linxiraos/zeta/mcp/analysis-precedence-hook";
import type { AnalysisMcpManifest, McpPrecedence } from "@linxiraos/zeta/mcp/analysis-precedence";
import type { MCPServerConfig } from "@linxiraos/zeta/mcp/types";

const manifest: AnalysisMcpManifest = {
	id: "graph",
	label: "Graph",
	serverNames: ["graph"],
	packageNames: ["@example/graph"],
	markerPaths: [".graph"],
	nativeTools: ["ast_grep"],
	tools: ["explore"],
};
const config: MCPServerConfig = { type: "stdio", command: "graph", args: ["@example/graph"] };
const tool = (server: string): AnalysisMcpToolLike => ({
	name: `mcp__${server}__explore`,
	mcpServerName: server,
	mcpToolName: "explore",
});

describe("analysis MCP caller snapshots", () => {
	let cwd: string;
	beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-mcp-caller-")); });
	afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

	async function snapshot(precedence: McpPrecedence, activeNativeTools: readonly string[] = ["ast_grep"]) {
		const tools = [tool("graph")];
		return buildAnalysisMcpRefreshInputFromRuntime({
			manager: { getTools: () => tools, getServerConfig: () => config, getAllServerNames: () => ["graph"] },
			settings: Settings.isolated({ "mcp.precedence": precedence }),
			cwd,
			activeNativeTools,
			deniedServers: [],
			manifests: [manifest],
		});
	}

	test("reads settings and selects native, MCP, or an unanswered ask", async () => {
		const native = createAnalysisMcpPrecedenceHook(await snapshot("native"));
		expect(native.filterTools([tool("graph")])).toEqual([]);
		expect(native.decisions[0]?.state).toBe("shadowed-native");
		const mcp = createAnalysisMcpPrecedenceHook(await snapshot("mcp"));
		expect(mcp.filterTools([tool("graph")])).toEqual([tool("graph")]);
		expect(mcp.nativeToolsToSuppress).toEqual(["ast_grep"]);
		const ask = createAnalysisMcpPrecedenceHook(await snapshot("ask"));
		expect(ask.filterTools([tool("graph")])).toEqual([]);
		expect(ask.approvalRequests).toHaveLength(1);
		expect(createAnalysisMcpApprovalAdapter(undefined)).toBeUndefined();
	});

	test("a disabled native tool cannot shadow MCP", async () => {
		const hook = createAnalysisMcpPrecedenceHook(await snapshot("native", []));
		expect(hook.filterTools([tool("graph")])).toEqual([tool("graph")]);
		expect(hook.nativeToolsToSuppress).toEqual([]);
	});

	test("a denied alias sharing a raw name cannot win the duplicate capability", async () => {
		const tools = [tool("denied"), tool("allowed")];
		const input = await buildAnalysisMcpRefreshInputFromRuntime({
			manager: { getTools: () => tools, getServerConfig: () => config, getAllServerNames: () => ["denied", "allowed"] },
			settings: Settings.isolated({ "mcp.precedence": "mcp" }),
			cwd,
			activeNativeTools: [],
			deniedServers: [],
			admission: { allowsMcpTool: (_name, server) => server === "allowed" },
			manifests: [manifest],
		});
		expect(input.serverTools).toEqual({ denied: ["explore"], allowed: ["explore"] });
		expect(input.allowedServerTools).toEqual({ allowed: ["explore"] });
		const hook = createAnalysisMcpPrecedenceHook(input);
		expect(hook.decisions.map(decision => decision.state)).toEqual(["shadowed-profile", "mounted"]);
		expect(hook.filterTools(tools)).toEqual([tool("allowed")]);
	});

	test("only one allowed provider of a capability mounts", async () => {
		const tools = [tool("first"), tool("second")];
		const input = await buildAnalysisMcpRefreshInputFromRuntime({
			manager: { getTools: () => tools, getServerConfig: () => config, getAllServerNames: () => ["first", "second"] },
			settings: Settings.isolated(), cwd, activeNativeTools: [], deniedServers: [], manifests: [manifest],
		});
		const hook = createAnalysisMcpPrecedenceHook(input);
		expect(hook.filterTools(tools)).toEqual([tool("first")]);
		expect(hook.decisions[1]?.state).toBe("shadowed-duplicate");
	});

	for (const outcome of ["approve", "deny", "throw"] as const) {
		test(`existing approval ${outcome} controls ask mounting`, async () => {
			const hook = createAnalysisMcpPrecedenceHook(await snapshot("ask"));
			const reasons = hook.shadowReasons;
			const approve = createAnalysisMcpApprovalAdapter({
				select: async title => {
					expect(title).toContain("Allow tool: mcp__graph");
					if (outcome === "throw") throw new Error("UI disconnected");
					return outcome === "approve" ? "Approve" : "Deny";
				},
			})!;
			const request = hook.approvalRequests[0]!;
			try {
				if (await approve(request)) hook.approve(request.serverName);
			} catch (error) {
				expect(outcome).toBe("throw");
				expect(String(error)).toContain("UI disconnected");
			}
			expect(hook.filterTools([tool("graph")])).toEqual(outcome === "approve" ? [tool("graph")] : []);
			expect(hook.nativeToolsToSuppress).toEqual(outcome === "approve" ? ["ast_grep"] : []);
			expect(reasons.graph === undefined).toBe(outcome === "approve");
			expect(hook.decisions[0]?.state).toBe(outcome === "approve" ? "mounted" : "ask");
			expect(hook.decisions[0]?.reason).toContain(outcome === "approve" ? "approved ask" : "approval required");
			// A reconnect/list_changed gets a new hook and never reuses an approval.
			expect(createAnalysisMcpPrecedenceHook(await snapshot("ask")).filterTools([tool("graph")])).toEqual([]);
		});
	}

	test("an explicit tools snapshot pins what the builder reads and the caller binds", async () => {
		const live = [tool("graph")];
		const input = await buildAnalysisMcpRefreshInputFromRuntime({
			manager: { getTools: () => live, getServerConfig: () => config, getAllServerNames: () => ["graph"] },
			settings: Settings.isolated(),
			cwd,
			activeNativeTools: [],
			deniedServers: [],
			manifests: [manifest],
			tools: [],
		});
		expect(input.serverTools).toEqual({});
		expect(input.configs.graph).toEqual(config);
	});

	test("refresh rereads tools, denylist, project signals, and toolless configs", async () => {
		let tools = [tool("graph")];
		let denied: readonly string[] = [];
		const options = {
			manager: { getTools: () => tools, getServerConfig: () => config, getAllServerNames: () => ["graph"] },
			settings: Settings.isolated(), cwd, activeNativeTools: [], manifests: [manifest],
			readDeniedServers: async () => denied,
		};
		const first = createAnalysisMcpPrecedenceHook(await buildAnalysisMcpRefreshInputFromRuntime(options));
		expect(first.filterTools(tools)).toHaveLength(1);
		denied = ["graph"];
		fs.mkdirSync(path.join(cwd, ".graph"));
		const second = await buildAnalysisMcpRefreshInputFromRuntime(options);
		expect(second.project?.markerPaths).toEqual([".graph"]);
		expect(createAnalysisMcpPrecedenceHook(second).filterTools(tools)).toEqual([]);
		tools = [];
		const third = await buildAnalysisMcpRefreshInputFromRuntime(options);
		expect(third.configs.graph).toEqual(config);
		expect(third.serverTools).toEqual({});
	});
});

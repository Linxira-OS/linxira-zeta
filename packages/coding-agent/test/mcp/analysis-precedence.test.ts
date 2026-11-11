/**
 * Analysis-MCP recognition/collision policy. Pure fixtures only: no package
 * install, process spawn, or real MCP connection. The manager integration smoke
 * (list/change/filter against a local stdio fixture) runs separately after the
 * tool-scope hook lands.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	ANALYSIS_MCP_MANIFESTS,
	analysisMcpNativeToolsToSuppress,
	analysisMcpReasons,
	filterAnalysisMcpTools,
	inspectProjectAnalysisMcp,
	readAnalysisMcpShadowReasons,
	resolveAnalysisMcp,
	type AnalysisMcpManifest,
	type AnalysisMcpResolveInput,
} from "@linxiraos/zeta/mcp/analysis-precedence";
import { buildAnalysisMcpRefreshInput } from "@linxiraos/zeta/mcp/analysis-precedence-hook";
import type { MCPServerConfig } from "@linxiraos/zeta/mcp/types";

const CODEGRAPH = "@colbymchenry/codegraph";

function codegraphConfig(command = "bun"): MCPServerConfig {
	return { type: "stdio", command, args: ["-y", CODEGRAPH, "mcp"] };
}

function input(overrides: Partial<AnalysisMcpResolveInput> = {}): AnalysisMcpResolveInput {
	return {
		configs: { codegraph: codegraphConfig() },
		precedence: "native",
		activeNativeTools: [],
		...overrides,
	};
}

const NATIVE_MANIFEST: AnalysisMcpManifest = {
	id: "codegraph",
	label: "CodeGraph",
	serverNames: ["codegraph"],
	packageNames: [CODEGRAPH],
	markerPaths: [".codegraph"],
	nativeTools: ["ast_grep"],
	tools: ["codegraph_explore"],
};

describe("analysis MCP recognition", () => {
	test("a declared CodeGraph server mounts when no native equivalent is active", () => {
		const [decision] = resolveAnalysisMcp(input());

		expect(decision.state).toBe("mounted");
		expect(decision.mount).toBe(true);
		expect(decision.serverName).toBe("codegraph");
		expect(decision.tools).toEqual(["codegraph_explore"]);
	});

	test("a declared package/marker without a server is detected, never available", () => {
		const [decision] = resolveAnalysisMcp(
			input({
				configs: {},
				project: { packageNames: [CODEGRAPH], markerPaths: [".codegraph"] },
			}),
		);

		expect(decision.state).toBe("detected");
		expect(decision.configured).toBe(false);
		expect(decision.mount).toBe(false);
		expect(decision.reason).toContain("never installs or starts it automatically");
	});

	test("no signal stays unconfigured", () => {
		const [decision] = resolveAnalysisMcp(input({ configs: {} }));
		expect(decision.state).toBe("unconfigured");
		expect(decision.mount).toBe(false);
	});

	test("inspection reads declarations, installed package metadata, and markers without executing anything", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-analysis-inspect-"));
		try {
			fs.writeFileSync(
				path.join(root, "package.json"),
				JSON.stringify({ dependencies: { [CODEGRAPH]: "^1.0.0" } }),
			);
			fs.mkdirSync(path.join(root, ".codegraph"));
			fs.mkdirSync(path.join(root, "node_modules", ...CODEGRAPH.split("/")), { recursive: true });
			fs.writeFileSync(
				path.join(root, "node_modules", ...CODEGRAPH.split("/"), "package.json"),
				JSON.stringify({ name: CODEGRAPH, version: "1.0.0" }),
			);

			const signals = await inspectProjectAnalysisMcp(root);
			expect(signals.packageNames).toContain(CODEGRAPH);
			expect(signals.markerPaths).toContain(".codegraph");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("analysis MCP collision policy", () => {
	test("active native equivalent wins by default and marks the MCP server shadowed", () => {
		const [decision] = resolveAnalysisMcp(
			input({ manifests: [NATIVE_MANIFEST], activeNativeTools: ["ast_grep"], precedence: "native" }),
		);

		expect(decision.state).toBe("shadowed-native");
		expect(decision.mount).toBe(false);
		expect(decision.reason).toContain("native ast_grep is active");
	});

	test("a disabled native tool cannot shadow an allowed MCP server", () => {
		const [decision] = resolveAnalysisMcp(
			input({ manifests: [NATIVE_MANIFEST], activeNativeTools: [], precedence: "native" }),
		);

		expect(decision.state).toBe("mounted");
		expect(decision.mount).toBe(true);
	});

	test("mcp precedence mounts MCP and reports the native tools to suppress", () => {
		const [decision] = resolveAnalysisMcp(
			input({ manifests: [NATIVE_MANIFEST], activeNativeTools: ["ast_grep"], precedence: "mcp" }),
		);

		expect(decision.state).toBe("mounted");
		expect(decision.suppressNativeTools).toEqual(["ast_grep"]);
		expect(analysisMcpNativeToolsToSuppress([decision])).toEqual(["ast_grep"]);
	});

	test("ask emits a descriptor and does not mount without the existing approval path", () => {
		const [decision] = resolveAnalysisMcp(
			input({ manifests: [NATIVE_MANIFEST], activeNativeTools: ["ast_grep"], precedence: "ask" }),
		);

		expect(decision.state).toBe("ask");
		expect(decision.mount).toBe(false);
		expect(decision.approval?.kind).toBe("mcp-precedence");
		expect(decision.approval?.prompt).toContain("Mount the MCP server instead");
	});

	test("same capability mounts one server; duplicate functions are shadowed", () => {
		const [decision, duplicate] = resolveAnalysisMcp(
			input({
				configs: { codegraph: codegraphConfig(), "codegraph-alt": codegraphConfig() },
				serverTools: {
					codegraph: ["codegraph_explore", "codegraph_status"],
					"codegraph-alt": ["codegraph_explore", "codegraph_status"],
				},
				activeNativeTools: ["ast_grep"],
				precedence: "mcp",
			}),
		);

		expect(decision.serverName).toBe("codegraph");
		expect(decision.state).toBe("mounted");
		expect(duplicate.serverName).toBe("codegraph-alt");
		expect(duplicate.state).toBe("shadowed-duplicate");
		expect(duplicate.mount).toBe(false);
		expect(duplicate.reason).toContain("already provided by codegraph");
	});

	test("a denied first server does not block a later allowed server of the same capability", () => {
		const [denied, mounted] = resolveAnalysisMcp(
			input({
				configs: { codegraph: codegraphConfig(), "codegraph-alt": codegraphConfig() },
				deniedServers: ["codegraph"],
			}),
		);

		expect(denied.state).toBe("shadowed-denied");
		expect(mounted.serverName).toBe("codegraph-alt");
		expect(mounted.state).toBe("mounted");
	});

	test("the profile allowlist excludes a server with no allowed tools", () => {
		const [decision] = resolveAnalysisMcp(input({ allowedTools: ["grep"] }));

		expect(decision.state).toBe("shadowed-profile");
		expect(decision.mount).toBe(false);
		expect(decision.reason).toContain("allowlist");
	});

	test("list_changed recomputation is deterministic and does not resurrect a shadowed server", () => {
		const first = resolveAnalysisMcp(
			input({ manifests: [NATIVE_MANIFEST], activeNativeTools: ["ast_grep"], precedence: "native" }),
		);
		const second = resolveAnalysisMcp(
			input({ manifests: [NATIVE_MANIFEST], activeNativeTools: ["ast_grep"], precedence: "native" }),
		);
		expect(second).toEqual(first);
		expect(second[0]?.state).toBe("shadowed-native");

		const afterChange = resolveAnalysisMcp(
			input({
				manifests: [NATIVE_MANIFEST],
				activeNativeTools: ["ast_grep"],
				precedence: "native",
				serverTools: { codegraph: ["codegraph_explore", "codegraph_new"] },
			}),
		);
		expect(afterChange[0]?.mount).toBe(false);
		expect(afterChange[0]?.state).toBe("shadowed-native");
	});
});

describe("analysis tool filtering", () => {
	test("drops shadowed server tools and keeps unrelated/non-MCP tools", () => {
		const decisions = resolveAnalysisMcp(
			input({ manifests: [NATIVE_MANIFEST], activeNativeTools: ["ast_grep"], precedence: "native" }),
		);
		const tools = [
			{ name: "mcp__codegraph_codegraph_explore", mcpServerName: "codegraph", mcpToolName: "codegraph_explore" },
			{ name: "grep" },
			{ name: "mcp__other_search", mcpServerName: "other", mcpToolName: "search" },
		];

		expect(filterAnalysisMcpTools(tools, decisions).map(tool => tool.name)).toEqual([
			"grep",
			"mcp__other_search",
		]);
		expect(analysisMcpReasons(decisions).codegraph).toContain("shadowed");
	});

	test("reads the session shadow-reason provider used by /mcp without recomputing", () => {
		const source = {
			getAnalysisMcpShadowReasons: () => ({
				codegraph: "shadowed: native ast_grep is active",
				invalid: 42,
			}),
		};
		expect(readAnalysisMcpShadowReasons(source)).toEqual({
			codegraph: "shadowed: native ast_grep is active",
		});
		expect(readAnalysisMcpShadowReasons({})).toBeUndefined();
	});
});

test("the default manifest set is explicit and contains CodeGraph, not a guessed package", () => {
	expect(ANALYSIS_MCP_MANIFESTS.map(manifest => manifest.id)).toEqual(["codegraph"]);
	expect(ANALYSIS_MCP_MANIFESTS[0]?.packageNames).toEqual([CODEGRAPH]);
});

describe("analysis refresh input builder", () => {
	const manager = {
		getServerConfig: (name: string): MCPServerConfig | undefined =>
			name === "codegraph" ? codegraphConfig() : undefined,
	};
	const tools = [
		{ name: "mcp__codegraph_codegraph_explore", mcpServerName: "codegraph", mcpToolName: "codegraph_explore" },
		{ name: "mcp__codegraph_codegraph_status", mcpServerName: "codegraph", mcpToolName: "codegraph_status" },
		{ name: "grep" },
	];

	test("groups server configs and names from the tools about to be bound", () => {
		const built = buildAnalysisMcpRefreshInput({
			manager,
			tools,
			precedence: "mcp",
			activeNativeTools: ["ast_grep"],
		});

		expect(Object.keys(built.configs)).toEqual(["codegraph"]);
		expect(built.serverTools).toEqual({ codegraph: ["codegraph_explore", "codegraph_status"] });
		expect(built.precedence).toBe("mcp");
		expect(built.activeNativeTools).toEqual(["ast_grep"]);
		// No admission snapshot means no allowlist: the existing session filter
		// stays authoritative rather than an ownerless builder widening the bind.
		expect(built.allowedTools).toBeUndefined();
	});

	test("derives allowedTools, project signals and approval from the supplied snapshot", () => {
		const built = buildAnalysisMcpRefreshInput({
			manager,
			tools,
			precedence: "native",
			activeNativeTools: [],
			admission: {
				allowsMcpTool: (name, serverName) => serverName === "codegraph" && name.endsWith("_explore"),
			},
			project: { packageNames: [CODEGRAPH], markerPaths: [] },
			approve: async () => false,
		});

		expect(built.allowedTools).toEqual(["codegraph_explore"]);
		expect(built.project?.packageNames).toEqual([CODEGRAPH]);
		expect(built.approve).toBeDefined();
		expect(built.deniedServers).toBeUndefined();
	});
});

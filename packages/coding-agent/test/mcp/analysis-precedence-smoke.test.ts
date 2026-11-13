/**
 * Real discovery + local-process smoke for analysis-MCP recognition.
 *
 * Discovery reads an actual project `.mcp.json`; the local fixture is a real
 * stdio MCP server with two tools and a `tools/list_changed` notification.
 * No mock echo, no package install, no network, and no production `~/.zeta`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getConfigRootDir, removeSyncWithRetries, setAgentDir } from "@linxiraos/pi-utils";
import { clearCache as clearFsCache } from "@linxiraos/zeta/capability/fs";
import { loadAllMCPConfigs } from "@linxiraos/zeta/mcp/config";
import { createAnalysisMcpPrecedenceHook } from "@linxiraos/zeta/mcp/analysis-precedence-hook";
import { MCPManager } from "@linxiraos/zeta/mcp/manager";
import "@linxiraos/zeta/discovery";

const FIXTURE = path.join(import.meta.dir, "..", "fixtures", "analysis-codegraph-mcp.ts");
const ORIGINAL_AGENT_DIR_ENV = process.env.ZETA_CODING_AGENT_DIR;
const FALLBACK_AGENT_DIR = path.join(getConfigRootDir(), "agent");

describe("analysis MCP discovery and local process", () => {
	let workDir: string;
	let agentDir: string;
	let originalHome: string | undefined;

	beforeEach(() => {
		originalHome = process.env.HOME;
		workDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-analysis-mcp-"));
		agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-analysis-mcp-agent-"));
		process.env.HOME = path.dirname(agentDir);
		setAgentDir(agentDir);
		clearFsCache();
		fs.writeFileSync(
			path.join(workDir, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					codegraph: {
						type: "stdio",
						command: process.execPath,
						args: [FIXTURE],
					},
					"codegraph-alt": {
						type: "stdio",
						command: process.execPath,
						args: [FIXTURE, "--alt"],
					},
					unrelated: {
						type: "stdio",
						command: process.execPath,
						args: [FIXTURE, "--other"],
					},
				},
			}),
		);
	});

	afterEach(() => {
		clearFsCache();
		if (ORIGINAL_AGENT_DIR_ENV) setAgentDir(ORIGINAL_AGENT_DIR_ENV);
		else setAgentDir(FALLBACK_AGENT_DIR);
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		removeSyncWithRetries(workDir);
		removeSyncWithRetries(agentDir);
	});

	test("discovers declared servers, mounts one analysis server, and filters duplicates", async () => {
		const loaded = await loadAllMCPConfigs(workDir, { filterExa: false, filterBrowser: false });
		expect(Object.keys(loaded.configs).sort()).toEqual(["codegraph", "codegraph-alt", "unrelated"]);

		const manager = new MCPManager(workDir);
		try {
			await manager.connectServers({ codegraph: loaded.configs.codegraph! }, {});
			const tools = manager.getTools();
			expect(tools.map(tool => tool.mcpToolName).sort()).toEqual(["codegraph_explore", "codegraph_status"]);

			const hook = createAnalysisMcpPrecedenceHook({
				configs: loaded.configs,
				precedence: "native",
				activeNativeTools: [],
				serverTools: {
					codegraph: ["codegraph_explore", "codegraph_status"],
					"codegraph-alt": ["codegraph_explore", "codegraph_status"],
				},
			});
			expect(hook.filterTools(tools)).toHaveLength(2);
			expect(hook.decisions.find(decision => decision.serverName === "codegraph")?.state).toBe("mounted");
			expect(hook.decisions.find(decision => decision.serverName === "codegraph-alt")?.state).toBe(
				"shadowed-duplicate",
			);
		} finally {
			await manager.disconnectAll();
		}
	});
});

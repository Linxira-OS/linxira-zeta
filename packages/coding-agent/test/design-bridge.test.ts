import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AuthStorage } from "@linxiraos/pi-ai";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { removeSyncWithRetries, Snowflake } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import {
	closeDesignConnections,
	designMarkerPath,
	designTool,
	handleDesignCommand,
	isDesignEnabled,
	readDesignMarker,
	writeDesignMarker,
} from "@linxiraos/zeta/design";
import { callDesignMcp } from "@linxiraos/zeta/design/transport";
import { createAgentSession } from "@linxiraos/zeta/sdk";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import type { SlashCommandRuntime } from "@linxiraos/zeta/slash-commands/types";
import { TOOL_NAME, TOOL_RESULT } from "./fixtures/delayed-tool-mcp";

const MCP_FIXTURE = path.join(import.meta.dir, "fixtures", "delayed-tool-mcp.ts");

describe("design workspace bridge", () => {
	let root: string;
	let registryDir: string;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	const sessions: AgentSession[] = [];

	beforeAll(async () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), `zeta-design-${Snowflake.next()}-`));
		registryDir = path.join(root, "registry");
		fs.mkdirSync(registryDir, { recursive: true });
		authStorage = await AuthStorage.create(path.join(registryDir, "auth.db"));
		modelRegistry = new ModelRegistry(authStorage, path.join(registryDir, "models.yml"));
	});

	afterEach(async () => {
		for (const session of sessions.splice(0)) await session.dispose().catch(() => {});
		await closeDesignConnections();
	});

	afterAll(() => {
		authStorage.close();
		if (fs.existsSync(root)) removeSyncWithRetries(root);
	});

	function workspace(): string {
		const cwd = path.join(root, `workspace-${Snowflake.next()}`);
		fs.mkdirSync(cwd, { recursive: true });
		return cwd;
	}

	function startupShortcuts(cwd: string) {
		return {
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			rules: [],
			workspaceTree: {
				rootPath: cwd,
				rendered: "",
				truncated: false,
				totalLines: 0,
				agentsMdFiles: [],
			},
			enableMCP: false,
			enableLsp: false,
		};
	}

	async function activeToolNames(cwd: string, toolNames?: string[]): Promise<string[]> {
		const { session } = await createAgentSession({
			...startupShortcuts(cwd),
			cwd,
			agentDir: cwd,
			modelRegistry,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "plan.enabled": false }),
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			toolNames,
		});
		sessions.push(session);
		return session.getActiveToolNames();
	}

	it("defaults to disabled and writes only the workspace marker", async () => {
		const cwd = workspace();
		expect(await isDesignEnabled(cwd)).toBe(false);
		const marker = await writeDesignMarker(cwd, { enabled: true });
		expect(marker.path).toBe(designMarkerPath(cwd));
		expect(marker.path.startsWith(path.join(cwd, ".zeta"))).toBe(true);
		expect((await readDesignMarker(cwd)).config.enabled).toBe(true);
	});

	it("fails closed on invalid YAML", async () => {
		const cwd = workspace();
		fs.mkdirSync(path.dirname(designMarkerPath(cwd)), { recursive: true });
		fs.writeFileSync(designMarkerPath(cwd), "enabled: [\n");
		const loaded = await readDesignMarker(cwd);
		expect(loaded.error).toBeDefined();
		expect(loaded.config.enabled).toBe(false);
		expect(await isDesignEnabled(cwd)).toBe(false);
	});

	it("registers design only for an enabled workspace and honors the tool whitelist", async () => {
		const cwd = workspace();
		expect(await activeToolNames(cwd)).not.toContain("design");
		await writeDesignMarker(cwd, { enabled: true });
		expect(await activeToolNames(cwd)).toContain("design");
		expect(await activeToolNames(cwd, ["read"])).not.toContain("design");
	});

	it("calls the configured MCP server through one cached connection", async () => {
		const cwd = workspace();
		await writeDesignMarker(cwd, {
			enabled: true,
			cliCommand: "zeta-missing-od",
			mcpCommand: process.execPath,
			mcpArgs: [MCP_FIXTURE],
		});
		const marker = (await readDesignMarker(cwd)).config;
		const result = await callDesignMcp(cwd, marker, TOOL_NAME, {});
		expect(result.content).toEqual([{ type: "text", text: TOOL_RESULT }]);
	});

	it("exposes the MCP action through the single design tool", async () => {
		const cwd = workspace();
		await writeDesignMarker(cwd, {
			enabled: true,
			cliCommand: "zeta-missing-od",
			mcpCommand: process.execPath,
			mcpArgs: [MCP_FIXTURE],
		});
		const result = await designTool.execute("design-test", { action: "mcp", mcp_tool: TOOL_NAME }, undefined, {
			sessionManager: { getCwd: () => cwd },
		} as never);
		expect(result.content).toEqual([{ type: "text", text: TOOL_RESULT }]);
		expect(result.details?.mcpTool).toBe(TOOL_NAME);
	});

	it("enables the workspace and reconciles tools from /design enable", async () => {
		const cwd = workspace();
		await writeDesignMarker(cwd, {
			enabled: false,
			cliCommand: "zeta-missing-od",
			mcpCommand: "zeta-missing-od",
		});
		let reconciles = 0;
		const output: string[] = [];
		const runtime = {
			cwd,
			session: {
				reconcileBuiltinTools: async () => {
					reconciles += 1;
				},
			},
			output: (text: string) => {
				output.push(text);
			},
		} as unknown as SlashCommandRuntime;

		await handleDesignCommand({ name: "design", args: "enable", text: "/design enable" }, runtime);
		expect((await readDesignMarker(cwd)).config.enabled).toBe(true);
		expect(reconciles).toBe(1);
		expect(output.join("\n")).toContain("OpenDesign enabled");
		expect(output.join("\n")).toContain("cli-missing");
	});
});

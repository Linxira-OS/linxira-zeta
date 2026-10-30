/**
 * Approval prompts for `write xd://<device>`: the write tool's outer gate and the
 * mounted tool's own wrapper must ask the user once per call (#17039).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { type } from "@linxiraos/pi-omptype";
import type { AgentTool, AgentToolContext } from "@linxiraos/pi-agent-core";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { ExtensionRuntime } from "@linxiraos/zeta/extensibility/extensions/loader";
import { ExtensionRunner } from "@linxiraos/zeta/extensibility/extensions/runner";
import type { ExtensionUIContext } from "@linxiraos/zeta/extensibility/extensions/types";
import { ExtensionToolWrapper } from "@linxiraos/zeta/extensibility/extensions/wrapper";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import type { Tool } from "@linxiraos/zeta/tools";
import { WriteTool } from "@linxiraos/zeta/tools/write";
import { resolveXdevTool, type XdevState } from "@linxiraos/zeta/tools/xdev";
import { TempDir } from "@linxiraos/pi-utils";

const DEVICE = "mcp__jira_addcomment";

let root: TempDir;
let authStorage: AuthStorage;
let modelRegistry: ModelRegistry;

beforeAll(async () => {
	root = TempDir.createSync("@pi-xdev-approval-");
	authStorage = await AuthStorage.create(path.join(root.path(), "testauth.db"));
	modelRegistry = new ModelRegistry(authStorage);
});
afterAll(() => {
	authStorage.close();
	root.removeSync();
});

function runnerWith(sessionManager: SessionManager, select: ExtensionUIContext["select"]): ExtensionRunner {
	const runner = new ExtensionRunner([], new ExtensionRuntime(), root.path(), sessionManager, modelRegistry);
	runner.initialize(
		{
			sendMessage: () => {},
			sendUserMessage: () => {},
			appendEntry: () => {},
			setLabel: () => {},
			getActiveTools: () => [],
			getAllTools: () => [],
			setActiveTools: async () => {},
			getCommands: () => [],
			setModel: async () => false,
			getThinkingLevel: () => undefined,
			setThinkingLevel: () => {},
			getSessionName: () => undefined,
			setSessionName: async () => {},
		},
		{
			getModel: () => undefined,
			isIdle: () => true,
			abort: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => undefined,
			compact: async () => {},
			getSystemPrompt: () => [],
		},
		undefined,
		{
			select,
			confirm: async () => false,
			input: async () => undefined,
			notify: () => {},
			onTerminalInput: () => () => {},
			rerenderMessage: () => {},
			getLinkClicksAvailable: () => false,
			setStatus: () => {},
			setWorkingMessage: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			custom: async <T>() => undefined as T,
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			addAutocompleteProvider: () => {},
			setEditorComponent: () => {},
			getEditorComponent: () => undefined,
			get theme() {
				return {} as never;
			},
			getAllThemes: async () => [],
			getTheme: async () => undefined,
			setTheme: async () => ({ success: false, error: "not implemented" }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		} satisfies ExtensionUIContext,
	);
	return runner;
}

/**
 * The session's tool graph for one mounted device: the registry wraps every
 * tool (the mounted device included) in `ExtensionToolWrapper`, and `write`
 * dispatches `xd://` to the wrapped device.
 */
function mountedDevice(runner: ExtensionRunner, cwd: string): { write: AgentTool; executed: unknown[] } {
	const executed: unknown[] = [];
	const device: AgentTool = {
		name: DEVICE,
		label: "Add comment",
		description: "MCP tool without an approval declaration (exec tier)",
		parameters: type({ body: "string" }),
		async execute(_id, args) {
			executed.push(args);
			return { content: [{ type: "text", text: "commented" }] };
		},
	};
	const wrappedDevice = new ExtensionToolWrapper(device, runner) as unknown as Tool;
	const xdev: XdevState = {
		tools: new Map([[DEVICE, wrappedDevice]]),
		mountedNames: new Set([DEVICE]),
		builtInNames: new Set(),
		isActive: () => false,
		resolve: name => resolveXdevTool(xdev, name),
	};
	const writeTool = new WriteTool({
		cwd,
		hasUI: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({}),
		xdev,
	});
	return { write: new ExtensionToolWrapper(writeTool as unknown as AgentTool, runner), executed };
}

function context(sessionManager: SessionManager, settings: Record<string, unknown>): AgentToolContext {
	return {
		sessionManager,
		modelRegistry,
		model: undefined,
		isIdle: () => true,
		hasQueuedMessages: () => false,
		abort: () => {},
		settings: Settings.isolated(settings),
	} as AgentToolContext;
}

const args = { path: `xd://${DEVICE}`, content: JSON.stringify({ body: "hello" }) };

describe("write xd://<device> approval", () => {
	it("asks once for an explicit device prompt policy", async () => {
		const cwd = root.path();
		const sessionManager = SessionManager.inMemory(cwd);
		const select = vi.fn(async (_title: string, options: string[]) => options[0]);
		const { write, executed } = mountedDevice(runnerWith(sessionManager, select), cwd);

		await write.execute(
			"call-1",
			args,
			undefined,
			undefined,
			context(sessionManager, { "tools.approvalMode": "write", "tools.approval": { [DEVICE]: "prompt" } }),
		);

		expect(select).toHaveBeenCalledTimes(1);
		expect(executed).toEqual([{ body: "hello" }]);
	});
});

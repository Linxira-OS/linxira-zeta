import * as path from "node:path";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { runRpcMode } from "@linxiraos/zeta/modes/rpc/rpc-mode";
import { createAgentSession } from "@linxiraos/zeta/sdk";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { cfgAsyncEnabled } from "@linxiraos/zeta/tools/settings";

// Real SDK session and RPC dispatch for the progress-event tests; the model always answers "pong".
// A `session_before_compact` hook supplies the summary, so a manual compaction commits without a
// summarizer call.
const MODEL = getBundledModel("anthropic", "claude-sonnet-4-5");
if (!MODEL) throw new Error("bundled test model missing");

const cwd = process.cwd();
const authStorage = await AuthStorage.create(path.join(cwd, "auth.db"));
authStorage.keys.setRuntime("anthropic", "test-key");
const modelRegistry = new ModelRegistry(authStorage, path.join(cwd, "models.yml"));
const settings = Settings.isolated({ "compaction.keepRecentTokens": 1 });
cfgAsyncEnabled.set(settings, false);

const { session } = await createAgentSession({
	cwd,
	agentDir: cwd,
	sessionManager: SessionManager.inMemory(cwd),
	authStorage,
	modelRegistry,
	settings,
	model: MODEL,
	disableExtensionDiscovery: true,
	skills: [],
	contextFiles: [],
	workspaceTree: { rootPath: cwd, rendered: "", truncated: false, totalLines: 0, agentsMdFiles: [] },
	promptTemplates: [],
	slashCommands: [],
	enableMCP: false,
	enableLsp: false,
	extensions: [
		pi => {
			pi.on("session_before_compact", async event => ({
				compaction: {
					summary: "compacted by the test hook",
					shortSummary: undefined,
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
					details: {},
				},
			}));
		},
	],
});

const mock = createMockModel();
session.agent.streamFn = (model, context, options) => {
	mock.push({ content: ["pong"] });
	return mock.stream(model, context, options);
};
await runRpcMode(session);

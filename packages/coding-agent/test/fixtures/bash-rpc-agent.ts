import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { runRpcMode } from "@linxiraos/zeta/modes/rpc/rpc-mode";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { convertToLlm } from "@linxiraos/zeta/session/messages";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";

// Real RPC dispatch, native bash execution and transcript storage; model requests are forbidden.
const cwd = process.cwd();
const authStorage = await AuthStorage.create(path.join(cwd, "auth.db"));
const modelRegistry = new ModelRegistry(authStorage, path.join(cwd, "models.yml"));
const agent = new Agent({
	initialState: { model: getBundledModel("anthropic", "claude-sonnet-4-5")!, systemPrompt: [], tools: [] },
	convertToLlm,
	streamFn: () => {
		throw new Error("bash-rpc-agent must not call a model");
	},
});
const session = new AgentSession({
	agent,
	sessionManager: SessionManager.inMemory(cwd),
	settings: Settings.isolated({ "compaction.enabled": false }),
	modelRegistry,
});
await runRpcMode(session);

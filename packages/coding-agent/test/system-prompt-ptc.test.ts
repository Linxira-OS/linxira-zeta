import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { TempDir } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { type CreateAgentSessionOptions, createAgentSession } from "@linxiraos/zeta/sdk";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";

const PTC_HEADER = "# Code-First Tool Orchestration (PTC)";

/** The rendered system prompt and active tool names of a session created with `options`. */
async function sessionFor(options: CreateAgentSessionOptions): Promise<{ prompt: string; toolNames: string[] }> {
	using tempDir = TempDir.createSync("@omp-sdk-ptc-prompt-");
	const cwd = tempDir.join("project");
	const authStorage = await AuthStorage.create(":memory:");
	const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
	const { session } = await createAgentSession({
		cwd,
		agentDir: tempDir.join("agent"),
		authStorage,
		modelRegistry,
		settings: Settings.isolated(),
		sessionManager: SessionManager.inMemory(cwd),
		model: getBundledModel("openai", "gpt-4o-mini"),
		disableExtensionDiscovery: true,
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		skipPythonPreflight: true,
		...options,
	});
	try {
		return { prompt: session.systemPrompt.join("\n"), toolNames: session.getActiveToolNames() };
	} finally {
		await session.dispose();
		authStorage.close();
	}
}

describe("code-first tool orchestration (PTC) guidance", () => {
	it("is given to a main session and withheld from a subagent session", async () => {
		const main = await sessionFor({});
		expect(main.prompt).toContain(PTC_HEADER);
		expect(main.prompt).toContain("tool.<name>(args)");
		expect(main.prompt).toContain("workpool()");

		for (const options of [{ taskDepth: 1 }, { taskDepth: 2 }] satisfies CreateAgentSessionOptions[]) {
			const subagent = await sessionFor(options);
			expect(subagent.prompt).not.toContain(PTC_HEADER);
			expect(subagent.prompt).not.toContain("Code-First Tool Orchestration");
		}
	});

	it("reuses the existing eval tool and adds no new tool", async () => {
		const main = await sessionFor({});
		expect(main.toolNames).toContain("eval");
		expect(main.toolNames).not.toContain("run_code");
		expect(main.prompt).not.toContain("run_code");
	});
});

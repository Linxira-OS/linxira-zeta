import { describe, expect, it } from "bun:test";
import { buildSystemPrompt, type SystemPromptToolMetadata } from "@linxiraos/zeta/system-prompt";
import { getEvalToolDescription } from "@linxiraos/zeta/tools/eval";

const BATCHING_HEADING = "## Batching independent calls";
const BYPASS_CLAUSE = "never use a cell to bypass them";
/** Removed concept: neither the eval description nor any system prompt may name it again. */
const RETIRED_PTC_TITLE = "Code-First Tool Orchestration";
const RETIRED_PTC_OPTION = "ptcGuidance";

const TOOLS = new Map<string, SystemPromptToolMetadata>([
	[
		"eval",
		{
			label: "Eval",
			description: "Runs one Python or JavaScript cell in a persistent kernel.",
			parameters: { type: "object", properties: {} },
		},
	],
]);

/** A system prompt rendered with `eval` in the active tool set, so the retired section would have applied. */
async function promptWithEval(options: { subagent?: boolean } = {}): Promise<string> {
	const built = await buildSystemPrompt({
		tools: TOOLS,
		toolNames: ["eval"],
		subagent: options.subagent,
		cwd: process.cwd(),
		skills: [],
		contextFiles: [],
		noContextFiles: true,
		rules: [],
		activeRepoContext: null,
		personality: "none",
	});
	return built.systemPrompt.join("\n");
}

describe("eval batching guidance", () => {
	it("states the batching rule in the eval tool description", () => {
		const description = getEvalToolDescription({ py: true, js: true, spawns: true });
		expect(description).toContain(BATCHING_HEADING);
		expect(description).toContain(BYPASS_CLAUSE);
		expect(description).not.toContain(RETIRED_PTC_TITLE);
	});

	it("keeps the rule for every option set instead of gating it per session kind", () => {
		for (const options of [
			{ py: true, js: true, spawns: true },
			{ py: true, js: true, spawns: false },
			{ py: true, js: true },
			{ py: false, js: true, spawns: false },
		]) {
			expect(getEvalToolDescription(options)).toContain(BATCHING_HEADING);
		}
	});

	it("removes the retired guidance from main and subagent system prompts", async () => {
		for (const subagent of [false, true]) {
			const prompt = await promptWithEval({ subagent });
			expect(prompt).not.toContain(RETIRED_PTC_TITLE);
			expect(prompt).not.toContain(RETIRED_PTC_OPTION);
			expect(prompt).not.toContain("ptc-guidance");
		}
	});
});

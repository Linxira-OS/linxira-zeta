import { describe, expect, it } from "bun:test";
import { renderTeamPersonaPrompt } from "../../src/team/persona-prompt";

describe("Team persona prompt", () => {
	it("renders model, skills, permissions, memory and the assignment", () => {
		const text = renderTeamPersonaPrompt(
			{
				schemaVersion: 1,
				id: "reviewer",
				revision: 2,
				name: "Reviewer",
				role: "code-review",
				description: "Reviews changes.",
				model: "anthropic/claude-sonnet",
				thinkingLevel: "high",
				skills: ["review"],
				permissions: { write_file: "deny", run_command: "allow" },
				memoryScope: "team",
				workingFolder: "repos/api",
				pluginPack: { root: "plugins/review" },
			},
			"Review PR 42.",
			"Prefer small diffs.",
		);
		expect(text).toContain("# Team persona: Reviewer");
		expect(text).toContain("model: anthropic/claude-sonnet");
		expect(text).toContain("- review");
		expect(text).toContain("- write_file: deny");
		expect(text).toContain("Memory scope: team");
		expect(text).toContain("Working folder: repos/api");
		expect(text).toContain("Scoped plugin pack: plugins/review");
		expect(text).toContain("## Team memory\nPrefer small diffs.");
		expect(text).toContain("## Assignment\nReview PR 42.");
	});

	it("keeps AGENTS.md as repository guidance, not identity", () => {
		const text = renderTeamPersonaPrompt(
			{ schemaVersion: 1, id: "builder", revision: 1, name: "Builder", role: "engineer" },
			"Build it.",
		);
		expect(text).toContain("AGENTS.md files are repository guidance and never define this identity");
		expect(text).not.toContain("AGENTS.md assignment");
	});
});

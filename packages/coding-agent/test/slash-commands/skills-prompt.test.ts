import { describe, expect, it } from "bun:test";
import { BUILTIN_SLASH_COMMANDS } from "@linxiraos/zeta/slash-commands/builtin-registry";
import { BUILTIN_SKILLS_SLASH_COMMANDS } from "@linxiraos/zeta/slash-commands/builtin-skills";

const skills = BUILTIN_SKILLS_SLASH_COMMANDS.find(command => command.name === "skills")!;

function runtime(): never {
	return {
		sessionManager: { getCwd: () => process.cwd() },
		output: async () => undefined,
	} as never;
}

describe("/skills documentation prompt", () => {
	it("stays visible in the palette", () => {
		expect(BUILTIN_SLASH_COMMANDS.some(command => command.name === "skills")).toBe(true);
	});

	it("returns the built-in skills guide instead of running an installer", async () => {
		const result = await skills.handle?.(
			{ name: "skills", args: "install @scope/tool", text: "/skills install @scope/tool" },
			runtime(),
		);
		if (!result || !("prompt" in result) || typeof result.prompt !== "string") {
			throw new Error("expected a string prompt result");
		}
		expect(result.prompt).toContain("install @scope/tool");
		expect(result.prompt).toContain("Skill");
		expect(result.prompt).toContain("workspace");
		expect(result.prompt).toContain("skills.md");
	});
});

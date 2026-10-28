import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { OFFICIAL_SKILLS_PROVIDER_ID } from "../src/capability/skill";
import { loadSkills } from "../src/extensibility/skills";

// Opt this file into the real pack before the provider module loads (the
// global test preload points ZETA_OFFICIAL_SKILLS_DIR at a dead path).
process.env.ZETA_OFFICIAL_SKILLS_DIR = path.resolve(import.meta.dir, "../../../skills/official");
// The official provider only serves names the user skills directory lacks.
// Keep this file hermetic: a developer machine with the pack already installed
// would otherwise hide the very skills this toggle test expects to merge.
const previousUserSkillsDir = process.env.ZETA_SKILLS_USER_DIR;
const isolatedUserSkillsDir = mkdtempSync(path.join(tmpdir(), "zeta-official-skills-user-"));
process.env.ZETA_SKILLS_USER_DIR = isolatedUserSkillsDir;
afterAll(() => {
	if (previousUserSkillsDir === undefined) delete process.env.ZETA_SKILLS_USER_DIR;
	else process.env.ZETA_SKILLS_USER_DIR = previousUserSkillsDir;
	rmSync(isolatedUserSkillsDir, { recursive: true, force: true });
});
await import("../src/discovery/builtin"); // registers all discovery providers (side effect)

/**
 * `skills.enableOfficial` is the dedicated user-facing switch for the bundled
 * pack. It gates at the merge layer (`isSourceEnabled`), so discovery itself
 * still runs — disabling must remove every `zeta-official`-sourced skill from
 * `loadSkills` output without touching authored providers.
 */
describe("skills.enableOfficial toggle", () => {
	const officialNames = async (options: Record<string, unknown>): Promise<string[]> => {
		const { skills } = await loadSkills({
			cwd: path.resolve(import.meta.dir, "../.."),
			...options,
		});
		return skills.filter(s => s._source?.provider === OFFICIAL_SKILLS_PROVIDER_ID).map(s => s.name);
	};

	test("bundled skills are merged by default", async () => {
		const names = await officialNames({});
		expect(names).toContain("docx");
		expect(names).toContain("pptx");
	});

	test("enableOfficial: false removes every bundled skill from the merge", async () => {
		const names = await officialNames({ enableOfficial: false });
		expect(names).toEqual([]);
	});
});

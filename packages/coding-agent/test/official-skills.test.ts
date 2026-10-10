import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getProviderInfo, loadCapability } from "../src/capability";
import { type Skill, skillCapability } from "../src/capability/skill";
// Static import: builtin.ts reads the env overrides at provider-load time, not
// at module load, so importing it here cannot bypass the preload isolation.
import { officialSkillsDirCandidates } from "../src/discovery/builtin";

/**
 * Merge guard: the official bundled skills provider (skills/official/) must
 * stay registered below authored providers and above managed auto-learn, and
 * must discover the shipped docx/pptx skills. Upstream merges have silently
 * dropped Zeta-owned capability providers before (see builtin-registry.test).
 */
// Opt this file back into the real pack before the provider module loads
// (the global test preload points ZETA_OFFICIAL_SKILLS_DIR at a dead path).
process.env.ZETA_OFFICIAL_SKILLS_DIR = path.resolve(import.meta.dir, "../../../skills/official");
await import("../src/discovery/builtin"); // registers all discovery providers (side effect)

describe("official bundled skills provider", () => {
	test("provider is registered with correct priority band", () => {
		const info = getProviderInfo("zeta-official");
		expect(info).toBeDefined();
		expect(info!.priority).toBeGreaterThan(5); // above managed auto-learn
		expect(info!.priority).toBeLessThan(100); // below authored providers
	});

	test("discovers the shipped docx and pptx skills from skills/official", async () => {
		const repo = path.resolve(import.meta.dir, "../..");
		const result = await loadCapability<Skill>(skillCapability.id, {
			cwd: repo,
			providers: ["zeta-official"],
		});
		const names = result.items.map(s => s.name);
		expect(names).toContain("docx");
		expect(names).toContain("pptx");
		expect(names).toContain("xlsx");
		expect(names).toContain("pdf");
		expect(names).toContain("diagnose-crash");
		const docx = result.items.find(s => s.name === "docx");
		expect(docx?.frontmatter?.description).toContain("Word");
	});
});

/**
 * src runtimes have no `ZETA_OFFICIAL_SKILLS_EMBED` define (it is substituted
 * at bundle/binary build time), so the on-disk fallback chain is the only
 * official-skills source for npm source installs. It must hit the packaged
 * `<pkg>/skills/official` copy there while continuing to hit the repo checkout
 * in dev.
 */
describe("official skills dir fallback chain", () => {
	test("repo checkout candidate hits <repo>/skills/official in dev", () => {
		const candidates = officialSkillsDirCandidates(path.resolve(import.meta.dir, "../src/discovery"));
		expect(candidates[0]).toBe(path.resolve(import.meta.dir, "../../../skills/official"));
		expect(existsSync(candidates[0])).toBe(true);
	});

	test("package-root candidate hits the packaged skills dir in an npm layout", async () => {
		const installRoot = await mkdtemp(path.join(os.tmpdir(), "zeta-npm-layout-"));
		try {
			const discoveryDir = path.join(installRoot, "node_modules", "@linxiraos", "zeta", "src", "discovery");
			const officialLeaf = path.join(
				installRoot,
				"node_modules",
				"@linxiraos",
				"zeta",
				"skills",
				"official",
				"alpha",
			);
			await mkdir(officialLeaf, { recursive: true });
			await Bun.write(
				path.join(officialLeaf, "SKILL.md"),
				"---\nname: alpha\ndescription: packaged skill\n---\n\nBody.\n",
			);
			const candidates = officialSkillsDirCandidates(discoveryDir);
			expect(candidates[1]).toBe(path.join(installRoot, "node_modules", "@linxiraos", "zeta", "skills", "official"));
			expect(existsSync(candidates[1])).toBe(true);
			expect(existsSync(candidates[0])).toBe(false);
		} finally {
			await rm(installRoot, { recursive: true, force: true });
		}
	});
});

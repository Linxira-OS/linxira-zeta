import { describe, expect, test } from "bun:test";
import path from "node:path";
import { getProviderInfo, loadCapability } from "../src/capability";
import { type Skill, skillCapability } from "../src/capability/skill";

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
		const docx = result.items.find(s => s.name === "docx");
		expect(docx?.frontmatter?.description).toContain("Word");
	});
});

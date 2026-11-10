import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseFrontmatter } from "@linxiraos/pi-utils";
import { getProviderInfo, loadCapability } from "../src/capability";
import { type Skill, skillCapability } from "../src/capability/skill";
// Static import: builtin.ts reads the env overrides at provider-load time, not
// at module load, so importing it here cannot bypass the preload isolation.
import { officialSkillsDirCandidates } from "../src/discovery/official-skills";

/**
 * Merge guard: the official bundled skills provider (skills/official/) must
 * stay registered below authored providers and above managed auto-learn, and
 * must discover the shipped docx/pptx skills. Upstream merges have silently
 * dropped Zeta-owned capability providers before (see builtin-registry.test).
 */
// Opt this file back into the real pack before the provider module loads
// (the global test preload points ZETA_OFFICIAL_SKILLS_DIR at a dead path).
// Test files share a chunk process, so the override leaks into later files in
// that chunk — the same accepted tradeoff the preload documents.
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
		// Hermetic: the pack provider yields a name the user skills dir already
		// serves, and a developer machine may have an installed copy of the pack
		// there (see the install tests). Point the user skills root at a temp dir.
		const previousUserDir = process.env.ZETA_SKILLS_USER_DIR;
		process.env.ZETA_SKILLS_USER_DIR = path.join(
			await mkdtemp(path.join(os.tmpdir(), "zeta-official-shadow-")),
			"skills",
		);
		try {
			const result = await loadCapability<Skill>(skillCapability.id, {
				cwd: repo,
				providers: ["zeta-official"],
			});
			const names = result.items.map(s => s.name);
			expect(names).toContain("docx");
			expect(names).toContain("pptx");
			expect(names).toContain("xlsx");
			expect(names).toContain("pdf");
			const docx = result.items.find(s => s.name === "docx");
			expect(docx?.frontmatter?.description).toContain("Word");
		} finally {
			if (previousUserDir === undefined) delete process.env.ZETA_SKILLS_USER_DIR;
			else process.env.ZETA_SKILLS_USER_DIR = previousUserDir;
		}
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

/**
 * Pack hygiene: discovery only needs `name` + `description`, but a bad name, a
 * duplicate, or a skill missing from the docs table degrades matching and
 * hides the pack from readers. The bundled pack is authored in-tree, so these
 * are repository invariants rather than user-data checks.
 */
describe("bundled official skills pack hygiene", () => {
	const packDir = path.resolve(import.meta.dir, "../../../skills/official");

	async function readPack(): Promise<{ dir: string; name: string; description: string }[]> {
		const entries: { dir: string; name: string; description: string }[] = [];
		for await (const relative of new Bun.Glob("*/SKILL.md").scan({ cwd: packDir, dot: false })) {
			const file = path.join(packDir, relative);
			const { frontmatter } = parseFrontmatter(await Bun.file(file).text(), { source: file, repair: false });
			const dir = path.basename(path.dirname(file));
			entries.push({
				dir,
				name: typeof frontmatter.name === "string" ? frontmatter.name : "",
				description: typeof frontmatter.description === "string" ? frontmatter.description : "",
			});
		}
		return entries.sort((a, b) => a.dir.localeCompare(b.dir));
	}

	test("every bundled skill has a directory-matching name and a description", async () => {
		const skills = await readPack();
		expect(skills.length).toBeGreaterThanOrEqual(8);
		for (const skill of skills) {
			expect(skill.name, `${skill.dir}/SKILL.md frontmatter name`).toBe(skill.dir);
			expect(skill.description.trim().length, `${skill.dir}/SKILL.md description`).toBeGreaterThan(0);
		}
		expect(new Set(skills.map(skill => skill.name)).size).toBe(skills.length);
	});

	test("docs/skills.md lists every bundled skill in the official pack table", async () => {
		const skills = await readPack();
		const doc = await Bun.file(path.resolve(import.meta.dir, "../../../docs/skills.md")).text();
		for (const skill of skills) {
			expect(doc).toContain(`| \`${skill.name}\` |`);
		}
	});
});

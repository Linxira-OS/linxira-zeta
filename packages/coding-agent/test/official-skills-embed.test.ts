import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDir, setAgentDir } from "@linxiraos/pi-utils";
import { loadCapability } from "../src/capability";
import type { Skill } from "../src/capability/skill";

const EMBED_FILES: Record<string, string> = {
	"alpha/SKILL.md": "---\nname: alpha\ndescription: Embed test skill alpha\n---\n\nBody alpha.\n",
	"beta/SKILL.md": "---\nname: beta\ndescription: Embed test skill beta\n---\n\nBody beta.\n",
};

/**
 * The bundled-distribution path: ZETA_OFFICIAL_SKILLS_EMBED carries the pack
 * as JSON (burned in at build time), and the provider seeds it under
 * <agentDir>/official-skills/ so skills keep real filesystem paths. The
 * explicit ZETA_OFFICIAL_SKILLS_DIR override must still win over the embed —
 * that is what lets the global test preload disable the pack entirely.
 */
describe("official skills embed seeding", () => {
	test("seeds embedded skills into agentDir and discovers them", async () => {
		const home = await mkdtemp(path.join(tmpdir(), "zeta-official-embed-"));
		const previousAgentDir = getAgentDir();
		const previousDirOverride = process.env.ZETA_OFFICIAL_SKILLS_DIR;
		delete process.env.ZETA_OFFICIAL_SKILLS_DIR;
		process.env.ZETA_OFFICIAL_SKILLS_EMBED = JSON.stringify(EMBED_FILES);
		setAgentDir(home);
		await import("../src/discovery/builtin"); // registers the provider (side effect)
		try {
			const result = await loadCapability<Skill>("skills", {
				cwd: path.resolve(import.meta.dir, "../.."),
				providers: ["zeta-official"],
			});
			const names = result.items.map(s => s.name);
			expect(names).toContain("alpha");
			expect(names).toContain("beta");
			expect(await Bun.file(path.join(home, "official-skills", "alpha", "SKILL.md")).text()).toContain("Body alpha");
			expect(await Bun.file(path.join(home, "official-skills", ".embed-hash")).text()).toMatch(/^[0-9a-f]{16}/);

			// A second load with the same payload must not rewrite content: the
			// hash marker short-circuits the seed.
			const before = await Bun.file(path.join(home, "official-skills", "alpha", "SKILL.md")).text();
			await loadCapability<Skill>("skills", {
				cwd: path.resolve(import.meta.dir, "../.."),
				providers: ["zeta-official"],
			});
			expect(await Bun.file(path.join(home, "official-skills", "alpha", "SKILL.md")).text()).toBe(before);
		} finally {
			setAgentDir(previousAgentDir);
			if (previousDirOverride === undefined) delete process.env.ZETA_OFFICIAL_SKILLS_DIR;
			else process.env.ZETA_OFFICIAL_SKILLS_DIR = previousDirOverride;
			delete process.env.ZETA_OFFICIAL_SKILLS_EMBED;
		}
	});
});

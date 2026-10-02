import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
		const previousDirOverride = process.env.ZETA_OFFICIAL_SKILLS_DIR;
		const previousSeedDir = process.env.ZETA_OFFICIAL_SKILLS_SEED_DIR;
		delete process.env.ZETA_OFFICIAL_SKILLS_DIR;
		process.env.ZETA_OFFICIAL_SKILLS_SEED_DIR = home;
		process.env.ZETA_OFFICIAL_SKILLS_EMBED = JSON.stringify(EMBED_FILES);
		await import("../src/discovery/builtin"); // registers the provider (side effect)
		try {
			const result = await loadCapability<Skill>("skills", {
				cwd: path.resolve(import.meta.dir, "../.."),
				providers: ["zeta-official"],
			});
			const names = result.items.map(s => s.name);
			expect(names).toContain("alpha");
			expect(names).toContain("beta");
			expect(await Bun.file(path.join(home, "alpha", "SKILL.md")).text()).toContain("Body alpha");
			expect(await Bun.file(path.join(home, ".embed-hash")).text()).toMatch(/^[0-9a-f]{16}/);

			// A second load with the same payload must not rewrite content: the
			// hash marker short-circuits the seed.
			const before = await Bun.file(path.join(home, "alpha", "SKILL.md")).text();
			await loadCapability<Skill>("skills", {
				cwd: path.resolve(import.meta.dir, "../.."),
				providers: ["zeta-official"],
			});
			expect(await Bun.file(path.join(home, "alpha", "SKILL.md")).text()).toBe(before);
		} finally {
			if (previousDirOverride === undefined) delete process.env.ZETA_OFFICIAL_SKILLS_DIR;
			else process.env.ZETA_OFFICIAL_SKILLS_DIR = previousDirOverride;
			delete process.env.ZETA_OFFICIAL_SKILLS_EMBED;
			if (previousSeedDir === undefined) delete process.env.ZETA_OFFICIAL_SKILLS_SEED_DIR;
			else process.env.ZETA_OFFICIAL_SKILLS_SEED_DIR = previousSeedDir;
		}
	});

	/**
	 * The payload is the seed dir's source of truth: a smaller payload (a skill
	 * retired from the pack) must not leave ghost skills from the previous seed
	 * on disk, and the `.embed-hash` marker itself must survive the cleanup so
	 * unchanged reseeds keep short-circuiting.
	 */
	test("reseeding a shrunken payload removes ghost files and keeps the hash marker", async () => {
		const home = await mkdtemp(path.join(tmpdir(), "zeta-official-shrink-"));
		const previousDirOverride = process.env.ZETA_OFFICIAL_SKILLS_DIR;
		const previousSeedDir = process.env.ZETA_OFFICIAL_SKILLS_SEED_DIR;
		delete process.env.ZETA_OFFICIAL_SKILLS_DIR;
		process.env.ZETA_OFFICIAL_SKILLS_SEED_DIR = home;
		process.env.ZETA_OFFICIAL_SKILLS_EMBED = JSON.stringify({
			"alpha/SKILL.md": "---\nname: alpha\ndescription: shrink test alpha\n---\n\nBody alpha v1.\n",
			"retired/ghost/SKILL.md": "---\nname: ghost\ndescription: soon retired\n---\n\nBody ghost.\n",
		});
		await import("../src/discovery/builtin"); // registers the provider (side effect)
		try {
			const load = () =>
				loadCapability<Skill>("skills", {
					cwd: path.resolve(import.meta.dir, "../.."),
					providers: ["zeta-official"],
				});
			await load();
			expect(existsSync(path.join(home, "retired", "ghost", "SKILL.md"))).toBe(true);

			// Shrunk payload: ghost retired, alpha revised.
			process.env.ZETA_OFFICIAL_SKILLS_EMBED = JSON.stringify({
				"alpha/SKILL.md": "---\nname: alpha\ndescription: shrink test alpha\n---\n\nBody alpha v2.\n",
			});
			const result = await load();
			expect(existsSync(path.join(home, "retired", "ghost", "SKILL.md"))).toBe(false);
			expect(await Bun.file(path.join(home, "alpha", "SKILL.md")).text()).toContain("Body alpha v2");
			const hash = await Bun.file(path.join(home, ".embed-hash")).text();
			expect(hash).toMatch(/^[0-9a-f]{16}\n$/);
			expect(result.items.map(s => s.name).sort()).toEqual(["alpha"]);

			// Same payload again: the hash short-circuit keeps the seed intact.
			await load();
			expect(await Bun.file(path.join(home, "alpha", "SKILL.md")).text()).toContain("Body alpha v2");
			expect(await Bun.file(path.join(home, ".embed-hash")).text()).toBe(hash);
		} finally {
			if (previousDirOverride === undefined) delete process.env.ZETA_OFFICIAL_SKILLS_DIR;
			else process.env.ZENTA_OFFICIAL_SKILLS_DIR = previousDirOverride;
			delete process.env.ZETA_OFFICIAL_SKILLS_EMBED;
			if (previousSeedDir === undefined) delete process.env.ZETA_OFFICIAL_SKILLS_SEED_DIR;
			else process.env.ZETA_OFFICIAL_SKILLS_SEED_DIR = previousSeedDir;
		}
	});
});

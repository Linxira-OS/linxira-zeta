import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSkills } from "../src/extensibility/skills";
import { runSkillsCommand } from "../src/cli/skill-list";
import {
	type OfficialSkillsPack,
	OFFICIAL_SKILLS_RECORD_FILE,
	installOfficialSkills,
	officialSkillsInstalledNames,
	readOfficialSkillsInstallRecord,
	uninstallOfficialSkills,
} from "../src/discovery/official-skills";

/**
 * Installation contract for the bundled official pack: the pack must become
 * ordinary user files (`~/.zeta/agent/skills/<name>/SKILL.md`) without ever
 * destroying user work, and installing it must not make the session see the
 * same skill twice (user copy + `zeta-official` provider copy).
 */

const PACK_V1: OfficialSkillsPack = {
	hash: "pack-v1",
	files: {
		"alpha/SKILL.md": "---\nname: alpha\ndescription: Alpha skill.\n---\n\nAlpha body v1.\n",
		"beta/SKILL.md": "---\nname: beta\ndescription: Beta skill.\n---\n\nBeta body v1.\n",
	},
};

const PACK_V2: OfficialSkillsPack = {
	hash: "pack-v2",
	files: {
		"alpha/SKILL.md": "---\nname: alpha\ndescription: Alpha skill.\n---\n\nAlpha body v2.\n",
		"beta/SKILL.md": "---\nname: beta\ndescription: Beta skill.\n---\n\nBeta body v2.\n",
		"gamma/SKILL.md": "---\nname: gamma\ndescription: Gamma skill.\n---\n\nGamma body v1.\n",
	},
};

const REPO_PACK_DIR = path.resolve(import.meta.dir, "../../../skills/official");
const USER_DIR_ENV = "ZETA_SKILLS_USER_DIR";
const PACK_DIR_ENV = "ZETA_OFFICIAL_SKILLS_DIR";

const tempDirs: string[] = [];

async function tempUserDir(prefix = "zeta-official-install-"): Promise<string> {
	const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

/** Run `body` with the user skills root and the pack source redirected, then restore both. */
async function withIsolatedSkillsRoots<T>(
	roots: { userDir?: string; packDir?: string },
	body: () => Promise<T>,
): Promise<T> {
	const previousUserDir = process.env[USER_DIR_ENV];
	const previousPackDir = process.env[PACK_DIR_ENV];
	if (roots.userDir !== undefined) process.env[USER_DIR_ENV] = roots.userDir;
	if (roots.packDir !== undefined) process.env[PACK_DIR_ENV] = roots.packDir;
	try {
		return await body();
	} finally {
		if (previousUserDir === undefined) delete process.env[USER_DIR_ENV];
		else process.env[USER_DIR_ENV] = previousUserDir;
		if (previousPackDir === undefined) delete process.env[PACK_DIR_ENV];
		else process.env[PACK_DIR_ENV] = previousPackDir;
	}
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("official skills install", () => {
	test("installs a fresh pack into the user skills dir and records the pack hash", async () => {
		const dir = await tempUserDir();
		const result = installOfficialSkills({ dir, pack: PACK_V1, mode: "explicit" });
		expect(result?.installed.sort()).toEqual(["alpha/SKILL.md", "beta/SKILL.md"]);
		expect(result?.upgraded).toEqual([]);
		expect(await readFile(path.join(dir, "alpha", "SKILL.md"), "utf8")).toBe(PACK_V1.files["alpha/SKILL.md"]);
		expect(readOfficialSkillsInstallRecord(dir).packHash).toBe("pack-v1");
		expect([...officialSkillsInstalledNames(dir)].sort()).toEqual(["alpha", "beta"]);

		// Same pack again: settled, nothing rewritten, nothing reported.
		const second = installOfficialSkills({ dir, pack: PACK_V1, mode: "explicit" });
		expect(second?.unchanged).toBe(true);
		expect(second?.installed).toEqual([]);
		expect(second?.upgraded).toEqual([]);
		// The automatic path stops even earlier, on the recorded hash.
		expect(installOfficialSkills({ dir, pack: PACK_V1, mode: "auto" })).toBeNull();
	});

	test("keeps an edited file, upgrades untouched ones, and installs newly added ones", async () => {
		const dir = await tempUserDir();
		installOfficialSkills({ dir, pack: PACK_V1, mode: "explicit" });
		const edited = "---\nname: alpha\ndescription: Alpha skill (mine).\n---\n\nMy own alpha.\n";
		await writeFile(path.join(dir, "alpha", "SKILL.md"), edited);

		const result = installOfficialSkills({ dir, pack: PACK_V2, mode: "explicit" });
		expect(result?.kept).toEqual(["alpha/SKILL.md"]);
		expect(result?.upgraded).toEqual(["beta/SKILL.md"]);
		expect(result?.installed).toEqual(["gamma/SKILL.md"]);
		expect(await readFile(path.join(dir, "alpha", "SKILL.md"), "utf8")).toBe(edited);
		expect(await readFile(path.join(dir, "beta", "SKILL.md"), "utf8")).toBe(PACK_V2.files["beta/SKILL.md"]);

		// A later pack revision still refuses to clobber the user's alpha.
		const third = installOfficialSkills({
			dir,
			pack: {
				hash: "pack-v3",
				files: { ...PACK_V2.files, "alpha/SKILL.md": "---\nname: alpha\ndescription: A3.\n---\n\nAlpha v3.\n" },
			},
			mode: "explicit",
		});
		expect(third?.kept).toEqual(["alpha/SKILL.md"]);
		expect(await readFile(path.join(dir, "alpha", "SKILL.md"), "utf8")).toBe(edited);
	});

	test("the automatic path respects a deletion; an explicit install restores it", async () => {
		const dir = await tempUserDir();
		installOfficialSkills({ dir, pack: PACK_V1, mode: "explicit" });
		await rm(path.join(dir, "alpha"), { recursive: true, force: true });

		const auto = installOfficialSkills({ dir, pack: PACK_V2, mode: "auto" });
		expect(auto?.skipped).toEqual(["alpha/SKILL.md"]);
		expect(auto?.restored).toEqual([]);
		expect(existsSync(path.join(dir, "alpha", "SKILL.md"))).toBe(false);
		expect(await readFile(path.join(dir, "beta", "SKILL.md"), "utf8")).toBe(PACK_V2.files["beta/SKILL.md"]);

		const explicit = installOfficialSkills({ dir, pack: PACK_V2, mode: "explicit" });
		expect(explicit?.restored).toEqual(["alpha/SKILL.md"]);
		expect(await readFile(path.join(dir, "alpha", "SKILL.md"), "utf8")).toBe(PACK_V2.files["alpha/SKILL.md"]);
	});

	test("never overwrites a user-authored file that already owns a pack path", async () => {
		const dir = await tempUserDir();
		const mine = "---\nname: gamma\ndescription: Mine, not the pack's.\n---\n\nMine.\n";
		await mkdir(path.join(dir, "gamma"), { recursive: true });
		await writeFile(path.join(dir, "gamma", "SKILL.md"), mine);

		const first = installOfficialSkills({ dir, pack: PACK_V2, mode: "explicit" });
		expect(first?.kept).toEqual(["gamma/SKILL.md"]);
		const record = readOfficialSkillsInstallRecord(dir);
		expect(record.files?.["gamma/SKILL.md"]?.owned).toBe(false);
		expect([...officialSkillsInstalledNames(dir)].sort()).toEqual(["alpha", "beta"]);
		expect(await readFile(path.join(dir, "gamma", "SKILL.md"), "utf8")).toBe(mine);
	});

	test("uninstall removes untouched copies, keeps edits, and opts out of the automatic path", async () => {
		const dir = await tempUserDir();
		installOfficialSkills({ dir, pack: PACK_V1, mode: "explicit" });
		const edited = "---\nname: alpha\ndescription: Alpha skill (mine).\n---\n\nMy own alpha.\n";
		await writeFile(path.join(dir, "alpha", "SKILL.md"), edited);

		const result = uninstallOfficialSkills({ dir });
		expect(result.removed).toEqual(["beta/SKILL.md"]);
		expect(result.kept).toEqual(["alpha/SKILL.md"]);
		expect(existsSync(path.join(dir, "beta", "SKILL.md"))).toBe(false);
		expect(await readFile(path.join(dir, "alpha", "SKILL.md"), "utf8")).toBe(edited);
		expect(readOfficialSkillsInstallRecord(dir).optOut).toBe(true);

		// Opted out: the automatic path must leave the user alone...
		expect(installOfficialSkills({ dir, pack: PACK_V1, mode: "auto" })).toBeNull();
		// ...while an explicit install is the documented way back, and it still
		// does not touch the edited file.
		const reinstall = installOfficialSkills({ dir, pack: PACK_V1, mode: "explicit" });
		expect(reinstall?.installed).toEqual(["beta/SKILL.md"]);
		expect(reinstall?.kept).toEqual(["alpha/SKILL.md"]);
		expect(await readFile(path.join(dir, "alpha", "SKILL.md"), "utf8")).toBe(edited);
		expect(readOfficialSkillsInstallRecord(dir).optOut).toBeUndefined();
	});

	test("does not double-provision: the provider yields names the user skills dir already serves", async () => {
		const userDir = await tempUserDir();
		expect(existsSync(path.join(REPO_PACK_DIR, "docx", "SKILL.md"))).toBe(true);
		await withIsolatedSkillsRoots({ userDir, packDir: REPO_PACK_DIR }, async () => {
			const cwd = await tempUserDir("zeta-official-install-cwd-");
			const before = await loadSkills({ cwd });
			expect(before.skills.some(s => s.name === "docx" && s.source === "zeta-official:user")).toBe(true);

			// Install the real pack into the user dir, then rediscover.
			const install = installOfficialSkills({ mode: "explicit" });
			expect(install?.installed.length).toBeGreaterThanOrEqual(4);
			const after = await loadSkills({ cwd });
			const docx = after.skills.filter(s => s.name === "docx");
			expect(docx).toHaveLength(1);
			expect(docx[0]?.source).toBe("native:user");
			expect(after.skills.some(s => s.name.startsWith("zeta-official/"))).toBe(false);
			// The install marker itself is not a skill.
			expect(existsSync(path.join(userDir, OFFICIAL_SKILLS_RECORD_FILE))).toBe(true);
			expect(after.skills.some(s => s.name.includes("official-skills"))).toBe(false);

			// Editing the installed copy must not resurrect a provider ghost either.
			await writeFile(
				path.join(userDir, "docx", "SKILL.md"),
				`${await readFile(path.join(userDir, "docx", "SKILL.md"), "utf8")}\nEdited by the user.\n`,
			);
			const edited = await loadSkills({ cwd });
			expect(edited.skills.filter(s => s.name === "docx")).toHaveLength(1);
			expect(edited.skills.some(s => s.name.startsWith("zeta-official/"))).toBe(false);

			// `zetacode skill list` sees the same single copy.
			const listed = await runSkillsCommand({
				cwd,
				skillsSettings: { enabled: true, enableOfficial: true, enablePiUser: true },
			});
			expect(listed.skills.filter(s => s.name === "docx")).toHaveLength(1);
			expect(listed.skills.some(s => s.name.startsWith("zeta-official/"))).toBe(false);
		});
	});
});

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { annotateSkillsWithInstallInfo, getGlobalSkillsLockPath } from "../../src/server/web-gateway/skills-lock";

function writeJson(path: string, value: unknown): void {
	fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeSkill(name: string, filePath: string, scope: string) {
	return {
		name,
		description: `${name} description`,
		filePath,
		baseDir: filePath.slice(0, -"/SKILL.md".length),
		disableModelInvocation: false,
		sourceInfo: { scope },
	};
}

describe("getGlobalSkillsLockPath", () => {
	it("uses the CLI global lock location", () => {
		const saved = process.env.XDG_STATE_HOME;
		try {
			delete process.env.XDG_STATE_HOME;
			expect(getGlobalSkillsLockPath({ homeDir: "/home/test", xdgStateHome: undefined })).toBe(
				path.join("/home/test", ".agents", ".skill-lock.json"),
			);
		} finally {
			if (saved === undefined) delete process.env.XDG_STATE_HOME;
			else process.env.XDG_STATE_HOME = saved;
		}
		expect(getGlobalSkillsLockPath({ homeDir: "/home/test", xdgStateHome: "/state" })).toBe(
			path.join("/state", "skills", ".skill-lock.json"),
		);
	});
});

describe("annotateSkillsWithInstallInfo", () => {
	it("annotates only lock entries that exist in the matching scope", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-skill-lock-"));
		try {
			const cwd = path.join(root, "project");
			const agentDir = path.join(root, "home", ".zeta", "agent");
			const globalLockPath = path.join(root, "global-lock.json");
			const projectLockPath = path.join(cwd, "skills-lock.json");
			const globalSkillPath = path.join(agentDir, "skills", "edge-tts", "SKILL.md");
			const projectSkillPath = path.join(cwd, ".zeta", "skills", "find-skills", "SKILL.md");
			const manualSkillPath = path.join(agentDir, "skills", "manual", "SKILL.md");
			const otherAgentSkillPath = path.join(root, "other-agent", "tts", "SKILL.md");

			for (const p of [globalSkillPath, projectSkillPath, manualSkillPath, otherAgentSkillPath]) {
				fs.mkdirSync(path.join(p, ".."), { recursive: true });
				fs.writeFileSync(p, "---\nname: test\n---\n", "utf8");
			}

			writeJson(globalLockPath, {
				version: 3,
				skills: {
					"edge-tts": {
						source: "https://github.com/aahl/skills.git",
						sourceType: "github",
						skillPath: "skills/edge-tts/SKILL.md",
						skillFolderHash: "global-version",
					},
					tts: { source: "noizai/skills", sourceType: "github" },
				},
			});
			writeJson(projectLockPath, {
				version: 1,
				skills: {
					"find-skills": {
						source: "vercel-labs/skills",
						sourceType: "github",
						skillPath: "skills/find-skills/SKILL.md",
						computedHash: "project-version",
					},
				},
			});

			const annotated = annotateSkillsWithInstallInfo(
				[
					makeSkill("edge-tts", globalSkillPath, "user"),
					makeSkill("find-skills", projectSkillPath, "project"),
					makeSkill("manual", manualSkillPath, "user"),
					makeSkill("tts", otherAgentSkillPath, "user"),
				],
				{ cwd, agentDir, globalLockPath, projectLockPath },
			);

			expect(annotated[0].install).toEqual({
				package: "aahl/skills@edge-tts",
				scope: "global",
				source: "aahl/skills",
				sourceType: "github",
				skillsShUrl: "https://skills.sh/aahl/skills/edge-tts",
				skillPath: "skills/edge-tts/SKILL.md",
				versionHash: "global-version",
				canCheckForUpdates: true,
			});
			expect(annotated[1].install).toEqual({
				package: "vercel-labs/skills@find-skills",
				scope: "project",
				source: "vercel-labs/skills",
				sourceType: "github",
				skillsShUrl: "https://skills.sh/vercel-labs/skills/find-skills",
				skillPath: "skills/find-skills/SKILL.md",
				versionHash: "project-version",
				canCheckForUpdates: true,
			});
			expect(annotated[2].install).toBeUndefined();
			expect(annotated[3].install).toBeUndefined();
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("ignores stale lock entries and malformed lock files", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-skill-lock-"));
		try {
			const cwd = path.join(root, "project");
			const agentDir = path.join(root, "agent");
			const missingPath = path.join(agentDir, "skills", "missing", "SKILL.md");
			const projectSkillPath = path.join(cwd, ".zeta", "skills", "broken", "SKILL.md");
			const globalLockPath = path.join(root, "global-lock.json");
			const projectLockPath = path.join(root, "project-lock.json");
			fs.mkdirSync(path.join(projectSkillPath, ".."), { recursive: true });
			fs.writeFileSync(projectSkillPath, "---\nname: broken\n---\n", "utf8");
			writeJson(globalLockPath, {
				version: 3,
				skills: {
					missing: { source: "owner/repo", sourceType: "github" },
				},
			});
			fs.writeFileSync(projectLockPath, "not json", "utf8");

			const skills = annotateSkillsWithInstallInfo(
				[makeSkill("missing", missingPath, "user"), makeSkill("broken", projectSkillPath, "project")],
				{ cwd, agentDir, globalLockPath, projectLockPath },
			);

			expect(skills[0].install).toBeUndefined();
			expect(skills[1].install).toBeUndefined();
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not compare a project ref with the default skills.sh snapshot", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-skill-lock-"));
		try {
			const cwd = path.join(root, "project");
			const agentDir = path.join(root, "agent");
			const projectLockPath = path.join(cwd, "skills-lock.json");
			const projectSkillPath = path.join(cwd, ".zeta", "skills", "preview", "SKILL.md");
			fs.mkdirSync(path.join(projectSkillPath, ".."), { recursive: true });
			fs.writeFileSync(projectSkillPath, "---\nname: preview\n---\n", "utf8");
			writeJson(projectLockPath, {
				version: 1,
				skills: {
					preview: {
						source: "owner/repo",
						sourceType: "github",
						skillPath: "skills/preview/SKILL.md",
						ref: "preview",
						computedHash: "project-version",
					},
				},
			});

			const [skill] = annotateSkillsWithInstallInfo([makeSkill("preview", projectSkillPath, "project")], {
				cwd,
				agentDir,
				projectLockPath,
				globalLockPath: path.join(root, "missing.json"),
			});

			expect(skill.install?.ref).toBe("preview");
			expect(skill.install?.canCheckForUpdates).toBe(false);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

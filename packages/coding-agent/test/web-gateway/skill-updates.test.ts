import { describe, expect, it } from "bun:test";
import type { SkillInstallInfo } from "../../src/server/web-gateway/dto";
import {
	buildSkillUpdateArgs,
	checkSkillUpdate,
	checkSkillUpdates,
	skillUpdateKey,
} from "../../src/server/web-gateway/skill-updates";

function install(overrides: Partial<SkillInstallInfo> = {}): SkillInstallInfo {
	return {
		package: "owner/repo@example-skill",
		scope: "global",
		source: "owner/repo",
		sourceType: "github",
		skillsShUrl: "https://skills.sh/owner/repo/example-skill",
		skillPath: "skills/example-skill/SKILL.md",
		versionHash: "current-hash",
		canCheckForUpdates: true,
		...overrides,
	};
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("checkSkillUpdate", () => {
	it("compares a global lock version with the remote Git tree", async () => {
		const seen: string[] = [];
		const upToDate = await checkSkillUpdate(install(), {
			fetcher: async url => {
				seen.push(url);
				return jsonResponse({
					sha: "root-hash",
					tree: [{ type: "tree", path: "skills/example-skill", sha: "current-hash" }],
				});
			},
		});

		expect(upToDate.state).toBe("up-to-date");
		expect(upToDate.latestVersion).toBe("current-hash");
		expect(seen[0]).toMatch(/repos\/owner\/repo\/git\/trees\/HEAD/);

		const available = await checkSkillUpdate(install(), {
			fetcher: async () =>
				jsonResponse({
					sha: "root-hash",
					tree: [{ type: "tree", path: "skills/example-skill", sha: "next-hash" }],
				}),
		});
		expect(available.state).toBe("update-available");
		expect(available.currentVersion).toBe("current-hash");
		expect(available.latestVersion).toBe("next-hash");
	});

	it("uses the repository hash for a root global skill", async () => {
		const result = await checkSkillUpdate(install({ skillPath: "SKILL.md" }), {
			fetcher: async () => jsonResponse({ sha: "next-root", tree: [] }),
		});

		expect(result.state).toBe("update-available");
		expect(result.latestVersion).toBe("next-root");
	});

	it("compares a project lock version with the skills.sh snapshot", async () => {
		let requestedUrl = "";
		const result = await checkSkillUpdate(install({ scope: "project" }), {
			skillsApiBase: "https://skills.test",
			fetcher: async url => {
				requestedUrl = url;
				return jsonResponse({ hash: "current-hash" });
			},
		});

		expect(result.state).toBe("up-to-date");
		expect(requestedUrl).toBe("https://skills.test/api/download/owner/repo/example-skill");
	});

	it("returns unsupported without making a remote request", async () => {
		let called = false;
		const result = await checkSkillUpdate(install({ canCheckForUpdates: false, versionHash: undefined }), {
			fetcher: async () => {
				called = true;
				return jsonResponse({});
			},
		});

		expect(result.state).toBe("unsupported");
		expect(called).toBe(false);
	});

	it("returns a scoped error when the remote check fails", async () => {
		const result = await checkSkillUpdate(install(), {
			fetcher: async () => jsonResponse({}, 503),
		});

		expect(result.state).toBe("error");
		expect(result.message).toBe("HTTP 503");
		expect(skillUpdateKey(install())).toBe("global\u0000owner/repo@example-skill");
	});

	it("falls back to Git when the GitHub API is rate limited", async () => {
		let resolved = false;
		const result = await checkSkillUpdate(install(), {
			fetcher: async () => jsonResponse({}, 403),
			resolveGitTreeHash: async () => {
				resolved = true;
				return "next-hash";
			},
		});

		expect(resolved).toBe(true);
		expect(result.state).toBe("update-available");
		expect(result.latestVersion).toBe("next-hash");
	});
});

describe("buildSkillUpdateArgs", () => {
	it("builds update commands for each scope", () => {
		expect(buildSkillUpdateArgs(install())).toEqual([
			"skills",
			"add",
			"owner/repo/skills/example-skill",
			"--skill",
			"example-skill",
			"-y",
			"--agent",
			"omp",
			"-g",
		]);
		expect(buildSkillUpdateArgs(install({ scope: "project" }))).toEqual([
			"skills",
			"add",
			"owner/repo/skills/example-skill",
			"--skill",
			"example-skill",
			"-y",
			"--agent",
			"omp",
		]);
		expect(buildSkillUpdateArgs(install({ ref: "release/v2" }))).toEqual([
			"skills",
			"add",
			"owner/repo/skills/example-skill#release%2Fv2",
			"--skill",
			"example-skill",
			"-y",
			"--agent",
			"omp",
			"-g",
		]);
	});
});

describe("checkSkillUpdates", () => {
	it("reuses one remote request for skills from the same GitHub source", async () => {
		let requests = 0;
		const results = await checkSkillUpdates(
			[
				install(),
				install({
					package: "owner/repo@another-skill",
					skillPath: "skills/another-skill/SKILL.md",
					versionHash: "another-hash",
				}),
			],
			{
				fetcher: async () => {
					requests++;
					return jsonResponse({
						sha: "root-hash",
						tree: [
							{ type: "tree", path: "skills/example-skill", sha: "current-hash" },
							{ type: "tree", path: "skills/another-skill", sha: "another-hash" },
						],
					});
				},
			},
		);

		expect(requests).toBe(1);
		expect(results.map(item => item.state)).toEqual(["up-to-date", "up-to-date"]);
	});
});

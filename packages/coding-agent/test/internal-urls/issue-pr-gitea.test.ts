/**
 * `issue://` / `pr://` Gitea routing and API-shape tests.
 *
 * Routing is exercised end-to-end through the router with `gitea.available`
 * stubbed; the Gitea runner's `json`/`text` are spied per test, so every
 * assertion below is about the concrete `tea api` endpoint the protocol asks
 * for, not an invented HTTP client shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { removeWithRetries } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import { InternalUrlRouter } from "@linxiraos/zeta/internal-urls";
import { resetForTests as resetCacheForTests } from "@linxiraos/zeta/tools/github-cache";
import { DEFAULT_REPO_INFLIGHT, DEFAULT_REPO_RESOLVED, resetTeaLoginsCache } from "@linxiraos/zeta/tools/tea-common";
import { gitea } from "@linxiraos/zeta/utils/gitea";
import { github } from "@linxiraos/zeta/utils/github";

let tempDir: string;
let originalEnv: string | undefined;
let originalGhToken: string | undefined;

const GITEA_HOST = "gitea.example.com";
const LOGINS = [{ name: "work", url: `https://${GITEA_HOST}`, ssh_host: GITEA_HOST }];

function enabledSettings(): Settings {
	return Settings.isolated({ "gitea.enabled": true });
}

interface SpiedCalls {
	mock: { calls: unknown[][] };
}

function apiCalls(spy: SpiedCalls): string[][] {
	return spy.mock.calls.map(call => call[1] as string[]).filter(args => args[0] === "api");
}

function apiEndpoint(args: string[]): string {
	return args[args.length - 1] ?? "";
}

function teaIssue(number: number) {
	return {
		number,
		title: `Gitea issue ${number}`,
		body: "issue body",
		state: "open",
		user: { login: "alice" },
		labels: [{ name: "bug" }],
		comments: 1,
		created_at: "2026-04-01T09:00:00Z",
		updated_at: "2026-04-01T10:00:00Z",
		html_url: `https://${GITEA_HOST}/owner/repo/issues/${number}`,
	};
}

function teaPull(number: number, overrides: Record<string, unknown> = {}) {
	return {
		number,
		title: `Gitea PR ${number}`,
		body: "pr body",
		state: "open",
		user: { login: "alice" },
		labels: [],
		base: { ref: "main" },
		head: { ref: "feature/x" },
		draft: false,
		merged: false,
		html_url: `https://${GITEA_HOST}/owner/repo/pulls/${number}`,
		...overrides,
	};
}

function diffText(): string {
	return [
		"diff --git a/src/one.ts b/src/one.ts",
		"index 0000000..1111111 100644",
		"--- a/src/one.ts",
		"+++ b/src/one.ts",
		"@@ -1,2 +1,2 @@",
		"-old one",
		"+new one",
		"diff --git a/src/two.ts b/src/two.ts",
		"index 0000000..2222222 100644",
		"--- a/src/two.ts",
		"+++ b/src/two.ts",
		"@@ -1 +1,2 @@",
		" kept",
		"+added two",
	].join("\n");
}

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "issue-pr-gitea-"));
	originalEnv = process.env.OMP_GITHUB_CACHE_DB;
	process.env.OMP_GITHUB_CACHE_DB = path.join(tempDir, "github-cache.db");
	originalGhToken = process.env.GH_TOKEN;
	process.env.GH_TOKEN = "test-token";
	resetCacheForTests();
	InternalUrlRouter.resetForTests();
	resetTeaLoginsCache();
	DEFAULT_REPO_RESOLVED.clear();
	DEFAULT_REPO_INFLIGHT.clear();
	vi.spyOn(gitea, "available").mockReturnValue(true);
});

afterEach(async () => {
	resetCacheForTests();
	InternalUrlRouter.resetForTests();
	resetTeaLoginsCache();
	DEFAULT_REPO_RESOLVED.clear();
	DEFAULT_REPO_INFLIGHT.clear();
	if (originalEnv === undefined) delete process.env.OMP_GITHUB_CACHE_DB;
	else process.env.OMP_GITHUB_CACHE_DB = originalEnv;
	if (originalGhToken === undefined) delete process.env.GH_TOKEN;
	else process.env.GH_TOKEN = originalGhToken;
	vi.restoreAllMocks();
	await removeWithRetries(tempDir);
});

describe("issue://pr:// host routing", () => {
	it("routes a configured Gitea host through the Gitea runner", async () => {
		const json = vi.spyOn(gitea, "json").mockImplementation(async (_cwd, args) => {
			if (args[0] === "logins") return LOGINS as never;
			if (apiEndpoint(args) === "/repos/owner/repo/issues/42") return teaIssue(42) as never;
			if (apiEndpoint(args) === "/repos/owner/repo/issues/42/comments") return [] as never;
			throw new Error(`unexpected endpoint ${apiEndpoint(args)}`);
		});
		const githubJson = vi.spyOn(github, "json");

		const resource = await InternalUrlRouter.instance().resolve(`issue://${GITEA_HOST}/owner/repo/42`, {
			settings: enabledSettings(),
			cwd: path.join(tempDir, "not-a-checkout"),
		});

		expect(resource.content).toContain("# Issue #42: Gitea issue 42");
		expect(resource.notes?.[0]).toBe("Fetched live");
		const views = apiCalls(json).filter(args => apiEndpoint(args) === "/repos/owner/repo/issues/42");
		expect(views).toHaveLength(1);
		expect(views[0]).toContain("--login");
		expect(views[0]?.[views[0].indexOf("--login") + 1]).toBe("work");
		expect(githubJson).not.toHaveBeenCalled();
	});

	it("keeps an unconfigured host on the GitHub path even when Gitea is enabled", async () => {
		const giteaJson = vi.spyOn(gitea, "json").mockImplementation(async (_cwd, args) => {
			if (args[0] === "logins") return LOGINS as never;
			return [] as never;
		});
		const githubJson = vi.spyOn(github, "json").mockImplementation(async (_cwd, args) => {
			if (args[0] !== "pr") return [] as never;
			return {
				number: 77,
				title: "GitHub PR 77",
				state: "OPEN",
				isDraft: false,
				baseRefName: "main",
				headRefName: "feature/x",
				author: { login: "octocat" },
				body: "github body",
				createdAt: "2026-04-01T09:00:00Z",
				updatedAt: "2026-04-01T10:00:00Z",
				url: "https://ghe.example.com/owner/repo/pull/77",
				labels: [],
				files: [],
				reviews: [],
				comments: [],
			} as never;
		});

		const resource = await InternalUrlRouter.instance().resolve("pr://ghe.example.com/owner/repo/77", {
			settings: enabledSettings(),
			cwd: path.join(tempDir, "not-a-checkout"),
		});

		expect(resource.content).toContain("# Pull Request #77: GitHub PR 77");
		expect(resource.notes).toContain("Diff: pr://ghe.example.com/owner/repo/77/diff");
		expect(apiCalls(giteaJson)).toHaveLength(0);
		expect(githubJson).toHaveBeenCalled();
	});

	it("resolves a bare issue://<n> against the checkout's Gitea remote", async () => {
		const cwd = path.join(tempDir, "work");
		DEFAULT_REPO_RESOLVED.set(path.resolve(cwd), `${GITEA_HOST}/owner/repo`);
		const json = vi.spyOn(gitea, "json").mockImplementation(async (_cwd, args) => {
			if (args[0] === "logins") return LOGINS as never;
			if (apiEndpoint(args) === "/repos/owner/repo/issues/7") return teaIssue(7) as never;
			if (apiEndpoint(args) === "/repos/owner/repo/issues/7/comments") return [] as never;
			throw new Error(`unexpected endpoint ${apiEndpoint(args)}`);
		});
		const githubJson = vi.spyOn(github, "json");

		const resource = await InternalUrlRouter.instance().resolve("issue://7", {
			settings: enabledSettings(),
			cwd,
		});

		expect(resource.content).toContain("# Issue #7: Gitea issue 7");
		expect(apiCalls(json).map(apiEndpoint)).toContain("/repos/owner/repo/issues/7");
		expect(githubJson).not.toHaveBeenCalled();
	});

	it("does nothing differently when gitea.enabled is false", async () => {
		const giteaJson = vi.spyOn(gitea, "json");
		const githubJson = vi.spyOn(github, "json").mockResolvedValue({
			number: 9,
			title: "GitHub issue 9",
			state: "OPEN",
			stateReason: null,
			author: { login: "octocat" },
			body: "github body",
			createdAt: "2026-04-01T09:00:00Z",
			updatedAt: "2026-04-01T10:00:00Z",
			url: "https://github.com/owner/repo/issues/9",
			labels: [],
			comments: [],
		} as never);

		const resource = await InternalUrlRouter.instance().resolve(`issue://owner/repo/9`, {
			settings: Settings.isolated({ "gitea.enabled": false }),
			cwd: path.join(tempDir, "not-a-checkout"),
		});

		expect(resource.url).toBe("issue://owner/repo/9");
		expect(giteaJson).not.toHaveBeenCalled();
		expect(githubJson).toHaveBeenCalled();
	});
});

describe("Gitea list endpoints", () => {
	it("passes state/limit/author/label to the issues endpoint", async () => {
		const json = vi.spyOn(gitea, "json").mockImplementation(async (_cwd, args) => {
			if (args[0] === "logins") return LOGINS as never;
			if (apiEndpoint(args).startsWith("/repos/owner/repo/issues?")) return [teaIssue(1)] as never;
			throw new Error(`unexpected endpoint ${apiEndpoint(args)}`);
		});

		const resource = await InternalUrlRouter.instance().resolve(
			`issue://${GITEA_HOST}/owner/repo?state=closed&limit=5&author=alice&label=bug`,
			{ settings: enabledSettings(), cwd: path.join(tempDir, "not-a-checkout") },
		);

		const endpoint = apiEndpoint(apiCalls(json).find(args => apiEndpoint(args).startsWith("/repos/")) ?? []);
		const params = new URL(endpoint, "http://gitea.invalid").searchParams;
		expect(params.get("state")).toBe("closed");
		expect(params.get("limit")).toBe("5");
		expect(params.get("type")).toBe("issues");
		expect(params.get("created_by")).toBe("alice");
		expect(params.get("labels")).toBe("bug");
		expect(resource.content).toContain(`# Issues in ${GITEA_HOST}/owner/repo (closed, up to 5)`);
		expect(resource.content).toContain(`issue://${GITEA_HOST}/owner/repo/1`);
	});

	it("maps pr state=merged to closed pulls and keeps only merged rows", async () => {
		const json = vi.spyOn(gitea, "json").mockImplementation(async (_cwd, args) => {
			if (args[0] === "logins") return LOGINS as never;
			if (apiEndpoint(args).startsWith("/repos/owner/repo/pulls?")) {
				return [teaPull(1, { merged: true }), teaPull(2, { merged: false })] as never;
			}
			throw new Error(`unexpected endpoint ${apiEndpoint(args)}`);
		});

		const resource = await InternalUrlRouter.instance().resolve(
			`pr://${GITEA_HOST}/owner/repo?state=merged&limit=10`,
			{ settings: enabledSettings(), cwd: path.join(tempDir, "not-a-checkout") },
		);

		const endpoint = apiEndpoint(apiCalls(json).find(args => apiEndpoint(args).startsWith("/repos/")) ?? []);
		expect(new URL(endpoint, "http://gitea.invalid").searchParams.get("state")).toBe("closed");
		expect(resource.content).toContain("Gitea PR 1");
		expect(resource.content).not.toContain("Gitea PR 2");
	});
});

describe("pr://.../diff against Gitea", () => {
	function mockDiff() {
		return vi.spyOn(gitea, "text").mockImplementation(async (_cwd, args) => {
			if (apiEndpoint(args) === "/repos/owner/repo/pulls/7.diff") return diffText();
			throw new Error(`unexpected endpoint ${apiEndpoint(args)}`);
		});
	}

	beforeEach(() => {
		vi.spyOn(gitea, "json").mockImplementation(async (_cwd, args) => {
			if (args[0] === "logins") return LOGINS as never;
			return [] as never;
		});
	});

	it("lists files parsed from the pulls .diff response", async () => {
		const text = mockDiff();
		const resource = await InternalUrlRouter.instance().resolve(`pr://${GITEA_HOST}/owner/repo/7/diff`, {
			settings: enabledSettings(),
			cwd: path.join(tempDir, "not-a-checkout"),
		});

		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content).toContain("src/one.ts  +1 -1  [modified]");
		expect(resource.content).toContain(`pr://${GITEA_HOST}/owner/repo/7/diff/2`);
		expect(text).toHaveBeenCalledTimes(1);
	});

	it("returns the verbatim unified diff for /diff/all", async () => {
		mockDiff();
		const resource = await InternalUrlRouter.instance().resolve(`pr://${GITEA_HOST}/owner/repo/7/diff/all`, {
			settings: enabledSettings(),
			cwd: path.join(tempDir, "not-a-checkout"),
		});

		expect(resource.contentType).toBe("text/plain");
		expect(resource.content).toBe(diffText());
	});

	it("slices one file for /diff/<i>", async () => {
		mockDiff();
		const resource = await InternalUrlRouter.instance().resolve(`pr://${GITEA_HOST}/owner/repo/7/diff/2`, {
			settings: enabledSettings(),
			cwd: path.join(tempDir, "not-a-checkout"),
		});

		expect(resource.content).toContain("diff --git a/src/two.ts b/src/two.ts");
		expect(resource.content).not.toContain("src/one.ts");
		expect(resource.notes).toContain("Showing file 2/2: src/two.ts");
	});
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ToolCall } from "@linxiraos/pi-ai";
import { validateToolArguments } from "@linxiraos/pi-ai/utils/validation";
import { Settings } from "@linxiraos/zeta/config/settings";
import type { ToolSession } from "@linxiraos/zeta/tools";
import { BUILTIN_TOOLS, resolveBuiltinToolPlan } from "@linxiraos/zeta/tools";
import { BUILTIN_TOOL_NAMES } from "@linxiraos/zeta/tools/builtin-names";
import {
	DEFAULT_REPO_INFLIGHT,
	DEFAULT_REPO_RESOLVED,
	formatRepoRef,
	parseGiteaRemoteUrl,
	parseIssueUrl,
	parsePositiveDecimalInt,
	parsePullRequestUrl,
	parseRepoRef,
	resetTeaLoginsCache,
	resolveLoginArgs,
	resolveTeaLimit,
	resolveTeaLogins,
	resolveTeaRepoMemoized,
	repoFromUrl,
} from "@linxiraos/zeta/tools/tea-common";
import {
	formatIssueList,
	formatIssueView,
	formatPrList,
	formatPrView,
	formatReleaseList,
	parseCreatedIndex,
	TeaTool,
} from "@linxiraos/zeta/tools/tea";
import { gitea } from "@linxiraos/zeta/utils/gitea";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { getAgentDir, hashPath, removeWithRetries, setAgentDir } from "@linxiraos/pi-utils";

// Isolate every `git` invocation in this file from the developer's host
// configuration (see test/tools/gh.test.ts for the full rationale).
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_TERMINAL_PROMPT = "0";
process.env.GIT_ASKPASS = "true";
delete process.env.XDG_CONFIG_HOME;

const TEA_OPS = [
	"repo_view",
	"repo_create",
	"issue_view",
	"issue_list",
	"issue_create",
	"pr_view",
	"pr_list",
	"pr_create",
	"pr_checkout",
	"pr_merge",
	"release_list",
	"release_create",
] as const;

const TEA_READ_OPS = ["repo_view", "issue_view", "issue_list", "pr_view", "pr_list", "release_list"] as const;

function createSession(
	cwd: string = "/tmp/test",
	settings: Settings = Settings.isolated({ "gitea.enabled": true }),
): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getArtifactsDir: () => null,
		getSessionSpawns: () => null,
		settings,
	};
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.find(block => block.type === "text")?.text ?? "";
}

function runGit(cwd: string, args: string[]): string {
	const result = Bun.spawnSync(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Test User",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test User",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
	});
	if (result.exitCode !== 0) {
		const stderr = new TextDecoder().decode(result.stderr).trim();
		const stdout = new TextDecoder().decode(result.stdout).trim();
		throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`);
	}
	return new TextDecoder().decode(result.stdout).trim();
}

interface PrFixture {
	baseDir: string;
	repoRoot: string;
	featureSha: string;
	mainSha: string;
}

async function buildPrFixture(): Promise<PrFixture> {
	const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "tea-tool-"));
	const repoRoot = path.join(baseDir, "repo");
	runGit(baseDir, ["init", "-b", "main", repoRoot]);
	await fs.writeFile(path.join(repoRoot, "README.md"), "base\n");
	runGit(repoRoot, ["add", "README.md"]);
	runGit(repoRoot, ["commit", "-m", "base commit"]);
	const mainSha = runGit(repoRoot, ["rev-parse", "HEAD"]);

	runGit(repoRoot, ["checkout", "-b", "feature"]);
	await fs.writeFile(path.join(repoRoot, "README.md"), "base\nfeature\n");
	runGit(repoRoot, ["commit", "-am", "feature commit"]);
	const featureSha = runGit(repoRoot, ["rev-parse", "HEAD"]);
	runGit(repoRoot, ["checkout", "main"]);

	runGit(baseDir, ["clone", "--bare", repoRoot, path.join(baseDir, "origin.git")]);
	runGit(repoRoot, ["remote", "add", "origin", "https://gitea.example/owner/repo.git"]);
	return { baseDir, repoRoot, featureSha, mainSha };
}

// getWorktreeDir() resolves under the agent dirs root, which is built from
// os.homedir() at construction time — stub the home and rebuild the resolver
// so PR worktrees land in a temp dir.
async function setupTempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
	const home = await fs.mkdtemp(path.join(os.tmpdir(), "tea-tool-home-"));
	vi.spyOn(os, "homedir").mockReturnValue(home);
	const xdgKeys = ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const;
	const xdgPrevious: Partial<Record<(typeof xdgKeys)[number], string | undefined>> = {};
	for (const key of xdgKeys) {
		xdgPrevious[key] = process.env[key];
		delete process.env[key];
	}
	const originalAgentDir = getAgentDir();
	setAgentDir(path.join(home, ".zeta", "agent"));
	return {
		home,
		cleanup: async () => {
			setAgentDir(originalAgentDir);
			for (const key of xdgKeys) {
				const previous = xdgPrevious[key];
				if (previous === undefined) delete process.env[key];
				else process.env[key] = previous;
			}
			await removeWithRetries(home);
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	DEFAULT_REPO_RESOLVED.clear();
	DEFAULT_REPO_INFLIGHT.clear();
	resetTeaLoginsCache();
});

describe("gitea runner failure mapping", () => {
	it("maps login failures to the authentication message", async () => {
		vi.spyOn(gitea, "run").mockResolvedValue({
			exitCode: 1,
			stdout: "",
			stderr: "No gitea login configured. Please run 'tea login add'",
		});
		await expect(gitea.text("/tmp", ["issues", "list"])).rejects.toThrow(
			/^Gitea CLI not authenticated\. Run `tea login`\.$/,
		);
	});

	it("maps login-command hints in stdout to the authentication message", async () => {
		vi.spyOn(gitea, "run").mockResolvedValue({
			exitCode: 1,
			stdout: 'token does not exist, run "tea login add" first',
			stderr: "",
		});
		await expect(gitea.json("/tmp", ["issues", "list"])).rejects.toThrow(
			"Gitea CLI not authenticated. Run `tea login`.",
		);
	});

	it("rejects invalid JSON output", async () => {
		vi.spyOn(gitea, "run").mockResolvedValue({ exitCode: 0, stdout: "not json", stderr: "" });
		await expect(gitea.json("/tmp", ["logins", "list"])).rejects.toThrow("Gitea CLI returned invalid JSON output.");
	});

	it("rejects empty output for json()", async () => {
		vi.spyOn(gitea, "run").mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
		await expect(gitea.json("/tmp", ["logins", "list"])).rejects.toThrow("Gitea CLI returned empty output.");
	});

	it("passes non-auth CLI errors through unchanged", async () => {
		vi.spyOn(gitea, "run").mockResolvedValue({ exitCode: 1, stdout: "", stderr: "Error: not found" });
		await expect(gitea.text("/tmp", ["repos", "view"])).rejects.toThrow(/^Error: not found$/);
	});

	it("falls back to a command summary when the CLI prints nothing", async () => {
		vi.spyOn(gitea, "run").mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
		await expect(gitea.text("/tmp", ["repos", "view"])).rejects.toThrow("Gitea CLI command failed: tea repos view");
	});
});

describe("tea pure helpers", () => {
	it("parses [host/]owner/repo refs", () => {
		expect(parseRepoRef("gitea.example.com/owner/repo")).toEqual({ host: "gitea.example.com", slug: "owner/repo" });
		expect(parseRepoRef("owner/repo")).toEqual({ slug: "owner/repo" });
		expect(parseRepoRef("a/b/c")).toEqual({ host: "a", slug: "b/c" });
		expect(parseRepoRef("a/b/c/d")).toEqual({ slug: "a/b/c/d" });
		expect(parseRepoRef("bare")).toEqual({ slug: "bare" });
		expect(formatRepoRef("gitea.example.com", "owner/repo")).toBe("gitea.example.com/owner/repo");
		expect(formatRepoRef(undefined, "owner/repo")).toBe("owner/repo");
	});

	it("parses Gitea clone URLs in https, ssh, and scp forms", () => {
		expect(parseGiteaRemoteUrl("https://gitea.example.com/owner/repo.git")).toEqual({
			host: "gitea.example.com",
			slug: "owner/repo",
		});
		expect(parseGiteaRemoteUrl("ssh://git@192.168.1.10:2222/owner/repo.git")).toEqual({
			host: "192.168.1.10:2222",
			slug: "owner/repo",
		});
		expect(parseGiteaRemoteUrl("git@gitea.example.com:owner/repo.git")).toEqual({
			host: "gitea.example.com",
			slug: "owner/repo",
		});
		expect(parseGiteaRemoteUrl("http://gitea.example.com/owner/repo")).toEqual({
			host: "gitea.example.com",
			slug: "owner/repo",
		});
		expect(parseGiteaRemoteUrl("https://github.com/owner/repo")).toEqual({
			host: "github.com",
			slug: "owner/repo",
		});
		expect(parseGiteaRemoteUrl("/local/path")).toBeUndefined();
		expect(parseGiteaRemoteUrl("")).toBeUndefined();
	});

	it("keeps the host in repo URLs (tea has no default host)", () => {
		expect(repoFromUrl("https://gitea.example.com/owner/repo")).toBe("gitea.example.com/owner/repo");
		expect(repoFromUrl("https://192.168.1.10:3000/owner/repo?x=1")).toBe("192.168.1.10:3000/owner/repo");
		expect(repoFromUrl("not a url")).toBeUndefined();
	});

	it("parses issue and PR URLs", () => {
		expect(parseIssueUrl("https://gitea.example.com/owner/repo/issues/7")).toEqual({
			repo: "gitea.example.com/owner/repo",
			issueNumber: 7,
		});
		expect(parsePullRequestUrl("http://gitea.example.com/owner/repo/pulls/12")).toEqual({
			repo: "gitea.example.com/owner/repo",
			prNumber: 12,
		});
		expect(parseIssueUrl("nope")).toEqual({});
	});

	it("parses strict decimal integers only", () => {
		expect(parsePositiveDecimalInt("12")).toBe(12);
		expect(parsePositiveDecimalInt("1e2")).toBeUndefined();
		expect(parsePositiveDecimalInt("0x10")).toBeUndefined();
		expect(parsePositiveDecimalInt("12.0")).toBeUndefined();
		expect(parsePositiveDecimalInt("+1")).toBeUndefined();
		expect(parsePositiveDecimalInt("0")).toBeUndefined();
		expect(parsePositiveDecimalInt(undefined)).toBeUndefined();
	});

	it("clamps list limits to 1..50 with a default of 20", () => {
		expect(resolveTeaLimit(undefined)).toBe(20);
		expect(resolveTeaLimit(5)).toBe(5);
		expect(resolveTeaLimit(0)).toBe(1);
		expect(resolveTeaLimit(-10)).toBe(1);
		expect(resolveTeaLimit(999)).toBe(50);
		expect(resolveTeaLimit(Number.NaN)).toBe(20);
	});

	it("extracts created-entity indexes from tea output", () => {
		expect(parseCreatedIndex("#12 My title")).toBe(12);
		expect(parseCreatedIndex("Created issue #7 done")).toBe(7);
		expect(parseCreatedIndex("(#3) fallback")).toBe(3);
		expect(parseCreatedIndex("no marker here")).toBeUndefined();
		expect(parseCreatedIndex("hash#12")).toBeUndefined();
	});

	it("matches host segments to tea logins", async () => {
		vi.spyOn(gitea, "json").mockResolvedValue([
			{ name: "nas", url: "http://192.168.11.172:3000", ssh_host: "192.168.11.172:2222", user: "bhys" },
		]);
		expect(await resolveLoginArgs("/tmp", { host: "192.168.11.172:3000", slug: "o/r" })).toEqual(["--login", "nas"]);
		expect(await resolveLoginArgs("/tmp", { host: "192.168.11.172:2222", slug: "o/r" })).toEqual(["--login", "nas"]);
		expect(await resolveLoginArgs("/tmp", { host: "other.example.com", slug: "o/r" })).toEqual([]);
		expect(await resolveLoginArgs("/tmp", { slug: "o/r" })).toEqual([]);
		expect(await resolveLoginArgs("/tmp", { host: "other.example.com", slug: "o/r" }, "nas")).toEqual([
			"--login",
			"nas",
		]);
	});

	it("memoizes the tea logins list", async () => {
		const jsonSpy = vi.spyOn(gitea, "json").mockResolvedValue([{ name: "nas", url: "http://h:1" }]);
		await resolveTeaLogins("/tmp");
		await resolveTeaLogins("/tmp");
		expect(jsonSpy).toHaveBeenCalledTimes(1);
		expect(jsonSpy.mock.calls[0]?.[1]).toEqual(["logins", "list", "--output", "json"]);
	});

	it("serves the default repo from the memoized map without spawning", async () => {
		DEFAULT_REPO_RESOLVED.set(path.resolve("/tmp/proj"), "gitea.example.com/owner/repo");
		expect(await resolveTeaRepoMemoized("/tmp/proj", undefined)).toBe("gitea.example.com/owner/repo");
		expect(await resolveTeaRepoMemoized("/tmp/proj", "other/one")).toBe("other/one");
	});
});

describe("schema and approval", () => {
	it("accepts every documented op and rejects unknown ones", () => {
		const tool = new TeaTool(createSession());
		for (const op of TEA_OPS) {
			const request: ToolCall = {
				type: "toolCall",
				id: `schema-${op}`,
				name: tool.name,
				arguments: { op },
			};
			expect(() => validateToolArguments(tool, request)).not.toThrow();
		}
		const bad: ToolCall = {
			type: "toolCall",
			id: "schema-bogus",
			name: tool.name,
			arguments: { op: "fork_self" },
		};
		expect(() => validateToolArguments(tool, bad)).toThrow();
		const badStyle: ToolCall = {
			type: "toolCall",
			id: "schema-style",
			name: tool.name,
			arguments: { op: "pr_merge", pr: "5", style: "octopus" },
		};
		expect(() => validateToolArguments(tool, badStyle)).toThrow();
		const badState: ToolCall = {
			type: "toolCall",
			id: "schema-state",
			name: tool.name,
			arguments: { op: "issue_list", state: "weird" },
		};
		expect(() => validateToolArguments(tool, badState)).toThrow();
	});

	it("requests read approval for read ops and exec approval for the rest", () => {
		const tool = new TeaTool(createSession());
		for (const op of TEA_READ_OPS) {
			expect(tool.approval({ op })).toBe("read");
		}
		for (const op of TEA_OPS) {
			if ((TEA_READ_OPS as readonly string[]).includes(op)) continue;
			expect(tool.approval({ op })).toBe("exec");
		}
		expect(tool.approval({})).toBe("exec");
	});

	it("exposes strict discoverable metadata", () => {
		const tool = new TeaTool(createSession());
		expect(tool.name).toBe("tea");
		expect(tool.loadMode).toBe("discoverable");
		expect(tool.strict).toBe(true);
		expect(tool.summary.length).toBeGreaterThan(0);
		expect(tool.description.length).toBeGreaterThan(0);
	});

	it("gates construction on tea availability", () => {
		vi.spyOn(gitea, "available").mockReturnValue(false);
		expect(TeaTool.createIf(createSession())).toBeNull();
		vi.spyOn(gitea, "available").mockReturnValue(true);
		expect(TeaTool.createIf(createSession())).toBeInstanceOf(TeaTool);
	});

	it("registers the tea builtin and gates it on gitea.enabled", async () => {
		expect(BUILTIN_TOOL_NAMES).toContain("tea");
		expect(typeof BUILTIN_TOOLS.tea).toBe("function");

		vi.spyOn(gitea, "available").mockReturnValue(false);
		expect(BUILTIN_TOOLS.tea(createSession())).toBeNull();
		vi.spyOn(gitea, "available").mockReturnValue(true);
		expect(BUILTIN_TOOLS.tea(createSession())).toBeInstanceOf(TeaTool);

		const disabled = await resolveBuiltinToolPlan(
			createSession("/tmp", Settings.isolated({ "gitea.enabled": false })),
			["tea"],
		);
		expect(disabled.isAllowed("tea")).toBe(false);

		const enabled = await resolveBuiltinToolPlan(
			createSession("/tmp", Settings.isolated({ "gitea.enabled": true })),
			["tea"],
		);
		expect(enabled.isAllowed("tea")).toBe(true);
	});
});

describe("tea tool operations", () => {
	it("repo_view renders repository metadata with a source URL", async () => {
		vi.spyOn(gitea, "json").mockResolvedValue({
			full_name: "bhys/zeta",
			name: "zeta",
			description: "Mirror",
			html_url: "http://192.168.11.172:3000/bhys/zeta",
			default_branch: "main",
			stars_count: 3,
			private: false,
		});
		const tool = new TeaTool(createSession());
		const result = await tool.execute("repo-view", { op: "repo_view", repo: "bhys/zeta" });
		const text = textOf(result);
		expect(text).toContain("# bhys/zeta");
		expect(text).toContain("Mirror");
		expect(text).toContain("Default branch: main");
		expect(text).toContain("Stars: 3");
		expect(result.details?.repo).toBe("bhys/zeta");
	});

	it("repo_create verifies the repository by readback", async () => {
		const textSpy = vi.spyOn(gitea, "text").mockResolvedValue("");
		vi.spyOn(gitea, "json").mockResolvedValueOnce({ login: "bhys" }).mockResolvedValueOnce({
			full_name: "bhys/newrepo",
			name: "newrepo",
			html_url: "http://gitea.example/bhys/newrepo",
			default_branch: "main",
		});
		const tool = new TeaTool(createSession());
		const result = await tool.execute("repo-create", {
			op: "repo_create",
			name: "newrepo",
			description: "fresh",
			private: true,
		});
		expect(textSpy.mock.calls[0]?.[1]).toEqual([
			"repos",
			"create",
			"--name",
			"newrepo",
			"--description",
			"fresh",
			"--private",
			"--init",
		]);
		expect(textOf(result)).toContain("# bhys/newrepo");
		expect(result.details?.repo).toBe("bhys/newrepo");
	});

	it("repo_create errors when the readback fails (tea repo create can fail silently)", async () => {
		vi.spyOn(gitea, "text").mockResolvedValue("");
		vi.spyOn(gitea, "json")
			.mockResolvedValueOnce({ login: "bhys" })
			.mockRejectedValueOnce(new ToolError("Error: not found"));
		const tool = new TeaTool(createSession());
		await expect(tool.execute("repo-create", { op: "repo_create", name: "ghost" })).rejects.toThrow(
			/could not be read back from bhys\/ghost/,
		);
	});

	it("repo_create errors when the readback names a different repository", async () => {
		vi.spyOn(gitea, "text").mockResolvedValue("");
		vi.spyOn(gitea, "json")
			.mockResolvedValueOnce({ login: "bhys" })
			.mockResolvedValueOnce({ full_name: "bhys/other", name: "other" });
		const tool = new TeaTool(createSession());
		await expect(tool.execute("repo-create", { op: "repo_create", name: "newrepo" })).rejects.toThrow(
			/requested repository was 'bhys\/newrepo'/,
		);
	});

	it("issue_view renders the body and comments", async () => {
		vi.spyOn(gitea, "json")
			.mockResolvedValueOnce({
				number: 7,
				title: "Tea breaks",
				state: "open",
				user: { login: "bhys" },
				body: "It breaks.",
				html_url: "http://gitea.example/owner/repo/issues/7",
				labels: [{ name: "bug" }],
			})
			.mockResolvedValueOnce([
				{ id: 1, user: { login: "admin" }, body: "Confirmed.", html_url: "http://gitea.example/x/1" },
			]);
		const tool = new TeaTool(createSession());
		const result = await tool.execute("issue-view", { op: "issue_view", repo: "owner/repo", issue: "7" });
		const text = textOf(result);
		expect(text).toContain("# Issue #7: Tea breaks");
		expect(text).toContain("Author: @bhys");
		expect(text).toContain("It breaks.");
		expect(text).toContain("## Comments (1)");
		expect(text).toContain("Confirmed.");
		expect(result.details?.issue).toBe(7);
	});

	it("issue_view accepts a Gitea issue URL and prefers the URL repo", async () => {
		const jsonSpy = vi
			.spyOn(gitea, "json")
			.mockResolvedValueOnce({ number: 9, title: "From URL", state: "open", body: "" })
			.mockResolvedValue([]);
		const tool = new TeaTool(createSession());
		await tool.execute("issue-view", {
			op: "issue_view",
			issue: "https://gitea.example.com/owner/other/issues/9",
		});
		// Call 0 is the logins lookup (the URL carries a host); call 1 is the issue.
		expect(jsonSpy.mock.calls[1]?.[1]).toContain("/repos/owner/other/issues/9");
	});

	it("issue_list renders entries and flags empty results as useless", async () => {
		const jsonSpy = vi
			.spyOn(gitea, "json")
			.mockResolvedValueOnce([{ number: 3, title: "First", state: "open", html_url: "http://gitea.example/o/r/3" }])
			.mockResolvedValueOnce([]);
		const tool = new TeaTool(createSession());
		const listed = await tool.execute("issue-list", { op: "issue_list", repo: "owner/repo", state: "open" });
		expect(textOf(listed)).toContain("# 3 [open] First");
		expect(listed.useless).toBeUndefined();
		expect(jsonSpy.mock.calls[0]?.[1]?.at(-1)).toContain("state=open&limit=20&type=issues");

		const empty = await tool.execute("issue-list", { op: "issue_list", repo: "owner/repo" });
		expect(textOf(empty)).toContain("0 result(s)");
		expect(empty.useless).toBe(true);
	});

	it("issue_create parses the index marker and reads the issue back", async () => {
		const textSpy = vi.spyOn(gitea, "text").mockResolvedValue("#12 Broken build on main");
		vi.spyOn(gitea, "json").mockResolvedValueOnce({
			number: 12,
			title: "Broken build on main",
			state: "open",
			html_url: "http://gitea.example/owner/repo/issues/12",
		});
		const tool = new TeaTool(createSession());
		const result = await tool.execute("issue-create", {
			op: "issue_create",
			repo: "owner/repo",
			title: "Broken build on main",
			body: "CI fails",
			labels: ["bug", "ci"],
		});
		expect(textSpy.mock.calls[0]?.[1]).toEqual([
			"issues",
			"create",
			"--title",
			"Broken build on main",
			"--description",
			"CI fails",
			"--labels",
			"bug,ci",
			"--repo",
			"owner/repo",
		]);
		expect(textOf(result)).toContain("# Created Issue #12");
		expect(result.details?.issue).toBe(12);
	});

	it("issue_create falls back to an exact-title search without a marker", async () => {
		vi.spyOn(gitea, "text").mockResolvedValue("created");
		vi.spyOn(gitea, "json").mockResolvedValueOnce([
			{ number: 5, title: "Something else" },
			{ number: 6, title: "No marker title", state: "open", html_url: "http://gitea.example/x/6" },
		]);
		const tool = new TeaTool(createSession());
		const result = await tool.execute("issue-create", {
			op: "issue_create",
			repo: "owner/repo",
			title: "No marker title",
		});
		expect(textOf(result)).toContain("# Created Issue #6");
	});

	it("issue_create errors when the readback cannot confirm the issue", async () => {
		vi.spyOn(gitea, "text").mockResolvedValue("created");
		vi.spyOn(gitea, "json").mockResolvedValue([]);
		const tool = new TeaTool(createSession());
		await expect(
			tool.execute("issue-create", { op: "issue_create", repo: "owner/repo", title: "ghost" }),
		).rejects.toThrow(/could not be read back from owner\/repo/);
	});

	it("issue_create requires a title", async () => {
		const tool = new TeaTool(createSession());
		await expect(tool.execute("issue-create", { op: "issue_create", repo: "owner/repo" })).rejects.toThrow(
			"title must not be empty",
		);
	});

	it("pr_view renders base/head metadata", async () => {
		vi.spyOn(gitea, "json").mockResolvedValue({
			number: 5,
			title: "Add tea",
			state: "open",
			draft: false,
			base: { ref: "main" },
			head: { ref: "feature", sha: "1234567890abcdef1234567890abcdef12345678" },
			mergeable: true,
			html_url: "http://gitea.example/owner/repo/pulls/5",
			body: "Ship it",
		});
		const tool = new TeaTool(createSession());
		const result = await tool.execute("pr-view", { op: "pr_view", repo: "owner/repo", pr: "5" });
		const text = textOf(result);
		expect(text).toContain("# Pull Request #5: Add tea");
		expect(text).toContain("Base: main");
		expect(text).toContain("Head: feature");
		expect(result.details?.pr).toBe(5);
	});

	it("pr_list renders entries with base/head", () => {
		const text = formatPrList(
			[
				{
					number: 4,
					title: "Change",
					state: "open",
					base: { ref: "main" },
					head: { ref: "feature" },
					html_url: "http://gitea.example/o/r/pulls/4",
				},
			],
			{ repo: "o/r", state: "open" },
		);
		expect(text).toContain("# 4 [open] Change");
		expect(text).toContain("Base: main");
		expect(text).toContain("Head: feature");
	});

	it("pr_create reads the created pull request back", async () => {
		const textSpy = vi.spyOn(gitea, "text").mockResolvedValue("#6 Add tea suite");
		vi.spyOn(gitea, "json").mockResolvedValueOnce({
			number: 6,
			title: "Add tea suite",
			state: "open",
			base: { ref: "main" },
			head: { ref: "tea" },
			html_url: "http://gitea.example/owner/repo/pulls/6",
		});
		const tool = new TeaTool(createSession());
		const result = await tool.execute("pr-create", {
			op: "pr_create",
			repo: "owner/repo",
			title: "Add tea suite",
			head: "tea",
			base: "main",
			draft: true,
		});
		expect(textSpy.mock.calls[0]?.[1]).toEqual([
			"pulls",
			"create",
			"--title",
			"Add tea suite",
			"--head",
			"tea",
			"--base",
			"main",
			"--draft",
			"--repo",
			"owner/repo",
		]);
		expect(textOf(result)).toContain("# Created Pull Request #6");
		expect(result.details?.pr).toBe(6);
	});

	it("pr_merge verifies the merged flag and reports the merge commit", async () => {
		const textSpy = vi.spyOn(gitea, "text").mockResolvedValue("");
		vi.spyOn(gitea, "json").mockResolvedValueOnce({
			number: 5,
			merged: true,
			merged_at: "2026-10-08T12:00:00Z",
			merge_commit_sha: "abcdef1234567890abcdef1234567890abcdef12",
			html_url: "http://gitea.example/owner/repo/pulls/5",
		});
		const tool = new TeaTool(createSession());
		const result = await tool.execute("pr-merge", { op: "pr_merge", repo: "owner/repo", pr: "5", style: "squash" });
		expect(textSpy.mock.calls[0]?.[1]).toEqual(["pulls", "merge", "5", "--style", "squash", "--repo", "owner/repo"]);
		expect(textOf(result)).toContain("# Merged Pull Request #5");
		expect(textOf(result)).toContain("abcdef1");
	});

	it("pr_merge errors when Gitea does not report the merge", async () => {
		vi.spyOn(gitea, "text").mockResolvedValue("");
		vi.spyOn(gitea, "json").mockResolvedValueOnce({ number: 5, merged: false, state: "open" });
		const tool = new TeaTool(createSession());
		await expect(tool.execute("pr-merge", { op: "pr_merge", repo: "owner/repo", pr: "5" })).rejects.toThrow(
			/did not report PR #5 as merged/,
		);
	});

	it("release_list renders releases", () => {
		const text = formatReleaseList(
			[
				{
					tag_name: "v1.2.0",
					name: "Tea release",
					draft: false,
					prerelease: true,
					published_at: "2026-10-08T00:00:00Z",
					html_url: "http://gitea.example/o/r/releases/tag/v1.2.0",
					assets: [{ id: 1 }],
				},
			],
			{ repo: "o/r" },
		);
		expect(text).toContain("# v1.2.0 — Tea release");
		expect(text).toContain("Pre-release: true");
		expect(text).toContain("Assets: 1");
	});

	it("release_create verifies the release by tag readback", async () => {
		const textSpy = vi.spyOn(gitea, "text").mockResolvedValue("");
		vi.spyOn(gitea, "json").mockResolvedValueOnce({
			tag_name: "v2.0.0",
			name: "Big one",
			draft: false,
			html_url: "http://gitea.example/owner/repo/releases/tag/v2.0.0",
		});
		const tool = new TeaTool(createSession());
		const result = await tool.execute("release-create", {
			op: "release_create",
			repo: "owner/repo",
			tag: "v2.0.0",
			title: "Big one",
			body: "notes",
			prerelease: true,
		});
		expect(textSpy.mock.calls[0]?.[1]).toEqual([
			"releases",
			"create",
			"v2.0.0",
			"--title",
			"Big one",
			"--note",
			"notes",
			"--prerelease",
			"--repo",
			"owner/repo",
		]);
		expect(textOf(result)).toContain("# Created Release v2.0.0");
	});

	it("release_create errors when the readback fails", async () => {
		vi.spyOn(gitea, "text").mockResolvedValue("");
		vi.spyOn(gitea, "json").mockRejectedValue(new ToolError("Error: not found"));
		const tool = new TeaTool(createSession());
		await expect(
			tool.execute("release-create", { op: "release_create", repo: "owner/repo", tag: "v9" }),
		).rejects.toThrow(/could not be read back from owner\/repo/);
	});

	it("rejects invalid identifiers", async () => {
		const tool = new TeaTool(createSession());
		await expect(
			tool.execute("issue-view", { op: "issue_view", repo: "o/r", issue: "not-a-number" }),
		).rejects.toThrow(/invalid issue identifier/);
		await expect(tool.execute("pr-view", { op: "pr_view", repo: "o/r", pr: "" })).rejects.toThrow(
			"pr must not be empty",
		);
	});
});

describe("formatters", () => {
	it("formatIssueView renders labels, milestone, and comments", () => {
		const text = formatIssueView(
			{
				number: 8,
				title: "Tea",
				state: "closed",
				user: { login: "bhys" },
				labels: [{ name: "bug" }, { name: "tea" }],
				milestone: { title: "v1" },
				body: "Body text",
			},
			[{ user: { login: "admin" }, body: "Done" }],
			{ issue: "8" },
		);
		expect(text).toContain("# Issue #8: Tea");
		expect(text).toContain("Labels: bug, tea");
		expect(text).toContain("Milestone: v1");
		expect(text).toContain("## Comments (1)");
	});

	it("formatIssueView falls back to the input number and localized placeholders", () => {
		const text = formatIssueView({ title: undefined, body: null }, [], { issue: "42" });
		expect(text).toContain("# Issue #42:");
	});

	it("formatPrView renders merge state", () => {
		const text = formatPrView({
			number: 3,
			title: "PR",
			state: "open",
			merged: false,
			mergeable: true,
			base: { ref: "main" },
			head: { ref: "f", sha: "1234567890abcdef1234567890abcdef12345678" },
		});
		expect(text).toContain("Mergeable: true");
		expect(text).toContain("Merged: false");
		expect(text).toContain("Head commit: 1234567");
	});

	it("formatIssueList renders zero-result headers", () => {
		expect(formatIssueList([], { repo: "o/r", state: "closed" })).toContain("0 result(s)");
	});
});

describe("pr_checkout", () => {
	let fixture: PrFixture;
	let tempHome: { home: string; cleanup: () => Promise<void> };

	beforeAll(async () => {
		fixture = await buildPrFixture();
		tempHome = await setupTempHome();
	});

	afterAll(async () => {
		await tempHome.cleanup();
		await removeWithRetries(fixture.baseDir);
	});

	function mockPrApi(): void {
		vi.spyOn(gitea, "json").mockImplementation((async (_cwd: string, args: string[]) => {
			if (args[0] === "logins") return [];
			if (args[0] === "api" && args[1] === "/repos/owner/repo/pulls/5") {
				return {
					number: 5,
					title: "Feature",
					state: "open",
					html_url: "https://gitea.example/owner/repo/pulls/5",
					base: { ref: "main", sha: fixture.mainSha },
					head: { ref: "feature", sha: fixture.featureSha, repo: { full_name: "owner/repo" } },
				};
			}
			throw new Error(`unexpected gitea.json call: ${args.join(" ")}`);
		}) as unknown as typeof gitea.json);
	}

	function session(): ToolSession {
		return createSession(fixture.repoRoot, Settings.isolated({ "gitea.enabled": true }));
	}

	it("checks a PR out into a dedicated worktree and reuses it", async () => {
		mockPrApi();
		const tool = new TeaTool(session());
		const result = await tool.execute("pr-checkout", {
			op: "pr_checkout",
			repo: "gitea.example/owner/repo",
			pr: "5",
		});
		const text = textOf(result);
		expect(text).toContain("# Checked Out Pull Request #5");
		expect(text).toContain("Local branch: pr-5");
		expect(result.details?.worktreePath).toBeTruthy();

		const branchSha = runGit(fixture.repoRoot, ["rev-parse", "pr-5"]);
		expect(branchSha).toBe(fixture.featureSha);

		const reused = await tool.execute("pr-checkout", {
			op: "pr_checkout",
			repo: "gitea.example/owner/repo",
			pr: "5",
		});
		expect(textOf(reused)).toContain("# Pull Request #5 Worktree");
		expect(textOf(reused)).toContain("Reused the existing PR worktree.");
	});

	it("refuses to reset an existing pr branch without force", async () => {
		mockPrApi();
		const worktreePath = path.join(tempHome.home, ".zeta", "wt", `5-${hashPath(fixture.repoRoot)}`);
		await removeWithRetries(worktreePath);
		await fs.rm(worktreePath, { recursive: true, force: true });
		runGit(fixture.repoRoot, ["worktree", "prune"]);
		runGit(fixture.repoRoot, ["branch", "-f", "pr-5", "main"]);

		const tool = new TeaTool(session());
		await expect(
			tool.execute("pr-checkout", { op: "pr_checkout", repo: "gitea.example/owner/repo", pr: "5" }),
		).rejects.toThrow(/pass force=true to reset it/);

		const forced = await tool.execute("pr-checkout", {
			op: "pr_checkout",
			repo: "gitea.example/owner/repo",
			pr: "5",
			force: true,
		});
		expect(textOf(forced)).toContain("# Checked Out Pull Request #5");
		expect(runGit(fixture.repoRoot, ["rev-parse", "pr-5"])).toBe(fixture.featureSha);
	});

	it("errors when no remote points at the repository", async () => {
		mockPrApi();
		runGit(fixture.repoRoot, ["remote", "set-url", "origin", "https://gitlab.example/other/thing.git"]);
		try {
			const tool = new TeaTool(session());
			await expect(
				tool.execute("pr-checkout", {
					op: "pr_checkout",
					repo: "gitlab.example/owner/repo",
					pr: "5",
					force: true,
				}),
			).rejects.toThrow(/no git remote points at owner\/repo/);
		} finally {
			runGit(fixture.repoRoot, ["remote", "set-url", "origin", "https://gitea.example/owner/repo.git"]);
		}
	});
});

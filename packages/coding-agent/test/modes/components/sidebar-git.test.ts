import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildSidebarGitSnapshot,
	formatSidebarCommitAge,
	parseSidebarGitLog,
	parseSidebarGitStatus,
	SIDEBAR_GIT_COMMIT_LIMIT,
	SidebarGitSource,
} from "../../../src/modes/components/sidebar-git";

const tempDirs: string[] = [];

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function runGit(dir: string, ...args: string[]): void {
	const proc = Bun.spawnSync(["git", "-C", dir, ...args], {
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Sidebar Test",
			GIT_AUTHOR_EMAIL: "sidebar@example.com",
			GIT_COMMITTER_NAME: "Sidebar Test",
			GIT_COMMITTER_EMAIL: "sidebar@example.com",
		},
	});
	if (proc.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
	}
}

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

const PORCELAIN = [
	"# branch.oid 8f4a2c1d9e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f",
	"# branch.head feature/sidebar",
	"# branch.upstream origin/feature/sidebar",
	"# branch.ab +2 -1",
	"1 M. N... 100644 100644 100644 1111111 2222222 staged.ts",
	"1 .M N... 100644 100644 100644 1111111 2222222 unstaged.ts",
	"1 MM N... 100644 100644 100644 1111111 2222222 both.ts",
	"2 R. N... 100644 100644 100644 1111111 2222222 R100 new.ts\told.ts",
	"u UU N... 100644 100644 100644 100644 1111111 2222222 3333333 conflict.ts",
	"? untracked.ts",
	"! ignored.log",
].join("\n");

describe("parseSidebarGitStatus", () => {
	it("reads the branch header, ahead/behind, and per-side change counts", () => {
		expect(parseSidebarGitStatus(PORCELAIN)).toEqual({
			branch: "feature/sidebar",
			ahead: 2,
			behind: 1,
			staged: 4,
			unstaged: 3,
			untracked: 1,
		});
	});

	it("treats a detached HEAD as no branch and ignores header noise", () => {
		const summary = parseSidebarGitStatus(
			["# branch.oid abc1234", "# branch.head (detached)", "# branch.ab +0 -0"].join("\n"),
		);
		expect(summary.branch).toBeNull();
		expect(summary.ahead).toBe(0);
		expect(summary.behind).toBe(0);
		expect(summary.staged).toBe(0);
		expect(summary.unstaged).toBe(0);
		expect(summary.untracked).toBe(0);
	});

	it("returns zero counts for an empty repository status", () => {
		expect(parseSidebarGitStatus("# branch.head main\n")).toEqual({
			branch: "main",
			ahead: 0,
			behind: 0,
			staged: 0,
			unstaged: 0,
			untracked: 0,
		});
	});
});

describe("parseSidebarGitLog", () => {
	const now = 1_700_000_000_000;

	it("reads short SHA, subject, and a compact relative age", () => {
		const output = ["abc1234\x1fAdd the sidebar Git panel\x1f1699999999", "def5678\x1fFix parser\x1f1699992800"].join(
			"\n",
		);
		expect(parseSidebarGitLog(output, now)).toEqual([
			{ shortSha: "abc1234", subject: "Add the sidebar Git panel", age: "now" },
			{ shortSha: "def5678", subject: "Fix parser", age: "2h" },
		]);
	});

	it("caps the snapshot at the commit limit and skips malformed lines", () => {
		const output = [
			...Array.from({ length: 7 }, (_, i) => `sha000${i}\x1fcommit ${i}\x1f1699999999`),
			"not-a-commit",
			"sha-only\x1f",
		].join("\n");
		const commits = parseSidebarGitLog(output, now);
		expect(commits.length).toBe(SIDEBAR_GIT_COMMIT_LIMIT);
		expect(commits[0]?.shortSha).toBe("sha0000");
	});
});

describe("formatSidebarCommitAge", () => {
	const now = 1_000_000_000_000;

	it("chooses a compact unit for each magnitude", () => {
		expect(formatSidebarCommitAge(now, now)).toBe("now");
		expect(formatSidebarCommitAge(now - 5 * 60_000, now)).toBe("5m");
		expect(formatSidebarCommitAge(now - 2 * 3_600_000, now)).toBe("2h");
		expect(formatSidebarCommitAge(now - 3 * 86_400_000, now)).toBe("3d");
		expect(formatSidebarCommitAge(now - 10 * 86_400_000, now)).toBe("1w");
		expect(formatSidebarCommitAge(now - 40 * 86_400_000, now)).toBe("1mo");
		expect(formatSidebarCommitAge(now - 400 * 86_400_000, now)).toBe("1y");
	});

	it("clamps a clock-skewed future commit to now", () => {
		expect(formatSidebarCommitAge(now + 60_000, now)).toBe("now");
	});
});

describe("buildSidebarGitSnapshot", () => {
	it("combines the status read with the log read", () => {
		const snapshot = buildSidebarGitSnapshot(PORCELAIN, "abc1234\x1fSubject\x1f1699999999", 1_700_000_000_000);
		expect(snapshot.branch).toBe("feature/sidebar");
		expect(snapshot.staged).toBe(4);
		expect(snapshot.unstaged).toBe(3);
		expect(snapshot.untracked).toBe(1);
		expect(snapshot.commits).toEqual([{ shortSha: "abc1234", subject: "Subject", age: "now" }]);
	});
});

describe("SidebarGitSource", () => {
	it("caches a snapshot read from a real repository and refreshes without a timer", async () => {
		const dir = await makeTempDir("zeta-sidebar-git-");
		runGit(dir, "init", "-q", "--initial-branch=main");
		await writeFile(join(dir, "README.md"), "hello\n");
		runGit(dir, "add", "README.md");
		runGit(dir, "commit", "-q", "-m", "Initial commit");

		let changes = 0;
		const source = new SidebarGitSource({
			cwd: () => dir,
			onChange: () => {
				changes++;
			},
		});

		await source.refresh();
		const snapshot = source.snapshot();
		expect(snapshot).not.toBeNull();
		expect(snapshot?.branch).toBe("main");
		expect(snapshot?.ahead).toBe(0);
		expect(snapshot?.behind).toBe(0);
		expect(snapshot?.staged).toBe(0);
		expect(snapshot?.unstaged).toBe(0);
		expect(snapshot?.untracked).toBe(0);
		expect(snapshot?.commits.map(commit => commit.subject)).toEqual(["Initial commit"]);
		expect(changes).toBe(1);

		await writeFile(join(dir, "README.md"), "hello again\n");
		runGit(dir, "add", "README.md");
		await writeFile(join(dir, "draft.txt"), "untracked\n");
		await source.refresh();
		expect(source.snapshot()?.staged).toBe(1);
		expect(source.snapshot()?.unstaged).toBe(0);
		expect(source.snapshot()?.untracked).toBe(1);
		expect(changes).toBe(2);

		source.dispose();
		source.dispose();
	}, 20_000);

	it("leaves the snapshot null outside a repository and hides the panel", async () => {
		const dir = await makeTempDir("zeta-sidebar-no-git-");
		let changes = 0;
		const source = new SidebarGitSource({
			cwd: () => dir,
			onChange: () => {
				changes++;
			},
		});
		await source.refresh();
		expect(source.snapshot()).toBeNull();
		expect(changes).toBe(0);
	}, 20_000);

	it("clears the snapshot while git integration is disabled", async () => {
		const dir = await makeTempDir("zeta-sidebar-disabled-");
		runGit(dir, "init", "-q", "--initial-branch=main");
		await writeFile(join(dir, "tracked.txt"), "content\n");
		runGit(dir, "add", "tracked.txt");
		runGit(dir, "commit", "-q", "-m", "Tracked");
		let enabled = true;
		const source = new SidebarGitSource({
			cwd: () => dir,
			enabled: () => enabled,
		});
		await source.refresh();
		expect(source.snapshot()?.branch).toBe("main");

		enabled = false;
		await source.refresh();
		expect(source.snapshot()).toBeNull();

		enabled = true;
		await source.refresh();
		expect(source.snapshot()?.branch).toBe("main");
	}, 20_000);
});

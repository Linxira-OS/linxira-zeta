/**
 * Gateway git reads — the Studio Git surface's status/diff/remotes/show/
 * worktrees routes, answered over the pi-vcs addon (no `git` subprocess in the
 * server). The fixtures build real repositories with `git`, which the *test*
 * may spawn.
 *
 * Contract points:
 * - status lists tracked, staged and untracked rows plus HEAD/upstream counts,
 * - diff renders a tracked file, the index, a commit, and synthesizes a patch
 *   for an untracked file the index diff cannot see,
 * - refusals are statuses: 404 outside a checkout or for an unknown commit,
 *   400 for a path outside the repository, 413 past the patch cap,
 * - show reports one commit with per-file line counts and statuses,
 * - worktrees lists the primary checkout and its linked worktrees,
 * - the gateway dispatches both literal paths above the generic captures.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { webGatewayFetch } from "../../src/server/web-gateway";
import { handleGitLog } from "../../src/server/web-gateway/git-actions";
import {
	handleGitDiff,
	handleGitRemotes,
	handleGitShow,
	handleGitStatus,
	handleGitWorktrees,
} from "../../src/server/web-gateway/git-reads";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	cleanups.push(() =>
		rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined),
	);
	return dir;
}

async function initRepo(dir: string): Promise<void> {
	await $`git init -q --initial-branch=main`.cwd(dir).quiet();
	await $`git config core.autocrlf false`.cwd(dir).quiet();
	await $`git config user.email test@example.com`.cwd(dir).quiet();
	await $`git config user.name Test`.cwd(dir).quiet();
	await Bun.write(join(dir, "README.md"), "# fixture\n");
	await $`git add -A`.cwd(dir).quiet();
	await $`git commit -q -m baseline`.cwd(dir).quiet();
}

function get(pathname: string, params: Record<string, string>): Request {
	const url = new URL(`http://localhost${pathname}`);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	return new Request(url.toString());
}

async function head(dir: string): Promise<string> {
	return (await $`git rev-parse HEAD`.cwd(dir).quiet().text()).trim();
}

interface StatusBody {
	isGitRepository: boolean;
	current: string | null;
	unborn: boolean;
	ahead: number;
	behind: number;
	stashCount?: number;
	changes: Array<{
		path: string;
		status: string;
		staged: boolean;
		indexStatus: string;
		worktreeStatus: string;
	}>;
	truncated: boolean;
}

describe("gateway git reads", () => {
	test("status lists tracked, staged and untracked rows with HEAD state", async () => {
		const repo = await makeTempDir("zeta-gw-gitread-");
		await initRepo(repo);
		await writeFile(join(repo, "README.md"), "# modified\n");
		await writeFile(join(repo, "staged.txt"), "one\n");
		await $`git add staged.txt`.cwd(repo).quiet();
		await writeFile(join(repo, "loose.txt"), "loose\n");

		const response = await handleGitStatus(get("/api/git/status", { cwd: repo }));
		expect(response.status).toBe(200);
		const body = (await response.json()) as StatusBody;
		expect(body.isGitRepository).toBe(true);
		expect(body.current).toBe("main");
		expect(body.unborn).toBe(false);
		expect(body.ahead).toBe(0);
		expect(body.behind).toBe(0);
		expect(body.stashCount).toBe(0);
		expect(body.truncated).toBe(false);
		const byPath = new Map(body.changes.map(change => [change.path, change]));
		expect(byPath.get("README.md")).toEqual({
			path: "README.md",
			status: "modified",
			staged: false,
			indexStatus: "unmodified",
			worktreeStatus: "modified",
		});
		expect(byPath.get("staged.txt")).toEqual({
			path: "staged.txt",
			status: "added",
			staged: true,
			indexStatus: "added",
			worktreeStatus: "unmodified",
		});
		expect(byPath.get("loose.txt")).toEqual({
			path: "loose.txt",
			status: "untracked",
			staged: false,
			indexStatus: "unmodified",
			worktreeStatus: "untracked",
		});
	});

	test("status reports ahead and behind against the configured upstream", async () => {
		const root = await makeTempDir("zeta-gw-gitup-");
		const origin = join(root, "origin.git");
		await $`git init -q --bare --initial-branch=main ${origin}`.quiet();
		const work = join(root, "work");
		await $`git clone -q ${origin} ${work}`.quiet();
		for (const dir of [work]) {
			await $`git config user.email test@example.com`.cwd(dir).quiet();
			await $`git config user.name Test`.cwd(dir).quiet();
		}
		await Bun.write(join(work, "a.txt"), "a\n");
		await $`git add -A`.cwd(work).quiet();
		await $`git commit -q -m first`.cwd(work).quiet();
		await $`git push -q origin main`.cwd(work).quiet();

		const other = join(root, "other");
		await $`git clone -q ${origin} ${other}`.quiet();
		await $`git config user.email test@example.com`.cwd(other).quiet();
		await $`git config user.name Test`.cwd(other).quiet();
		await Bun.write(join(other, "b.txt"), "b\n");
		await $`git add -A`.cwd(other).quiet();
		await $`git commit -q -m remote-side`.cwd(other).quiet();
		await $`git push -q origin main`.cwd(other).quiet();

		await Bun.write(join(work, "c.txt"), "c\n");
		await $`git add -A`.cwd(work).quiet();
		await $`git commit -q -m local-side`.cwd(work).quiet();
		await $`git fetch -q origin`.cwd(work).quiet();

		const response = await handleGitStatus(get("/api/git/status", { cwd: work }));
		expect(response.status).toBe(200);
		const body = (await response.json()) as StatusBody;
		expect(body.current).toBe("main");
		expect(body.ahead).toBe(1);
		expect(body.behind).toBe(1);
	});

	test("non-repository cwds are refused with 404 on every read route", async () => {
		const plain = await makeTempDir("zeta-gw-gitplain-");
		for (const response of [
			await handleGitStatus(get("/api/git/status", { cwd: plain })),
			await handleGitRemotes(get("/api/git/remotes", { cwd: plain })),
			await handleGitWorktrees(get("/api/git/worktrees", { cwd: plain })),
			await handleGitShow(get("/api/git/show", { cwd: plain, oid: "HEAD" })),
			await handleGitDiff(get("/api/git/diff", { cwd: plain, path: "a.txt" })),
		]) {
			expect(response.status).toBe(404);
			expect(await response.json()).toMatchObject({ error: "not a git repository" });
		}
	});

	test("diff renders a tracked file, the index and an untracked file", async () => {
		const repo = await makeTempDir("zeta-gw-gitdiff-");
		await initRepo(repo);
		await writeFile(join(repo, "README.md"), "# modified\n");
		await writeFile(join(repo, "staged.txt"), "one\n");
		await $`git add staged.txt`.cwd(repo).quiet();
		await writeFile(join(repo, "loose.txt"), "loose\n");

		const working = await handleGitDiff(get("/api/git/diff", { cwd: repo, path: "README.md" }));
		expect(working.status).toBe(200);
		const workingDiff = (await working.json()) as { diff: string };
		expect(workingDiff.diff).toContain("--- a/README.md");
		expect(workingDiff.diff).toContain("+# modified");

		// An absolute path inside the checkout is accepted and narrowed.
		const absolute = await handleGitDiff(get("/api/git/diff", { cwd: repo, path: join(repo, "README.md") }));
		expect(absolute.status).toBe(200);

		const staged = await handleGitDiff(get("/api/git/diff", { cwd: repo, path: "staged.txt", staged: "true" }));
		expect(staged.status).toBe(200);
		const stagedDiff = (await staged.json()) as { diff: string };
		expect(stagedDiff.diff).toContain("+one");

		const untracked = await handleGitDiff(get("/api/git/diff", { cwd: repo, path: "loose.txt" }));
		expect(untracked.status).toBe(200);
		const untrackedBody = (await untracked.json()) as { diff: string };
		expect(untrackedBody.diff).toContain("new file mode");
		expect(untrackedBody.diff).toContain("+loose");
	});

	test("diff refuses unknown commits, escaping paths and oversized patches", async () => {
		const repo = await makeTempDir("zeta-gw-gitrefuse-");
		await initRepo(repo);

		const unknown = await handleGitDiff(get("/api/git/diff", { cwd: repo, oid: "0".repeat(40) }));
		expect(unknown.status).toBe(404);
		expect(await unknown.json()).toMatchObject({ error: "unknown commit: 0000000000000000000000000000000000000000" });

		const escape = await handleGitDiff(get("/api/git/diff", { cwd: repo, path: join(repo, "..", "outside.txt") }));
		expect(escape.status).toBe(400);

		const lines = Array.from({ length: 12_000 }, (_, index) => `line ${index} ${"x".repeat(48)}`).join("\n");
		await writeFile(join(repo, "big.txt"), `${lines}\n`);
		await $`git add big.txt`.cwd(repo).quiet();
		await $`git commit -q -m big`.cwd(repo).quiet();
		const sha = await head(repo);

		const commitDiff = await handleGitDiff(get("/api/git/diff", { cwd: repo, oid: sha }));
		expect(commitDiff.status).toBe(413);
		expect(await commitDiff.json()).toMatchObject({ error: "diff too large" });

		// A working-tree edit past the cap is refused before it is buffered.
		const rewritten = Array.from({ length: 12_000 }, (_, index) => `line ${index} ${"y".repeat(48)}`).join("\n");
		await writeFile(join(repo, "big.txt"), `${rewritten}\n`);
		const fileDiff = await handleGitDiff(get("/api/git/diff", { cwd: repo, path: "big.txt" }));
		expect(fileDiff.status).toBe(413);
	});

	test("remotes lists configured names with their fetch url", async () => {
		const repo = await makeTempDir("zeta-gw-gitremote-");
		await initRepo(repo);
		await $`git remote add origin https://example.com/sample.git`.cwd(repo).quiet();

		const response = await handleGitRemotes(get("/api/git/remotes", { cwd: repo }));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			remotes: [{ name: "origin", url: "https://example.com/sample.git" }],
		});
	});

	test("show reports commit metadata and per-file counts and statuses", async () => {
		const repo = await makeTempDir("zeta-gw-gitshow-");
		await initRepo(repo);
		const base = await head(repo);
		await writeFile(join(repo, "README.md"), "# changed\n");
		await writeFile(join(repo, "added.txt"), "a\nb\n");
		await $`git add -A`.cwd(repo).quiet();
		await $`git commit -q -m second -m "body line"`.cwd(repo).quiet();
		const sha = await head(repo);

		// A short object id is accepted; the answer carries the full one.
		const response = await handleGitShow(get("/api/git/show", { cwd: repo, oid: sha.slice(0, 8) }));
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			oid: string;
			parents: string[];
			authorName: string;
			authorEmail: string;
			authorDate?: string;
			subject: string;
			body: string;
			truncated: boolean;
			files: Array<{ path: string; additions?: number; deletions?: number; status?: string }>;
		};
		expect(body.oid).toBe(sha);
		expect(body.parents).toEqual([base]);
		expect(body.authorName).toBe("Test");
		expect(body.authorEmail).toBe("test@example.com");
		expect(typeof body.authorDate).toBe("string");
		expect(body.subject).toBe("second");
		expect(body.body).toBe("body line");
		expect(body.truncated).toBe(false);
		const files = new Map(body.files.map(file => [file.path, file]));
		expect(files.get("added.txt")).toEqual({ path: "added.txt", additions: 2, deletions: 0, status: "added" });
		expect(files.get("README.md")).toEqual({ path: "README.md", additions: 1, deletions: 1, status: "modified" });

		const unknown = await handleGitShow(get("/api/git/show", { cwd: repo, oid: "0".repeat(40) }));
		expect(unknown.status).toBe(404);

		// A root commit has no parent tree; its files come from the patch alone.
		const rootResponse = await handleGitShow(get("/api/git/show", { cwd: repo, oid: base }));
		expect(rootResponse.status).toBe(200);
		const rootBody = (await rootResponse.json()) as {
			parents: string[];
			files: Array<{ path: string; additions?: number; deletions?: number; status?: string }>;
		};
		expect(rootBody.parents).toEqual([]);
		expect(rootBody.files).toContainEqual({
			path: "README.md",
			additions: 1,
			deletions: 0,
			status: "added",
		});
	});

	test("worktrees lists the primary checkout and a linked worktree", async () => {
		const root = await makeTempDir("zeta-gw-gitwt-");
		const repo = join(root, "main");
		await mkdir(repo, { recursive: true });
		await initRepo(repo);
		await $`git branch feature`.cwd(repo).quiet();
		const linked = join(root, "wt");
		await $`git worktree add -q ${linked} feature`.cwd(repo).quiet();

		const response = await handleGitWorktrees(get("/api/git/worktrees", { cwd: repo }));
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			worktrees: Array<{
				path: string;
				branch: string | null;
				head: string | null;
				detached: boolean;
				bare: boolean;
				locked: boolean;
				prunable: boolean;
			}>;
		};
		expect(body.worktrees).toHaveLength(2);
		for (const entry of body.worktrees) {
			expect(entry.detached).toBe(false);
			expect(typeof entry.head).toBe("string");
			// A live linked worktree of a normal checkout is never any of these.
			expect(entry.bare).toBe(false);
			expect(entry.locked).toBe(false);
			expect(entry.prunable).toBe(false);
		}
		const branches = body.worktrees.map(entry => entry.branch).sort();
		expect(branches).toEqual(["feature", "main"]);
	});

	test("the gateway dispatches /api/git/status and /api/git/worktrees", async () => {
		const repo = await makeTempDir("zeta-gw-gitdispatch-");
		await initRepo(repo);
		const agentDir = await makeTempDir("zeta-gw-gitagent-");
		const saved = process.env.ZETA_CODING_AGENT_DIR;
		process.env.ZETA_CODING_AGENT_DIR = agentDir;
		refreshDirsFromEnv();
		try {
			const status = await webGatewayFetch(
				new Request(`http://127.0.0.1/api/git/status?cwd=${encodeURIComponent(repo)}`),
				"127.0.0.1",
			);
			expect(status.status).toBe(200);
			const statusBody = (await status.json()) as StatusBody;
			expect(statusBody).toMatchObject({ isGitRepository: true, current: "main" });

			const worktrees = await webGatewayFetch(
				new Request(`http://127.0.0.1/api/git/worktrees?cwd=${encodeURIComponent(repo)}`),
				"127.0.0.1",
			);
			expect(worktrees.status).toBe(200);
			const worktreeBody = (await worktrees.json()) as { worktrees: unknown[] };
			expect(worktreeBody.worktrees).toHaveLength(1);
		} finally {
			if (saved === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
			else process.env.ZETA_CODING_AGENT_DIR = saved;
			refreshDirsFromEnv();
		}
	}, 30_000);

	test("status counts stash entries and reports an unborn repository", async () => {
		const repo = await makeTempDir("zeta-gw-gitstash-");
		await initRepo(repo);
		await writeFile(join(repo, "one.txt"), "one\n");
		await $`git stash push -u -q -m first`.cwd(repo).quiet();
		await writeFile(join(repo, "two.txt"), "two\n");
		await $`git stash push -u -q -m second`.cwd(repo).quiet();

		const two = (await (await handleGitStatus(get("/api/git/status", { cwd: repo }))).json()) as StatusBody;
		expect(two.stashCount).toBe(2);
		expect(two.unborn).toBe(false);

		// Dropping a stash rewrites the reflog, so the count follows it back down.
		await $`git stash pop -q`.cwd(repo).quiet();
		const one = (await (await handleGitStatus(get("/api/git/status", { cwd: repo }))).json()) as StatusBody;
		expect(one.stashCount).toBe(1);

		const fresh = await makeTempDir("zeta-gw-gitunborn-");
		await $`git init -q --initial-branch=main`.cwd(fresh).quiet();
		const response = await handleGitStatus(get("/api/git/status", { cwd: fresh }));
		expect(response.status).toBe(200);
		const unborn = (await response.json()) as StatusBody;
		expect(unborn).toMatchObject({
			isGitRepository: true,
			current: "main",
			unborn: true,
			ahead: 0,
			behind: 0,
			stashCount: 0,
		});
		expect(unborn.changes).toEqual([]);
	});

	test("worktrees report lock state with its reason, and prunable checkouts", async () => {
		const root = await makeTempDir("zeta-gw-gitwtfacts-");
		const repo = join(root, "main");
		await mkdir(repo, { recursive: true });
		await initRepo(repo);
		await $`git branch feature`.cwd(repo).quiet();
		await $`git branch gone`.cwd(repo).quiet();
		const lockedRoot = join(root, "wt-locked");
		await $`git worktree add -q ${lockedRoot} feature`.cwd(repo).quiet();
		await $`git worktree lock --reason in-use ${lockedRoot}`.cwd(repo).quiet();
		const goneRoot = join(root, "wt-gone");
		await $`git worktree add -q ${goneRoot} gone`.cwd(repo).quiet();
		await rm(goneRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

		const response = await handleGitWorktrees(get("/api/git/worktrees", { cwd: repo }));
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			worktrees: Array<{
				path: string;
				branch: string | null;
				bare: boolean;
				locked: boolean;
				lockReason?: string;
				prunable: boolean;
			}>;
		};
		const byBranch = new Map(body.worktrees.map(entry => [entry.branch, entry]));
		expect(byBranch.get("main")).toMatchObject({ bare: false, locked: false, prunable: false });
		expect(byBranch.get("feature")).toMatchObject({
			bare: false,
			locked: true,
			lockReason: "in-use",
			prunable: false,
		});
		expect(byBranch.get("gone")).toMatchObject({ prunable: true });
	});

	test("log rows classify against the upstream, and stay unclassified without one", async () => {
		const root = await makeTempDir("zeta-gw-gitlogrel-");
		const origin = join(root, "origin.git");
		await $`git init -q --bare --initial-branch=main ${origin}`.quiet();
		const work = join(root, "work");
		await $`git clone -q ${origin} ${work}`.quiet();
		await $`git config user.email test@example.com`.cwd(work).quiet();
		await $`git config user.name Test`.cwd(work).quiet();
		await Bun.write(join(work, "a.txt"), "a\n");
		await $`git add -A`.cwd(work).quiet();
		await $`git commit -q -m first`.cwd(work).quiet();
		await $`git push -q origin main`.cwd(work).quiet();
		await Bun.write(join(work, "b.txt"), "b\n");
		await $`git add -A`.cwd(work).quiet();
		await $`git commit -q -m local-side`.cwd(work).quiet();

		const response = await handleGitLog(get("/api/git/log", { cwd: work }));
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			commits: Array<{ sha: string; subject: string; refs?: string[]; relation?: string }>;
			hasMore: boolean;
		};
		expect(body.hasMore).toBe(false);
		expect(body.commits.map(commit => commit.subject)).toEqual(["local-side", "first"]);
		// HEAD is the branch tip; the pushed commit is shared with the upstream.
		expect(body.commits[0]).toMatchObject({ relation: "head", refs: ["HEAD -> main"] });
		expect(body.commits[1].relation).toBe("common");

		const local = await makeTempDir("zeta-gw-gitloglocal-");
		await initRepo(local);
		const localResponse = await handleGitLog(get("/api/git/log", { cwd: local }));
		expect(localResponse.status).toBe(200);
		const localBody = (await localResponse.json()) as { commits: Array<{ relation?: string }> };
		expect(localBody.commits.length).toBeGreaterThan(0);
		// No upstream to compare against: the field is absent rather than guessed.
		for (const commit of localBody.commits) expect(commit).not.toHaveProperty("relation");
	});
});

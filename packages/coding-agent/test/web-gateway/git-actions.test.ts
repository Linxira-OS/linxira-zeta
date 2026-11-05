/**
 * Gateway git mutation contract — the Studio Git surface.
 *
 * These handlers are the write side of `/api/git/*`; the read side (`status`,
 * `diff`) stays in Next. Contracts pinned here:
 * - `stage` accepts repository-relative paths and `all`, and refuses absolute
 *   paths or paths that escape the repository,
 * - `commit` refuses an empty index (409) instead of creating an empty commit,
 * - `pull` is fast-forward-only: behind → reset to the remote tip, ahead →
 *   reported as no-op, diverged → 409 `diverged` with both sides,
 * - `log` paginates with `skip`/`limit` and reports `hasMore`,
 * - a non-git cwd answers `{ isGitRepository: false }`, never an error.
 *
 * Exercised through the real handlers against temp git repositories.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
	handleGitCommit,
	handleGitLog,
	handleGitPull,
	handleGitPush,
	handleGitStage,
	handleGitUnstage,
} from "../../src/server/web-gateway/git-actions";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

function post(pathname: string, body: unknown): Request {
	return new Request(`http://localhost${pathname}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

function logRequest(cwd: string, query = ""): Request {
	return new Request(`http://localhost/api/git/log?cwd=${encodeURIComponent(cwd)}${query}`);
}

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

async function head(dir: string): Promise<string> {
	return (await $`git rev-parse HEAD`.cwd(dir).quiet().text()).trim();
}

describe("gateway git actions", () => {
	test("stage takes relative paths; commit produces a sha and the log shows it", async () => {
		const repo = await makeTempDir("zeta-gw-gita-");
		await initRepo(repo);
		await Bun.write(join(repo, "a.txt"), "one\n");

		const staged = await handleGitStage(post("/api/git/stage", { cwd: repo, paths: ["a.txt"] }));
		expect(staged.status).toBe(200);
		expect(await staged.json()).toEqual({ ok: true, staged: 1 });

		const committed = await handleGitCommit(post("/api/git/commit", { cwd: repo, message: "add a" }));
		expect(committed.status).toBe(200);
		const body = (await committed.json()) as { ok: boolean; sha: string };
		expect(body.ok).toBe(true);
		expect(body.sha).toBe(await head(repo));

		const log = await handleGitLog(logRequest(repo, "&limit=5"));
		const entries = (await log.json()) as {
			commits: Array<{
				sha: string;
				subject: string;
				parents?: string[];
				authorName?: string;
				authorDate?: string;
				refs?: string[];
			}>;
			hasMore: boolean;
		};
		// `--oneline` abbreviates the hash; the row identity is that short form.
		expect(entries.commits[0]?.subject).toBe("add a");
		expect(body.sha.startsWith(entries.commits[0]?.sha ?? "\u0000")).toBe(true);
		// The enrichment adds the full parents, author and decorations at the
		// commit the branch points at; `sha` itself stays the oneline form.
		await $`git tag v1`.cwd(repo).quiet();
		const tagged = await handleGitLog(logRequest(repo, "&limit=5"));
		const taggedEntries = (await tagged.json()) as {
			commits: Array<{ refs?: string[] }>;
		};
		expect(entries.commits[0]?.parents?.[0]?.startsWith(entries.commits[1]?.sha ?? "\u0000")).toBe(true);
		expect(entries.commits[0]?.authorName).toBe("Test");
		expect(typeof entries.commits[0]?.authorDate).toBe("string");
		expect(taggedEntries.commits[0]?.refs).toEqual(["HEAD -> main", "tag: v1"]);
		expect(entries.commits[1]?.subject).toBe("baseline");
		expect(entries.hasMore).toBe(false);
	}, 30_000);

	test("stage all picks up an untracked file", async () => {
		const repo = await makeTempDir("zeta-gw-gita-");
		await initRepo(repo);
		await Bun.write(join(repo, "b.txt"), "two\n");

		const staged = await handleGitStage(post("/api/git/stage", { cwd: repo, all: true }));
		expect(await staged.json()).toEqual({ ok: true, staged: 1 });
	}, 30_000);

	test("absolute and escaping paths are rejected", async () => {
		const repo = await makeTempDir("zeta-gw-gita-");
		await initRepo(repo);

		const absolute = await handleGitStage(post("/api/git/stage", { cwd: repo, paths: [join(repo, "a.txt")] }));
		expect(absolute.status).toBe(400);

		const escaping = await handleGitStage(post("/api/git/stage", { cwd: repo, paths: ["../outside.txt"] }));
		expect(escaping.status).toBe(400);
	}, 30_000);

	test("commit refuses an empty index", async () => {
		const repo = await makeTempDir("zeta-gw-gita-");
		await initRepo(repo);

		const response = await handleGitCommit(post("/api/git/commit", { cwd: repo, message: "nothing" }));
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "nothing staged" });
		expect(await head(repo)).toBe(await head(repo));
	}, 30_000);

	test("unstage drops the path back to untracked", async () => {
		const repo = await makeTempDir("zeta-gw-gita-");
		await initRepo(repo);
		await Bun.write(join(repo, "c.txt"), "three\n");
		await handleGitStage(post("/api/git/stage", { cwd: repo, paths: ["c.txt"] }));

		const unstage = await handleGitUnstage(post("/api/git/unstage", { cwd: repo, paths: ["c.txt"] }));
		expect(await unstage.json()).toEqual({ ok: true });
		const porcelain = (await $`git status --porcelain`.cwd(repo).quiet().text()).trim();
		expect(porcelain).toBe("?? c.txt");
	}, 30_000);

	test("log paginates with skip and reports hasMore", async () => {
		const repo = await makeTempDir("zeta-gw-gita-");
		await initRepo(repo);
		for (const name of ["one", "two", "three"]) {
			await Bun.write(join(repo, `${name}.txt`), `${name}\n`);
			await $`git add -A`.cwd(repo).quiet();
			await $`git commit -q -m ${name}`.cwd(repo).quiet();
		}

		const first = (await (await handleGitLog(logRequest(repo, "&limit=2"))).json()) as {
			commits: Array<{ subject: string }>;
			hasMore: boolean;
		};
		expect(first.commits.map(row => row.subject)).toEqual(["three", "two"]);
		expect(first.hasMore).toBe(true);

		const second = (await (await handleGitLog(logRequest(repo, "&limit=2&skip=2"))).json()) as {
			commits: Array<{ subject: string }>;
			hasMore: boolean;
		};
		expect(second.commits.map(row => row.subject)).toEqual(["one", "baseline"]);
		expect(second.hasMore).toBe(false);
	}, 30_000);

	test("push then pull fast-forwards a clone that fell behind", async () => {
		const origin = await makeTempDir("zeta-gw-origin-");
		await $`git init -q --bare --initial-branch=main`.cwd(origin).quiet();
		const work = await makeTempDir("zeta-gw-work-");
		await initRepo(work);
		await $`git remote add origin ${origin}`.cwd(work).quiet();
		await $`git push -q -u origin main`.cwd(work).quiet();

		const clone = await makeTempDir("zeta-gw-clone-");
		await $`git clone -q ${origin} .`.cwd(clone).quiet();
		await $`git config user.email test@example.com`.cwd(clone).quiet();
		await $`git config user.name Test`.cwd(clone).quiet();

		await Bun.write(join(work, "d.txt"), "four\n");
		await handleGitStage(post("/api/git/stage", { cwd: work, all: true }));
		await handleGitCommit(post("/api/git/commit", { cwd: work, message: "four" }));
		const pushed = await handleGitPush(post("/api/git/push", { cwd: work }));
		expect(await pushed.json()).toEqual({ ok: true, remote: "origin", branch: "main" });

		const tip = await head(work);
		const pulled = await handleGitPull(post("/api/git/pull", { cwd: clone }));
		expect(pulled.status).toBe(200);
		expect(await pulled.json()).toEqual({ ok: true, fastForward: true, sha: tip });
		expect(await head(clone)).toBe(tip);
	}, 30_000);

	test("pull refuses a diverged branch instead of resetting", async () => {
		const origin = await makeTempDir("zeta-gw-origin-");
		await $`git init -q --bare --initial-branch=main`.cwd(origin).quiet();
		const work = await makeTempDir("zeta-gw-work-");
		await initRepo(work);
		await $`git remote add origin ${origin}`.cwd(work).quiet();
		await $`git push -q -u origin main`.cwd(work).quiet();

		const clone = await makeTempDir("zeta-gw-clone-");
		await $`git clone -q ${origin} .`.cwd(clone).quiet();
		await $`git config user.email test@example.com`.cwd(clone).quiet();
		await $`git config user.name Test`.cwd(clone).quiet();

		// Both sides move.
		await Bun.write(join(work, "remote.txt"), "remote\n");
		await $`git add -A`.cwd(work).quiet();
		await $`git commit -q -m remote`.cwd(work).quiet();
		await $`git push -q origin main`.cwd(work).quiet();
		await Bun.write(join(clone, "local.txt"), "local\n");
		await $`git add -A`.cwd(clone).quiet();
		await $`git commit -q -m local`.cwd(clone).quiet();
		const localTip = await head(clone);

		const pulled = await handleGitPull(post("/api/git/pull", { cwd: clone }));
		expect(pulled.status).toBe(409);
		const body = (await pulled.json()) as { error: string; local: string };
		expect(body.error).toBe("diverged");
		expect(body.local).toBe(localTip);
		expect(await head(clone)).toBe(localTip);
	}, 30_000);

	test("a non-git directory answers isGitRepository: false", async () => {
		const dir = await makeTempDir("zeta-gw-plain-");
		const staged = await handleGitStage(post("/api/git/stage", { cwd: dir, all: true }));
		expect(await staged.json()).toEqual({ isGitRepository: false });
		const log = await handleGitLog(logRequest(dir));
		expect(await log.json()).toEqual({ isGitRepository: false });
	}, 30_000);

	test("a missing cwd is a 400 on every handler", async () => {
		expect((await handleGitStage(post("/api/git/stage", { all: true }))).status).toBe(400);
		expect((await handleGitCommit(post("/api/git/commit", { message: "x" }))).status).toBe(400);
		expect((await handleGitPush(post("/api/git/push", {}))).status).toBe(400);
		expect((await handleGitPull(post("/api/git/pull", {}))).status).toBe(400);
		expect((await handleGitLog(new Request("http://localhost/api/git/log"))).status).toBe(400);
	}, 30_000);
});

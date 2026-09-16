/**
 * Gateway git contract for the sidebar project switcher: branch listing
 * (local branches + current), checkout (refused on a dirty tree with a 409
 * file count), branch creation (no checkout, invalid names rejected), the
 * `{ isGitRepository: false }` signal for non-git cwds, and the
 * SessionInfo.temp flag for sessions whose cwd lives inside the OS temp dir.
 * Exercised through the real handlers against a temp git repo.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { handleGitBranch, handleGitBranches, handleGitCheckout } from "../../src/server/web-gateway/git";
import { invalidateSessionListCache, listAllSessionsWeb } from "../../src/server/web-gateway/sessions";
import { SessionManager } from "../../src/session/session-manager";

const ENV_KEY = "ZETA_CODING_AGENT_DIR";

function getRequest(cwd: string): Request {
	return new Request(`http://localhost/api/git/branches?cwd=${encodeURIComponent(cwd)}`);
}

function postRequest(pathname: string, body: Record<string, string>): Request {
	return new Request(`http://localhost${pathname}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("gateway git branches", () => {
	const cleanups: Array<() => Promise<void>> = [];
	const savedEnv = new Map<string, string | undefined>();

	afterEach(async () => {
		if (savedEnv.has(ENV_KEY)) {
			const saved = savedEnv.get(ENV_KEY);
			if (saved === undefined) delete process.env[ENV_KEY];
			else process.env[ENV_KEY] = saved;
			refreshDirsFromEnv();
		}
		invalidateSessionListCache();
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	});

	async function makeTempDir(prefix: string): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), prefix));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		return dir;
	}

	/** Real git repo on `main` with a second local branch `feature/x`. */
	async function initGitRepo(dir: string): Promise<void> {
		await $`git init -q --initial-branch=main`.cwd(dir).quiet();
		await $`git config core.autocrlf false`.cwd(dir).quiet();
		await $`git config user.email test@example.com`.cwd(dir).quiet();
		await $`git config user.name Test`.cwd(dir).quiet();
		await Bun.write(join(dir, "README.md"), "# fixture\n");
		await $`git add -A`.cwd(dir).quiet();
		await $`git commit -q -m baseline`.cwd(dir).quiet();
		await $`git branch feature/x`.cwd(dir).quiet();
	}

	async function currentBranch(dir: string): Promise<string> {
		return (await $`git rev-parse --abbrev-ref HEAD`.cwd(dir).quiet().text()).trim();
	}

	test("branches listing: local branches with current flag and top-level current", async () => {
		const repo = await makeTempDir("zeta-gw-git-");
		await initGitRepo(repo);

		const res = await handleGitBranches(getRequest(repo));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			isGitRepository: true,
			current: "main",
			branches: [
				{ name: "feature/x", current: false },
				{ name: "main", current: true },
			],
		});
	});

	test("checkout switches HEAD; branch create adds a local branch without switching", async () => {
		const repo = await makeTempDir("zeta-gw-git-");
		await initGitRepo(repo);

		const checkout = await handleGitCheckout(postRequest("/api/git/checkout", { cwd: repo, branch: "feature/x" }));
		expect(checkout.status).toBe(200);
		expect(await checkout.json()).toEqual({ ok: true, branch: "feature/x" });
		expect(await currentBranch(repo)).toBe("feature/x");

		const create = await handleGitBranch(postRequest("/api/git/branch", { cwd: repo, name: "side/work" }));
		expect(create.status).toBe(200);
		expect(await create.json()).toEqual({ ok: true, branch: "side/work" });
		// Creation must not move HEAD…
		expect(await currentBranch(repo)).toBe("feature/x");
		// …and the new branch shows up in the listing, not flagged current.
		const branches = (await (await handleGitBranches(getRequest(repo))).json()) as {
			current: string;
			branches: Array<{ name: string; current: boolean }>;
		};
		expect(branches.current).toBe("feature/x");
		expect(branches.branches).toContainEqual({ name: "side/work", current: false });
	});

	test("checkout refuses a dirty tree with 409 { error: dirty, files }", async () => {
		const repo = await makeTempDir("zeta-gw-git-");
		await initGitRepo(repo);
		await writeFile(join(repo, "README.md"), "# modified\n");

		const res = await handleGitCheckout(postRequest("/api/git/checkout", { cwd: repo, branch: "feature/x" }));
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "dirty", files: 1 });
		expect(await currentBranch(repo)).toBe("main");
	});

	test("branch create rejects invalid names and existing branches", async () => {
		const repo = await makeTempDir("zeta-gw-git-");
		await initGitRepo(repo);

		for (const name of ["", "bad..name", "-flag", "has space"]) {
			const res = await handleGitBranch(postRequest("/api/git/branch", { cwd: repo, name }));
			expect(res.status).toBe(400);
			expect((await res.json()) as { error: string }).toHaveProperty("error");
		}

		const dup = await handleGitBranch(postRequest("/api/git/branch", { cwd: repo, name: "main" }));
		expect(dup.status).toBe(409);
	});

	test("non-git cwd answers { isGitRepository: false } on all three routes", async () => {
		const plain = await makeTempDir("zeta-gw-nogit-");

		const list = await handleGitBranches(getRequest(plain));
		expect(list.status).toBe(200);
		expect(await list.json()).toEqual({ isGitRepository: false });

		const checkout = await handleGitCheckout(postRequest("/api/git/checkout", { cwd: plain, branch: "main" }));
		expect(checkout.status).toBe(200);
		expect(await checkout.json()).toEqual({ isGitRepository: false });

		const create = await handleGitBranch(postRequest("/api/git/branch", { cwd: plain, name: "new-branch" }));
		expect(create.status).toBe(200);
		expect(await create.json()).toEqual({ isGitRepository: false });
	});

	test("SessionInfo.temp flags sessions with a cwd inside the OS temp dir", async () => {
		const agentDir = await makeTempDir("zeta-gw-git-agent-");
		savedEnv.set(ENV_KEY, process.env[ENV_KEY]);
		process.env[ENV_KEY] = agentDir;
		refreshDirsFromEnv();
		invalidateSessionListCache();

		const insideTmp = await makeTempDir("zeta-gw-git-cwd-");
		const seed = async (cwd: string): Promise<void> => {
			const dir = SessionManager.getDefaultSessionDir(cwd);
			await Bun.write(
				join(dir, `${randomUUID()}.jsonl`),
				`${JSON.stringify({ type: "session", version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd })}\n`,
			);
		};
		// A scratch session (cwd inside tmp), an ordinary project session
		// (this package dir), and the tmpdir root itself — the root is the
		// boundary, not "inside", so it must not be flagged.
		await seed(insideTmp);
		await seed(process.cwd());
		await seed(tmpdir());

		const sessions = await listAllSessionsWeb();
		expect(sessions.find(s => s.cwd === insideTmp)?.temp).toBe(true);
		expect(sessions.find(s => s.cwd === process.cwd())?.temp).toBeUndefined();
		expect(sessions.find(s => s.cwd === tmpdir())?.temp).toBeUndefined();
	});
});

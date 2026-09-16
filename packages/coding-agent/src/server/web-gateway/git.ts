/**
 * Web Gateway — git branch handlers for the web-ui sidebar project switcher.
 *
 * GET  /api/git/branches?cwd=…  → { isGitRepository, current, branches: [{ name, current }] }
 * POST /api/git/checkout        → { ok: true, branch } | 409 { error: "dirty", files }
 * POST /api/git/branch          → { ok: true, branch } | 400 on invalid name
 *
 * Every handler accepts a plain cwd (the UI passes session cwds through) and
 * answers `{ isGitRepository: false }` (200) outside a git checkout, matching
 * how `projects.ts` signals non-git directories. Git access goes through the
 * pi-vcs native addon, same as `projects.ts` — no git CLI spawning.
 */

import { git, isVcsError } from "@linxiraos/pi-natives/vcs";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

/** Character set git itself rejects; mirrors the worktree CLI's validation. */
const BRANCH_NAME_RE = /^[^\s~^:?*[\\]+$/;

function isValidBranchName(name: string): boolean {
	return BRANCH_NAME_RE.test(name) && !name.startsWith("-") && !name.endsWith("/") && !name.includes("..");
}

/** GET /api/git/branches?cwd=… — local branches plus the current one. */
export async function handleGitBranches(req: Request): Promise<Response> {
	const cwd = new URL(req.url).searchParams.get("cwd");
	if (!cwd) return json({ error: "cwd query parameter is required" }, 400);
	const repo = git(cwd);
	if (!repo) return json({ isGitRepository: false });
	// Detached HEAD → null; no local branch is then flagged current.
	const current = repo.headSync().branch ?? null;
	const branches = (await repo.listBranches(false)).map(name => ({ name, current: name === current }));
	return json({ isGitRepository: true, current, branches });
}

/** POST /api/git/checkout { cwd, branch } — switch branch, refusing a dirty tree. */
export async function handleGitCheckout(req: Request): Promise<Response> {
	const body = (await req.json().catch(() => null)) as { cwd?: unknown; branch?: unknown } | null;
	const cwd = typeof body?.cwd === "string" ? body.cwd : "";
	const branch = typeof body?.branch === "string" ? body.branch : "";
	if (!cwd || !branch) return json({ error: "cwd and branch are required" }, 400);
	const repo = git(cwd);
	if (!repo) return json({ isGitRepository: false });
	const summary = await repo.statusSummary();
	const files = summary.staged + summary.unstaged + summary.untracked;
	if (files > 0) return json({ error: "dirty", files }, 409);
	try {
		await repo.checkout(branch);
	} catch (error) {
		if (isVcsError(error) && (error.code === "RefNotFound" || error.code === "ObjectNotFound")) {
			return json({ error: `unknown branch: ${branch}` }, 400);
		}
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
	return json({ ok: true, branch });
}

/** POST /api/git/branch { cwd, name } — create a local branch at HEAD, no checkout. */
export async function handleGitBranch(req: Request): Promise<Response> {
	const body = (await req.json().catch(() => null)) as { cwd?: unknown; name?: unknown } | null;
	const cwd = typeof body?.cwd === "string" ? body.cwd : "";
	const name = typeof body?.name === "string" ? body.name : "";
	if (!cwd) return json({ error: "cwd is required" }, 400);
	if (!isValidBranchName(name)) return json({ error: `invalid branch name: ${name}` }, 400);
	const repo = git(cwd);
	if (!repo) return json({ isGitRepository: false });
	if (await repo.refExists(`refs/heads/${name}`)) {
		return json({ error: `branch already exists: ${name}` }, 409);
	}
	try {
		await repo.createBranch(name, "HEAD", false);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
	return json({ ok: true, branch: name });
}

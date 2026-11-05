/**
 * Web Gateway — git mutations for the Studio Git surface.
 *
 * The read side (`status`, `diff`, `remotes`, `show`, `worktrees`) lives in
 * `git-reads.ts`; both halves go through the pi-vcs native addon rather than
 * spawning `git` from the web process. Everything that *writes* lives here:
 *
 *   POST /api/git/stage   { cwd, paths?: string[], all?: boolean } → { ok, staged }
 *   POST /api/git/unstage { cwd, paths: string[] }                 → { ok }
 *   POST /api/git/commit  { cwd, message, amend?, paths? }         → { ok, sha }
 *   POST /api/git/push    { cwd, remote?, branch?, forceWithLease? } → { ok }
 *   POST /api/git/fetch   { cwd, remote?, branch? }                → { ok, remote, branch }
 *   POST /api/git/pull    { cwd, remote?, branch? }                → { ok, fastForward, sha? }
 *   GET  /api/git/log?cwd=&limit=&skip=                            → { commits, hasMore }
 *
 * `pull` is fast-forward-only on purpose: the addon has no merge driver, so a
 * pull that would rewrite local history is refused (409 `diverged`) rather
 * than approximated with a hard reset.
 *
 * No handler here touches the file system by path beyond handing relative paths
 * to the addon, and every path is rejected when absolute or when it escapes the
 * repository root.
 */

import { isAbsolute, relative, resolve } from "node:path";
import { git, isVcsError, requireGit } from "@linxiraos/pi-natives/vcs";
import { enrichLogRows } from "./git-reads";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Repository-relative paths only. The UI always sends paths it read from
 * `status`, so anything absolute or escaping the root is a bug or an attack.
 */
function normalizePaths(cwd: string, value: unknown): string[] | { error: string } {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) return { error: "paths must be an array of repository-relative paths" };
	const root = resolve(cwd);
	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string" || entry.trim() === "") return { error: "paths must be non-empty strings" };
		if (isAbsolute(entry)) return { error: `absolute path not allowed: ${entry}` };
		const resolved = resolve(root, entry);
		const rel = relative(root, resolved);
		if (rel.startsWith("..") || isAbsolute(rel)) return { error: `path escapes the repository: ${entry}` };
		out.push(rel.replace(/\\/g, "/"));
	}
	return out;
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
	const body = (await req.json().catch(() => null)) as unknown;
	return isObject(body) ? body : null;
}

function branchOrNull(body: Record<string, unknown>): string | null {
	return typeof body.branch === "string" && body.branch.trim() ? body.branch.trim() : null;
}

/**
 * Remote + remote-side ref for a local branch, honouring
 * `branch.<name>.remote` / `branch.<name>.merge` before falling back to the
 * same-named branch on the first remote. A clone of a repo whose default
 * branch is `master` while the local branch is `main` must not be asked for
 * `refs/heads/main` just because that is the local name.
 */
async function resolveUpstream(
	repo: NonNullable<ReturnType<typeof git>>,
	branch: string,
	requestedRemote: string | undefined,
): Promise<{ remote: string; remoteRef: string } | null> {
	const configuredRemote = await repo.configGet(`branch.${branch}.remote`).catch(() => null);
	const configuredMerge = await repo.configGet(`branch.${branch}.merge`).catch(() => null);
	const remotes = await repo.remoteList().catch(() => [] as string[]);
	const preferred = requestedRemote ?? configuredRemote ?? (remotes.includes("origin") ? "origin" : remotes[0]);
	if (!preferred) return null;
	const candidate = configuredMerge ?? `refs/heads/${branch}`;
	if (requestedRemote && requestedRemote !== configuredRemote) {
		// An explicit remote means "that remote's same-named branch"; the
		// configured merge ref belongs to the configured remote only.
		return { remote: requestedRemote, remoteRef: `refs/heads/${branch}` };
	}
	return { remote: preferred, remoteRef: candidate };
}

/** POST /api/git/stage — stage the named paths, or the whole tree with `all`. */
export async function handleGitStage(req: Request): Promise<Response> {
	const body = await readBody(req);
	const cwd = typeof body?.cwd === "string" ? body.cwd : "";
	if (!cwd) return json({ error: "cwd is required" }, 400);
	const paths = normalizePaths(cwd, body?.paths);
	if (!Array.isArray(paths)) return json({ error: paths.error }, 400);
	const all = body?.all === true;
	if (!all && paths.length === 0) return json({ error: "paths or all is required" }, 400);
	let repo: ReturnType<typeof git>;
	try {
		repo = git(cwd);
	} catch (error) {
		return json({ error: errorMessage(error) }, 400);
	}
	if (!repo) return json({ isGitRepository: false }, 200);
	try {
		await repo.stageFiles(all ? [] : paths);
		const summary = await repo.statusSummary();
		return json({ ok: true, staged: summary.staged });
	} catch (error) {
		return json({ error: errorMessage(error) }, 500);
	}
}

/** POST /api/git/unstage — drop the named paths from the index. */
export async function handleGitUnstage(req: Request): Promise<Response> {
	const body = await readBody(req);
	const cwd = typeof body?.cwd === "string" ? body.cwd : "";
	if (!cwd) return json({ error: "cwd is required" }, 400);
	const paths = normalizePaths(cwd, body?.paths);
	if (!Array.isArray(paths)) return json({ error: paths.error }, 400);
	if (paths.length === 0) return json({ error: "paths is required" }, 400);
	const repo = git(cwd);
	if (!repo) return json({ isGitRepository: false }, 200);
	try {
		await repo.unstage(paths);
		return json({ ok: true });
	} catch (error) {
		return json({ error: errorMessage(error) }, 500);
	}
}

/** POST /api/git/commit — commit the index (or the named paths). */
export async function handleGitCommit(req: Request): Promise<Response> {
	const body = await readBody(req);
	const cwd = typeof body?.cwd === "string" ? body.cwd : "";
	if (!cwd) return json({ error: "cwd is required" }, 400);
	const message = typeof body?.message === "string" ? body.message : "";
	if (!message.trim()) return json({ error: "message is required" }, 400);
	const paths = normalizePaths(cwd, body?.paths);
	if (!Array.isArray(paths)) return json({ error: paths.error }, 400);
	const amend = body?.amend === true;
	const allowEmpty = body?.allowEmpty === true;
	const repo = git(cwd);
	if (!repo) return json({ isGitRepository: false }, 200);
	try {
		const summary = await repo.statusSummary();
		if (!amend && !allowEmpty && summary.staged === 0 && paths.length === 0) {
			return json({ error: "nothing staged" }, 409);
		}
		const sha = await repo.commitCreate(message, {
			amend,
			allowEmpty,
			...(paths.length > 0 ? { files: paths } : {}),
		});
		return json({ ok: true, sha });
	} catch (error) {
		if (isVcsError(error)) return json({ error: errorMessage(error), code: error.code }, 409);
		return json({ error: errorMessage(error) }, 500);
	}
}

/** POST /api/git/push — push the current branch (or `branch`) to `remote`. */
export async function handleGitPush(req: Request): Promise<Response> {
	const body = await readBody(req);
	const cwd = typeof body?.cwd === "string" ? body.cwd : "";
	if (!cwd) return json({ error: "cwd is required" }, 400);
	const repo = git(cwd);
	if (!repo) return json({ isGitRepository: false }, 200);
	const remote = typeof body?.remote === "string" && body.remote.trim() ? body.remote.trim() : undefined;
	const branch = branchOrNull(body ?? {}) ?? repo.headSync().branch ?? null;
	if (!branch) return json({ error: "detached HEAD: there is no branch to push" }, 409);
	const remotes = await repo.remoteList().catch(() => [] as string[]);
	const target = remote ?? (remotes.includes("origin") ? "origin" : remotes[0]);
	if (!target) return json({ error: "no remote configured" }, 409);
	try {
		await repo.push({ remote: target, refspec: `refs/heads/${branch}:refs/heads/${branch}` });
		return json({ ok: true, remote: target, branch });
	} catch (error) {
		return json({ error: errorMessage(error), remote: target, branch }, 500);
	}
}

/** POST /api/git/fetch — fetch one branch from a remote without touching HEAD. */
export async function handleGitFetch(req: Request): Promise<Response> {
	const body = await readBody(req);
	const cwd = typeof body?.cwd === "string" ? body.cwd : "";
	if (!cwd) return json({ error: "cwd is required" }, 400);
	const repo = git(cwd);
	if (!repo) return json({ isGitRepository: false }, 200);
	const branch = branchOrNull(body ?? {}) ?? repo.headSync().branch ?? null;
	if (!branch) return json({ error: "detached HEAD: specify a branch" }, 409);
	const upstream = await resolveUpstream(
		repo,
		branch,
		typeof body?.remote === "string" && body.remote.trim() ? body.remote.trim() : undefined,
	);
	if (!upstream) return json({ error: "no remote configured" }, 409);
	const { remote, remoteRef } = upstream;
	try {
		await repo.fetch(remote, remoteRef, `refs/remotes/${remote}/${branch}`);
		return json({ ok: true, remote, branch });
	} catch (error) {
		return json({ error: errorMessage(error), remote, branch }, 500);
	}
}

/**
 * POST /api/git/pull — fetch, then fast-forward only.
 *
 * Refuses when local and remote have diverged (409 `diverged`): the addon has
 * no merge, and a `reset --hard` on a diverged branch would silently destroy
 * local commits.
 */
export async function handleGitPull(req: Request): Promise<Response> {
	const body = await readBody(req);
	const cwd = typeof body?.cwd === "string" ? body.cwd : "";
	if (!cwd) return json({ error: "cwd is required" }, 400);
	const repo = git(cwd);
	if (!repo) return json({ isGitRepository: false }, 200);
	const branch = branchOrNull(body ?? {}) ?? repo.headSync().branch ?? null;
	if (!branch) return json({ error: "detached HEAD: specify a branch" }, 409);
	if (await repo.isDirty().catch(() => false)) return json({ error: "dirty", files: 0 }, 409);
	const upstream = await resolveUpstream(
		repo,
		branch,
		typeof body?.remote === "string" && body.remote.trim() ? body.remote.trim() : undefined,
	);
	if (!upstream) return json({ error: "no remote configured" }, 409);
	const { remote, remoteRef } = upstream;
	const tracking = `refs/remotes/${remote}/${branch}`;
	try {
		await repo.fetch(remote, remoteRef, tracking);
		const head = await repo.headSha();
		const remoteSha = await repo.resolveRef(tracking);
		if (!remoteSha) return json({ error: `remote branch missing: ${remote}/${branch}` }, 404);
		if (!head) return json({ error: "HEAD has no commit" }, 409);
		if (head === remoteSha) return json({ ok: true, fastForward: false, sha: head });
		const base = await repo.mergeBase(head, remoteSha);
		if (base === head) {
			await repo.reset("hard", remoteSha);
			return json({ ok: true, fastForward: true, sha: remoteSha });
		}
		if (base === remoteSha) return json({ ok: true, fastForward: false, sha: head });
		return json({ error: "diverged", local: head, remote: remoteSha, base: base ?? null }, 409);
	} catch (error) {
		return json({ error: errorMessage(error) }, 500);
	}
}

/** GET /api/git/log?cwd=&limit=&skip= — recent commits, newest first. */
export async function handleGitLog(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const cwd = url.searchParams.get("cwd");
	if (!cwd) return json({ error: "cwd query parameter is required" }, 400);
	const limit = clampInt(url.searchParams.get("limit"), 50, 1, 500);
	const skip = clampInt(url.searchParams.get("skip"), 0, 0, 10_000);
	const repo = git(cwd);
	if (!repo) return json({ isGitRepository: false });
	try {
		// The addon has no offset window, so read one extra row to answer `hasMore`.
		const onelines = await repo.logOnelines(limit + skip + 1);
		const rows = onelines
			.slice(skip, skip + limit)
			.map(parseOneline)
			.filter(row => row.sha !== "");
		const commits = await enrichLogRows(repo, rows);
		return json({ commits, hasMore: onelines.length > skip + limit });
	} catch (error) {
		return json({ error: errorMessage(error) }, 500);
	}
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
	if (raw === null) return fallback;
	const value = Number.parseInt(raw, 10);
	if (!Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

/**
 * `--oneline` prints `<abbreviated-sha> <subject>`, so `sha` here is the short
 * form the addon hands back. It is the row identity and the display value; a
 * caller that needs the full object id resolves it with `showCommit`/hashes
 * from `status`. Subjects may contain spaces, so split on the first one.
 */
function parseOneline(line: string): { sha: string; subject: string } {
	const space = line.indexOf(" ");
	if (space < 0) return { sha: line.trim(), subject: "" };
	return { sha: line.slice(0, space).trim(), subject: line.slice(space + 1).trim() };
}

// `requireGit` is re-exported so callers that must fail loudly (rather than
// answer `{ isGitRepository: false }`) have one import site on this boundary.
export { requireGit };

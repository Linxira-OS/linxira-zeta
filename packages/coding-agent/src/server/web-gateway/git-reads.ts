/**
 * Web Gateway — git read handlers for the Studio Git surface.
 *
 * GET /api/git/status?cwd=            → { isGitRepository, current, ahead, behind, changes, truncated }
 * GET /api/git/diff?cwd=&path=&staged= → { diff } (one working-tree/index file)
 * GET /api/git/diff?cwd=&oid=          → { diff } (one commit, header + patch)
 * GET /api/git/remotes?cwd=           → { remotes: [{ name, url }] }
 * GET /api/git/show?cwd=&oid=         → one commit with its per-file line counts
 * GET /api/git/worktrees?cwd=         → { worktrees: [{ path, branch, head, detached }] }
 *
 * Reads go through the pi-vcs native addon — no `git` subprocess. Outside a
 * checkout the routes answer 404 `{ error: "not a git repository" }`; an
 * unknown commit is 404, an oversized patch is 413, so a caller can tell a
 * refusal from an empty result.
 *
 * DTO gaps (the addon exposes no such fact, so the field is absent rather than
 * invented): `stashCount` in status, `bare`/`locked` in worktrees, and branch
 * decorations for remote-tracking refs in the log.
 */

import { statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { VcsGitRepo } from "@linxiraos/pi-natives";
import { git, isVcsError } from "@linxiraos/pi-natives/vcs";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Per-file patch cap; past this the route answers 413 instead of buffering. */
const MAX_DIFF_BYTES = 512 * 1024;
/** One page of status rows; a pathological tree stops here with `truncated`. */
const MAX_STATUS_CHANGES = 5_000;
/** Patch text read to classify the files of one commit (numstat carries counts). */
const MAX_COMMIT_PATCH_BYTES = 2 * 1024 * 1024;
/** Branches enriched with upstream/divergence; past this the listing stays bare. */
const MAX_ENRICHED_BRANCHES = 100;
/** Commits decorated with `refs`; past this a log page carries no decorations. */
const MAX_DECORATED_COMMITS = 100;

export type GitChangeStatus = "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "conflicted";

export interface GitStatusChange {
	path: string;
	status: GitChangeStatus;
	staged: boolean;
}

/** Porcelain v1 pairs that mean an unresolved merge conflict. */
const CONFLICT_PAIRS: Record<string, true> = {
	DD: true,
	AU: true,
	UD: true,
	UA: true,
	DU: true,
	AA: true,
	UU: true,
};

function classify(index: string, worktree: string): GitChangeStatus {
	const pair = `${index}${worktree}`;
	if (pair === "??") return "untracked";
	if (CONFLICT_PAIRS[pair] === true || pair.includes("U")) return "conflicted";
	if (pair.includes("D")) return "deleted";
	if (pair.includes("R")) return "renamed";
	if (pair.includes("C")) return "copied";
	if (pair.includes("A")) return "added";
	return "modified";
}

/**
 * Porcelain v1 rows (`-z`, so paths are raw). A rename record is followed by
 * the original path, which is skipped: the row is the destination.
 */
function parseStatusEntries(text: string, limit: number): { changes: GitStatusChange[]; truncated: boolean } {
	const rows = text.split("\0");
	const changes: GitStatusChange[] = [];
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i];
		if (row.length < 4 || row[2] !== " ") continue;
		const index = row[0];
		const worktree = row[1];
		if (index === "R" || index === "C" || worktree === "R" || worktree === "C") i += 1;
		if (changes.length >= limit) return { changes, truncated: true };
		changes.push({
			path: row.slice(3),
			status: classify(index, worktree),
			staged: index !== " " && index !== "?",
		});
	}
	return { changes, truncated: false };
}

export interface BranchUpstream {
	/** Display form, e.g. `origin/main`. */
	name: string;
	oid: string;
}

/**
 * The tracking ref configured for `branch`, or null when the branch has no
 * upstream (or the remote-tracking ref does not exist yet). Mirrors
 * `branch.<name>.remote` / `branch.<name>.merge`; no implicit `origin` guess,
 * so a branch without a configured upstream reports no divergence.
 */
export async function resolveBranchUpstream(repo: VcsGitRepo, branch: string): Promise<BranchUpstream | null> {
	const [remote, merge] = await Promise.all([
		repo.configGet(`branch.${branch}.remote`).catch(() => null),
		repo.configGet(`branch.${branch}.merge`).catch(() => null),
	]);
	if (!remote || !merge) return null;
	const shortMerge = merge.startsWith("refs/heads/") ? merge.slice("refs/heads/".length) : merge;
	const tracking = remote === "." ? merge : `refs/remotes/${remote}/${shortMerge}`;
	const oid = await repo.resolveRef(tracking).catch(() => null);
	if (!oid) return null;
	return { name: remote === "." ? shortMerge : `${remote}/${shortMerge}`, oid };
}

export interface BranchDivergence {
	ahead: number;
	behind: number;
}

/** Commits HEAD has that the upstream does not, and the reverse. */
export async function branchDivergence(repo: VcsGitRepo, upstream: BranchUpstream | null): Promise<BranchDivergence> {
	if (!upstream) return { ahead: 0, behind: 0 };
	try {
		const [outgoing, incoming] = await Promise.all([
			repo.revListRange(upstream.oid, "HEAD"),
			repo.revListRange("HEAD", upstream.oid),
		]);
		return { ahead: outgoing.length, behind: incoming.length };
	} catch {
		// Unborn HEAD or a ref that vanished between the two reads.
		return { ahead: 0, behind: 0 };
	}
}

/** Resolve a repository handle, or the refusal response. */
function openRepo(cwd: string): { repo: VcsGitRepo } | { response: Response } {
	let repo: VcsGitRepo | null;
	try {
		repo = git(cwd);
	} catch (error) {
		return { response: json({ error: errorMessage(error) }, 400) };
	}
	if (!repo) return { response: json({ error: "not a git repository", isGitRepository: false }, 404) };
	return { repo };
}

/** GET /api/git/status — working-tree status, one row per changed path. */
export async function handleGitStatus(req: Request): Promise<Response> {
	const cwd = new URL(req.url).searchParams.get("cwd");
	if (!cwd) return json({ error: "cwd query parameter is required" }, 400);
	const opened = openRepo(cwd);
	if ("response" in opened) return opened.response;
	const { repo } = opened;
	try {
		// Detached HEAD → null; the DTO then reports no tracked divergence.
		const current = repo.headSync().branch ?? null;
		const upstream = current ? await resolveBranchUpstream(repo, current) : null;
		const { ahead, behind } = await branchDivergence(repo, upstream);
		const porcelain = await repo.statusPorcelain({ untracked: "normal", nulTerminated: true });
		const { changes, truncated } = parseStatusEntries(porcelain, MAX_STATUS_CHANGES);
		return json({ isGitRepository: true, current, ahead, behind, changes, truncated });
	} catch (error) {
		if (isVcsError(error) && error.code === "OutputTooLarge") {
			return json({ error: "status too large", limit: MAX_STATUS_CHANGES }, 413);
		}
		return json({ error: errorMessage(error) }, 500);
	}
}

/** Absolute paths are accepted as long as they stay inside the checkout. */
function toRepoRelative(root: string, path: string): string | null {
	const candidate = isAbsolute(path) ? relative(root, resolve(path)) : path;
	const rel = candidate.replace(/\\/g, "/");
	if (!rel || rel === "." || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return null;
	return rel;
}

function patchSectionPath(header: string): string | null {
	const marker = header.lastIndexOf(" b/");
	if (marker < 0) return null;
	return header.slice(marker + 3);
}

/**
 * A path the addon leaves out of the index diff — an untracked file has no
 * old side, so render it against the null device. Returns null when the path
 * is not untracked, "too-large" past the cap.
 */
async function untrackedPatch(repo: VcsGitRepo, root: string, rel: string): Promise<string | "too-large" | null> {
	const porcelain = await repo.statusPorcelain({ untracked: "normal", pathspecs: [rel], nulTerminated: true });
	const untracked = porcelain.split("\0").some(row => row.startsWith("?? "));
	if (!untracked) return null;
	try {
		const stat = statSync(resolve(root, rel));
		if (!stat.isFile()) return null;
		if (stat.size > MAX_DIFF_BYTES) return "too-large";
	} catch {
		return null;
	}
	return repo.diffNoIndex("/dev/null", rel, false);
}

/** GET /api/git/diff — one file's patch, or one commit's show output. */
export async function handleGitDiff(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const cwd = url.searchParams.get("cwd");
	const oid = url.searchParams.get("oid");
	const path = url.searchParams.get("path");
	if (!cwd) return json({ error: "cwd query parameter is required" }, 400);
	if (!oid && !path) return json({ error: "path or oid query parameter is required" }, 400);
	const opened = openRepo(cwd);
	if ("response" in opened) return opened.response;
	const { repo } = opened;

	if (oid) {
		const commit = await repo.resolveRef(oid).catch(() => null);
		if (!commit) return json({ error: `unknown commit: ${oid}` }, 404);
		try {
			const shown = await repo.showCommit(commit, MAX_DIFF_BYTES + 1);
			if (shown.truncated) return json({ error: "diff too large", limit: MAX_DIFF_BYTES }, 413);
			return json({ diff: shown.data.toString("utf8") });
		} catch (error) {
			return json({ error: errorMessage(error) }, 500);
		}
	}

	const root = repo.info().repoRoot;
	const rel = toRepoRelative(root, path ?? "");
	if (!rel) return json({ error: "path must be inside the repository" }, 400);
	const staged =
		url.searchParams.get("staged") === "true" ||
		url.searchParams.get("staged") === "1" ||
		url.searchParams.get("staged") === "";
	try {
		const diff = await repo.diffText({
			files: [rel],
			...(staged ? { cached: true } : {}),
			maxBytes: MAX_DIFF_BYTES,
		});
		if (diff === "" && !staged) {
			const synthesized = await untrackedPatch(repo, root, rel);
			if (synthesized === "too-large") return json({ error: "diff too large", limit: MAX_DIFF_BYTES }, 413);
			if (synthesized !== null) return json({ diff: synthesized });
		}
		return json({ diff });
	} catch (error) {
		if (isVcsError(error) && error.code === "OutputTooLarge") {
			return json({ error: "diff too large", limit: MAX_DIFF_BYTES }, 413);
		}
		return json({ error: errorMessage(error) }, 500);
	}
}

/** GET /api/git/remotes — configured remotes and their fetch URLs. */
export async function handleGitRemotes(req: Request): Promise<Response> {
	const cwd = new URL(req.url).searchParams.get("cwd");
	if (!cwd) return json({ error: "cwd query parameter is required" }, 400);
	const opened = openRepo(cwd);
	if ("response" in opened) return opened.response;
	const { repo } = opened;
	try {
		const names = await repo.remoteList();
		const remotes = await Promise.all(
			names.map(async name => ({ name, url: (await repo.remoteUrl(name).catch(() => null)) ?? null })),
		);
		return json({ remotes });
	} catch (error) {
		return json({ error: errorMessage(error) }, 500);
	}
}

export type GitCommitFileStatus = "added" | "modified" | "deleted" | "renamed" | "copied";

export interface GitCommitFile {
	path: string;
	additions?: number;
	deletions?: number;
	status?: GitCommitFileStatus;
}

/**
 * Classify the files of a rendered commit patch. `diff --git` headers carry
 * both paths; `new file mode` / `deleted file mode` / `rename from` decide the
 * status. A truncated patch simply lacks the later sections, and those files
 * keep no `status` rather than a guessed one.
 */
function parsePatchStatuses(text: string): Map<string, GitCommitFileStatus> {
	const out = new Map<string, GitCommitFileStatus>();
	let path: string | null = null;
	let status: GitCommitFileStatus = "modified";
	const flush = (): void => {
		if (path !== null) out.set(path, status);
	};
	for (const line of text.split("\n")) {
		if (line.startsWith("diff --git ")) {
			flush();
			path = patchSectionPath(line.slice("diff --git ".length));
			status = "modified";
		} else if (line.startsWith("new file mode ")) status = "added";
		else if (line.startsWith("deleted file mode ")) status = "deleted";
		else if (line.startsWith("rename from ")) status = "renamed";
		else if (line.startsWith("copy from ")) status = "copied";
	}
	flush();
	return out;
}

/** Fallback for a root commit, which has no parent tree to `numstat` against. */
function parsePatchFiles(text: string): GitCommitFile[] {
	const files: GitCommitFile[] = [];
	let current:
		| (Required<Pick<GitCommitFile, "path" | "status">> & { additions: number; deletions: number; binary: boolean })
		| null = null;
	const flush = (): void => {
		if (!current) return;
		files.push({
			path: current.path,
			status: current.status,
			...(current.binary ? {} : { additions: current.additions, deletions: current.deletions }),
		});
	};
	for (const line of text.split("\n")) {
		if (line.startsWith("diff --git ")) {
			flush();
			const path = patchSectionPath(line.slice("diff --git ".length));
			current = path === null ? null : { path, status: "modified", additions: 0, deletions: 0, binary: false };
			continue;
		}
		if (!current) continue;
		if (line.startsWith("new file mode ")) current.status = "added";
		else if (line.startsWith("deleted file mode ")) current.status = "deleted";
		else if (line.startsWith("rename from ")) current.status = "renamed";
		else if (line.startsWith("copy from ")) current.status = "copied";
		else if (line.startsWith("Binary files ")) current.binary = true;
		else if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;
		else if (line.startsWith("+")) current.additions += 1;
		else if (line.startsWith("-")) current.deletions += 1;
	}
	flush();
	return files;
}

/** First line is the subject; the rest is the body (blank leading lines cut). */
function splitMessage(message: string): { subject: string; body: string } {
	const newline = message.indexOf("\n");
	if (newline < 0) return { subject: message.trim(), body: "" };
	return {
		subject: message.slice(0, newline).trim(),
		body: message
			.slice(newline + 1)
			.replace(/^\s*\n/, "")
			.trimEnd(),
	};
}

async function commitFiles(
	repo: VcsGitRepo,
	sha: string,
	parents: string[],
): Promise<{ files: GitCommitFile[]; truncated: boolean }> {
	const shown = await repo.showCommit(sha, MAX_COMMIT_PATCH_BYTES + 1);
	const patch = shown.data.toString("utf8");
	// The addon stops at first-parent diff for merges, exactly like `git show`.
	const parent = parents[0];
	if (parent === undefined) return { files: parsePatchFiles(patch), truncated: shown.truncated };
	const statuses = parsePatchStatuses(patch);
	const counts = await repo.numstat({ base: parent, head: sha });
	const files = counts.map(entry => {
		const status = statuses.get(entry.path);
		return {
			path: entry.path,
			...(typeof entry.added === "number" ? { additions: entry.added } : {}),
			...(typeof entry.removed === "number" ? { deletions: entry.removed } : {}),
			...(status === undefined ? {} : { status }),
		};
	});
	return { files, truncated: shown.truncated };
}

/** GET /api/git/show — one commit's metadata and per-file line counts. */
export async function handleGitShow(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const cwd = url.searchParams.get("cwd");
	const oid = url.searchParams.get("oid");
	if (!cwd) return json({ error: "cwd query parameter is required" }, 400);
	if (!oid) return json({ error: "oid query parameter is required" }, 400);
	const opened = openRepo(cwd);
	if ("response" in opened) return opened.response;
	const { repo } = opened;
	const commit = await repo.resolveRef(oid).catch(() => null);
	if (!commit) return json({ error: `unknown commit: ${oid}` }, 404);
	try {
		const details = await repo.commitDetails(commit);
		const { subject, body } = splitMessage(details.message);
		const { files, truncated } = await commitFiles(repo, details.sha, details.parents);
		return json({
			oid: details.sha,
			parents: details.parents,
			authorName: details.author.name,
			authorEmail: details.author.email,
			// The addon leaves the date optional; absent is better than invented.
			...(typeof details.author.date === "string" ? { authorDate: details.author.date } : {}),
			subject,
			body,
			files,
			truncated,
		});
	} catch (error) {
		return json({ error: errorMessage(error) }, 500);
	}
}

/**
 * GET /api/git/worktrees — the primary checkout plus its linked worktrees.
 *
 * `bare` and `locked` are absent: the addon's listing row carries only
 * `path`/`head`/`branch`/`detached`.
 */
export async function handleGitWorktrees(req: Request): Promise<Response> {
	const cwd = new URL(req.url).searchParams.get("cwd");
	if (!cwd) return json({ error: "cwd query parameter is required" }, 400);
	const opened = openRepo(cwd);
	if ("response" in opened) return opened.response;
	const { repo } = opened;
	try {
		const entries = await repo.worktrees();
		return json({
			worktrees: entries.map(entry => ({
				path: entry.path,
				// The addon reports the checked-out ref (`refs/heads/x`); the DTO
				// carries the branch name a caller can pass back.
				branch: entry.branch === undefined ? null : entry.branch.replace(/^refs\/heads\//, ""),
				head: entry.head ?? null,
				detached: entry.detached,
			})),
		});
	} catch (error) {
		return json({ error: errorMessage(error) }, 500);
	}
}

export interface LogRow {
	sha: string;
	subject: string;
}

export type EnrichedLogRow = LogRow & {
	parents?: string[];
	authorName?: string;
	authorDate?: string;
	refs?: string[];
};

/** Local branch heads, keyed by commit id; skipped past the enrichment cap. */
async function branchHeads(repo: VcsGitRepo, current: string | null): Promise<Map<string, string[]>> {
	const heads = new Map<string, string[]>();
	const branches = await repo.listBranches(false).catch(() => [] as string[]);
	if (branches.length > MAX_ENRICHED_BRANCHES) return heads;
	await Promise.all(
		branches.map(async branch => {
			const oid = await repo.resolveRef(`refs/heads/${branch}`).catch(() => null);
			if (!oid) return;
			const label = branch === current ? `HEAD -> ${branch}` : branch;
			const existing = heads.get(oid);
			if (existing) existing.push(label);
			else heads.set(oid, [label]);
		}),
	);
	return heads;
}

/**
 * Add parents, author and decorations to a page of `--oneline` rows.
 *
 * `sha` keeps the addon's abbreviated id (the row identity the log page
 * already returns); `parents` are the full ids `commitDetails` reports. A row
 * whose details cannot be read keeps only what `--oneline` produced, and a
 * page past {@link MAX_DECORATED_COMMITS} carries no `refs` at all.
 */
export async function enrichLogRows(repo: VcsGitRepo, rows: LogRow[]): Promise<EnrichedLogRow[]> {
	const current = repo.headSync().branch ?? null;
	const decorate = rows.length <= MAX_DECORATED_COMMITS;
	const heads = decorate ? await branchHeads(repo, current) : new Map<string, string[]>();
	return Promise.all(
		rows.map(async row => {
			const details = await repo.commitDetails(row.sha).catch(() => null);
			if (!details) return row;
			const enriched: EnrichedLogRow = {
				...row,
				parents: details.parents,
				authorName: details.author.name,
				...(typeof details.author.date === "string" ? { authorDate: details.author.date } : {}),
			};
			if (decorate) {
				const tags = await repo.tagsAt(details.sha).catch(() => [] as string[]);
				enriched.refs = [...(heads.get(details.sha) ?? []), ...tags.map(tag => `tag: ${tag}`)];
			}
			return enriched;
		}),
	);
}

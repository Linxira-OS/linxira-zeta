/**
 * Studio operations — Git reads and execution.
 *
 * Owned operations: `git.branches.list`, `git.remotes.list`, `git.diff.get`,
 * `git.commit.changes`, `git.commit.diff` (queries) and `git.execute`
 * (command). Everything returned is built from the gateway payload; a name
 * this file does not export is simply absent from the capability manifest, so
 * its surface disappears instead of painting fixtures.
 *
 * Operation → gateway route:
 *   git.branches.list               → GET /api/git/branches?cwd=
 *   git.diff.get                    → GET /api/git/diff?cwd=&path=&staged=
 *   git.remotes.list                → GET /api/git/remotes?cwd=
 *   git.commit.changes              → GET /api/git/show?cwd=&oid=
 *   git.commit.diff                 → GET /api/git/diff?cwd=&oid=
 *   git.execute { stage }           → POST /api/git/stage
 *   git.execute { unstage }         → POST /api/git/unstage
 *   git.execute { commit }          → POST /api/git/commit
 *   git.execute { push|fetch|pull } → POST /api/git/{push,fetch,pull}
 *   git.execute { branch.create }   → POST /api/git/branch (+ /api/git/checkout)
 *   git.execute { branch.switch }   → POST /api/git/checkout
 *   git.execute { checkout }        → POST /api/git/checkout
 *
 * `WorkspaceId` is opaque (`ws-<hex>`), never a path: it is the truncated
 * SHA-256 of the workspace's canonical registry key, exactly as
 * `ops/workspace.ts` mints it. Each operation resolves the id through one
 * `GET /api/projects` read — the registry is edited at runtime, so the map is
 * never cached across calls — and hands the matching workspace `path` to the
 * gateway as `cwd`. An absent id sends no `cwd` (the gateway's own default); an
 * id the registry does not know fails as an invalid argument.
 *
 * Not implemented, and why (each is blocked by a required contract field that
 * no gateway route carries, and inventing it would be a fixture):
 * - `git.repository.get` needs `stashCount` and `unborn`. `/api/git/status`
 *   reports neither (no stash surface exists; HEAD-resolution is not exposed).
 * - `git.log.list` needs a per-row `relation`: `head`/`outgoing`/`incoming`/
 *   `common` is a classification against the upstream tip that the log DTO
 *   does not carry (it has no merge base or upstream oid), and guessing it
 *   would mislabel every local-only commit as shared history.
 * - `git.worktrees.list` needs `bare`, `locked` and `prunable`; the worktree
 *   DTO row carries only `path`/`branch`/`head`/`detached` (bare and locked are
 *   documented DTO gaps, and the addon exposes no prune state).
 * - `git.toolchain.get` is C-class in the spec: Zeta exposes no toolchain
 *   surface.
 *
 * `git.commit.diff` is the spec's one B-class Git read: its contract input is
 * `{ workspaceId, oid, path }` — there is no range parameter to forward, and
 * `/api/git/diff?cwd=&oid=` renders the whole commit. This handler extracts the
 * requested file's section, which is what the contract's `path` field means.
 */
import { createHash } from "node:crypto";
import { isRecord } from "@linxiraos/pi-utils";
import { resumePathKey } from "../../../resume/paths.js";
import type {
	GitBranchListReadModel,
	GitBranchRecord,
	GitCommitChangeRecord,
	GitCommitChangesReadModel,
	GitCommitDiffReadModel,
	GitDiffReadModel,
	GitDiffTarget,
	GitExecuteInput,
	GitOperation,
	GitOperationResult,
	GitRemoteListReadModel,
	GitRemoteRecord,
	QueryInput,
} from "../contract/index.js";
import type { StudioFamily } from "../registry.js";
import { StudioOpError, gatewayJson, invalid, optionalString, requiredString, unavailable } from "../gateway.js";

// ---------------------------------------------------------------------------
// Wire-shape guards
//
// Both the operation input (JSON from the renderer) and the gateway answer are
// untrusted, so every field is read through one of these before use.
// ---------------------------------------------------------------------------

function booleanFlag(input: unknown, field: string): boolean | undefined {
	const value = isRecord(input) ? input[field] : undefined;
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw invalid(`${field} must be a boolean`);
	return value;
}

function pathList(input: unknown, field: string): ReadonlyArray<string> {
	const value = isRecord(input) ? input[field] : undefined;
	if (!Array.isArray(value)) throw invalid(`${field} must be an array of repository-relative paths`);
	return value.map(entry => {
		if (typeof entry !== "string" || entry === "") throw invalid(`${field} entries must be non-empty strings`);
		return entry;
	});
}

/** A non-empty string field, or `undefined` (the gateway's empty placeholders drop out). */
function stringField(record: Record<string, unknown>, field: string): string | undefined {
	const value = record[field];
	return typeof value === "string" && value !== "" ? value : undefined;
}

/** Every git route answers `{ isGitRepository: false }` (or 404) outside a checkout. */
function gitAnswer(body: unknown, cwd: string | undefined): Record<string, unknown> {
	const where = cwd === undefined ? "" : `: ${cwd}`;
	if (!isRecord(body)) throw unavailable(`git gateway answered a non-object body${where}`);
	if (body.isGitRepository === false) throw unavailable(`not a git repository${where}`);
	return body;
}

function unsupported(reason: string): StudioOpError {
	return new StudioOpError("unsupported", reason);
}

// ---------------------------------------------------------------------------
// Workspace resolution
//
// The gateway speaks `cwd`; the Renderer speaks opaque workspace ids. The two
// meet here, through the same registry (`GET /api/projects`) and the same hash
// `projects.list` uses, so a `git.*` input names the directory the sidebar
// showed without either side carrying a path.
// ---------------------------------------------------------------------------

const PROJECTS_ROUTE = "/api/projects";

/** Stable, path-free `WorkspaceId` for a canonical workspace key. */
function workspaceIdOf(key: string): string {
	const digest = createHash("sha256")
		.update(`zeta-workspace\u0000${resumePathKey(key)}`)
		.digest("hex");
	return `ws-${digest.slice(0, 16)}`;
}

/**
 * Resolve one opaque workspace id to the directory the gateway takes as `cwd`.
 *
 * One `GET /api/projects` per call: the registry changes at runtime, so the
 * id→path map is request-scoped and never cached in the process. An absent id
 * yields `undefined` (the caller omits `cwd` and the gateway uses its own
 * default); an id the registry does not know is an invalid argument — reading
 * whatever directory the gateway happens to sit in would silently act on the
 * wrong repository.
 */
async function resolveWorkspaceCwd(workspaceId: unknown): Promise<string | undefined> {
	if (workspaceId === undefined) return undefined;
	if (typeof workspaceId !== "string" || workspaceId === "") {
		throw invalid("workspaceId must be a non-empty workspace id");
	}
	const payload = await gatewayJson<unknown>(PROJECTS_ROUTE);
	if (!isRecord(payload) || !Array.isArray(payload.projects)) {
		throw unavailable(`${PROJECTS_ROUTE} returned an unexpected payload`);
	}
	for (const project of payload.projects) {
		if (!isRecord(project) || !Array.isArray(project.workspaces)) continue;
		for (const workspace of project.workspaces) {
			if (!isRecord(workspace)) continue;
			const key = workspace.key;
			const path = workspace.path;
			if (typeof key !== "string" || key === "" || typeof path !== "string" || path === "") continue;
			if (workspaceIdOf(key) === workspaceId) return path;
		}
	}
	throw invalid("unknown workspace");
}

/** Attach the resolved directory to a gateway body; absent id → gateway default. */
function withCwd(cwd: string | undefined, body: Record<string, unknown>): Record<string, unknown> {
	return cwd === undefined ? body : { cwd, ...body };
}

/** Build a gateway query string; an unresolved workspace contributes no `cwd`. */
function queryString(cwd: string | undefined, params: Record<string, string | number | boolean | undefined>): string {
	const search = new URLSearchParams();
	if (cwd !== undefined) search.set("cwd", cwd);
	for (const [name, value] of Object.entries(params)) {
		if (value !== undefined) search.set(name, String(value));
	}
	return search.toString();
}

// ---------------------------------------------------------------------------
// Patch helpers
// ---------------------------------------------------------------------------

/**
 * Whether a patch is a binary placeholder.
 *
 * The pi-vcs renderer emits `Binary files … differ` or a bare `GIT binary
 * patch` line for a binary side (never both a binary marker and hunks), so the
 * classification is read off the payload instead of guessed. Markers are
 * matched at line start: hunk content always carries a `+`/`-`/space prefix,
 * so a source file quoting the marker cannot flip the result.
 */
function isBinaryPatch(patch: string): boolean {
	return patch.split("\n").some(line => line.startsWith("Binary files ") || line === "GIT binary patch");
}

/** Opaque fingerprint of exactly the file state a diff describes. */
function revisionOf(target: GitDiffTarget, path: string, patch: string): string {
	return createHash("sha256").update(`zeta-diff\u0000${target}\u0000${path}\u0000${patch}`).digest("hex").slice(0, 16);
}

/** Paths named by one `diff --git` section: the header, then its `---`/`+++` lines. */
function sectionPaths(lines: ReadonlyArray<string>, start: number, end: number): ReadonlyArray<string> {
	const paths: string[] = [];
	const header = lines[start].slice("diff --git ".length);
	const marker = header.lastIndexOf(" b/");
	if (marker >= 0) paths.push(header.slice(marker + 3));
	for (let index = start + 1; index < Math.min(end, start + 8); index += 1) {
		const line = lines[index];
		if (line.startsWith("@@")) break;
		if (line.startsWith("+++ b/")) paths.push(line.slice("+++ b/".length));
		else if (line.startsWith("--- a/")) paths.push(line.slice("--- a/".length));
	}
	return paths.map(candidate => candidate.replace(/\\/g, "/"));
}

/**
 * One file's section of a rendered commit, or `undefined` when the commit does
 * not touch the path. `show` writes the commit header first, then one
 * `diff --git` block per file (a merge shows its first-parent diff), so the
 * section is the slice between two block starts.
 */
function commitDiffSection(patch: string, path: string): string | undefined {
	const lines = patch.split("\n");
	const wanted = path.replace(/\\/g, "/");
	const starts: number[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (lines[index].startsWith("diff --git ")) starts.push(index);
	}
	for (let block = 0; block < starts.length; block += 1) {
		const start = starts[block];
		const end = block + 1 < starts.length ? starts[block + 1] : lines.length;
		if (!sectionPaths(lines, start, end).includes(wanted)) continue;
		return `${lines.slice(start, end).join("\n").replace(/\n+$/, "")}\n`;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One gateway branch row; `headOid`/divergence are absent past the gateway's cap. */
function branchRecord(raw: unknown, cwd: string | undefined): GitBranchRecord {
	if (!isRecord(raw)) throw unavailable("git gateway answered a malformed branch row");
	const name = stringField(raw, "name");
	const headOid = stringField(raw, "headOid");
	const upstream = stringField(raw, "upstream");
	if (name === undefined) throw unavailable("git gateway answered a branch row without a name");
	if (headOid === undefined) {
		const where = cwd === undefined ? "" : ` for ${cwd}`;
		throw unavailable(`branch listing is not enriched beyond the gateway's 100-branch cap${where}`);
	}
	// The gateway lists local branches only, so `remote` is a fact, not a guess.
	// Divergence is reported only against a configured upstream; a branch
	// without one has none to be ahead of or behind.
	const ahead = typeof raw.ahead === "number" && Number.isFinite(raw.ahead) ? raw.ahead : 0;
	const behind = typeof raw.behind === "number" && Number.isFinite(raw.behind) ? raw.behind : 0;
	return {
		name,
		remote: false,
		current: raw.current === true,
		headOid,
		...(upstream === undefined ? {} : { upstream }),
		ahead,
		behind,
	};
}

/** `git.branches.list` → `GET /api/git/branches?cwd=`. */
async function readBranches(input: QueryInput<"git.branches.list">): Promise<GitBranchListReadModel> {
	const cwd = await resolveWorkspaceCwd(input.workspaceId);
	const body = gitAnswer(await gatewayJson<unknown>("/api/git/branches", { query: queryString(cwd, {}) }), cwd);
	if (!Array.isArray(body.branches)) throw unavailable("/api/git/branches did not return a branches array");
	return { workspaceId: input.workspaceId, branches: body.branches.map(raw => branchRecord(raw, cwd)) };
}

/** `git.diff.get` → `GET /api/git/diff?cwd=&path=&staged=`. */
async function readDiff(input: QueryInput<"git.diff.get">): Promise<GitDiffReadModel> {
	const path = requiredString(input, "path");
	const target = input.target;
	if (target !== "working" && target !== "staged") throw invalid('target must be "working" or "staged"');
	const cwd = await resolveWorkspaceCwd(input.workspaceId);
	const body = gitAnswer(
		await gatewayJson<unknown>("/api/git/diff", {
			query: queryString(cwd, { path, staged: target === "staged" }),
		}),
		cwd,
	);
	const patch = body.diff;
	if (typeof patch !== "string") throw unavailable("/api/git/diff did not return a diff string");
	// A patch past the route's cap is refused with 413, never truncated, so a
	// successful answer is complete.
	return {
		workspaceId: input.workspaceId,
		path,
		target,
		patch,
		binary: isBinaryPatch(patch),
		truncated: false,
		revision: revisionOf(target, path, patch),
	};
}

/** One gateway remote row; the addon exposes a single URL per remote. */
function remoteRecord(raw: unknown): GitRemoteRecord {
	if (!isRecord(raw)) throw unavailable("git gateway answered a malformed remote row");
	const name = stringField(raw, "name");
	const url = stringField(raw, "url");
	if (name === undefined) throw unavailable("git gateway answered a remote without a name");
	if (url === undefined) throw unavailable(`remote ${name} has no readable URL`);
	// `remote.<name>.pushurl` is not exposed by the addon; git pushes to the
	// fetch URL unless one is configured, so the model reports that one URL.
	return { name, fetchUrl: url, pushUrl: url };
}

/** `git.remotes.list` → `GET /api/git/remotes?cwd=`. */
async function readRemotes(input: QueryInput<"git.remotes.list">): Promise<GitRemoteListReadModel> {
	const cwd = await resolveWorkspaceCwd(input.workspaceId);
	const body = gitAnswer(await gatewayJson<unknown>("/api/git/remotes", { query: queryString(cwd, {}) }), cwd);
	if (!Array.isArray(body.remotes)) throw unavailable("/api/git/remotes did not return a remotes array");
	return { workspaceId: input.workspaceId, remotes: body.remotes.map(remoteRecord) };
}

/** The five statuses the commit DTO can report; anything else is not a status. */
function commitChangeStatus(value: unknown): GitCommitChangeRecord["status"] | undefined {
	return value === "added" || value === "modified" || value === "deleted" || value === "renamed" || value === "copied"
		? value
		: undefined;
}

/** One changed file of a commit; the route omits `status` when its patch was cut. */
function commitChangeRecord(raw: unknown): GitCommitChangeRecord {
	if (!isRecord(raw)) throw unavailable("git gateway answered a malformed commit file row");
	const path = stringField(raw, "path");
	const status = commitChangeStatus(raw.status);
	if (path === undefined || status === undefined) {
		throw unavailable("commit patch is truncated; a changed file has no status");
	}
	return { path: path.replace(/\\/g, "/"), status };
}

/** `git.commit.changes` → `GET /api/git/show?cwd=&oid=`. */
async function readCommitChanges(input: QueryInput<"git.commit.changes">): Promise<GitCommitChangesReadModel> {
	const oid = requiredString(input, "oid");
	const cwd = await resolveWorkspaceCwd(input.workspaceId);
	const body = gitAnswer(await gatewayJson<unknown>("/api/git/show", { query: queryString(cwd, { oid }) }), cwd);
	const resolvedOid = stringField(body, "oid");
	const subject = typeof body.subject === "string" ? body.subject : undefined;
	if (resolvedOid === undefined || subject === undefined) {
		throw unavailable("/api/git/show did not return a commit");
	}
	if (!Array.isArray(body.files)) throw unavailable("/api/git/show did not return a files array");
	return {
		workspaceId: input.workspaceId,
		oid: resolvedOid,
		subject,
		files: body.files.map(commitChangeRecord),
	};
}

/** `git.commit.diff` → `GET /api/git/diff?cwd=&oid=`, narrowed to one file. */
async function readCommitDiff(input: QueryInput<"git.commit.diff">): Promise<GitCommitDiffReadModel> {
	const oid = requiredString(input, "oid");
	const path = requiredString(input, "path");
	const cwd = await resolveWorkspaceCwd(input.workspaceId);
	const body = gitAnswer(await gatewayJson<unknown>("/api/git/diff", { query: queryString(cwd, { oid }) }), cwd);
	if (typeof body.diff !== "string") throw unavailable("/api/git/diff did not return a diff string");
	const patch = commitDiffSection(body.diff, path);
	if (patch === undefined) throw unavailable(`commit ${oid} does not change ${path}`);
	// The whole-commit patch is refused with 413 when it exceeds the cap, so a
	// section that came back is complete.
	return {
		workspaceId: input.workspaceId,
		oid,
		path,
		patch,
		binary: isBinaryPatch(patch),
		truncated: false,
	};
}

// ---------------------------------------------------------------------------
// Mutations
//
// Each helper performs one gateway call (or the two-call branch-create + switch
// composition) and returns the display sentence for `GitOperationResult`.
// ---------------------------------------------------------------------------

async function stagePaths(cwd: string | undefined, paths: ReadonlyArray<string>): Promise<string> {
	if (paths.length === 0) throw invalid("stage requires at least one path");
	const body = gitAnswer(
		await gatewayJson<unknown>("/api/git/stage", { method: "POST", body: withCwd(cwd, { paths }) }),
		cwd,
	);
	const staged = body.staged;
	if (typeof staged !== "number" || !Number.isFinite(staged)) return "Staged changes";
	return `Staged ${staged} file${staged === 1 ? "" : "s"}`;
}

async function unstagePaths(cwd: string | undefined, paths: ReadonlyArray<string>): Promise<string> {
	if (paths.length === 0) throw invalid("unstage requires at least one path");
	gitAnswer(await gatewayJson<unknown>("/api/git/unstage", { method: "POST", body: withCwd(cwd, { paths }) }), cwd);
	return `Unstaged ${paths.length} path${paths.length === 1 ? "" : "s"}`;
}

async function createCommit(
	cwd: string | undefined,
	message: string,
	amend: boolean,
	paths: ReadonlyArray<string> | undefined,
): Promise<string> {
	const body = gitAnswer(
		await gatewayJson<unknown>("/api/git/commit", {
			method: "POST",
			body: withCwd(cwd, { message, amend, ...(paths && paths.length > 0 ? { paths } : {}) }),
		}),
		cwd,
	);
	const sha = stringField(body, "sha");
	return sha === undefined ? "Committed" : `Committed ${sha}`;
}

async function pushBranch(
	cwd: string | undefined,
	remote: string | undefined,
	branch: string | undefined,
): Promise<string> {
	const body = gitAnswer(
		await gatewayJson<unknown>("/api/git/push", {
			method: "POST",
			body: withCwd(cwd, { ...(remote ? { remote } : {}), ...(branch ? { branch } : {}) }),
		}),
		cwd,
	);
	const pushedRemote = stringField(body, "remote") ?? remote;
	const pushedBranch = stringField(body, "branch") ?? branch;
	if (pushedRemote === undefined || pushedBranch === undefined) return "Pushed";
	return `Pushed ${pushedBranch} to ${pushedRemote}`;
}

/** The gateway fetches the configured/current branch's tracking ref only. */
async function fetchRemote(cwd: string | undefined, remote: string | undefined): Promise<string> {
	const body = gitAnswer(
		await gatewayJson<unknown>("/api/git/fetch", {
			method: "POST",
			body: withCwd(cwd, { ...(remote ? { remote } : {}) }),
		}),
		cwd,
	);
	const fetchedRemote = stringField(body, "remote");
	const fetchedBranch = stringField(body, "branch");
	if (fetchedRemote === undefined) return "Fetched";
	return fetchedBranch === undefined ? `Fetched ${fetchedRemote}` : `Fetched ${fetchedRemote}/${fetchedBranch}`;
}

async function pullBranch(
	cwd: string | undefined,
	remote: string | undefined,
	branch: string | undefined,
): Promise<string> {
	const body = gitAnswer(
		await gatewayJson<unknown>("/api/git/pull", {
			method: "POST",
			body: withCwd(cwd, { ...(remote ? { remote } : {}), ...(branch ? { branch } : {}) }),
		}),
		cwd,
	);
	if (body.fastForward !== true) return "Already up to date";
	const sha = stringField(body, "sha");
	return sha === undefined ? "Fast-forwarded" : `Fast-forwarded to ${sha}`;
}

async function switchBranch(cwd: string | undefined, branch: string): Promise<string> {
	const body = gitAnswer(
		await gatewayJson<unknown>("/api/git/checkout", { method: "POST", body: withCwd(cwd, { branch }) }),
		cwd,
	);
	return `Switched to ${stringField(body, "branch") ?? branch}`;
}

/**
 * Create a branch at HEAD, then switch to it when asked.
 *
 * Two gateway calls: `/api/git/branch` never moves HEAD, so `checkout` adds
 * `/api/git/checkout`. That route refuses a dirty tree, and nothing is rolled
 * back: a refusal leaves the branch created while the command reports the
 * gateway's refusal.
 */
async function createBranch(cwd: string | undefined, name: string, checkout: boolean): Promise<string> {
	gitAnswer(await gatewayJson<unknown>("/api/git/branch", { method: "POST", body: withCwd(cwd, { name }) }), cwd);
	if (!checkout) return `Created branch ${name}`;
	await switchBranch(cwd, name);
	return `Created branch ${name} and switched to it`;
}

/**
 * Translate one `GitOperation` into the gateway call its semantics allow.
 *
 * A kind whose promise cannot be kept by the route is refused with
 * `unsupported` instead of being narrowed silently: `sign`, `push --set-upstream`,
 * `--force-with-lease`, an expected remote oid, `fetch --prune`, a non
 * fast-forward `pull`, and a branch created at anything but HEAD. Gateway
 * refusals (dirty tree, diverged, detached HEAD, unknown ref) arrive as
 * `UNAVAILABLE` carrying the gateway's own sentence.
 *
 * The workspace is resolved lazily: exactly one `GET /api/projects` per
 * command that needs a repository, and none for a kind with no route.
 */
async function runGitOperation(workspaceId: unknown, operation: GitOperation): Promise<string> {
	let resolved: Promise<string | undefined> | undefined;
	const cwd = (): Promise<string | undefined> => (resolved ??= resolveWorkspaceCwd(workspaceId));
	switch (operation.kind) {
		case "stage":
			return stagePaths(await cwd(), pathList(operation, "paths"));
		case "unstage":
			return unstagePaths(await cwd(), pathList(operation, "paths"));
		case "commit": {
			if (booleanFlag(operation, "sign") === true) {
				throw unsupported("commit.sign: the Zeta gateway has no signing route");
			}
			const message = requiredString(operation, "message");
			const amend = booleanFlag(operation, "amend") === true;
			const paths = operation.paths === undefined ? undefined : pathList(operation, "paths");
			return createCommit(await cwd(), message, amend, paths);
		}
		case "push": {
			if (booleanFlag(operation, "setUpstream") === true) {
				throw unsupported("push.setUpstream: the gateway push route does not set an upstream");
			}
			if (booleanFlag(operation, "forceWithLease") === true) {
				throw unsupported("push.forceWithLease: the gateway push route cannot express a lease");
			}
			if (optionalString(operation, "expectedRemoteOid") !== undefined) {
				throw unsupported("push.expectedRemoteOid: the gateway push route cannot check it");
			}
			return pushBranch(await cwd(), optionalString(operation, "remote"), optionalString(operation, "branch"));
		}
		case "fetch": {
			if (booleanFlag(operation, "prune") === true) {
				throw unsupported("fetch.prune: the gateway fetch route fetches one branch and never prunes");
			}
			return fetchRemote(await cwd(), optionalString(operation, "remote"));
		}
		case "pull": {
			if (operation.strategy !== "ff-only") {
				throw unsupported(`pull.${operation.strategy}: the gateway pull route is fast-forward-only`);
			}
			return pullBranch(await cwd(), optionalString(operation, "remote"), optionalString(operation, "branch"));
		}
		case "branch.create": {
			const name = requiredString(operation, "name");
			const startPoint = optionalString(operation, "startPoint");
			if (startPoint !== undefined && startPoint !== "HEAD") {
				throw unsupported("branch.create.startPoint: the gateway branch route always branches at HEAD");
			}
			return createBranch(await cwd(), name, booleanFlag(operation, "checkout") === true);
		}
		case "branch.switch":
			return switchBranch(await cwd(), requiredString(operation, "name"));
		case "checkout":
			return switchBranch(await cwd(), requiredString(operation, "ref"));
		default:
			throw unsupported(`git operation ${operation.kind} has no Zeta gateway route`);
	}
}

async function executeGit(input: GitExecuteInput): Promise<GitOperationResult> {
	const operation = isRecord(input) ? input.operation : undefined;
	if (!isRecord(operation) || typeof operation.kind !== "string") {
		throw invalid("operation must be a git operation object");
	}
	// The result's `repository` field stays absent: `git.repository.get` cannot
	// be built from the gateway (see the file header).
	return {
		operation: operation.kind,
		message: await runGitOperation(input.workspaceId, operation),
		...(typeof input.workspaceId === "string" ? { workspaceId: input.workspaceId } : {}),
	};
}

/**
 * The Git family, one handler per route above.
 *
 * Queries read the gateway's git read surface; the command runs its write
 * surface. `git.repository.get`, `git.log.list`, `git.worktrees.list` and
 * `git.toolchain.get` are absent — see the file header for the exact contract
 * fields the gateway does not carry.
 */
export const gitOps: StudioFamily = {
	id: "git",
	queries: {
		"git.branches.list": readBranches,
		"git.diff.get": readDiff,
		"git.remotes.list": readRemotes,
		"git.commit.changes": readCommitChanges,
		"git.commit.diff": readCommitDiff,
	},
	commands: {
		"git.execute": executeGit,
	},
};

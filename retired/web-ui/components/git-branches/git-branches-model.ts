/**
 * Data layer for the right-dock git-branch panel.
 *
 * Both calls go through existing endpoints — the Next-side request-time proxies
 * `app/api/git/branches` and `app/api/git/checkout`, which forward to the Web
 * Gateway handlers in
 * `packages/coding-agent/src/server/web-gateway/git.ts`:
 *
 *   GET  /api/git/branches?cwd=… → { isGitRepository, current, branches[] }
 *   POST /api/git/checkout       → { ok, branch }
 *                                | 409 { error: "dirty", files }
 *                                | 400/500 { error }
 *
 * Nothing here touches React or the DOM, so the parsing, the ordering and the
 * failure classification are unit-testable without a renderer. The panel
 * (`GitBranchesPanel`) owns the request lifecycle; the view
 * (`GitBranchesView`) owns presentation only.
 */

/** One local branch as the gateway reports it. */
export interface GitBranch {
	name: string;
	current: boolean;
}

/**
 * What the panel knows about the workspace's branches.
 *
 * `empty` (no workspace selected) and `not-a-repo` are distinct states on
 * purpose: the first is a shell-level gap the user fixes by picking a workspace,
 * the second is a fact about that workspace (and the whole panel is then a
 * no-op, exactly like the draft composer's branch chip that hides outside git).
 */
export type BranchListState =
	| { kind: "empty" }
	| { kind: "loading" }
	| { kind: "failed"; message: string }
	| { kind: "not-a-repo" }
	/** `current` is null on a detached HEAD; no row is flagged then. */
	| { kind: "ready"; current: string | null; branches: GitBranch[] };

/**
 * Outcome of an explicit checkout.
 *
 * The server's distinction matters to the user, so it survives as a `kind` and
 * the view supplies the wording: a dirty tree (`409`) is a recoverable
 * "commit or stash first", a rejected branch name or a git refusal is a
 * diagnostic, and a transport failure is "try again".
 */
export type CheckoutResult =
	| { ok: true; branch: string }
	| { ok: false; kind: "dirty"; files: number | null }
	| { ok: false; kind: "rejected"; message: string }
	| { ok: false; kind: "request-failed" };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Read one field of an unvalidated JSON value. `typeof` proves it is an object
 * but not which members it has, so the only claim made here is the weakest one
 * available: every member is `unknown`. (`object` → `Record<string, unknown>`
 * is a structurally identical pair TypeScript cannot unify on its own.)
 */
function field(value: unknown, key: string): unknown {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	return record[key];
}

/**
 * Current branch first — it is the row the eye looks for — then alphabetical.
 * `localeCompare` on purpose: branch names are identifiers, but the list is
 * read by a human and the ICU order keeps CJK names sane.
 */
export function orderBranches(branches: readonly GitBranch[]): GitBranch[] {
	return [...branches].sort((a, b) => {
		if (a.current !== b.current) return a.current ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

/** Map a `GET /api/git/branches` payload onto the panel's state. */
export function branchListState(body: unknown): BranchListState {
	if (!body || typeof body !== "object") return { kind: "failed", message: "malformed response" };
	if (field(body, "isGitRepository") !== true) return { kind: "not-a-repo" };
	const rawCurrent = field(body, "current");
	const current = typeof rawCurrent === "string" ? rawCurrent : null;
	const rawBranches = field(body, "branches");
	const branches: GitBranch[] = [];
	for (const entry of Array.isArray(rawBranches) ? rawBranches : []) {
		const name = field(entry, "name");
		if (typeof name === "string") branches.push({ name, current: name === current });
	}
	return { kind: "ready", current, branches: orderBranches(branches) };
}

/** `GET /api/git/branches?cwd=` — the workspace's local branches. */
export async function loadBranches(cwd: string | null, fetchImpl: FetchLike = fetch): Promise<BranchListState> {
	if (!cwd) return { kind: "empty" };
	try {
		const res = await fetchImpl(`/api/git/branches?cwd=${encodeURIComponent(cwd)}`);
		if (!res.ok) return { kind: "failed", message: `HTTP ${res.status}` };
		return branchListState(await res.json());
	} catch (error) {
		return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * `POST /api/git/checkout` — switch the workspace to `branch`.
 *
 * Called ONLY for an explicit user switch (never to "sync" state): the gateway
 * refuses a dirty tree, and an automatic call would turn a background refresh
 * into an unrequested working-tree change.
 */
export async function switchBranch(
	cwd: string,
	branch: string,
	fetchImpl: FetchLike = fetch,
): Promise<CheckoutResult> {
	let res: Response;
	try {
		res = await fetchImpl("/api/git/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cwd, branch }),
		});
	} catch {
		return { ok: false, kind: "request-failed" };
	}
	if (res.ok) return { ok: true, branch };
	const payload: unknown = await res.json().catch(() => null);
	if (res.status === 409) {
		const files = field(payload, "files");
		return { ok: false, kind: "dirty", files: typeof files === "number" ? files : null };
	}
	const rawMessage = field(payload, "error");
	return {
		ok: false,
		kind: "rejected",
		message: typeof rawMessage === "string" ? rawMessage : `HTTP ${res.status}`,
	};
}

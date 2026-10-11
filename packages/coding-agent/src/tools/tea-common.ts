import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { AgentToolResult } from "@linxiraos/pi-agent-core";
import type { VcsWorktreeEntry } from "@linxiraos/pi-natives";
import { isEnoent, untilAborted } from "@linxiraos/pi-utils";
import * as vcs from "@linxiraos/pi-natives/vcs";
import { pushLine } from "@linxiraos/pi-tui/tools/gh-format";
import { M } from "../i18n";
import { gitea } from "../utils/gitea";
import type { ToolSession } from ".";
import type { TeaInput, TeaLogin, TeaLabel, TeaPullRequest, TeaRepo, TeaToolDetails, TeaUser } from "./tea-types";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { toolResult } from "./tool-result";

export function normalizeText(value: string | null | undefined): string {
	return (value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\t", "    ").trim();
}

export function normalizeOptionalString(value: string | null | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

export function normalizeStringList(value: string | string[] | undefined): string[] {
	if (value === undefined) return [];
	const raw = typeof value === "string" ? [value] : value;
	const cleaned: string[] = [];
	for (const entry of raw) {
		const trimmed = entry?.trim();
		if (trimmed) cleaned.push(trimmed);
	}
	return cleaned;
}

export function requireNonEmpty(value: string | null | undefined, label: string): string {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		throw new ToolError(`${label} must not be empty`);
	}
	return normalized;
}

/**
 * List-result page size: default 20, floored and clamped to 1–50 so a huge or
 * zero `limit` cannot flood the context or produce an empty call.
 */
export function resolveTeaLimit(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return 20;
	return Math.min(50, Math.max(1, Math.floor(value)));
}

/**
 * A repository in `tea`'s `[host/]owner/repo` form. Unlike `gh`, `tea` sends
 * a bare `owner/repo` to its *default login*, so the host segment is not
 * decorative: it selects the Gitea instance the request must land on.
 */
export interface TeaRepoRef {
	/** Host this repo lives on, or undefined when unknown. */
	host?: string;
	/** `OWNER/REPO`, never host-qualified. */
	slug: string;
}

/** Split `[HOST/]OWNER/REPO`; anything with another shape is taken as a slug. */
export function parseRepoRef(repo: string): TeaRepoRef {
	const firstSlash = repo.indexOf("/");
	if (firstSlash < 0) return { slug: repo };
	const secondSlash = repo.indexOf("/", firstSlash + 1);
	if (secondSlash < 0 || repo.includes("/", secondSlash + 1)) return { slug: repo };
	return { host: repo.slice(0, firstSlash), slug: repo.slice(firstSlash + 1) };
}

/** Join a known host and `OWNER/REPO` into the host-qualified form. */
export function formatRepoRef(host: string | undefined, slug: string): string {
	return host ? `${host}/${slug}` : slug;
}

/** Git clone URL → `{ host, owner/repo }` for https, ssh://, and scp-style URLs. */
export function parseGiteaRemoteUrl(url: string): { host: string; slug: string } | undefined {
	const trimmed = url.trim();
	if (trimmed.length === 0) return undefined;
	const scpMatch = /^([^@/]+)@([^:/]+):(?:\/)?([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed);
	if (scpMatch) {
		return { host: scpMatch[2].toLowerCase(), slug: `${scpMatch[3]}/${scpMatch[4]}` };
	}
	const urlMatch = /^(?:https?|ssh):\/\/(?:[^@/]+@)?([^/:]+(?::\d+)?)[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
		trimmed,
	);
	if (!urlMatch) return undefined;
	return { host: urlMatch[1].toLowerCase(), slug: `${urlMatch[2]}/${urlMatch[3]}` };
}

const REPO_URL_PATTERN = /^https?:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/;

/**
 * `https://HOST/OWNER/REPO` → the repository's identity. The host is always
 * kept: `tea` has no global default host (every instance is a named login),
 * so a bare slug would be sent to whichever login `tea` resolves — never
 * assume a host away.
 */
export function repoFromUrl(value: string | undefined): string | undefined {
	const match = REPO_URL_PATTERN.exec(value?.trim() ?? "");
	if (!match) return undefined;
	return formatRepoRef(match[1].toLowerCase(), `${match[2]}/${match[3]}`);
}

export const PR_URL_PATTERN = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pulls\/(\d+)(?:\/.*)?$/;
export const ISSUE_URL_PATTERN = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/issues\/(\d+)(?:\/.*)?$/;

export function parsePullRequestUrl(value: string | undefined): { repo?: string; prNumber?: number } {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return {};
	}
	const match = normalized.match(PR_URL_PATTERN);
	if (!match) {
		return {};
	}
	return {
		repo: formatRepoRef(match[1], match[2]),
		prNumber: Number(match[3]),
	};
}

export function parseIssueUrl(value: string | undefined): { repo?: string; issueNumber?: number } {
	const normalized = normalizeOptionalString(value);
	if (!normalized) return {};
	const match = normalized.match(ISSUE_URL_PATTERN);
	if (!match) return {};
	return {
		repo: formatRepoRef(match[1], match[2]),
		issueNumber: Number(match[3]),
	};
}

/**
 * Parse a digit-only decimal positive integer or return undefined. Rejects
 * `1e2`, `0x10`, `12.0`, leading +/-, or any other shape `Number()` would
 * accept.
 */
export function parsePositiveDecimalInt(value: string | undefined): number | undefined {
	if (!value || !/^\d+$/.test(value)) return undefined;
	const num = Number(value);
	if (!Number.isSafeInteger(num) || num <= 0) return undefined;
	return num;
}

export function formatAuthor(author: TeaUser | null | undefined): string | undefined {
	if (!author) return undefined;
	if (author.login) return `@${author.login}`;
	if (author.full_name) return author.full_name;
	return undefined;
}

export function formatLabels(labels: TeaLabel[] | undefined): string | undefined {
	const names = labels?.map(label => label.name).filter((value): value is string => Boolean(value)) ?? [];
	if (names.length === 0) return undefined;
	return names.join(", ");
}

export function formatRepoView(data: TeaRepo, input: { repo?: string }): string {
	const lines: string[] = [];
	const name = data.full_name ?? input.repo ?? "Gitea Repository";
	lines.push(`# ${name}`);
	lines.push("");
	lines.push(normalizeText(data.description) || M.teaNoDescription);
	lines.push("");
	pushLine(lines, "URL", data.html_url);
	pushLine(lines, "Owner", formatAuthor(data.owner));
	pushLine(lines, "Default branch", data.default_branch);
	pushLine(lines, "Private", data.private);
	pushLine(lines, "Archived", data.archived);
	pushLine(lines, "Fork", data.fork);
	pushLine(lines, "Stars", data.stars_count);
	pushLine(lines, "Forks", data.forks_count);
	pushLine(lines, "Open issues", data.open_issues_count);
	pushLine(lines, "Open pulls", data.open_pr_counter);
	pushLine(lines, "SSH", data.ssh_url);
	pushLine(lines, "Clone", data.clone_url);
	pushLine(lines, "Website", normalizeOptionalString(data.website ?? undefined));
	pushLine(lines, "Created", data.created_at);
	pushLine(lines, "Updated", data.updated_at);
	return lines.join("\n").trim();
}

export function formatCreatedPullRequest(pull: TeaPullRequest): string {
	const lines: string[] = [`# Created Pull Request #${pull.number ?? "?"}`, ""];
	pushLine(lines, "Title", pull.title);
	pushLine(lines, "State", pull.state);
	pushLine(lines, "Draft", pull.draft);
	pushLine(lines, "Base", pull.base?.ref);
	pushLine(lines, "Head", pull.head?.ref);
	pushLine(lines, "Labels", formatLabels(pull.labels));
	pushLine(lines, "URL", pull.html_url);
	return lines.join("\n").trim();
}

// ────────────────────────────────────────────────────────────────────────────
// Login (instance) resolution
//
// `gh` pins the instance with `--hostname`; `tea` pins it with a *named
// login* (`--login`). A `[host/]owner/repo` ref maps its host segment to the
// login whose URL or SSH host matches. Login config is process-global (under
// `$XDG_CONFIG_HOME/tea`), so the list is fetched once and memoized.
// ────────────────────────────────────────────────────────────────────────────

let teaLoginsCache: Promise<TeaLogin[]> | undefined;

/** Test seam: drop the memoized `tea logins list` so the next call refetches. */
export function resetTeaLoginsCache(): void {
	teaLoginsCache = undefined;
}

function loginHostKey(value: string | undefined): string | undefined {
	const normalized = normalizeOptionalString(value);
	if (!normalized) return undefined;
	return normalized
		.replace(/^https?:\/\//, "")
		.replace(/\/$/, "")
		.toLowerCase();
}

/** Memoized `tea logins list -o json`, shared across every concurrent caller. */
export async function resolveTeaLogins(cwd: string, signal?: AbortSignal): Promise<TeaLogin[]> {
	teaLoginsCache ??= (async () => {
		const logins = await gitea.json<TeaLogin[]>(cwd, ["logins", "list", "--output", "json"], signal);
		return Array.isArray(logins) ? logins : [];
	})().catch(error => {
		// Do not let a failed fetch poison the cache: a login added later must
		// be visible on the next call.
		teaLoginsCache = undefined;
		throw error;
	});
	return untilAborted(signal, teaLoginsCache);
}

/**
 * `tea` instance-selection flags for a ref: an explicit `login` input wins,
 * then the ref's host segment matched against known logins, then `tea`'s own
 * default-login resolution.
 */
export async function resolveLoginArgs(
	cwd: string,
	ref: TeaRepoRef,
	loginInput?: string,
	signal?: AbortSignal,
): Promise<string[]> {
	const login = normalizeOptionalString(loginInput);
	if (login) return ["--login", login];
	const host = ref.host?.toLowerCase();
	if (!host) return [];
	// Login lookup is best-effort: a failed `tea logins list` must not kill an
	// op that could still ride tea's own default login.
	let logins: TeaLogin[];
	try {
		logins = await resolveTeaLogins(cwd, signal);
	} catch {
		return [];
	}
	for (const entry of logins) {
		if (loginHostKey(entry.url) === host || loginHostKey(entry.ssh_host) === host) {
			const name = normalizeOptionalString(entry.name);
			if (name) return ["--login", name];
		}
	}
	return [];
}

// ────────────────────────────────────────────────────────────────────────────
// cwd → default repo resolution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a checkout's Gitea repository from its git remotes. A remote counts
 * when its URL parses as a Gitea clone URL *and* a configured tea login
 * serves the same host — otherwise any git remote would qualify.
 */
async function resolveRepoFromCwd(cwd: string, signal?: AbortSignal): Promise<string> {
	const repo = vcs.git(cwd);
	if (!repo) {
		throw new ToolError(
			"Gitea repository context is unavailable. Pass `repo` explicitly or run the tool inside a Gitea checkout.",
		);
	}
	const remotes = await repo.remoteList(signal).catch(() => [] as string[]);
	const logins = await resolveTeaLogins(cwd, signal).catch(() => [] as TeaLogin[]);
	const loginHosts = new Set<string>();
	for (const login of logins) {
		const url = loginHostKey(login.url);
		const ssh = loginHostKey(login.ssh_host);
		if (url) loginHosts.add(url);
		if (ssh) loginHosts.add(ssh);
	}
	for (const remote of remotes) {
		const url = await repo.remoteUrl(remote, signal).catch(() => undefined);
		if (!url) continue;
		const parsed = parseGiteaRemoteUrl(url);
		if (!parsed) continue;
		if (!loginHosts.has(parsed.host)) continue;
		return formatRepoRef(parsed.host, parsed.slug);
	}
	throw new ToolError(
		"Gitea repository context is unavailable. Pass `repo` explicitly or run the tool inside a Gitea checkout.",
	);
}

/**
 * Resolve the repository a tea op acts on: explicit `repo` input, then the
 * resolved repo of an explicit run reference (none for tea), then the cwd
 * checkout's Gitea remote.
 */
export async function resolveTeaRepo(cwd: string, repo: string | undefined, signal?: AbortSignal): Promise<string> {
	const normalized = normalizeOptionalString(repo);
	if (normalized) return normalized;
	return resolveRepoFromCwd(cwd, signal);
}

/**
 * Process-lifetime cache of cwd → `[host/]owner/repo` lookups. Avoids
 * repeated git/tea chatter when the same session resolves the default repo
 * many times in a row.
 *
 * The shared lookup is intentionally **not** bound to any caller's
 * AbortSignal. Cancelling one caller would otherwise kill the underlying
 * resolution for every concurrent waiter on the same cwd. Each caller's
 * signal is honored at the wait point via `untilAborted` instead, so an abort
 * unwinds only that caller.
 */
export const DEFAULT_REPO_RESOLVED = new Map<string, string>();
export const DEFAULT_REPO_INFLIGHT = new Map<string, Promise<string>>();

export async function resolveDefaultRepoMemoized(cwd: string, signal?: AbortSignal): Promise<string> {
	const key = path.resolve(cwd);
	const ready = DEFAULT_REPO_RESOLVED.get(key);
	if (ready) return ready;
	let pending = DEFAULT_REPO_INFLIGHT.get(key);
	if (!pending) {
		pending = (async () => {
			// No caller signal: this lookup is shared across every concurrent
			// waiter on the same cwd.
			const value = await resolveRepoFromCwd(cwd);
			DEFAULT_REPO_RESOLVED.set(key, value);
			return value;
		})();
		// Drop the in-flight slot on settle so failures don't poison the cache
		// and so a successful resolution survives only in `DEFAULT_REPO_RESOLVED`.
		void pending.then(
			() => DEFAULT_REPO_INFLIGHT.delete(key),
			() => DEFAULT_REPO_INFLIGHT.delete(key),
		);
		DEFAULT_REPO_INFLIGHT.set(key, pending);
	}
	return untilAborted(signal, pending);
}

/** Resolve an op's repo: explicit input, else the memoized cwd default. */
export async function resolveTeaRepoMemoized(
	cwd: string,
	repo: string | undefined,
	signal?: AbortSignal,
): Promise<string> {
	const normalized = normalizeOptionalString(repo);
	if (normalized) return normalized;
	return resolveDefaultRepoMemoized(cwd, signal);
}

/**
 * Best-effort cached cwd → `owner/repo` resolution that swallows any failure
 * (not a git checkout, no Gitea remote, `tea` unauthenticated, …) into
 * `undefined`.
 */
export async function tryResolveCurrentRepo(cwd: string, signal: AbortSignal | undefined): Promise<string | undefined> {
	try {
		return await resolveDefaultRepoMemoized(cwd, signal);
	} catch {
		return undefined;
	}
}

/** Repo context every op resolves before touching the CLI. */
export interface TeaRepoContext {
	/** Host-qualified `[host/]owner/repo` as resolved. */
	repo: string;
	/** `OWNER/REPO` slug for `--repo` flags and API paths. */
	slug: string;
	/** `--login <name>` flags pinning the instance, when resolvable. */
	loginArgs: string[];
}

/**
 * Resolve the repo context an op acts on: an identifier-carried repo (issue/PR
 * URL), then explicit `repo` input, then the memoized cwd default.
 */
export async function resolveRepoContext(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
	identifierRepo?: string,
): Promise<TeaRepoContext> {
	const repo = await resolveTeaRepoMemoized(
		session.cwd,
		normalizeOptionalString(identifierRepo) ?? normalizeOptionalString(params.repo),
		signal,
	);
	const ref = parseRepoRef(repo);
	const loginArgs = await resolveLoginArgs(session.cwd, ref, params.login, signal);
	return { repo, slug: ref.slug, loginArgs };
}

/**
 * `tea api` argument prefix for an endpoint path, with the instance pinned by
 * `--login` when a login could be resolved.
 */
export async function giteaApiArgs(
	cwd: string,
	repo: string,
	endpoint: string,
	loginInput: string | undefined,
	signal?: AbortSignal,
): Promise<string[]> {
	const ref = parseRepoRef(repo);
	const loginArgs = await resolveLoginArgs(cwd, ref, loginInput, signal);
	return ["api", ...loginArgs, endpoint];
}

/** `tea` repo-override flags (`--repo <slug>`) — the slug never carries a host. */
export function appendTeaRepoFlag(args: string[], repo: string, identifier?: string): void {
	if (identifier?.startsWith("http://") || identifier?.startsWith("https://")) return;
	args.push("--repo", parseRepoRef(repo).slug);
}

export function toLocalBranchRef(value: string): string {
	return `refs/heads/${value}`;
}

export async function requireGitRepoRoot(cwd: string, signal?: AbortSignal): Promise<string> {
	signal?.throwIfAborted();
	const repoRoot = vcs.git(cwd)?.info().repoRoot;
	if (!repoRoot) {
		throw new ToolError("Current git repository is unavailable.");
	}
	return repoRoot;
}

/** Maximum disambiguation suffixes tried before giving up on a worktree path. */
export const WORKTREE_PATH_MAX_SUFFIX = 100;

/**
 * Resolve a worktree path that is free of conflicts: `basePath`, then
 * `${basePath}-2`, `${basePath}-3`, … up to {@link WORKTREE_PATH_MAX_SUFFIX}
 * — whichever is first **not** registered with git and **not** on disk.
 */
export async function resolveAvailableWorktreePath(
	basePath: string,
	existingWorktrees: VcsWorktreeEntry[],
): Promise<string> {
	const registered = new Set(existingWorktrees.map(entry => path.resolve(entry.path)));
	for (let attempt = 0; attempt < WORKTREE_PATH_MAX_SUFFIX; attempt += 1) {
		const candidate = attempt === 0 ? basePath : `${basePath}-${attempt + 1}`;
		const normalized = path.resolve(candidate);
		if (registered.has(normalized)) continue;
		try {
			await fs.stat(normalized);
		} catch (error) {
			if (isEnoent(error)) {
				return candidate;
			}
			throw error;
		}
	}
	throw new ToolError(
		`could not find an unused worktree path under ${basePath} (tried ${WORKTREE_PATH_MAX_SUFFIX} suffixes)`,
	);
}

export function buildTextResult(
	text: string,
	sourceUrl?: string,
	details?: TeaToolDetails,
	options?: { useless?: boolean },
): AgentToolResult<TeaToolDetails> {
	const builder = toolResult<TeaToolDetails>(details).text(text);
	if (sourceUrl) {
		builder.sourceUrl(sourceUrl);
	}
	if (options?.useless) {
		builder.useless();
	}
	return builder.done();
}

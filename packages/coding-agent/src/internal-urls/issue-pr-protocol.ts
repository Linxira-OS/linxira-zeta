/**
 * Protocol handlers for `issue://` and `pr://`.
 *
 * Both single-item reads route through the SQLite-backed `github-cache`,
 * sharing rendered markdown across sessions. Root and repo-scoped reads
 * (`issue://`, `pr://owner/repo`) issue a live `gh issue list` / `gh pr list`
 * for browsing.
 *
 * URL shapes:
 * - `issue://` / `pr://` — list recent items in the caller's default repo.
 * - `issue://owner/repo` / `pr://owner/repo` — list recent items for that repo.
 * - `issue://123` / `pr://123` — single item; repo derived from the caller's
 *   session cwd (passed through `ResolveContext`).
 * - `issue://owner/repo/123` / `pr://owner/repo/123` — fully qualified single
 *   item.
 * - `pr://ghe.example.com/owner/repo/123` — same, on a GitHub Enterprise host;
 *   any shape above may carry a `<host>/` prefix. A host with no dot (`ghe`) is
 *   recognized only in this numbered form.
 * - `issue://owner/repo/123?comments=0` — single item, comments suppressed.
 * - `issue://owner/repo?state=closed&limit=20` — list options pass through to
 *   `gh`.
 * - `pr://owner/repo/123/diff/2?at=<fetchedAt>` — that cached diff generation,
 *   not whatever the live row is after a background refresh.
 */
import issueDoc from "../prompts/internal-urls/issue.md" with { type: "text" };
import {
	formatRepoRef,
	getOrFetchIssue,
	getOrFetchPr,
	getOrFetchPrDiff,
	getPinnedPrDiff,
	githubIssueJsonWithStateReasonFallback,
	parsePositiveDecimalInt,
	resolveDefaultRepoMemoized,
} from "../tools/gh";
import type { PrDiffPayload } from "../tools/gh-pr-diff";
import { type CacheStatus, formatFreshnessNote } from "../tools/github-cache";
import type { ViewLookupResult } from "../tools/gh-view";
import { cfgGiteaEnabled } from "../tools/settings";
import {
	formatRepoRef as formatTeaRepoRef,
	giteaHostKey,
	parseRepoRef as parseTeaRepoRef,
	resolveTeaLogins,
	tryResolveCurrentRepo as tryResolveCurrentTeaRepo,
} from "../tools/tea-common";
import { fetchTeaPullDiff, listTeaIssues, listTeaPulls, renderTeaIssue, renderTeaPull } from "../tools/tea-issue-pr";
import type { TeaIssue, TeaPullRequest } from "../tools/tea-types";
import { AgentRegistry } from "../registry/agent-registry";
import { gitea } from "../utils/gitea";
import { github } from "../utils/github";
import { renderDiffFamilyResource, splitInternalUrlSegments } from "./forge-diff";
import type { InternalResource, InternalUrl, ProtocolHandler, ResolveContext, SchemeSpec } from "./types";

type Scheme = "issue" | "pr";

interface ParsedSingle {
	kind: "single";
	repo?: string;
	number: number;
	comments: boolean;
}

interface ParsedPrDiff {
	kind: "pr-diff";
	repo?: string;
	number: number;
	/**
	 * `list` → enumerate changed files.
	 * `all`  → full unified diff.
	 * `slice`→ single file's diff section (1-indexed `index`).
	 */
	mode: "list" | "all" | "slice";
	index?: number;
	/** Cache generation (`?at=`). When set, resolution must not read the live row. */
	fetchedAt?: number;
}

interface ParsedList {
	kind: "list";
	repo?: string;
	state: "open" | "closed" | "merged" | "all";
	limit: number;
	author: string | undefined;
	label: string | undefined;
}

type Parsed = ParsedSingle | ParsedList | ParsedPrDiff;

const LIST_LIMIT_DEFAULT = 30;
const LIST_LIMIT_MAX = 100;

function parseListOptions(url: InternalUrl, scheme: Scheme, repo: string | undefined): ParsedList {
	const stateRaw = url.searchParams.get("state");
	const allowedStates: ParsedList["state"][] =
		scheme === "pr" ? ["open", "closed", "merged", "all"] : ["open", "closed", "all"];
	if (stateRaw !== null && !(allowedStates as string[]).includes(stateRaw)) {
		// Reject instead of silently falling back to "open": a typo'd state
		// would otherwise return the open list, indistinguishable from "no
		// matches for the requested state".
		throw new Error(`Invalid ${scheme}:// list state '${stateRaw}'. Expected one of: ${allowedStates.join(", ")}.`);
	}
	const state = (stateRaw ?? "open") as ParsedList["state"];

	const limitRaw = url.searchParams.get("limit");
	let limit = LIST_LIMIT_DEFAULT;
	if (limitRaw !== null) {
		const parsed = parsePositiveDecimalInt(limitRaw);
		if (parsed === undefined) {
			throw new Error(
				`Invalid ${scheme}:// list limit '${limitRaw}'. Expected a positive integer (max ${LIST_LIMIT_MAX}).`,
			);
		}
		limit = Math.min(parsed, LIST_LIMIT_MAX);
	}
	return {
		kind: "list",
		repo,
		state,
		limit,
		author: url.searchParams.get("author") ?? undefined,
		label: url.searchParams.get("label") ?? undefined,
	};
}

function parseUrl(url: InternalUrl, scheme: Scheme): Parsed {
	let host = url.rawHost || url.hostname;
	let parts = splitInternalUrlSegments(url, scheme);

	// Detect a leading `<host>/` prefix. A dotted first segment can only be a
	// host, because GitHub owner names are alphanumeric-plus-hyphen, so dotted
	// hosts work with every shape below. A single-label host (`ghe`,
	// `localhost`) is only recognizable from the item number's position, so it
	// is accepted in the numbered form alone — `<host>/<owner>/<repo>` with no
	// number is indistinguishable from `<owner>/<repo>/<bad-number>`, and
	// keeping the latter's error beats guessing.
	let repoHost: string | undefined;
	const dottedHost = host.includes(".");
	if (dottedHost && parts.length < 2) {
		throw new Error(
			`Invalid ${scheme}:// URL. Expected ${scheme}://<host>/<owner>/<repo> or ${scheme}://<host>/<owner>/<repo>/<number>`,
		);
	}
	const hostPrefixed = dottedHost
		? parts.length >= 2
		: parts.length >= 3 && parsePositiveDecimalInt(parts[2]) !== undefined;
	if (hostPrefixed) {
		repoHost = host;
		host = parts[0] ?? "";
		parts = parts.slice(1);
	}

	// Shapes (each optionally prefixed with an enterprise `<host>/`):
	//   scheme://                    → list default repo
	//   scheme://N                   → single item, default repo
	//   scheme://owner/repo          → list specific repo
	//   scheme://owner/repo/N        → single item, specific repo
	//   pr://N/diff[/<sub>]          → diff family, default repo
	//   pr://owner/repo/N/diff[/<sub>] → diff family, specific repo
	let repo: string | undefined;
	let numberPart: string | undefined;
	let diffParts: string[] = [];

	if (!host && parts.length === 0) {
		return parseListOptions(url, scheme, undefined);
	}
	if (host && parts.length === 0) {
		// scheme://N (numeric) or scheme://owner (host-only, no repo segment)
		numberPart = host;
	} else if (parts[0] === "diff" && parsePositiveDecimalInt(host) !== undefined) {
		// <scheme>://N/diff[/<sub>] — short form with diff suffix. Restrict this
		// ambiguity to numeric hosts so `<scheme>://owner/diff` remains the valid
		// repo-scoped listing for a repository named `diff`. `issue://` falls
		// through to the `scheme === "issue"` branch below for the "issues have
		// no diff" rejection rather than being misparsed as repo `<N>/diff`.
		numberPart = host;
		diffParts = parts;
	} else if (host && parts.length === 1) {
		// scheme://owner/repo  → list
		repo = formatRepoRef(repoHost, `${host}/${parts[0]}`);
		return parseListOptions(url, scheme, repo);
	} else if (host && parts.length >= 2) {
		// scheme://owner/repo/N[/diff[/<sub>]]
		repo = formatRepoRef(repoHost, `${host}/${parts[0]}`);
		numberPart = parts[1];
		diffParts = parts.slice(2);
	} else {
		throw new Error(
			`Invalid ${scheme}:// URL. Expected ${scheme}://, ${scheme}://<number>, ${scheme}://<owner>/<repo>, or ${scheme}://<owner>/<repo>/<number>`,
		);
	}

	// Reject unrecognized trailing segments before parsing the number so
	// shapes like `issue://owner/repo/foo/bar` surface as "Invalid URL"
	// rather than the misleading "Invalid number: foo".
	if (diffParts.length > 0) {
		if (scheme === "issue") {
			throw new Error(
				`Invalid issue:// URL. Issue views do not have a diff; use pr://<owner>/<repo>/<n>/diff for pull requests.`,
			);
		}
		if (diffParts[0] !== "diff" || diffParts.length > 2) {
			throw new Error(
				`Invalid pr:// URL. Expected pr://<n>, pr://<n>/diff, pr://<n>/diff/all, or pr://<n>/diff/<i>`,
			);
		}
	}

	const num = parsePositiveDecimalInt(numberPart);
	if (num === undefined) {
		throw new Error(`Invalid ${scheme}:// number: ${numberPart ?? "(missing)"}`);
	}

	if (diffParts.length === 0) {
		const commentsParam = url.searchParams.get("comments");
		const comments =
			commentsParam === null ? true : !(commentsParam === "0" || commentsParam.toLowerCase() === "false");
		return { kind: "single", repo, number: num, comments };
	}

	// diffParts has already been validated above; scheme is `pr`.
	const fetchedAt = parsePinnedDiffGeneration(url);
	if (diffParts.length === 1) {
		return { kind: "pr-diff", repo, number: num, mode: "list", fetchedAt };
	}
	const sub = diffParts[1] ?? "";
	if (sub === "all") {
		return { kind: "pr-diff", repo, number: num, mode: "all", fetchedAt };
	}
	const idx = parsePositiveDecimalInt(sub);
	if (idx === undefined) {
		throw new Error(`Invalid pr:// diff sub-path '${sub}'. Use 'all' or a 1-indexed file number.`);
	}
	return { kind: "pr-diff", repo, number: num, mode: "slice", index: idx, fetchedAt };
}

function parsePinnedDiffGeneration(url: InternalUrl): number | undefined {
	const raw = url.searchParams.get("at");
	if (raw === null) return undefined;
	const parsed = parsePositiveDecimalInt(raw);
	if (parsed === undefined) {
		throw new Error(`Invalid pr:// diff snapshot '${raw}'. Expected a positive integer cache generation.`);
	}
	return parsed;
}

function diffSnapshotQuery(fetchedAt: number | undefined): string {
	return fetchedAt === undefined ? "" : `?at=${fetchedAt}`;
}

/**
 * Resolve the working directory the protocol should use.
 *
 * Order:
 * 1. Caller-supplied `context.cwd` (the session that initiated `read`).
 * 2. First registered session via `AgentRegistry` (single-session fallback).
 * 3. `process.cwd()` (last resort).
 *
 * The earlier-fallback drives `gh repo view` and any `gh issue list` /
 * `gh pr list` for short-form URLs, so getting this right is what keeps
 * reads of `issue://N` from picking the wrong repo across concurrent sessions.
 */
function resolveCwd(context: ResolveContext | undefined): string {
	if (context?.cwd) return context.cwd;
	for (const ref of AgentRegistry.global().list()) {
		const cwd = ref.session?.sessionManager?.getCwd();
		if (cwd) return cwd;
	}
	return process.cwd();
}

/**
 * Hosts the Gitea runner can serve: configured `tea` logins plus the cwd
 * checkout's Gitea remote (already matched against those logins). Populated
 * from process state only — there is no separate host config file.
 */
async function resolveGiteaHosts(cwd: string, signal?: AbortSignal): Promise<Set<string>> {
	const hosts = new Set<string>();
	try {
		for (const login of await resolveTeaLogins(cwd, signal)) {
			const url = giteaHostKey(login.url);
			const ssh = giteaHostKey(login.ssh_host);
			if (url) hosts.add(url);
			if (ssh) hosts.add(ssh);
		}
	} catch {
		// Unauthenticated `tea`: the checkout lookup below also fails, which
		// leaves the GitHub path in charge.
	}
	const current = await tryResolveCurrentTeaRepo(cwd, signal);
	const currentRef = current ? parseTeaRepoRef(current) : undefined;
	if (currentRef?.host) hosts.add(currentRef.host.toLowerCase());
	return hosts;
}

/**
 * Pick the Gitea backend for a parsed `issue://` / `pr://` reference.
 *
 * - `gitea.enabled` off or `tea` absent → never (GitHub behavior unchanged).
 * - `<host>/` prefix → Gitea only when that host is a configured instance;
 *   otherwise the prefix keeps meaning GitHub Enterprise.
 * - no host → Gitea when the checkout's Gitea remote resolves, using that
 *   instance's host for an explicit `owner/repo`; else GitHub's default repo.
 */
async function resolveGiteaRoute(
	parsedRepo: string | undefined,
	context: ResolveContext | undefined,
): Promise<string | undefined> {
	const settings = context?.settings;
	if (settings === undefined || !cfgGiteaEnabled.get(settings) || !gitea.available()) {
		return undefined;
	}
	const cwd = resolveCwd(context);
	const explicit = parsedRepo ? parseTeaRepoRef(parsedRepo) : undefined;
	if (explicit?.host && parsedRepo) {
		const hosts = await resolveGiteaHosts(cwd, context?.signal);
		return hosts.has(explicit.host.toLowerCase()) ? parsedRepo : undefined;
	}
	const current = await tryResolveCurrentTeaRepo(cwd, context?.signal);
	if (!current) return undefined;
	const currentRef = parseTeaRepoRef(current);
	if (explicit) return formatTeaRepoRef(currentRef.host, explicit.slug);
	return current;
}

async function resolveListRepo(
	scheme: Scheme,
	parsedRepo: string | undefined,
	context: ResolveContext | undefined,
): Promise<string> {
	if (parsedRepo) return parsedRepo;
	const cwd = resolveCwd(context);
	try {
		return await resolveDefaultRepoMemoized(cwd, context?.signal);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(
			`${scheme}:// could not resolve a default repo from the current session: ${message}\nUse ${scheme}://<owner>/<repo> instead.`,
		);
	}
}

interface IssueListItem {
	number?: number;
	title?: string;
	state?: string;
	stateReason?: string | null;
	author?: { login?: string } | null;
	labels?: Array<{ name?: string }>;
	createdAt?: string;
	updatedAt?: string;
	url?: string;
}

interface PrListItem extends IssueListItem {
	isDraft?: boolean;
	baseRefName?: string;
	headRefName?: string;
}

function formatListItem(scheme: Scheme, repo: string, item: IssueListItem | PrListItem): string {
	const number = item.number ?? "?";
	const title = item.title ?? "(no title)";
	const state = item.state?.toLowerCase() ?? "?";
	const author = item.author?.login ?? "?";
	const updated = item.updatedAt ?? item.createdAt ?? "";
	const draftSuffix = scheme === "pr" && (item as PrListItem).isDraft ? " [draft]" : "";
	const labels = (item.labels ?? [])
		.map(l => l.name)
		.filter(Boolean)
		.join(", ");
	const labelSuffix = labels ? `  labels: ${labels}` : "";
	const itemUrl = number === "?" ? `${scheme}://${repo}` : `${scheme}://${repo}/${number}`;
	return `- [${state}${draftSuffix}] #${number}  @${author}  ${updated}\n    ${title}${labelSuffix}\n    ${itemUrl}`;
}

async function fetchAndRenderList(
	scheme: Scheme,
	options: ParsedList,
	url: InternalUrl,
	context: ResolveContext | undefined,
): Promise<InternalResource> {
	const repo = await resolveListRepo(scheme, options.repo, context);
	const cwd = resolveCwd(context);
	const fields =
		scheme === "issue"
			? ["number", "title", "state", "author", "labels", "createdAt", "updatedAt", "url"]
			: [
					"number",
					"title",
					"state",
					"isDraft",
					"author",
					"baseRefName",
					"headRefName",
					"labels",
					"createdAt",
					"updatedAt",
					"url",
				];
	const args = [
		scheme,
		"list",
		"--repo",
		repo,
		"--state",
		options.state,
		"--limit",
		String(options.limit),
		"--json",
		fields.join(","),
	];
	if (options.author) args.push("--author", options.author);
	if (options.label) args.push("--label", options.label);

	const items =
		scheme === "issue"
			? await githubIssueJsonWithStateReasonFallback<Array<IssueListItem>>(cwd, args, context?.signal, {
					repoProvided: true,
				})
			: await github.json<Array<PrListItem>>(cwd, args, context?.signal, {
					repoProvided: true,
				});
	return buildListResource(scheme, repo, options, items, url, `Live listing for ${repo}`);
}

function buildListResource(
	scheme: Scheme,
	repo: string,
	options: ParsedList,
	items: Array<IssueListItem | PrListItem>,
	url: InternalUrl,
	note: string,
): InternalResource {
	const header =
		scheme === "issue"
			? `# Issues in ${repo} (${options.state}, up to ${options.limit})`
			: `# Pull Requests in ${repo} (${options.state}, up to ${options.limit})`;
	const body =
		items.length === 0 ? "_No matches._" : items.map(item => formatListItem(scheme, repo, item)).join("\n\n");
	const footer = `\n\n---\nRead a specific item: \`${scheme}://${repo}/<N>\` (or \`${scheme}://<N>\` for the current repo).`;
	const rendered = `${header}\n\n${body}${footer}`;

	return {
		url: url.href,
		content: rendered,
		contentType: "text/markdown",
		size: Buffer.byteLength(rendered, "utf-8"),
		notes: [note],
	};
}

function mapTeaIssue(item: TeaIssue): IssueListItem {
	return {
		number: item.number,
		title: item.title,
		state: item.state,
		author: item.user ? { login: item.user.login } : null,
		labels: item.labels?.map(label => ({ name: label.name })),
		createdAt: item.created_at ?? undefined,
		updatedAt: item.updated_at ?? undefined,
		url: item.html_url,
	};
}

function mapTeaPull(item: TeaPullRequest): PrListItem {
	return {
		...mapTeaIssue(item),
		// `merged` is a boolean field on Gitea pulls, not a state.
		state: item.merged ? "merged" : item.state,
		isDraft: item.draft,
		baseRefName: item.base?.ref,
		headRefName: item.head?.ref,
	};
}

async function fetchAndRenderTeaList(
	scheme: Scheme,
	repo: string,
	options: ParsedList,
	url: InternalUrl,
	context: ResolveContext | undefined,
): Promise<InternalResource> {
	const cwd = resolveCwd(context);
	const listOptions = {
		state: options.state,
		limit: options.limit,
		author: options.author,
		label: options.label,
	};
	const items =
		scheme === "issue"
			? (await listTeaIssues(cwd, repo, listOptions, context?.signal)).map(mapTeaIssue)
			: (await listTeaPulls(cwd, repo, listOptions, context?.signal)).map(mapTeaPull);
	return buildListResource(scheme, repo, options, items, url, `Live Gitea listing for ${repo}`);
}

interface BuildSingleArgs {
	url: InternalUrl;
	scheme: Scheme;
	parsed: ParsedSingle;
	rendered: string;
	status: CacheStatus;
	fetchedAt: number;
	/** Resolved repo (post short-form expansion) — used for the PR-only diff hint. */
	repo?: string;
}

function buildSingleResource({
	url,
	scheme,
	parsed,
	rendered,
	status,
	fetchedAt,
	repo,
}: BuildSingleArgs): InternalResource {
	const notes: string[] = [formatFreshnessNote(status, fetchedAt)];
	if (!parsed.comments) notes.push("Comments disabled");
	if (scheme === "pr") {
		const repoSegment = repo ?? parsed.repo;
		const diffUrl = repoSegment ? `pr://${repoSegment}/${parsed.number}/diff` : `pr://${parsed.number}/diff`;
		notes.push(`Diff: ${diffUrl}`);
	}
	const content =
		status === "stale"
			? `> WARNING: Live GitHub refresh failed; this ${scheme} content is cached and may be stale.\n\n${rendered}`
			: rendered;
	return {
		url: url.href,
		content,
		contentType: "text/markdown",
		size: Buffer.byteLength(content, "utf-8"),
		notes,
	};
}

function loadPinnedPrDiff(repo: string, number: number, fetchedAt: number, settings: ResolveContext["settings"]) {
	const pinned = getPinnedPrDiff({ repo, number, fetchedAt, settings });
	if (!pinned) {
		throw new Error(
			`pr://${repo}/${number}/diff?at=${fetchedAt} is not available: the pinned snapshot expired, the GitHub cache is disabled, or it was saved under another GitHub account. Run /review again.`,
		);
	}
	return pinned;
}

async function fetchAndRenderPrDiff(
	url: InternalUrl,
	parsed: ParsedPrDiff,
	context: ResolveContext | undefined,
	giteaRepo?: string,
): Promise<InternalResource> {
	const cwd = resolveCwd(context);
	let repo = parsed.repo;
	let lookup: ViewLookupResult<PrDiffPayload>;
	if (giteaRepo !== undefined) {
		repo = giteaRepo;
		lookup = {
			rendered: "",
			sourceUrl: undefined,
			payload: await fetchTeaPullDiff(cwd, giteaRepo, parsed.number, context?.signal),
			status: "miss",
			fetchedAt: Date.now(),
		};
	} else {
		if (!repo) {
			try {
				repo = await resolveDefaultRepoMemoized(cwd, context?.signal);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(
					`pr://${parsed.number}/diff could not resolve a default repo from the current session: ${message}\nUse pr://<owner>/<repo>/${parsed.number}/diff.`,
				);
			}
		}
		lookup =
			parsed.fetchedAt === undefined
				? await getOrFetchPrDiff({
						cwd,
						repo,
						number: parsed.number,
						signal: context?.signal,
						settings: context?.settings,
					})
				: loadPinnedPrDiff(repo, parsed.number, parsed.fetchedAt, context?.settings);
	}
	return renderDiffFamilyResource(url, parsed.mode, parsed.index, lookup, {
		baseUrl: `pr://${repo}/${parsed.number}`,
		heading: `Pull Request Diff: ${repo}#${parsed.number}`,
		noun: "PR",
		query: diffSnapshotQuery(parsed.fetchedAt),
	});
}

/**
 * Handler for `issue://` URLs.
 */
export class IssueProtocolHandler implements ProtocolHandler {
	readonly scheme = "issue";
	readonly spec: SchemeSpec = { backing: "remote", selectors: "lines", immutable: true };

	/** Advertised when `gh` is on PATH; the entry documents `pr://` too. */
	promptDoc(): string | undefined {
		return github.available() ? issueDoc.trim() : undefined;
	}

	async resolve(url: InternalUrl, context?: ResolveContext): Promise<InternalResource> {
		if (context?.signal?.aborted) {
			throw new Error("aborted");
		}
		const parsed = parseUrl(url, "issue");
		const giteaRepo = await resolveGiteaRoute(parsed.repo, context);
		if (parsed.kind === "list") {
			try {
				if (giteaRepo !== undefined) {
					return await fetchAndRenderTeaList("issue", giteaRepo, parsed, url, context);
				}
				return await fetchAndRenderList("issue", parsed, url, context);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`issue:// listing failed: ${message}`);
			}
		}
		// parseUrl already rejects `issue://.../diff`; this guard is a belt-and-
		// suspenders catch in case the union grows.
		if (parsed.kind !== "single") {
			throw new Error(`Invalid issue:// URL: unexpected variant '${parsed.kind}'`);
		}
		try {
			if (giteaRepo !== undefined) {
				const rendered = await renderTeaIssue(
					resolveCwd(context),
					giteaRepo,
					parsed.number,
					parsed.comments,
					context?.signal,
				);
				return buildSingleResource({
					url,
					scheme: "issue",
					parsed,
					rendered,
					status: "miss",
					fetchedAt: Date.now(),
					repo: giteaRepo,
				});
			}
			const lookup = await getOrFetchIssue({
				cwd: resolveCwd(context),
				repo: parsed.repo,
				issue: String(parsed.number),
				includeComments: parsed.comments,
				signal: context?.signal,
				settings: context?.settings,
			});
			return buildSingleResource({
				url,
				scheme: "issue",
				parsed,
				rendered: lookup.rendered,
				status: lookup.status,
				fetchedAt: lookup.fetchedAt,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`issue:// resolution failed: ${message}`);
		}
	}
}

/**
 * Handler for `pr://` URLs.
 */
export class PrProtocolHandler implements ProtocolHandler {
	readonly scheme = "pr";
	readonly spec: SchemeSpec = { backing: "remote", selectors: "lines", immutable: true };

	async resolve(url: InternalUrl, context?: ResolveContext): Promise<InternalResource> {
		if (context?.signal?.aborted) {
			throw new Error("aborted");
		}
		const parsed = parseUrl(url, "pr");
		const giteaRepo = await resolveGiteaRoute(parsed.repo, context);
		if (parsed.kind === "list") {
			try {
				if (giteaRepo !== undefined) {
					return await fetchAndRenderTeaList("pr", giteaRepo, parsed, url, context);
				}
				return await fetchAndRenderList("pr", parsed, url, context);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`pr:// listing failed: ${message}`);
			}
		}
		if (parsed.kind === "pr-diff") {
			try {
				return await fetchAndRenderPrDiff(url, parsed, context, giteaRepo);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`pr:// diff resolution failed: ${message}`);
			}
		}
		if (giteaRepo !== undefined) {
			try {
				const rendered = await renderTeaPull(
					resolveCwd(context),
					giteaRepo,
					parsed.number,
					parsed.comments,
					context?.signal,
				);
				return buildSingleResource({
					url,
					scheme: "pr",
					parsed,
					rendered,
					status: "miss",
					fetchedAt: Date.now(),
					repo: giteaRepo,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`pr:// resolution failed: ${message}`);
			}
		}
		const cwd = resolveCwd(context);
		let repo = parsed.repo;
		if (!repo) {
			try {
				repo = await resolveDefaultRepoMemoized(cwd, context?.signal);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(
					`pr://${parsed.number} could not resolve a default repo from the current session: ${message}\nUse pr://<owner>/<repo>/${parsed.number}.`,
				);
			}
		}
		try {
			const lookup = await getOrFetchPr({
				cwd,
				repo,
				number: parsed.number,
				includeComments: parsed.comments,
				signal: context?.signal,
				settings: context?.settings,
			});
			return buildSingleResource({
				url,
				scheme: "pr",
				parsed,
				rendered: lookup.rendered,
				status: lookup.status,
				fetchedAt: lookup.fetchedAt,
				repo,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`pr:// resolution failed: ${message}`);
		}
	}
}

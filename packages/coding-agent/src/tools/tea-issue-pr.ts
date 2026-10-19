/**
 * `issue://` / `pr://` support against Gitea.
 *
 * Mirrors the GitHub protocol surface (`read`, `list`, `pr://N/diff`) on the
 * Gitea REST API, called through `tea api` so instance selection and auth ride
 * the already-resolved `--login` flags. Rendering reuses the tea tool's
 * formatters; diff parsing reuses the unified-diff splitter shared with `gh`.
 */
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { type PrDiffPayload, parsePrUnifiedDiff } from "./gh-pr-diff";
import { formatCommentsSection, formatIssueView, formatPrView } from "./tea";
import { giteaApiArgs, parseRepoRef } from "./tea-common";
import type { TeaComment, TeaIssue, TeaPullRequest } from "./tea-types";
import { gitea } from "../utils/gitea";

export interface TeaIssuePrListOptions {
	state: "open" | "closed" | "merged" | "all";
	limit: number;
	author?: string;
	label?: string;
}

function matchesFilters(
	item: { user?: { login?: string } | null; labels?: Array<{ name?: string }> } | undefined,
	options: TeaIssuePrListOptions,
): boolean {
	if (!item) return false;
	if (options.author) {
		const login = item.user?.login?.toLowerCase();
		if (login !== options.author.toLowerCase()) return false;
	}
	if (options.label) {
		const wanted = options.label.toLowerCase();
		if (!item.labels?.some(label => label.name?.toLowerCase() === wanted)) return false;
	}
	return true;
}

/** `GET /repos/{owner}/{repo}/issues` through `tea api`. */
export async function listTeaIssues(
	cwd: string,
	repo: string,
	options: TeaIssuePrListOptions,
	signal?: AbortSignal,
): Promise<TeaIssue[]> {
	const slug = parseRepoRef(repo).slug;
	const params = new URLSearchParams({
		state: options.state,
		limit: String(options.limit),
		type: "issues",
	});
	if (options.author) params.set("created_by", options.author);
	if (options.label) params.set("labels", options.label);
	const endpoint = `/repos/${slug}/issues?${params.toString()}`;
	const items = await gitea.json<TeaIssue[]>(cwd, await giteaApiArgs(cwd, repo, endpoint, undefined, signal), signal, {
		repoProvided: true,
	});
	return (Array.isArray(items) ? items : []).filter(item => matchesFilters(item, options));
}

/** `GET /repos/{owner}/{repo}/pulls` through `tea api`. */
export async function listTeaPulls(
	cwd: string,
	repo: string,
	options: TeaIssuePrListOptions,
	signal?: AbortSignal,
): Promise<TeaPullRequest[]> {
	const slug = parseRepoRef(repo).slug;
	// Gitea has no `merged` state: closed pulls are filtered client-side.
	const apiState = options.state === "merged" ? "closed" : options.state;
	const params = new URLSearchParams({
		state: apiState,
		limit: String(options.limit),
	});
	if (options.author) params.set("poster", options.author);
	if (options.label) params.set("labels", options.label);
	const endpoint = `/repos/${slug}/pulls?${params.toString()}`;
	const items = await gitea.json<TeaPullRequest[]>(
		cwd,
		await giteaApiArgs(cwd, repo, endpoint, undefined, signal),
		signal,
		{ repoProvided: true },
	);
	const list = Array.isArray(items) ? items : [];
	const filtered = options.state === "merged" ? list.filter(item => item.merged === true) : list;
	return filtered.filter(item => matchesFilters(item, options));
}

/** `GET /repos/{owner}/{repo}/issues/{index}` (+ comments) rendered as markdown. */
export async function renderTeaIssue(
	cwd: string,
	repo: string,
	number: number,
	includeComments: boolean,
	signal?: AbortSignal,
): Promise<string> {
	const slug = parseRepoRef(repo).slug;
	const issue = await gitea.json<TeaIssue>(
		cwd,
		await giteaApiArgs(cwd, repo, `/repos/${slug}/issues/${number}`, undefined, signal),
		signal,
		{ repoProvided: true },
	);
	let comments: TeaComment[] | undefined;
	if (includeComments) {
		try {
			comments = await gitea.json<TeaComment[]>(
				cwd,
				await giteaApiArgs(cwd, repo, `/repos/${slug}/issues/${number}/comments`, undefined, signal),
				signal,
				{ repoProvided: true },
			);
		} catch {
			// A failed comments read degrades to the issue's comment count
			// instead of masking the body exactly like `tea issue_view`.
		}
	}
	return formatIssueView(issue, comments, { issue: String(number) });
}

/** `GET /repos/{owner}/{repo}/pulls/{index}` (+ issue comments) as markdown. */
export async function renderTeaPull(
	cwd: string,
	repo: string,
	number: number,
	includeComments: boolean,
	signal?: AbortSignal,
): Promise<string> {
	const slug = parseRepoRef(repo).slug;
	const pull = await gitea.json<TeaPullRequest>(
		cwd,
		await giteaApiArgs(cwd, repo, `/repos/${slug}/pulls/${number}`, undefined, signal),
		signal,
		{ repoProvided: true },
	);
	let rendered = formatPrView(pull);
	if (includeComments) {
		let comments: TeaComment[] | undefined;
		try {
			comments = await gitea.json<TeaComment[]>(
				cwd,
				await giteaApiArgs(cwd, repo, `/repos/${slug}/issues/${number}/comments`, undefined, signal),
				signal,
				{ repoProvided: true },
			);
		} catch {
			// Comments are optional context; the PR body is the read's payload.
		}
		const section = formatCommentsSection(comments).join("\n").trim();
		if (section) rendered = `${rendered}\n\n${section}`;
	}
	return rendered;
}

/**
 * `GET /repos/{owner}/{repo}/pulls/{index}.diff`, split into per-file sections
 * with byte offsets so the listing, `/diff/all`, and `/diff/<i>` views can all
 * slice one fetch exactly like the GitHub path.
 */
export async function fetchTeaPullDiff(
	cwd: string,
	repo: string,
	number: number,
	signal?: AbortSignal,
): Promise<PrDiffPayload> {
	const slug = parseRepoRef(repo).slug;
	const unified = await gitea.text(
		cwd,
		await giteaApiArgs(cwd, repo, `/repos/${slug}/pulls/${number}.diff`, undefined, signal),
		signal,
		{ repoProvided: true },
	);
	// A `.diff` route that an older/foreign instance does not serve returns
	// JSON instead of a patch; surface that instead of a bogus empty listing.
	if (unified.length > 0 && !unified.startsWith("diff --git")) {
		throw new ToolError(
			`Gitea did not return a unified diff for ${repo}#${number}. The instance may not support the pulls .diff route.`,
		);
	}
	return parsePrUnifiedDiff(unified);
}

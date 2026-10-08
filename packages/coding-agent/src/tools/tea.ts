import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
	ToolApprovalDecision,
} from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/pi-omptype";
import type { VcsGitRepo } from "@linxiraos/pi-natives";
import * as vcs from "@linxiraos/pi-natives/vcs";
import { getWorktreeDir, hashPath, prompt, untilAborted } from "@linxiraos/pi-utils";
import { pushLine, formatShortSha } from "@linxiraos/pi-tui/tools/gh-format";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { M } from "../i18n";
import giteaDescription from "../prompts/tools/gitea.md" with { type: "text" };
import { parseIsolationBackend } from "../task/worktree";
import { cfgIsolationBackend, cfgWorktreeClone } from "../task/settings";
import { gitea } from "../utils/gitea";
import { withRepoLock } from "../utils/repo-lock";
import type { ToolSession } from ".";
import {
	appendTeaRepoFlag,
	buildTextResult,
	formatAuthor,
	formatCreatedPullRequest,
	formatLabels,
	formatRepoView,
	normalizeOptionalString,
	normalizeStringList,
	normalizeText,
	parseIssueUrl,
	parsePositiveDecimalInt,
	parsePullRequestUrl,
	parseGiteaRemoteUrl,
	parseRepoRef,
	requireGitRepoRoot,
	requireNonEmpty,
	resolveAvailableWorktreePath,
	resolveLoginArgs,
	resolveRepoContext,
	resolveTeaLimit,
	toLocalBranchRef,
	type TeaRepoContext,
	type TeaRepoRef,
} from "./tea-common";
import { throwIfAborted } from "./tool-errors";
import type {
	TeaCheckoutSummary,
	TeaComment,
	TeaInput,
	TeaIssue,
	TeaPullRequest,
	TeaRelease,
	TeaRepo,
	TeaToolDetails,
	TeaUser,
} from "./tea-types";

/** Read-approval ops; everything else in the op union requests execution approval. */
const TEA_READONLY_OPS: Record<string, true> = {
	repo_view: true,
	issue_view: true,
	issue_list: true,
	pr_view: true,
	pr_list: true,
	release_list: true,
};

const TEA_MERGE_STYLES: Record<string, true> = {
	merge: true,
	rebase: true,
	squash: true,
	"rebase-merge": true,
};

const TEA_PR_FETCH_TIMEOUT_MS = 30 * 60 * 1000;

const teaSchema = type({
	op: type(
		"'repo_view' | 'repo_create' | 'issue_view' | 'issue_list' | 'issue_create' | 'pr_view' | 'pr_list' | 'pr_create' | 'pr_checkout' | 'pr_merge' | 'release_list' | 'release_create'",
	).describe("tea operation"),
	"repo?": type("string").describe("[host/]owner/repo; host names the Gitea instance"),
	"login?": type("string").describe("tea login name selecting the Gitea instance"),
	"name?": type("string").describe("repo_create: new repository name"),
	"owner?": type("string").describe("repo_create: owner user or org (default: logged-in user)"),
	"description?": type("string").describe("repo_create: repository description"),
	"private?": type("boolean").describe("repo_create: private repository"),
	"init?": type("boolean").describe("repo_create: initialize with README (default true)"),
	"issue?": type("string").describe("issue number or Gitea issue URL"),
	"pr?": type("string").describe("pr number or Gitea PR URL"),
	"title?": type("string").describe("issue/pr/release title"),
	"body?": type("string").describe("issue/pr description or release notes"),
	"base?": type("string").describe("pr_create: base branch (default: repo default branch)"),
	"head?": type("string").describe("pr_create: head branch (default: current branch)"),
	"draft?": type("boolean").describe("create as draft"),
	"prerelease?": type("boolean").describe("release_create: mark as pre-release"),
	"tag?": type("string").describe("release_create: tag to release"),
	"target?": type("string").describe("release_create: target branch or commit"),
	"labels?": type("string[]").describe("labels to apply"),
	"assignees?": type("string[]").describe("assignees"),
	"state?": type("'open' | 'closed' | 'all'").describe("list state filter"),
	"limit?": type("number").describe("max results"),
	"style?": type("'merge' | 'rebase' | 'squash' | 'rebase-merge'").describe("pr_merge style"),
	"mergeTitle?": type("string").describe("pr_merge: merge commit title"),
	"mergeMessage?": type("string").describe("pr_merge: merge commit message"),
	"force?": type("boolean").describe("pr_checkout: reset an existing pr-N branch"),
});

type TeaToolInput = typeof teaSchema.infer;

/** `tea api` arguments for an endpoint under an op's resolved repo context. */
function apiArgs(ctx: TeaRepoContext, endpoint: string): string[] {
	return ["api", ...ctx.loginArgs, endpoint];
}

/** First `#<index>` marker in a `tea` create-command output, for readback. */
export function parseCreatedIndex(stdout: string): number | undefined {
	const match = /(?:^|[\s(#])#(\d+)\b/.exec(stdout);
	return match ? Number(match[1]) : undefined;
}

/**
 * `tea repo create` has a silent-failure history (it can exit 0 while the
 * repository was not created), so every creation is confirmed by reading the
 * entity back from the API. A failed readback is an error, never a guess.
 */
function requireReadback<T>(entity: T | undefined, what: string, repo: string): T {
	if (entity === undefined) {
		throw new ToolError(
			`Gitea reported success creating ${what}, but it could not be read back from ${repo}. ` +
				"Verify the result manually (tea repo create can fail silently); do not assume it exists.",
		);
	}
	return entity;
}

export function formatIssueView(data: TeaIssue, comments: TeaComment[] | undefined, input: { issue: string }): string {
	const lines: string[] = [];
	const issueNumber = data.number ?? input.issue;
	lines.push(`# Issue #${issueNumber}: ${data.title ?? M.teaUntitled}`);
	lines.push("");
	pushLine(lines, "State", data.state);
	pushLine(lines, "Author", formatAuthor(data.user));
	pushLine(lines, "Created", data.created_at);
	pushLine(lines, "Updated", data.updated_at);
	pushLine(lines, "Labels", formatLabels(data.labels));
	pushLine(lines, "Milestone", data.milestone?.title);
	pushLine(lines, "Comments", data.comments);
	pushLine(lines, "URL", data.html_url);
	lines.push("");
	lines.push("## Body");
	lines.push("");
	lines.push(normalizeText(data.body) || M.teaNoDescription);

	const commentSection = formatCommentsSection(comments);
	if (commentSection.length > 0) {
		lines.push("");
		lines.push(...commentSection);
	}
	return lines.join("\n").trim();
}

export function formatCommentsSection(comments: TeaComment[] | undefined): string[] {
	if (!comments || comments.length === 0) {
		return [];
	}
	const lines: string[] = [`## Comments (${comments.length})`, ""];
	for (const comment of comments) {
		const author = formatAuthor(comment.user) ?? "unknown";
		const createdAt = comment.created_at ? ` · ${comment.created_at}` : "";
		lines.push(`### ${author}${createdAt}`);
		lines.push("");
		lines.push(normalizeText(comment.body) || M.teaNoDescription);
		if (comment.html_url) {
			lines.push("");
			lines.push(`URL: ${comment.html_url}`);
		}
		lines.push("");
	}
	return lines;
}

export function formatIssueList(items: TeaIssue[], input: { repo: string; state: string }): string {
	const lines: string[] = [`# Issues in ${input.repo} (${input.state}) — ${items.length} result(s)`, ""];
	for (const item of items) {
		lines.push(`# ${item.number} [${item.state ?? "?"}] ${item.title ?? M.teaUntitled}`);
		pushLine(lines, "  Author", formatAuthor(item.user));
		pushLine(lines, "  Labels", formatLabels(item.labels));
		pushLine(lines, "  Updated", item.updated_at);
		pushLine(lines, "  URL", item.html_url);
		lines.push("");
	}
	return lines.join("\n").trim();
}

export function formatPrView(data: TeaPullRequest): string {
	const lines: string[] = [];
	const prNumber = data.number ?? "?";
	lines.push(`# Pull Request #${prNumber}: ${data.title ?? M.teaUntitled}`);
	lines.push("");
	pushLine(lines, "State", data.state);
	pushLine(lines, "Draft", data.draft);
	pushLine(lines, "Author", formatAuthor(data.user));
	pushLine(lines, "Base", data.base?.ref);
	pushLine(lines, "Head", data.head?.ref);
	pushLine(lines, "Head commit", data.head?.sha ? formatShortSha(data.head.sha) : undefined);
	pushLine(lines, "Mergeable", data.mergeable);
	pushLine(lines, "Merged", data.merged);
	pushLine(lines, "Created", data.created_at);
	pushLine(lines, "Updated", data.updated_at);
	pushLine(lines, "Labels", formatLabels(data.labels));
	pushLine(lines, "URL", data.html_url);
	lines.push("");
	lines.push("## Body");
	lines.push("");
	lines.push(normalizeText(data.body) || M.teaNoDescription);
	return lines.join("\n").trim();
}

export function formatPrList(items: TeaPullRequest[], input: { repo: string; state: string }): string {
	const lines: string[] = [`# Pull Requests in ${input.repo} (${input.state}) — ${items.length} result(s)`, ""];
	for (const item of items) {
		lines.push(`# ${item.number} [${item.state ?? "?"}] ${item.title ?? M.teaUntitled}`);
		pushLine(lines, "  Author", formatAuthor(item.user));
		pushLine(lines, "  Base", item.base?.ref);
		pushLine(lines, "  Head", item.head?.ref);
		pushLine(lines, "  Draft", item.draft);
		pushLine(lines, "  Updated", item.updated_at);
		pushLine(lines, "  URL", item.html_url);
		lines.push("");
	}
	return lines.join("\n").trim();
}

export function formatReleaseList(items: TeaRelease[], input: { repo: string }): string {
	const lines: string[] = [`# Releases in ${input.repo} — ${items.length} result(s)`, ""];
	for (const item of items) {
		lines.push(`# ${item.tag_name ?? "?"}${item.name ? ` — ${item.name}` : ""}`);
		pushLine(lines, "  Draft", item.draft);
		pushLine(lines, "  Pre-release", item.prerelease);
		pushLine(lines, "  Target", item.target_commitish);
		pushLine(lines, "  Author", formatAuthor(item.author));
		pushLine(lines, "  Published", item.published_at);
		pushLine(lines, "  Assets", item.assets?.length);
		pushLine(lines, "  URL", item.html_url);
		lines.push("");
	}
	return lines.join("\n").trim();
}

function formatCreatedIssue(issue: TeaIssue): string {
	const lines: string[] = [`# Created Issue #${issue.number ?? "?"}`, ""];
	pushLine(lines, "Title", issue.title);
	pushLine(lines, "State", issue.state);
	pushLine(lines, "Author", formatAuthor(issue.user));
	pushLine(lines, "Labels", formatLabels(issue.labels));
	pushLine(
		lines,
		"Assignees",
		issue.assignees
			?.map(user => user.login)
			.filter(Boolean)
			.join(", "),
	);
	pushLine(lines, "URL", issue.html_url);
	return lines.join("\n").trim();
}

function formatCreatedRelease(release: TeaRelease): string {
	const lines: string[] = [`# Created Release ${release.tag_name ?? "?"}`, ""];
	pushLine(lines, "Title", release.name);
	pushLine(lines, "Draft", release.draft);
	pushLine(lines, "Pre-release", release.prerelease);
	pushLine(lines, "Target", release.target_commitish);
	pushLine(lines, "Author", formatAuthor(release.author));
	pushLine(lines, "URL", release.html_url);
	return lines.join("\n").trim();
}

async function executeRepoView(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<TeaToolDetails>> {
	const ctx = await resolveRepoContext(session, params, signal);
	const data = await gitea.json<TeaRepo>(session.cwd, apiArgs(ctx, `/repos/${ctx.slug}`), signal, {
		repoProvided: true,
	});
	return buildTextResult(formatRepoView(data, { repo: ctx.repo }), data.html_url, {
		repo: ctx.repo,
		url: data.html_url,
	});
}

async function executeRepoCreate(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<TeaToolDetails>> {
	const name = requireNonEmpty(params.name, "name");
	const ref = parseRepoRef(normalizeOptionalString(params.repo) ?? "");
	const loginArgs = await resolveLoginArgs(session.cwd, ref, params.login, signal);
	let owner = normalizeOptionalString(params.owner);
	if (!owner) {
		const user = await gitea.json<TeaUser>(session.cwd, ["api", ...loginArgs, "/user"], signal);
		owner = requireNonEmpty(user.login, "owner (resolved from the logged-in user)");
	}
	const explicitOwner = normalizeOptionalString(params.owner);
	const init = params.init ?? true;
	const args = ["repos", "create", "--name", name];
	if (explicitOwner) args.push("--owner", explicitOwner);
	if (normalizeOptionalString(params.description)) args.push("--description", params.description as string);
	if (params.private === true) args.push("--private");
	if (init) args.push("--init");

	await gitea.text(session.cwd, args, signal, { repoProvided: true });

	let data: TeaRepo | undefined;
	try {
		data = await gitea.json<TeaRepo>(session.cwd, ["api", ...loginArgs, `/repos/${owner}/${name}`], signal);
	} catch {
		data = undefined;
	}
	if (data !== undefined && data.name !== undefined && data.name !== name) {
		throw new ToolError(
			`Gitea read back '${data.full_name ?? data.name}' but the requested repository was '${owner}/${name}'.`,
		);
	}
	data = requireReadback(data, `repository '${owner}/${name}'`, `${owner}/${name}`);

	const full = data.full_name ?? `${owner}/${name}`;
	return buildTextResult(formatRepoView(data, { repo: full }), data.html_url, { repo: full, url: data.html_url });
}

/** Issue/PR number from a number or a Gitea URL; undefined when neither. */
function entityNumberFromIdentifier(identifier: string): number | undefined {
	const prUrl = parsePullRequestUrl(identifier);
	if (prUrl.prNumber !== undefined) return prUrl.prNumber;
	const issueUrl = parseIssueUrl(identifier);
	if (issueUrl.issueNumber !== undefined) return issueUrl.issueNumber;
	return parsePositiveDecimalInt(identifier);
}

async function executeIssueView(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<TeaToolDetails>> {
	const identifier = requireNonEmpty(params.issue, "issue");
	const fromUrl = parseIssueUrl(identifier);
	const ctx = await resolveRepoContext(session, params, signal, fromUrl.repo);
	const number = entityNumberFromIdentifier(identifier);
	if (number === undefined) {
		throw new ToolError(`invalid issue identifier: ${identifier}. Pass an issue number or Gitea issue URL.`);
	}
	const data = await gitea.json<TeaIssue>(session.cwd, apiArgs(ctx, `/repos/${ctx.slug}/issues/${number}`), signal, {
		repoProvided: true,
	});
	let comments: TeaComment[] | undefined;
	try {
		comments = await gitea.json<TeaComment[]>(
			session.cwd,
			apiArgs(ctx, `/repos/${ctx.slug}/issues/${number}/comments`),
			signal,
		);
	} catch (error) {
		// Comments must not mask the issue body itself when the instance or
		// token cannot serve them; the view already reports the comment count.
		if (!(error instanceof ToolError)) throw error;
		comments = undefined;
	}
	return buildTextResult(formatIssueView(data, comments, { issue: String(number) }), data.html_url, {
		repo: ctx.repo,
		issue: number,
		url: data.html_url,
	});
}

async function executeIssueList(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<TeaToolDetails>> {
	const ctx = await resolveRepoContext(session, params, signal);
	const state = params.state ?? "open";
	const limit = resolveTeaLimit(params.limit);
	const endpoint = `/repos/${ctx.slug}/issues?state=${encodeURIComponent(state)}&limit=${limit}&type=issues`;
	const items = await gitea.json<TeaIssue[]>(session.cwd, apiArgs(ctx, endpoint), signal, { repoProvided: true });
	const list = Array.isArray(items) ? items : [];
	return buildTextResult(
		formatIssueList(list, { repo: ctx.repo, state }),
		undefined,
		{ repo: ctx.repo },
		{ useless: list.length === 0 },
	);
}

async function executePrView(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<TeaToolDetails>> {
	const identifier = requireNonEmpty(params.pr, "pr");
	const fromUrl = parsePullRequestUrl(identifier);
	const ctx = await resolveRepoContext(session, params, signal, fromUrl.repo);
	const number = entityNumberFromIdentifier(identifier);
	if (number === undefined) {
		throw new ToolError(`invalid PR identifier: ${identifier}. Pass a PR number or Gitea PR URL.`);
	}
	const data = await gitea.json<TeaPullRequest>(
		session.cwd,
		apiArgs(ctx, `/repos/${ctx.slug}/pulls/${number}`),
		signal,
		{
			repoProvided: true,
		},
	);
	return buildTextResult(formatPrView(data), data.html_url, {
		repo: ctx.repo,
		pr: number,
		url: data.html_url,
	});
}

async function executePrList(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<TeaToolDetails>> {
	const ctx = await resolveRepoContext(session, params, signal);
	const state = params.state ?? "open";
	const limit = resolveTeaLimit(params.limit);
	const endpoint = `/repos/${ctx.slug}/pulls?state=${encodeURIComponent(state)}&limit=${limit}`;
	const items = await gitea.json<TeaPullRequest[]>(session.cwd, apiArgs(ctx, endpoint), signal, {
		repoProvided: true,
	});
	const list = Array.isArray(items) ? items : [];
	return buildTextResult(
		formatPrList(list, { repo: ctx.repo, state }),
		undefined,
		{ repo: ctx.repo },
		{ useless: list.length === 0 },
	);
}

async function executeReleaseList(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<TeaToolDetails>> {
	const ctx = await resolveRepoContext(session, params, signal);
	const limit = resolveTeaLimit(params.limit);
	const items = await gitea.json<TeaRelease[]>(
		session.cwd,
		apiArgs(ctx, `/repos/${ctx.slug}/releases?limit=${limit}`),
		signal,
		{ repoProvided: true },
	);
	const list = Array.isArray(items) ? items : [];
	return buildTextResult(
		formatReleaseList(list, { repo: ctx.repo }),
		undefined,
		{ repo: ctx.repo },
		{ useless: list.length === 0 },
	);
}

/**
 * Confirm a freshly created issue by reading it back: prefer the `#<n>`
 * marker tea printed, else search the API by exact title (the entry was
 * created moments ago by this caller).
 */
async function readbackCreatedIssue(
	session: ToolSession,
	ctx: TeaRepoContext,
	title: string,
	stdout: string,
	signal: AbortSignal | undefined,
): Promise<TeaIssue | undefined> {
	const number = parseCreatedIndex(stdout);
	if (number !== undefined) {
		try {
			return await gitea.json<TeaIssue>(session.cwd, apiArgs(ctx, `/repos/${ctx.slug}/issues/${number}`), signal);
		} catch {
			return undefined;
		}
	}
	const search = `/repos/${ctx.slug}/issues?q=${encodeURIComponent(title)}&state=all&limit=10&type=issues`;
	try {
		const found = await gitea.json<TeaIssue[]>(session.cwd, apiArgs(ctx, search), signal);
		return Array.isArray(found) ? found.find(item => item.title === title) : undefined;
	} catch {
		return undefined;
	}
}

/** Same confirmation flow for pull requests (title search over open+closed). */
async function readbackCreatedPullRequest(
	session: ToolSession,
	ctx: TeaRepoContext,
	title: string,
	stdout: string,
	signal: AbortSignal | undefined,
): Promise<TeaPullRequest | undefined> {
	const number = parseCreatedIndex(stdout);
	if (number !== undefined) {
		try {
			return await gitea.json<TeaPullRequest>(
				session.cwd,
				apiArgs(ctx, `/repos/${ctx.slug}/pulls/${number}`),
				signal,
			);
		} catch {
			return undefined;
		}
	}
	const search = `/repos/${ctx.slug}/pulls?state=all&limit=50`;
	try {
		const found = await gitea.json<TeaPullRequest[]>(session.cwd, apiArgs(ctx, search), signal);
		return Array.isArray(found) ? found.find(item => item.title === title) : undefined;
	} catch {
		return undefined;
	}
}

async function executeIssueCreate(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<TeaToolDetails>> {
	const ctx = await resolveRepoContext(session, params, signal);
	const title = requireNonEmpty(params.title, "title");
	const labels = normalizeStringList(params.labels);
	const assignees = normalizeStringList(params.assignees);
	const args = ["issues", "create", "--title", title];
	if (normalizeOptionalString(params.body)) args.push("--description", params.body as string);
	if (labels.length > 0) args.push("--labels", labels.join(","));
	if (assignees.length > 0) args.push("--assignees", assignees.join(","));
	appendTeaRepoFlag(args, ctx.repo);

	const stdout = await gitea.text(session.cwd, args, signal, { repoProvided: true });
	const foundIssue = await readbackCreatedIssue(session, ctx, title, stdout, signal);
	const issue = requireReadback(foundIssue, `issue '${title}'`, ctx.repo);

	return buildTextResult(formatCreatedIssue(issue), issue.html_url, {
		repo: ctx.repo,
		issue: issue.number,
		url: issue.html_url,
	});
}

async function executePrCreate(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<TeaToolDetails>> {
	const ctx = await resolveRepoContext(session, params, signal);
	const title = requireNonEmpty(params.title, "title");
	const labels = normalizeStringList(params.labels);
	const assignees = normalizeStringList(params.assignees);
	const args = ["pulls", "create", "--title", title];
	if (normalizeOptionalString(params.body)) args.push("--description", params.body as string);
	if (normalizeOptionalString(params.head)) args.push("--head", params.head as string);
	if (normalizeOptionalString(params.base)) args.push("--base", params.base as string);
	if (params.draft === true) args.push("--draft");
	if (labels.length > 0) args.push("--labels", labels.join(","));
	if (assignees.length > 0) args.push("--assignees", assignees.join(","));
	appendTeaRepoFlag(args, ctx.repo);

	const stdout = await gitea.text(session.cwd, args, signal, { repoProvided: true });
	const foundPull = await readbackCreatedPullRequest(session, ctx, title, stdout, signal);
	const pull = requireReadback(foundPull, `pull request '${title}'`, ctx.repo);

	return buildTextResult(formatCreatedPullRequest(pull), pull.html_url, {
		repo: ctx.repo,
		pr: pull.number,
		url: pull.html_url,
	});
}

async function executePrMerge(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<TeaToolDetails>> {
	const ctx = await resolveRepoContext(session, params, signal);
	const identifier = requireNonEmpty(params.pr, "pr");
	const number = entityNumberFromIdentifier(identifier);
	if (number === undefined) {
		throw new ToolError(`invalid PR identifier: ${identifier}. Pass a PR number or Gitea PR URL.`);
	}
	const style = params.style ?? "merge";
	if (!TEA_MERGE_STYLES[style]) {
		throw new ToolError(`invalid merge style '${style}'. Use one of: merge, rebase, squash, rebase-merge.`);
	}
	const args = ["pulls", "merge", String(number), "--style", style];
	if (normalizeOptionalString(params.mergeTitle)) args.push("--title", params.mergeTitle as string);
	if (normalizeOptionalString(params.mergeMessage)) args.push("--message", params.mergeMessage as string);
	appendTeaRepoFlag(args, ctx.repo);

	await gitea.text(session.cwd, args, signal, { repoProvided: true });

	const data = await gitea.json<TeaPullRequest>(
		session.cwd,
		apiArgs(ctx, `/repos/${ctx.slug}/pulls/${number}`),
		signal,
	);
	if (data.merged !== true) {
		throw new ToolError(
			`Gitea did not report PR #${number} as merged after the merge command (state: ${data.state ?? "unknown"}).`,
		);
	}
	const lines: string[] = [`# Merged Pull Request #${number}`, ""];
	pushLine(lines, "Title", data.title);
	pushLine(lines, "Merged at", data.merged_at ?? undefined);
	pushLine(lines, "Merge commit", data.merge_commit_sha ? formatShortSha(data.merge_commit_sha) : undefined);
	pushLine(lines, "Merged by", formatAuthor(data.merged_by));
	pushLine(lines, "URL", data.html_url);
	return buildTextResult(lines.join("\n").trim(), data.html_url, {
		repo: ctx.repo,
		pr: number,
		url: data.html_url,
		headSha: data.merge_commit_sha ?? undefined,
	});
}

async function executeReleaseCreate(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<TeaToolDetails>> {
	const ctx = await resolveRepoContext(session, params, signal);
	const tag = requireNonEmpty(params.tag, "tag");
	const args = ["releases", "create", tag];
	if (normalizeOptionalString(params.title)) args.push("--title", params.title as string);
	if (normalizeOptionalString(params.body)) args.push("--note", params.body as string);
	if (normalizeOptionalString(params.target)) args.push("--target", params.target as string);
	if (params.draft === true) args.push("--draft");
	if (params.prerelease === true) args.push("--prerelease");
	appendTeaRepoFlag(args, ctx.repo);

	await gitea.text(session.cwd, args, signal, { repoProvided: true });

	let foundRelease: TeaRelease | undefined;
	try {
		foundRelease = await gitea.json<TeaRelease>(
			session.cwd,
			apiArgs(ctx, `/repos/${ctx.slug}/releases/tags/${encodeURIComponent(tag)}`),
			signal,
		);
	} catch {
		foundRelease = undefined;
	}
	const release = requireReadback(foundRelease, `release '${tag}'`, ctx.repo);

	return buildTextResult(formatCreatedRelease(release), release.html_url, {
		repo: ctx.repo,
		url: release.html_url,
	});
}

/** Find the local git remote whose URL points at `slug` (host match preferred). */
async function matchRemoteForRepo(
	repository: VcsGitRepo,
	ref: TeaRepoRef,
	slug: string,
	signal: AbortSignal | undefined,
): Promise<{ name: string; url: string }> {
	const remotes = await repository.remoteList(signal).catch(() => [] as string[]);
	let fallback: { name: string; url: string } | undefined;
	for (const name of remotes) {
		const url = await repository.remoteUrl(name, signal).catch(() => undefined);
		if (!url) continue;
		const parsed = parseGiteaRemoteUrl(url);
		if (!parsed || parsed.slug.toLowerCase() !== slug.toLowerCase()) continue;
		const entry = { name, url };
		if (!ref.host || parsed.host === ref.host.toLowerCase()) return entry;
		fallback ??= entry;
	}
	if (fallback) return fallback;
	throw new ToolError(`no git remote points at ${slug}; add it before checking out PRs`);
}

function formatPrCheckoutResult(options: {
	data: TeaPullRequest;
	localBranch: string;
	worktreePath: string;
	remoteName: string;
	remoteUrl: string;
	remoteBranch?: string;
	reused: boolean;
}): string {
	const { data, localBranch, worktreePath, remoteName, remoteUrl, remoteBranch, reused } = options;
	const lines: string[] = [
		reused ? `# Pull Request #${data.number ?? "?"} Worktree` : `# Checked Out Pull Request #${data.number ?? "?"}`,
		"",
	];
	pushLine(lines, "Title", data.title ?? undefined);
	pushLine(lines, "URL", data.html_url);
	pushLine(lines, "Base", data.base?.ref);
	pushLine(lines, "Head", data.head?.ref);
	pushLine(lines, "Local branch", localBranch);
	pushLine(lines, "Worktree", worktreePath);
	pushLine(lines, "Remote", remoteName);
	pushLine(lines, "Remote URL", remoteUrl);
	pushLine(lines, "Remote branch", remoteBranch);
	lines.push("");
	lines.push(
		reused
			? "Reused the existing PR worktree."
			: "Created a dedicated worktree for this PR; the working tree was never touched.",
	);
	return lines.join("\n").trim();
}

interface PrCheckoutOutcome extends TeaCheckoutSummary {
	text: string;
}

/** `resolveRef` yields null/undefined for missing refs; checkout needs a real commit. */
async function resolveFetchedRef(
	repository: VcsGitRepo,
	ref: string,
	signal: AbortSignal | undefined,
): Promise<string> {
	const resolved = await repository.resolveRef(ref, signal);
	if (!resolved) {
		throw new ToolError(`could not resolve ${ref} after fetch`);
	}
	return resolved;
}

/**
 * Fetch `refs/pull/<N>/head` (Gitea exposes it for same-repo and fork PRs
 * alike), falling back to the head branch for remotes without pull refs.
 * The returned commit must match the API-reported head before any branch is
 * created. A checkout that already carries the head commit — the common case
 * for the agent's own feature branches — skips the network entirely.
 */
async function fetchPrHead(
	repository: VcsGitRepo,
	remote: { name: string; url: string },
	number: number,
	headRefName: string,
	headSha: string,
	signal: AbortSignal | undefined,
): Promise<string> {
	const localHead = await repository.resolveRef(headSha, signal).catch(() => undefined);
	if (localHead === headSha) return localHead;
	const pullRef = `refs/pull/${number}/head`;
	try {
		await repository.fetch(
			remote.name,
			pullRef,
			`refs/remotes/${remote.name}/pr-${number}`,
			TEA_PR_FETCH_TIMEOUT_MS,
			signal,
		);
		return await resolveFetchedRef(repository, `refs/remotes/${remote.name}/pr-${number}`, signal);
	} catch (pullRefError) {
		throwIfAborted(signal);
		try {
			await repository.fetch(
				remote.name,
				`refs/heads/${headRefName}`,
				`refs/remotes/${remote.name}/${headRefName}`,
				TEA_PR_FETCH_TIMEOUT_MS,
				signal,
			);
			return await resolveFetchedRef(repository, `refs/remotes/${remote.name}/${headRefName}`, signal);
		} catch {
			throw pullRefError;
		}
	}
}

async function checkoutOnePr(
	session: ToolSession,
	params: TeaInput,
	ctx: TeaRepoContext,
	prRef: string,
	signal: AbortSignal | undefined,
): Promise<PrCheckoutOutcome> {
	const number = entityNumberFromIdentifier(prRef);
	if (number === undefined) {
		throw new ToolError(`invalid PR identifier: ${prRef}. Pass a PR number or Gitea PR URL.`);
	}

	const data = await gitea.json<TeaPullRequest>(
		session.cwd,
		apiArgs(ctx, `/repos/${ctx.slug}/pulls/${number}`),
		signal,
		{ repoProvided: true },
	);
	const headRefName = requireNonEmpty(data.head?.ref, "head branch");
	const headSha = requireNonEmpty(data.head?.sha, "head commit");
	const repoRoot = await requireGitRepoRoot(session.cwd, signal);
	const repository = vcs.requireGit(repoRoot);
	const ref = parseRepoRef(ctx.repo);
	const remote = await matchRemoteForRepo(repository, ref, ctx.slug, signal);
	const localBranch = `pr-${number}`;

	return withRepoLock(
		repoRoot,
		async () => {
			const existingWorktrees = await repository.worktrees(signal);
			const existingWorktree = existingWorktrees.find(entry => entry.branch === toLocalBranchRef(localBranch));

			if (existingWorktree) {
				const text = formatPrCheckoutResult({
					data,
					localBranch,
					worktreePath: existingWorktree.path,
					remoteName: remote.name,
					remoteUrl: remote.url,
					remoteBranch: headRefName,
					reused: true,
				});
				return {
					prNumber: number,
					url: data.html_url,
					branch: localBranch,
					worktreePath: existingWorktree.path,
					remote: remote.name,
					remoteBranch: headRefName,
					reused: true,
					text,
				};
			}

			const fetchedRef = await fetchPrHead(repository, remote, number, headRefName, headSha, signal);
			if (fetchedRef !== headSha) {
				throw new ToolError(
					`fetched commit ${fetchedRef ? formatShortSha(fetchedRef) : "?"} does not match PR head ${formatShortSha(headSha)}; refusing to check out a stale ref`,
				);
			}

			const localBranchRef = toLocalBranchRef(localBranch);
			const localBranchExists = await repository.refExists(localBranchRef, signal);
			if (localBranchExists) {
				const existingOid = await repository.resolveRef(localBranchRef, signal);
				if (existingOid !== headSha) {
					if (params.force !== true) {
						throw new ToolError(
							`local branch ${localBranch} already exists at ${formatShortSha(existingOid ?? undefined) ?? existingOid ?? "unknown commit"}; pass force=true to reset it`,
						);
					}
					await repository.createBranch(localBranch, fetchedRef, true, signal);
				}
			} else {
				await repository.createBranch(localBranch, fetchedRef, false, signal);
			}

			// Fork PRs get no push config: the local branch must not be pointed
			// at a repository the PR head does not live on.
			const isCrossRepo =
				data.head?.repo?.full_name !== undefined &&
				data.head.repo.full_name.toLowerCase() !== ctx.slug.toLowerCase();
			const configPrefix = `branch.${localBranch}.`;
			await repository.configSet(`${configPrefix}remote`, remote.name, signal);
			if (!isCrossRepo) {
				await repository.configSet(`${configPrefix}merge`, `refs/heads/${headRefName}`, signal);
				await repository.configSet(`${configPrefix}pushRemote`, remote.name, signal);
			}
			await repository.configSet(`${configPrefix}ompPrHeadRef`, headRefName, signal);
			await repository.configSet(`${configPrefix}ompPrUrl`, data.html_url ?? "", signal);

			const worktreePath = getWorktreeDir(`${number}-${hashPath(repoRoot)}`);
			const finalWorktreePath = await resolveAvailableWorktreePath(worktreePath, existingWorktrees);
			await fs.mkdir(path.dirname(finalWorktreePath), { recursive: true });
			await repository.worktreeAdd(
				finalWorktreePath,
				localBranch,
				{
					detach: false,
					clone: cfgWorktreeClone.get(session.settings),
					backend: parseIsolationBackend(cfgIsolationBackend.get(session.settings)),
				},
				signal,
			);
			const resolvedWorktreePath = await fs.realpath(finalWorktreePath);
			const text = formatPrCheckoutResult({
				data,
				localBranch,
				worktreePath: resolvedWorktreePath,
				remoteName: remote.name,
				remoteUrl: remote.url,
				remoteBranch: headRefName,
				reused: false,
			});
			return {
				prNumber: number,
				url: data.html_url,
				branch: localBranch,
				worktreePath: resolvedWorktreePath,
				remote: remote.name,
				remoteBranch: headRefName,
				reused: false,
				text,
			};
		},
		signal,
	);
}

async function executePrCheckout(
	session: ToolSession,
	params: TeaInput,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<TeaToolDetails>> {
	const ctx = await resolveRepoContext(session, params, signal);
	const prRef = requireNonEmpty(params.pr, "pr");
	const outcome = await checkoutOnePr(session, params, ctx, prRef, signal);
	return buildTextResult(outcome.text, outcome.url, {
		repo: ctx.repo,
		pr: outcome.prNumber,
		worktreePath: outcome.worktreePath,
		remote: outcome.remote,
		remoteBranch: outcome.remoteBranch,
		url: outcome.url,
		checkouts: [outcome],
	});
}

export class TeaTool implements AgentTool<typeof teaSchema, TeaToolDetails> {
	readonly name = "tea";
	readonly approval = (args: unknown): ToolApprovalDecision => {
		const rawOp = (args as Partial<TeaInput>).op;
		const op = typeof rawOp === "string" ? rawOp : "";
		return TEA_READONLY_OPS[op] ? "read" : "exec";
	};
	readonly summary = M.teaSummary;
	readonly loadMode = "discoverable";
	readonly label = M.teaLabel;
	readonly description = prompt.render(giteaDescription);
	readonly parameters = teaSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): TeaTool | null {
		if (!gitea.available()) return null;
		return new TeaTool(session);
	}

	async execute(
		_toolCallId: string,
		params: TeaToolInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<TeaToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<TeaToolDetails>> {
		return untilAborted(signal, async () => {
			switch (params.op) {
				case "repo_view":
					return executeRepoView(this.session, params, signal);
				case "repo_create":
					return executeRepoCreate(this.session, params, signal);
				case "issue_view":
					return executeIssueView(this.session, params, signal);
				case "issue_list":
					return executeIssueList(this.session, params, signal);
				case "issue_create":
					return executeIssueCreate(this.session, params, signal);
				case "pr_view":
					return executePrView(this.session, params, signal);
				case "pr_list":
					return executePrList(this.session, params, signal);
				case "pr_create":
					return executePrCreate(this.session, params, signal);
				case "pr_checkout":
					return executePrCheckout(this.session, params, signal);
				case "pr_merge":
					return executePrMerge(this.session, params, signal);
				case "release_list":
					return executeReleaseList(this.session, params, signal);
				case "release_create":
					return executeReleaseCreate(this.session, params, signal);
			}
		});
	}
}

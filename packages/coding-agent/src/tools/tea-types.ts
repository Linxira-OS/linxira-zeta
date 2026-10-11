/**
 * Pure type shapes for the `tea` (Gitea CLI) tool suite: the tool input
 * discriminator, result details, and the Gitea API JSON projections the ops
 * consume. Gitea's REST API mirrors GitHub's closely but names fields in
 * snake_case (html_url, ssh_url, tag_name) and nests clone targets under
 * `head`/`base` repo objects.
 */
import type { OutputMeta } from "@linxiraos/pi-tui/tools/output-meta";

export type TeaOp =
	| "repo_view"
	| "repo_create"
	| "issue_view"
	| "issue_list"
	| "issue_create"
	| "pr_view"
	| "pr_list"
	| "pr_create"
	| "pr_checkout"
	| "pr_merge"
	| "release_list"
	| "release_create";

export interface TeaInput {
	op: TeaOp;
	/** `[host/]owner/repo`; the host names the Gitea instance when given. */
	repo?: string;
	/** Named `tea` login selecting the Gitea instance (the `--hostname` analog). */
	login?: string;
	/** repo_create: new repository name. */
	name?: string;
	/** repo_create: owner user or organization; defaults to the logged-in user. */
	owner?: string;
	/** repo_create: repository description. */
	description?: string;
	/** repo_create: make the repository private. */
	private?: boolean;
	/** repo_create: initialize with a README so the default branch exists (default true). */
	init?: boolean;
	/** issue_view: issue number or Gitea issue URL. */
	issue?: string;
	/** pr_view / pr_checkout: PR number or Gitea PR URL. */
	pr?: string;
	title?: string;
	body?: string;
	/** pr_create: base branch; defaults to the repository's default branch. */
	base?: string;
	/** pr_create: head branch; defaults to the current branch on the instance. */
	head?: string;
	/** pr_create / release_create: mark as draft. */
	draft?: boolean;
	/** release_create: pre-release marker. */
	prerelease?: boolean;
	/** release_create: tag to release. */
	tag?: string;
	/** release_create: target branch or commit for the tag. */
	target?: string;
	/** issue_create / pr_create: labels to apply. */
	labels?: string[];
	/** issue_create / pr_create: assignees. */
	assignees?: string[];
	/** issue_list / pr_list: state filter. */
	state?: "open" | "closed" | "all";
	/** issue_list / pr_list / release_list: max results (1–50, default 20). */
	limit?: number;
	/** pr_merge: merge style. */
	style?: "merge" | "rebase" | "squash" | "rebase-merge";
	/** pr_merge: merge commit title. */
	mergeTitle?: string;
	/** pr_merge: merge commit message. */
	mergeMessage?: string;
	/** pr_checkout: reset an existing `pr-<number>` branch. */
	force?: boolean;
}

/** Structured metadata attached to tea tool results for the TUI renderer. */
export interface TeaToolDetails {
	meta?: OutputMeta;
	artifactId?: string;
	repo?: string;
	branch?: string;
	issue?: number;
	pr?: number;
	url?: string;
	worktreePath?: string;
	remote?: string;
	remoteBranch?: string;
	headSha?: string;
	checkouts?: TeaCheckoutSummary[];
}

/** Worktree outcome summary for a pr_checkout result. */
export interface TeaCheckoutSummary {
	prNumber?: number;
	url?: string;
	branch: string;
	worktreePath: string;
	remote: string;
	remoteBranch?: string;
	reused: boolean;
}

/** A named `tea` login entry: one Gitea instance plus its credentials. */
export interface TeaLogin {
	name?: string;
	url?: string;
	ssh_host?: string;
	user?: string;
	default?: string;
}

/** Gitea API user projection (subset). */
export interface TeaUser {
	id?: number;
	login?: string;
	full_name?: string | null;
	email?: string | null;
	html_url?: string;
}

/** Gitea API label projection (subset). */
export interface TeaLabel {
	id?: number;
	name?: string;
	color?: string;
}

/** Gitea API repository projection (subset). */
export interface TeaRepo {
	id?: number;
	owner?: TeaUser | null;
	name?: string;
	full_name?: string;
	description?: string | null;
	private?: boolean;
	fork?: boolean;
	template?: boolean;
	archived?: boolean;
	html_url?: string;
	ssh_url?: string;
	clone_url?: string;
	website?: string | null;
	default_branch?: string;
	stars_count?: number;
	watchers_count?: number;
	forks_count?: number;
	open_issues_count?: number;
	open_pr_counter?: number;
	created_at?: string;
	updated_at?: string;
	size?: number;
	permissions?: {
		admin?: boolean;
		push?: boolean;
		pull?: boolean;
	};
}

/** Gitea API milestone projection (subset). */
export interface TeaMilestone {
	id?: number;
	title?: string;
}

/** Gitea API issue comment projection (subset). */
export interface TeaComment {
	id?: number;
	user?: TeaUser | null;
	body?: string | null;
	created_at?: string;
	html_url?: string;
}

/** Gitea API issue projection (subset). PRs expose `pull_request: null` here. */
export interface TeaIssue {
	id?: number;
	number?: number;
	title?: string;
	body?: string | null;
	state?: string;
	user?: TeaUser | null;
	labels?: TeaLabel[];
	assignees?: TeaUser[] | null;
	assignee?: TeaUser | null;
	milestone?: TeaMilestone | null;
	comments?: number;
	created_at?: string;
	updated_at?: string;
	closed_at?: string | null;
	html_url?: string;
	pull_request?: {
		merged?: boolean;
		merged_at?: string | null;
	} | null;
	repository?: {
		id?: number;
		name?: string;
		owner?: string;
		full_name?: string;
	} | null;
}

/** One side of a pull request: branch ref plus the repo it lives on. */
export interface TeaPullRequestBranch {
	label?: string;
	ref?: string;
	sha?: string;
	repo?: TeaRepo | null;
}

/** Gitea API pull request projection (subset). */
export interface TeaPullRequest {
	id?: number;
	number?: number;
	title?: string;
	body?: string | null;
	state?: string;
	user?: TeaUser | null;
	labels?: TeaLabel[];
	assignees?: TeaUser[] | null;
	milestone?: TeaMilestone | null;
	base?: TeaPullRequestBranch | null;
	head?: TeaPullRequestBranch | null;
	mergeable?: boolean;
	merged?: boolean;
	merged_at?: string | null;
	merge_commit_sha?: string | null;
	merged_by?: TeaUser | null;
	draft?: boolean;
	comments?: number;
	created_at?: string;
	updated_at?: string;
	closed_at?: string | null;
	html_url?: string;
}

/** Gitea API release attachment projection (subset). */
export interface TeaReleaseAsset {
	id?: number;
	name?: string;
	size?: number;
	download_count?: number;
	created_at?: string;
	browser_download_url?: string;
}

/** Gitea API release projection (subset). */
export interface TeaRelease {
	id?: number;
	tag_name?: string;
	target_commitish?: string;
	name?: string;
	body?: string | null;
	draft?: boolean;
	prerelease?: boolean;
	created_at?: string;
	published_at?: string;
	url?: string;
	html_url?: string;
	tarball_url?: string;
	zipball_url?: string;
	author?: TeaUser | null;
	assets?: TeaReleaseAsset[];
}

/** Gitea Actions run projection (subset). */
export interface TeaRun {
	id?: number;
	name?: string | null;
	display_title?: string | null;
	head_branch?: string | null;
	head_sha?: string | null;
	status?: string | null;
	conclusion?: string | null;
	run_number?: number;
	workflow_id?: number;
	html_url?: string;
	created_at?: string | null;
	updated_at?: string | null;
}

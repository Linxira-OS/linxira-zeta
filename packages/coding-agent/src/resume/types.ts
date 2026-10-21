/**
 * Resume picker data model: project → workspace → conversation.
 *
 * Everything here is computed from local session files, the on-disk project
 * registry (see `preferences.ts`) and the filesystem; no HTTP gateway is
 * involved. The web gateway may reuse the same module later, but it is not the
 * source of truth.
 */

import type { SessionInfo, SessionStatus } from "../session/session-listing";

/** A conversation as it appears in the picker: one persisted session. */
export interface ResumeConversation {
	session: SessionInfo;
	key: string;
	id: string;
	path: string;
	/** Picker-facing display name (explicit title, then first prompt, then time). */
	title: string;
	cwd: string;
	projectKey: string;
	workspaceKey: string;
	created: Date;
	modified: Date;
	status?: SessionStatus;
	pinned: boolean;
	current: boolean;
	/** True when this conversation was forked from another session. */
	fork: boolean;
	/** True when this session was spawned as a subagent (`session_init.agent` + parent). */
	isSubagent: boolean;
	/** Agent definition recorded for a subagent session (`scout`, `task`, …). */
	agentName?: string;
	/** Resolved key of the parent conversation, for forks and subagents. */
	parentKey?: string;
	/** Direct subagent children, sorted like their siblings. Empty for normal conversations. */
	subagents: ResumeConversation[];
	messageCount: number;
}

/** A workspace is the checkout directory a conversation was started in. */
export interface ResumeWorkspace {
	/** Canonical path identity, also used as the map key. */
	key: string;
	path: string;
	name: string;
	/** User-configured workspace alias, or null. */
	alias: string | null;
	/** Alias when set, otherwise `name`. The directory name never changes. */
	displayName: string;
	projectKey: string;
	/** Checked-out branch when the checkout is a git worktree. */
	branch: string | null;
	/** True when the directory is a linked git worktree (not the main checkout). */
	isWorktree: boolean;
	/** Pinned when any conversation inside it is pinned. */
	pinned: boolean;
	lastActivity: Date | null;
	conversations: ResumeConversation[];
	counts: {
		conversations: number;
		pinnedConversations: number;
	};
}

/** A project is a repository root (all its worktrees share one). */
export interface ResumeProject {
	/** Canonical project-root identity, also used as the map key. */
	key: string;
	root: string;
	name: string;
	/** User-configured alias, or null. */
	alias: string | null;
	/** Alias when set, otherwise `name`. */
	displayName: string;
	/** The seeded default workspace project: always pinned, never removable. */
	isDefault: boolean;
	pinned: boolean;
	removable: boolean;
	collapsed: boolean;
	lastActivity: Date | null;
	workspaces: ResumeWorkspace[];
	/** Flattened, pinned-first then most-recently-modified conversations. */
	conversations: ResumeConversation[];
	counts: {
		conversations: number;
		workspaces: number;
		pinnedConversations: number;
	};
}

export interface ResumeDirectoryCounts {
	projects: number;
	workspaces: number;
	conversations: number;
	pinnedConversations: number;
}

/** The complete local directory model consumed by picker renderers. */
export interface ResumeDirectory {
	projects: ResumeProject[];
	workspaces: ResumeWorkspace[];
	conversations: ResumeConversation[];
	defaultProjectKey: string;
	defaultWorkspaceKey: string;
	counts: ResumeDirectoryCounts;
}

/**
 * One project's persisted picker preferences. The record of keys in
 * {@link ResumePreferences.projects} is also the on-disk project registry:
 * a registered project stays listed even with zero conversations.
 */
export interface ResumeProjectPreferences {
	pinned?: boolean;
	alias?: string;
	collapsed?: boolean;
	/** Registry flag: keep this project in the directory with zero sessions. */
	registered?: boolean;
	/** Epoch milliseconds of the last time the project was opened. */
	lastOpened?: number;
}

/** One workspace's persisted preferences, keyed by its canonical path. */
export interface ResumeWorkspacePreferences {
	/** Display alias; the directory name never changes. */
	alias?: string;
	pinned?: boolean;
}

export interface ResumePreferences {
	version: 1;
	projects: Record<string, ResumeProjectPreferences>;
	/** Workspace overrides keyed by canonical workspace path. */
	workspaces?: Record<string, ResumeWorkspacePreferences>;
}

export type ResumeScopeKind = "workspace" | "project" | "all";

export interface ResumeScope {
	kind: ResumeScopeKind;
	/** Alias for `workspaceKey` or `projectKey`, depending on `kind`. */
	key?: string;
	projectKey?: string;
	workspaceKey?: string;
}

export type ResumeScopeInput = ResumeScopeKind | ResumeScope;

/** Parsed structured query: `project:`, `workspace:`, `branch:`, `status:`, `current:`, `fork:`, `pinned:`. */
export interface ResumeQuery {
	raw: string;
	/** Free-text terms (everything that is not a recognised structured token). */
	terms: string[];
	project: string[];
	workspace: string[];
	branch: string[];
	status: string[];
	current: boolean | null;
	fork: boolean | null;
	pinned: boolean | null;
}

export interface ResumeProjectRow {
	type: "project";
	key: string;
	project: ResumeProject;
	depth: 0;
	pinned: boolean;
	collapsed: boolean;
	conversationCount: number;
	totalConversationCount: number;
	workspaceCount: number;
	totalWorkspaceCount: number;
}

export interface ResumeWorkspaceRow {
	type: "workspace";
	key: string;
	workspace: ResumeWorkspace;
	projectKey: string;
	depth: 1;
	pinned: boolean;
	conversationCount: number;
	totalConversationCount: number;
}

export interface ResumeConversationRow {
	type: "conversation";
	key: string;
	conversation: ResumeConversation;
	projectKey: string;
	workspaceKey: string;
	depth: 2;
	pinned: boolean;
	current: boolean;
	/** Relevance score; 0 when the row is only visible because it is pinned. */
	score: number;
	/** True when a free-text search would have hidden this pinned row. */
	pinnedOnly: boolean;
}

export type ResumeViewRow = ResumeProjectRow | ResumeWorkspaceRow | ResumeConversationRow;

export interface ResumeViewCounts {
	/** Visible (post-query) counts. */
	conversations: number;
	workspaces: number;
	projects: number;
	pinnedConversations: number;
	/** Pre-query counts for the selected scope. */
	totalConversations: number;
	totalWorkspaces: number;
	totalProjects: number;
}

/** Pure renderer input: ordered rows plus the scope/query that produced it. */
export interface ResumeView {
	scope: ResumeScope;
	query: ResumeQuery;
	rows: ResumeViewRow[];
	conversations: ResumeConversationRow[];
	counts: ResumeViewCounts;
	/** Branch of the current session's workspace, when one is known. */
	referenceBranch?: string | null;
	/** Workspace key of the current session, when one is known. */
	currentWorkspaceKey?: string;
}

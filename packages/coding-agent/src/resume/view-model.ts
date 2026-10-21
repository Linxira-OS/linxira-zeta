/**
 * Pure resume-picker view model.
 *
 * Given the local directory ({@link buildResumeDirectory}), preferences and a
 * scope + query, produce the ordered rows renderers consume: project headers,
 * workspace headers and conversations, with visible and total counts. Both the
 * terminal picker and the serve/GUI side can call {@link buildResumeView}; the
 * function performs no I/O and keeps no state.
 */

import { sameResumePath } from "./paths";
import type {
	ResumeConversation,
	ResumeConversationRow,
	ResumeDirectory,
	ResumeProject,
	ResumeProjectRow,
	ResumeQuery,
	ResumeScope,
	ResumeScopeInput,
	ResumeView,
	ResumeViewCounts,
	ResumeViewRow,
	ResumeWorkspace,
	ResumeWorkspaceRow,
} from "./types";

const KNOWN_STATUSES: Record<string, true> = {
	complete: true,
	interrupted: true,
	aborted: true,
	error: true,
	pending: true,
	unknown: true,
};

const TOKEN_PATTERN = /(?:^|\s)(project|workspace|branch|status|current|fork|pinned):(?:"([^"]*)"|(\S+))/gi;

function parseBooleanToken(value: string): boolean | null {
	const normalized = value.toLowerCase();
	if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
	if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
	return null;
}

/**
 * Split a picker query into structured filters and free-text terms. Recognised
 * tokens (`project:`, `workspace:`, `branch:`, `status:`, `current:`, `fork:`,
 * `pinned:`) are removed from the free text; unrecognised `key:value` pairs
 * stay searchable text.
 */
export function parseResumeQuery(raw: string): ResumeQuery {
	const query: ResumeQuery = {
		raw,
		terms: [],
		project: [],
		workspace: [],
		branch: [],
		status: [],
		current: null,
		fork: null,
		pinned: null,
	};
	const textParts: string[] = [];
	let cursor = 0;
	for (const match of raw.matchAll(TOKEN_PATTERN)) {
		const [token, rawKey, quotedValue, bareValue] = match;
		const value = (quotedValue ?? bareValue ?? "").trim();
		if (!value || match.index === undefined) continue;
		const key = rawKey.toLowerCase();
		if (key === "status" && KNOWN_STATUSES[value.toLowerCase()] !== true) continue;
		if ((key === "current" || key === "fork" || key === "pinned") && parseBooleanToken(value) === null) continue;
		textParts.push(raw.slice(cursor, match.index));
		cursor = match.index + token.length;
		switch (key) {
			case "project":
				query.project.push(value);
				break;
			case "workspace":
				query.workspace.push(value);
				break;
			case "branch":
				query.branch.push(value);
				break;
			case "status":
				query.status.push(value.toLowerCase());
				break;
			case "current":
				query.current = parseBooleanToken(value);
				break;
			case "fork":
				query.fork = parseBooleanToken(value);
				break;
			case "pinned":
				query.pinned = parseBooleanToken(value);
				break;
		}
	}
	textParts.push(raw.slice(cursor));
	query.terms = textParts
		.join(" ")
		.toLowerCase()
		.split(/\s+/)
		.filter(term => term.length > 0);
	return query;
}

export function hasResumeQueryTokens(query: ResumeQuery): boolean {
	return (
		query.terms.length > 0 ||
		query.project.length > 0 ||
		query.workspace.length > 0 ||
		query.branch.length > 0 ||
		query.status.length > 0 ||
		query.current !== null ||
		query.fork !== null ||
		query.pinned !== null
	);
}

function includesToken(candidates: readonly (string | null | undefined)[], value: string): boolean {
	const needle = value.toLowerCase();
	return candidates.some(candidate => typeof candidate === "string" && candidate.toLowerCase().includes(needle));
}

function matchesGroupFilters(query: ResumeQuery, project: ResumeProject, workspace: ResumeWorkspace): boolean {
	if (
		query.project.length > 0 &&
		!query.project.every(value =>
			includesToken([project.name, project.alias, project.root, project.displayName], value),
		)
	) {
		return false;
	}
	if (
		query.workspace.length > 0 &&
		!query.workspace.every(value =>
			includesToken(
				[workspace.name, workspace.alias, workspace.displayName, workspace.path, workspace.branch],
				value,
			),
		)
	) {
		return false;
	}
	if (query.branch.length > 0 && !query.branch.every(value => includesToken([workspace.branch], value))) {
		return false;
	}
	return true;
}

function matchesConversationFilters(query: ResumeQuery, conversation: ResumeConversation, current: boolean): boolean {
	if (query.current !== null && current !== query.current) return false;
	if (query.fork !== null && conversation.fork !== query.fork) return false;
	if (query.pinned !== null && conversation.pinned !== query.pinned) return false;
	if (query.status.length > 0 && !query.status.includes((conversation.status ?? "unknown").toLowerCase())) {
		return false;
	}
	return true;
}

/** Field match strength: 3 = exact, 2 = prefix, 1 = substring, null = miss. */
function fieldMatch(value: string | undefined, term: string): number | null {
	if (!value) return null;
	const haystack = value.toLowerCase();
	const index = haystack.indexOf(term);
	if (index < 0) return null;
	if (index > 0) return 1;
	return haystack.length === term.length ? 3 : 2;
}

function conversationTermScore(
	conversation: ResumeConversation,
	project: ResumeProject,
	workspace: ResumeWorkspace,
	term: string,
): number | null {
	const fields: [string | undefined, number][] = [
		[conversation.session.title, 120],
		[conversation.title, 120],
		[conversation.session.firstMessage, 50],
		[conversation.session.allMessagesText, 15],
		[project.displayName, 40],
		[project.root, 10],
		[workspace.name, 30],
		[workspace.branch ?? undefined, 30],
		[workspace.path, 10],
	];
	let score = 0;
	let matched = false;
	for (const [value, weight] of fields) {
		const strength = fieldMatch(value, term);
		if (strength === null) continue;
		matched = true;
		score += weight * strength;
	}
	return matched ? score : null;
}

interface ConversationMatch {
	conversation: ResumeConversation;
	score: number;
	pinnedOnly: boolean;
}

function matchConversation(
	query: ResumeQuery,
	conversation: ResumeConversation,
	project: ResumeProject,
	workspace: ResumeWorkspace,
	current: boolean,
): ConversationMatch | null {
	if (!matchesGroupFilters(query, project, workspace)) return null;
	if (!matchesConversationFilters(query, conversation, current)) return null;
	if (query.terms.length === 0) {
		return { conversation, score: hasResumeQueryTokens(query) ? 1 : 0, pinnedOnly: false };
	}
	let score = 0;
	for (const term of query.terms) {
		const termScore = conversationTermScore(conversation, project, workspace, term);
		if (termScore === null) {
			// Pins are intentionally kept visible even when they do not match the
			// free-text query; explicit tokens above still filter them out.
			return conversation.pinned ? { conversation, score: 0, pinnedOnly: true } : null;
		}
		score += termScore;
	}
	return { conversation, score, pinnedOnly: false };
}

function sortConversationMatches(matches: ConversationMatch[], searching: boolean): ConversationMatch[] {
	return [...matches].sort((a, b) => {
		if (a.conversation.pinned !== b.conversation.pinned) return a.conversation.pinned ? -1 : 1;
		if (searching && a.score !== b.score) return b.score - a.score;
		return (
			b.conversation.modified.getTime() - a.conversation.modified.getTime() ||
			b.conversation.created.getTime() - a.conversation.created.getTime() ||
			a.conversation.id.localeCompare(b.conversation.id)
		);
	});
}

function sortWithActivity<T extends { pinned: boolean; lastActivity: Date | null }>(
	values: readonly T[],
	nameOf: (value: T) => string,
): T[] {
	return [...values].sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		const aActivity = a.lastActivity?.getTime() ?? Number.NEGATIVE_INFINITY;
		const bActivity = b.lastActivity?.getTime() ?? Number.NEGATIVE_INFINITY;
		if (aActivity !== bActivity) return bActivity - aActivity;
		return nameOf(a).localeCompare(nameOf(b));
	});
}

/**
 * Resolve the effective scope. A workspace/project scope without an explicit
 * key follows the current conversation, then the seeded default workspace.
 */
export function resolveResumeScope(
	directory: ResumeDirectory,
	input: ResumeScopeInput | undefined,
	currentSessionPath?: string,
): ResumeScope {
	const kind = typeof input === "string" ? input : (input?.kind ?? "workspace");
	const explicitWorkspaceKey =
		typeof input === "object" ? (input.workspaceKey ?? (kind === "workspace" ? input.key : undefined)) : undefined;
	const explicitProjectKey =
		typeof input === "object" ? (input.projectKey ?? (kind === "project" ? input.key : undefined)) : undefined;
	const current = currentSessionPath
		? directory.conversations.find(conversation => sameResumePath(conversation.path, currentSessionPath))
		: undefined;
	if (kind === "all") return { kind };
	if (kind === "workspace") {
		const workspaceKey = explicitWorkspaceKey ?? current?.workspaceKey ?? directory.defaultWorkspaceKey;
		const workspace = directory.workspaces.find(candidate => candidate.key === workspaceKey);
		return { kind, workspaceKey, projectKey: workspace?.projectKey };
	}
	const projectKey = explicitProjectKey ?? current?.projectKey ?? directory.defaultProjectKey;
	return { kind, projectKey };
}

export interface BuildResumeViewOptions {
	scope?: ResumeScopeInput;
	query?: string | ResumeQuery;
	currentSessionPath?: string;
}

interface WorkspaceMatches {
	workspace: ResumeWorkspace;
	matches: ConversationMatch[];
}

interface ProjectMatches {
	project: ResumeProject;
	workspaces: WorkspaceMatches[];
	matches: ConversationMatch[];
	pinned: boolean;
}

function prepareProject(project: ResumeProject, query: ResumeQuery, currentSessionPath?: string): ProjectMatches {
	const workspaces: WorkspaceMatches[] = [];
	const allMatches: ConversationMatch[] = [];
	const includeEmpty = !hasResumeQueryTokens(query);
	for (const workspace of project.workspaces) {
		const matches: ConversationMatch[] = [];
		for (const conversation of workspace.conversations) {
			const current = currentSessionPath
				? sameResumePath(conversation.path, currentSessionPath)
				: conversation.current;
			const match = matchConversation(query, conversation, project, workspace, current);
			if (match) matches.push(match);
		}
		if (matches.length === 0 && !includeEmpty) continue;
		const sorted = sortConversationMatches(matches, query.terms.length > 0);
		workspaces.push({ workspace, matches: sorted });
		allMatches.push(...sorted);
	}
	return {
		project,
		workspaces,
		matches: sortConversationMatches(allMatches, query.terms.length > 0),
		pinned: project.pinned,
	};
}

function toConversationRow(
	match: ConversationMatch,
	projectKey: string,
	workspaceKey: string,
	current: boolean,
): ResumeConversationRow {
	return {
		type: "conversation",
		key: match.conversation.key,
		conversation: match.conversation,
		projectKey,
		workspaceKey,
		depth: 2,
		pinned: match.conversation.pinned,
		current,
		score: match.score,
		pinnedOnly: match.pinnedOnly,
	};
}

function projectRow(projectMatches: ProjectMatches, collapsed: boolean): ResumeProjectRow {
	return {
		type: "project",
		key: projectMatches.project.key,
		project: projectMatches.project,
		depth: 0,
		pinned: projectMatches.project.pinned,
		collapsed,
		conversationCount: projectMatches.matches.length,
		totalConversationCount: projectMatches.project.counts.conversations,
		workspaceCount: projectMatches.workspaces.length,
		totalWorkspaceCount: projectMatches.project.counts.workspaces,
	};
}

function workspaceRow(workspaceMatches: WorkspaceMatches, projectKey: string): ResumeWorkspaceRow {
	return {
		type: "workspace",
		key: workspaceMatches.workspace.key,
		workspace: workspaceMatches.workspace,
		projectKey,
		depth: 1,
		pinned: workspaceMatches.workspace.pinned,
		conversationCount: workspaceMatches.matches.length,
		totalConversationCount: workspaceMatches.workspace.counts.conversations,
	};
}

/**
 * Build the ordered rows for one scope. Group headers carry both visible and
 * total counts; conversations are pinned-first, then search relevance (when
 * searching), then recency. A free-text search expands collapsed projects and
 * keeps pinned conversations visible.
 */
export function buildResumeView(directory: ResumeDirectory, options: BuildResumeViewOptions = {}): ResumeView {
	const query = typeof options.query === "object" ? options.query : parseResumeQuery(options.query ?? "");
	const scope = resolveResumeScope(directory, options.scope, options.currentSessionPath);
	const searching = hasResumeQueryTokens(query);
	const currentOf = (conversation: ResumeConversation) =>
		options.currentSessionPath ? sameResumePath(conversation.path, options.currentSessionPath) : conversation.current;
	const rows: ResumeViewRow[] = [];
	let pinnedConversations = 0;
	let totalConversations = 0;
	let totalWorkspaces = 0;
	let totalProjects = 0;
	let visibleWorkspaces = 0;
	let visibleProjects = 0;

	const pushWorkspace = (workspaceMatches: WorkspaceMatches, projectKey: string) => {
		rows.push(workspaceRow(workspaceMatches, projectKey));
		for (const match of workspaceMatches.matches) {
			rows.push(toConversationRow(match, projectKey, workspaceMatches.workspace.key, currentOf(match.conversation)));
		}
	};
	const countMatches = (projectMatches: ProjectMatches) => {
		for (const workspaceMatches of projectMatches.workspaces) {
			for (const match of workspaceMatches.matches) {
				if (match.conversation.pinned) pinnedConversations += 1;
			}
		}
	};

	if (scope.kind === "workspace") {
		const project = directory.projects.find(candidate => candidate.key === scope.projectKey);
		const workspace = project?.workspaces.find(candidate => candidate.key === scope.workspaceKey);
		if (project && workspace) {
			const projectMatches = prepareProject(
				{ ...project, workspaces: [workspace] },
				query,
				options.currentSessionPath,
			);
			totalConversations = workspace.counts.conversations;
			totalWorkspaces = 1;
			totalProjects = 1;
			visibleWorkspaces = 1;
			visibleProjects = 1;
			countMatches(projectMatches);
			for (const workspaceMatches of projectMatches.workspaces) {
				for (const match of workspaceMatches.matches) {
					rows.push(toConversationRow(match, project.key, workspace.key, currentOf(match.conversation)));
				}
			}
		}
	} else if (scope.kind === "project") {
		const project = directory.projects.find(candidate => candidate.key === scope.projectKey);
		if (project) {
			totalConversations = project.counts.conversations;
			totalWorkspaces = project.counts.workspaces;
			totalProjects = 1;
			const projectMatches = prepareProject(project, query, options.currentSessionPath);
			visibleProjects = 1;
			visibleWorkspaces = projectMatches.workspaces.length;
			countMatches(projectMatches);
			const sortedWorkspaces = sortWithActivity(
				projectMatches.workspaces.map(workspaceMatches => {
					const workspace = workspaceMatches.workspace;
					return {
						...workspaceMatches,
						pinned: workspace.pinned || workspaceMatches.matches.some(match => match.conversation.pinned),
						lastActivity: workspace.lastActivity,
					};
				}),
				value => value.workspace.name,
			);
			for (const workspaceMatches of sortedWorkspaces) pushWorkspace(workspaceMatches, project.key);
		}
	} else {
		totalConversations = directory.counts.conversations;
		totalWorkspaces = directory.counts.workspaces;
		totalProjects = directory.counts.projects;
		const prepared: ProjectMatches[] = [];
		for (const project of directory.projects) {
			const projectMatches = prepareProject(project, query, options.currentSessionPath);
			const visible = !searching || projectMatches.matches.length > 0 || project.pinned;
			if (!visible) continue;
			prepared.push(projectMatches);
		}
		const sorted = [...prepared].sort((a, b) => {
			if (a.project.isDefault !== b.project.isDefault) return a.project.isDefault ? -1 : 1;
			if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
			const aActivity = a.project.lastActivity?.getTime() ?? Number.NEGATIVE_INFINITY;
			const bActivity = b.project.lastActivity?.getTime() ?? Number.NEGATIVE_INFINITY;
			if (aActivity !== bActivity) return bActivity - aActivity;
			return (
				a.project.displayName.localeCompare(b.project.displayName) || a.project.key.localeCompare(b.project.key)
			);
		});
		for (const projectMatches of sorted) {
			countMatches(projectMatches);
			const collapsed = projectMatches.project.collapsed && !searching;
			rows.push(projectRow(projectMatches, collapsed));
			if (collapsed) continue;
			const visibleWorkspaces = sortWithActivity(
				projectMatches.workspaces.map(workspaceMatches => ({
					...workspaceMatches,
					pinned:
						workspaceMatches.workspace.pinned ||
						workspaceMatches.matches.some(match => match.conversation.pinned),
					lastActivity: workspaceMatches.workspace.lastActivity,
				})),
				value => value.workspace.name,
			);
			for (const workspaceMatches of visibleWorkspaces) {
				pushWorkspace(workspaceMatches, projectMatches.project.key);
			}
		}
	}

	const conversationRows = rows.filter((row): row is ResumeConversationRow => row.type === "conversation");
	const counts: ResumeViewCounts = {
		conversations: conversationRows.length,
		workspaces: scope.kind === "all" ? rows.filter(row => row.type === "workspace").length : visibleWorkspaces,
		projects: scope.kind === "all" ? rows.filter(row => row.type === "project").length : visibleProjects,
		pinnedConversations,
		totalConversations,
		totalWorkspaces,
		totalProjects,
	};
	const currentConversation = directory.conversations.find(conversation =>
		options.currentSessionPath ? sameResumePath(conversation.path, options.currentSessionPath) : conversation.current,
	);
	const currentWorkspace = currentConversation
		? directory.workspaces.find(workspace => workspace.key === currentConversation.workspaceKey)
		: undefined;
	return {
		scope,
		query,
		rows,
		conversations: conversationRows,
		counts,
		referenceBranch: currentWorkspace?.branch ?? null,
		...(currentWorkspace ? { currentWorkspaceKey: currentWorkspace.key } : {}),
	};
}

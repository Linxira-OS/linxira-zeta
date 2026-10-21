/**
 * Local resume directory builder: project → workspace → conversation.
 *
 * Inputs are session files already scanned from disk (`SessionManager` picker
 * listings), the persisted project registry/preferences and git metadata for
 * each cwd. Nothing here talks to the HTTP gateway, so `zetacode` in a plain
 * terminal keeps a complete picker with no backend running. The web gateway
 * may call {@link loadResumeDirectory} later; it does not own this data.
 */

import * as path from "node:path";

import type { SessionInfo } from "../session/session-listing";
import { sessionDisplayName } from "../session/session-listing";
import { loadPinnedSessionIds } from "../session/session-pins";
import { SessionManager } from "../session/session-manager";
import type { SessionStorage } from "../session/session-storage";
import { defaultCoordinatorWorkspace } from "../default-workspace";
import { resolveProject, type ProjectInfo } from "../server/web-gateway/projects";
import { resumePathKey, sameResumePath } from "./paths";
import { loadResumePreferences, type LoadResumePreferencesOptions } from "./preferences";
import type {
	ResumeConversation,
	ResumeDirectory,
	ResumeDirectoryCounts,
	ResumePreferences,
	ResumeProject,
	ResumeWorkspace,
} from "./types";

export type ResumeProjectResolver = (cwd: string) => Promise<ProjectInfo> | ProjectInfo;

export interface BuildResumeDirectoryOptions {
	/** Picker-facing sessions (already empty-filtered by the caller/loader). */
	sessions: readonly SessionInfo[];
	preferences?: ResumePreferences;
	pinnedIds?: ReadonlySet<string>;
	/** Default workspace anchor; defaults to `defaultCoordinatorWorkspace()`. */
	defaultWorkspace?: string;
	/** Session file of the running conversation, marked `current`. */
	currentSessionPath?: string;
	/** Injectable git resolver (tests, alternate environments). */
	resolveProject?: ResumeProjectResolver;
	/** Additional project roots to keep listed with zero conversations. */
	registeredProjects?: readonly string[];
	/**
	 * Drop subagent sessions before grouping, so counts and every picker view
	 * describe main-agent conversations only. Defaults to false for callers
	 * that need the raw classified model.
	 */
	filterSubagents?: boolean;
}

function missingProjectInfo(cwd: string): ProjectInfo {
	return { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
}

function projectName(root: string): string {
	return path.basename(root) || root;
}

function activityTime(value: Date | null): number {
	return value ? value.getTime() : Number.NEGATIVE_INFINITY;
}

/** Pinned first, then most recently modified, then most recently created. */
export function compareResumeConversations(a: ResumeConversation, b: ResumeConversation): number {
	if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
	const modified = b.modified.getTime() - a.modified.getTime();
	if (modified !== 0) return modified;
	const created = b.created.getTime() - a.created.getTime();
	if (created !== 0) return created;
	return a.id.localeCompare(b.id);
}

interface ProjectBucket {
	project: ResumeProject;
	workspaces: Map<string, ResumeWorkspace>;
}

function createProject(key: string, root: string, isDefault: boolean, preferences: ResumePreferences): ProjectBucket {
	const preference = preferences.projects[key] ?? {};
	const alias = preference.alias?.trim() || null;
	const name = projectName(root);
	return {
		project: {
			key,
			root,
			name,
			alias,
			displayName: alias ?? name,
			isDefault,
			// The seeded default project is pinned regardless of stored state.
			pinned: isDefault || preference.pinned === true,
			removable: !isDefault,
			collapsed: preference.collapsed === true,
			lastActivity: null,
			workspaces: [],
			conversations: [],
			counts: { conversations: 0, workspaces: 0, pinnedConversations: 0 },
		},
		workspaces: new Map(),
	};
}

function createWorkspace(
	key: string,
	directory: string,
	projectKey: string,
	info: ProjectInfo,
	preferences: ResumePreferences,
): ResumeWorkspace {
	const preference = preferences.workspaces?.[key] ?? {};
	const alias = preference.alias?.trim() || null;
	const name = projectName(directory);
	return {
		key,
		path: directory,
		name,
		alias,
		displayName: alias ?? name,
		projectKey,
		branch: info.branch,
		isWorktree: info.isWorktree,
		pinned: preference.pinned === true,
		lastActivity: null,
		conversations: [],
		counts: { conversations: 0, pinnedConversations: 0 },
	};
}

function sortWorkspaces(workspaces: ResumeWorkspace[]): ResumeWorkspace[] {
	return [...workspaces].sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		const activity = activityTime(b.lastActivity) - activityTime(a.lastActivity);
		if (activity !== 0) return activity;
		return a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
	});
}

function sortProjects(projects: ResumeProject[]): ResumeProject[] {
	return [...projects].sort((a, b) => {
		if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		const activity = activityTime(b.lastActivity) - activityTime(a.lastActivity);
		if (activity !== 0) return activity;
		return a.displayName.localeCompare(b.displayName) || a.key.localeCompare(b.key);
	});
}

function latestActivity(conversations: readonly ResumeConversation[]): Date | null {
	let latest: Date | null = null;
	for (const conversation of conversations) {
		if (!latest || conversation.modified.getTime() > latest.getTime()) latest = conversation.modified;
	}
	return latest;
}

function countPinned(conversations: readonly ResumeConversation[]): number {
	let count = 0;
	for (const conversation of conversations) if (conversation.pinned) count += 1;
	return count;
}

/**
 * Resolve each conversation's parent reference (a session path or id) to the
 * parent conversation's key and collect subagent children under their parent.
 * A reference outside the directory still yields a stable key, so a subagent
 * whose parent was deleted is not silently re-parented.
 */
function linkConversationParents(conversations: readonly ResumeConversation[]): void {
	const byId = new Map<string, ResumeConversation>();
	const byPath = new Map<string, ResumeConversation>();
	for (const conversation of conversations) {
		byId.set(conversation.id, conversation);
		byPath.set(resumePathKey(conversation.path), conversation);
	}
	for (const conversation of conversations) {
		const reference = conversation.session.parentSessionPath;
		if (!reference) continue;
		const parent = byPath.get(resumePathKey(reference)) ?? byId.get(reference);
		conversation.parentKey = parent?.key ?? resumePathKey(reference);
		if (parent && conversation.isSubagent) parent.subagents.push(conversation);
	}
	for (const conversation of conversations) {
		if (conversation.subagents.length > 1) conversation.subagents.sort(compareResumeConversations);
	}
}

/**
 * Append each duplicated project's parent folder to its display name, so two
 * checkouts both named `zeta` are distinguishable without changing identity.
 */
function disambiguateProjectNames(projects: readonly ResumeProject[]): void {
	const counts = new Map<string, number>();
	for (const project of projects) counts.set(project.name, (counts.get(project.name) ?? 0) + 1);
	if (![...counts.values()].some(count => count > 1)) return;
	const used = new Set(projects.map(project => project.displayName));
	for (const project of projects) {
		// Every same-named project gets the tag; none keeps the bare name.
		if ((counts.get(project.name) ?? 0) < 2) continue;
		const normalized = project.root.replace(/[\\/]+$/, "");
		const parent = path.basename(path.dirname(normalized));
		if (!parent) continue;
		let candidate = `${project.displayName} (${parent})`;
		for (let suffix = 2; used.has(candidate); suffix++) candidate = `${project.displayName} (${parent} ${suffix})`;
		used.add(candidate);
		project.displayName = candidate;
	}
}

/**
 * Build the complete directory. Pure with respect to the injected resolver and
 * inputs: no filesystem reads beyond git metadata discovery.
 */
export async function buildResumeDirectory(options: BuildResumeDirectoryOptions): Promise<ResumeDirectory> {
	const preferences = options.preferences ?? { version: 1, projects: {} };
	const pinnedIds = options.pinnedIds ?? new Set<string>();
	const defaultWorkspace = options.defaultWorkspace ?? defaultCoordinatorWorkspace();
	const defaultWorkspaceKey = resumePathKey(defaultWorkspace);
	const resolver = options.resolveProject ?? resolveProject;
	const sessions = options.filterSubagents
		? options.sessions.filter(session => !(session.parentSessionPath && session.agent?.trim()))
		: options.sessions;

	const cwds = new Set<string>([defaultWorkspace]);
	for (const projectRoot of options.registeredProjects ?? []) {
		if (projectRoot) cwds.add(projectRoot);
	}
	for (const session of sessions) {
		if (session.cwd) cwds.add(session.cwd);
	}

	const projectInfoByCwd = new Map<string, ProjectInfo>();
	await Promise.all(
		[...cwds].map(async cwd => {
			try {
				projectInfoByCwd.set(cwd, await resolver(cwd));
			} catch {
				projectInfoByCwd.set(cwd, missingProjectInfo(cwd));
			}
		}),
	);

	const infoFor = (cwd: string): ProjectInfo => projectInfoByCwd.get(cwd) ?? missingProjectInfo(cwd);
	const defaultProjectRoot = infoFor(defaultWorkspace).projectRoot || defaultWorkspace;
	const defaultProjectKey = resumePathKey(defaultProjectRoot);

	const buckets = new Map<string, ProjectBucket>();
	const ensureProject = (root: string): ProjectBucket => {
		const key = resumePathKey(root);
		let bucket = buckets.get(key);
		if (!bucket) {
			bucket = createProject(key, root, key === defaultProjectKey, preferences);
			buckets.set(key, bucket);
		}
		return bucket;
	};
	const ensureWorkspace = (bucket: ProjectBucket, directory: string): ResumeWorkspace => {
		const key = resumePathKey(directory);
		let workspace = bucket.workspaces.get(key);
		if (!workspace) {
			workspace = createWorkspace(key, directory, bucket.project.key, infoFor(directory), preferences);
			bucket.workspaces.set(key, workspace);
		}
		return workspace;
	};

	// Registry entries and the default workspace stay listed even with no
	// conversations. Preference keys are canonicalized by the store on load.
	for (const key of Object.keys(preferences.projects)) {
		ensureProject(key);
	}
	for (const projectRoot of options.registeredProjects ?? []) {
		if (projectRoot) ensureProject(projectRoot);
	}
	const defaultBucket = ensureProject(defaultProjectRoot);
	ensureWorkspace(defaultBucket, defaultWorkspace);

	for (const session of sessions) {
		const cwd = session.cwd || defaultWorkspace;
		const info = infoFor(cwd);
		const projectRoot = info.projectRoot || cwd;
		const bucket = ensureProject(projectRoot);
		const workspace = ensureWorkspace(bucket, cwd);
		const agentName = session.agent?.trim() || undefined;
		const hasParent = Boolean(session.parentSessionPath);
		const conversation: ResumeConversation = {
			session,
			key: session.id || resumePathKey(session.path),
			id: session.id,
			path: session.path,
			title: sessionDisplayName(session),
			cwd,
			projectKey: bucket.project.key,
			workspaceKey: workspace.key,
			created: session.created,
			modified: session.modified,
			status: session.status,
			pinned: pinnedIds.has(session.id),
			current: sameResumePath(session.path, options.currentSessionPath),
			// A subagent carries both a parent and the agent marker; a user fork
			// carries the parent alone and must stay a `fork`.
			isSubagent: hasParent && agentName !== undefined,
			...(agentName ? { agentName } : {}),
			fork: hasParent && agentName === undefined,
			subagents: [],
			messageCount: session.messageCount,
		};
		workspace.conversations.push(conversation);
		bucket.project.conversations.push(conversation);
	}

	const projects: ResumeProject[] = [];
	const workspaces: ResumeWorkspace[] = [];
	const conversations: ResumeConversation[] = [];
	for (const bucket of buckets.values()) {
		const project = bucket.project;
		for (const workspace of bucket.workspaces.values()) {
			workspace.conversations.sort(compareResumeConversations);
			workspace.pinned =
				preferences.workspaces?.[workspace.key]?.pinned === true ||
				workspace.conversations.some(conversation => conversation.pinned);
			workspace.lastActivity = latestActivity(workspace.conversations);
			workspace.counts = {
				conversations: workspace.conversations.length,
				pinnedConversations: countPinned(workspace.conversations),
			};
			workspaces.push(workspace);
		}
		project.conversations.sort(compareResumeConversations);
		project.workspaces = sortWorkspaces([...bucket.workspaces.values()]);
		project.lastActivity = latestActivity(project.conversations);
		project.counts = {
			conversations: project.conversations.length,
			workspaces: project.workspaces.length,
			pinnedConversations: countPinned(project.conversations),
		};
		projects.push(project);
		conversations.push(...project.conversations);
	}

	linkConversationParents(conversations);

	const sortedProjects = sortProjects(projects);
	disambiguateProjectNames(sortedProjects);
	return {
		projects: sortedProjects,
		workspaces: sortedProjects.flatMap(project => project.workspaces),
		conversations: sortedProjects.flatMap(project => project.conversations),
		defaultProjectKey,
		defaultWorkspaceKey,
		counts: {
			projects: sortedProjects.length,
			workspaces: sortedProjects.reduce((total, project) => total + project.workspaces.length, 0),
			conversations: conversations.length,
			pinnedConversations: countPinned(conversations),
		} satisfies ResumeDirectoryCounts,
	};
}

export interface LoadResumeDirectoryOptions extends Omit<BuildResumeDirectoryOptions, "sessions"> {
	/** Explicit session list; otherwise `SessionManager.listAllForPicker`. */
	sessions?: readonly SessionInfo[];
	/** Sessions root to scan when `sessions` is absent; defaults to the agent sessions dir. */
	sessionsRoot?: string;
	storage?: SessionStorage;
	/** Agent/config dir override for pins and preferences (tests, profiles). */
	agentDir?: string;
	preferences?: ResumePreferences;
	pinnedIds?: ReadonlySet<string>;
	preferencesOptions?: LoadResumePreferencesOptions;
}

/**
 * Load everything the resume picker needs from disk: cross-project
 * conversations, session pins and project preferences.
 */
export async function loadResumeDirectory(options: LoadResumeDirectoryOptions = {}): Promise<ResumeDirectory> {
	const [sessions, pinnedIds, preferences] = await Promise.all([
		options.sessions ?? SessionManager.listAllForPicker(options.storage, options.sessionsRoot),
		options.pinnedIds ?? loadPinnedSessionIds(options.agentDir),
		options.preferences ?? loadResumePreferences(options.agentDir, options.preferencesOptions),
	]);
	return buildResumeDirectory({ ...options, sessions, pinnedIds, preferences });
}

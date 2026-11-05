/**
 * Studio surface — shared view model.
 *
 * The Studio shell renders from these shapes, never from gateway DTOs directly
 * and never from `@omp-studio/*` types. Two rules keep it honest:
 *
 * 1. **No fixtures.** Every field here is produced by a live Zeta endpoint
 *    (`/api/projects`, `/api/sessions`, `/api/agent/*`, `/api/git/*`, …). A
 *    surface whose data has no endpoint is not rendered.
 * 2. **No protocol.** These are plain values. The transport stays `fetch` +
 *    Server-Sent Events through the existing hooks (`useAgentSession`,
 *    `session-api`, `agent-client`).
 *
 * Product vocabulary (see the migration plan §3):
 *   project   → a directory registered in `~/.zeta/agent/resume-projects.json`
 *   workspace → a branch/worktree checkout under a project
 *   session   → one agent conversation
 */

/** Where the shell is rendered. `panel` is the in-IDE docked surface on `/panel`. */
export type StudioMode = "app" | "panel";

/** Top-level product routes. `workbench` is the conversation surface. */
export type StudioRoute =
	| "workbench"
	| "skills"
	| "models"
	| "agents"
	| "git"
	| "usage"
	| "settings";

export const STUDIO_ROUTES: readonly StudioRoute[] = [
	"workbench",
	"skills",
	"models",
	"agents",
	"git",
	"usage",
	"settings",
];

/** Wordmark / icon pair used by the titlebar; brand-check owns the strings. */
export interface StudioProjectSummary {
	/** Canonical project identity (case-normalized on Windows) — usable as `cwd`. */
	path: string;
	key: string;
	/** Directory basename. */
	name: string;
	alias: string | null;
	/** `alias ?? name`; what the sidebar prints. */
	displayName: string;
	/** The seeded default workspace project: pinned and never removable. */
	isDefault: boolean;
	pinned: boolean;
	removable: boolean;
	collapsed: boolean;
	/** ISO timestamp of the most recent conversation activity, or null. */
	lastActivity: string | null;
	counts: {
		conversations: number;
		workspaces: number;
		pinnedConversations: number;
	};
	workspaces: StudioWorkspaceSummary[];
}

/** A checkout under a project: the main clone or one of its worktrees. */
export interface StudioWorkspaceSummary {
	path: string;
	key: string;
	name: string;
	alias: string | null;
	displayName: string;
	/** Checked-out branch when the checkout is a git worktree. */
	branch: string | null;
	isWorktree: boolean;
	pinned: boolean;
	lastActivity: string | null;
	counts: {
		conversations: number;
		pinnedConversations: number;
	};
}

/** `GET /api/projects` — the whole project list, replaced wholesale on refresh. */
export interface StudioProjectsResponse {
	projects: StudioProjectSummary[];
	defaultProjectKey: string;
	defaultWorkspaceKey: string;
	counts: {
		projects: number;
		workspaces: number;
		conversations: number;
		pinnedConversations: number;
	};
}

/** `PUT /api/projects` body. An absent field is left untouched; a null alias clears it. */
export interface StudioProjectPatch {
	path: string;
	alias?: string | null;
	pinned?: boolean;
	collapsed?: boolean;
	/** `false` drops the project from the registry (its sessions are untouched). */
	registered?: boolean;
}

/** One conversation row in the sidebar. */
export interface StudioSessionSummary {
	id: string;
	/** Absolute path to the session file; the stable identity across renames. */
	path: string;
	title: string;
	cwd: string;
	created: string;
	modified: string;
	messageCount: number;
	/** Live run state, from `/api/agent/running` and the events stream. */
	running: boolean;
	/** Resolved project/workspace keys so the sidebar can group without re-resolving. */
	projectKey: string | null;
	workspaceKey: string | null;
}

/**
 * What the platform can do. One object, filled from `window.piDesktop` when the
 * desktop shell hosts the page, and from the browser fallback otherwise
 * (`lib/pi-desktop.ts`). Feature code branches on these booleans, never on
 * `navigator.userAgent` and never on a second platform store.
 */
export interface PlatformCapabilities {
	/** True when the page runs inside the native desktop shell. */
	desktop: boolean;
	/** Native window controls (minimize/maximize/close) are wired. */
	windowControls: boolean;
	/** A native directory picker is available; otherwise use the HTTP picker. */
	nativeDirectoryPicker: boolean;
	/** The shell can reveal a path in the OS file manager. */
	revealInFileManager: boolean;
	/** Opening a URL in the user's browser is supported. */
	openExternal: boolean;
	/** `process.platform`-style string, e.g. "win32" | "linux" | "darwin". */
	platform: "win32" | "linux" | "darwin" | "other";
	/** The native shell draws its own titlebar, so the page must not. */
	nativeTitlebar: boolean;
}

/** Aggregate the shell passes down; feature pages receive it as one prop. */
export interface StudioViewState {
	route: StudioRoute;
	mode: StudioMode;
	projects: StudioProjectSummary[];
	/** Selected project key, or null before the first run picks one. */
	projectKey: string | null;
	/** Selected workspace path, or null (falls back to the project root). */
	workspacePath: string | null;
	sessions: StudioSessionSummary[];
	activeSessionId: string | null;
	capabilities: PlatformCapabilities;
}

/** Navigation and mutation callbacks the shell owns. */
export interface StudioActions {
	go(route: StudioRoute): void;
	openProject(path: string): Promise<void>;
	registerProject(path: string): Promise<void>;
	removeProject(path: string): Promise<void>;
	selectProject(key: string): void;
	selectWorkspace(path: string): void;
	openSession(id: string): void;
	startSession(workspacePath: string | null): Promise<void>;
	refreshProjects(): Promise<void>;
}

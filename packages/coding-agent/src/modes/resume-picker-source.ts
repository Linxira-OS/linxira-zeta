/**
 * Live data source for the ANSI resume tree (`/resume` in the editor and
 * `zetacode --resume`).
 *
 * The TUI owns presentation; this bridge loads the local resume directory,
 * projects it through `buildResumeView`, persists pin/scope choices and
 * performs the confirmed delete. Directory loading is deliberately lazy so the
 * picker paints its scope control and skeleton immediately: the overlay opens
 * first, then `load()` fills the rows.
 */

import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, isEnoent, logger } from "@linxiraos/pi-utils";
import { getSessionsDir } from "@linxiraos/pi-utils/dirs";
import type {
	ResumeTreeConversation,
	ResumeTreeDeleteMode,
	ResumeTreePickerState,
	ResumeTreeProject,
	ResumeTreeScope,
	ResumeTreeScopeSummary,
	ResumeTreeSource,
	ResumeTreeView,
} from "@linxiraos/pi-tui/overlays/resume-tree";

import {
	buildResumeView,
	loadResumeDirectory,
	resolveResumeScope,
	type ResumeDirectory,
	type ResumeScopeKind,
	type ResumeSubagentsMode,
} from "../resume";
import type { ResumeSourceLike } from "@linxiraos/pi-tui/overlays/resume-picker";
import { toggleProjectPin } from "../resume/preferences";
import type { SessionStorage } from "../session/session-storage";
import { toggleSessionPin } from "../session/session-pins";
import { replaceFileAtomically } from "../utils/atomic-file";

/**
 * Picker state carries an explicit schema version. The old
 * `resume-picker-state.json` shape is deliberately never read or migrated: a
 * stale file is ignored and the next write creates this one.
 */
export const RESUME_PICKER_STATE_FILENAME = "resume-picker-state.v2.json";
export const RESUME_PICKER_STATE_VERSION = 2;

function resumePickerStatePath(agentDir: string = getAgentDir()): string {
	return path.join(agentDir, RESUME_PICKER_STATE_FILENAME);
}

function isScope(value: unknown): value is ResumeTreeScope {
	return value === "workspace" || value === "project" || value === "all";
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

const EMPTY_PICKER_STATE: ResumeTreePickerState = { scope: "workspace" };

/**
 * Read the v2 picker state. Missing, unreadable, wrong-version or corrupt
 * files all fall back to the default (workspace scope, nothing expanded); the
 * legacy file is not consulted.
 */
export async function loadResumePickerState(agentDir: string = getAgentDir()): Promise<ResumeTreePickerState> {
	try {
		const parsed: unknown = JSON.parse(await fs.readFile(resumePickerStatePath(agentDir), "utf-8"));
		if (typeof parsed !== "object" || parsed === null) return { ...EMPTY_PICKER_STATE };
		const record = parsed as Record<string, unknown>;
		if (record.version !== RESUME_PICKER_STATE_VERSION) return { ...EMPTY_PICKER_STATE };
		return {
			scope: isScope(record.scope) ? record.scope : "workspace",
			collapsedProjects: stringList(record.collapsedProjects),
			expandedProjects: stringList(record.expandedProjects),
			collapsedWorkspaces: stringList(record.collapsedWorkspaces),
			expandedSubagents: stringList(record.expandedSubagents),
		};
	} catch (error) {
		if (!isEnoent(error)) logger.warn("Failed to read resume picker state", { error });
		return { ...EMPTY_PICKER_STATE };
	}
}

/** The last scope chosen in any picker; a missing/corrupt file means workspace. */
export async function loadResumePickerScope(agentDir: string = getAgentDir()): Promise<ResumeTreeScope> {
	return (await loadResumePickerState(agentDir)).scope;
}

/** Persist the picker state atomically so both pickers remember it across opens. */
export async function saveResumePickerState(
	state: ResumeTreePickerState,
	agentDir: string = getAgentDir(),
): Promise<void> {
	const filePath = resumePickerStatePath(agentDir);
	const temporaryPath = `${filePath}.${process.pid}.tmp`;
	await fs.mkdir(agentDir, { recursive: true });
	const payload = {
		version: RESUME_PICKER_STATE_VERSION,
		scope: state.scope,
		collapsedProjects: [...(state.collapsedProjects ?? [])],
		expandedProjects: [...(state.expandedProjects ?? [])],
		collapsedWorkspaces: [...(state.collapsedWorkspaces ?? [])],
		expandedSubagents: [...(state.expandedSubagents ?? [])],
	};
	try {
		await fs.writeFile(temporaryPath, JSON.stringify(payload, null, "\t"), { encoding: "utf-8", mode: 0o600 });
		await replaceFileAtomically(temporaryPath, filePath);
	} catch (error) {
		await fs.rm(temporaryPath, { force: true }).catch(() => {});
		throw error;
	}
}

/** Persist only the scope, keeping the other state fields at their defaults. */
export async function saveResumePickerScope(scope: ResumeTreeScope, agentDir: string = getAgentDir()): Promise<void> {
	await saveResumePickerState({ scope }, agentDir);
}

/**
 * Read the session buckets the listing layer scans, reporting directories it
 * cannot enter. `listAllSessions` swallows those failures and returns the rows
 * it managed to read; the picker shows this banner so a partial listing is
 * never mistaken for an empty history.
 */
async function unreadableSessionDirs(sessionsRoot: string): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(sessionsRoot, { withFileTypes: true });
	} catch {
		return [path.basename(sessionsRoot) || sessionsRoot];
	}
	const failed: string[] = [];
	await Promise.all(
		entries
			.filter(entry => entry.isDirectory())
			.map(async entry => {
				try {
					await fs.readdir(path.join(sessionsRoot, entry.name));
				} catch {
					failed.push(entry.name);
				}
			}),
	);
	return failed.sort((a, b) => a.localeCompare(b));
}

export interface LiveResumePickerSourceOptions {
	initialScope: ResumeTreeScope;
	/** Full v2 picker state (scope + expansion); wins over `initialScope`. */
	initialState?: ResumeTreePickerState;
	currentSessionPath?: () => string | undefined;
	/** The checkout "this workspace" means; defaults to the coordinator workspace. */
	workspacePath?: string;
	/** Confirmed delete action; wording comes from `deleteMode`. */
	deleteConversation: (conversation: ResumeTreeConversation) => Promise<boolean>;
	/** `trash` for the in-session picker, `permanent` for `--resume`. */
	deleteMode: ResumeTreeDeleteMode;
	/** `resume.subagents`; grouped when omitted. */
	subagents?: ResumeSubagentsMode;
	storage?: SessionStorage;
	agentDir?: string;
}

/** Host bridge shared with the native renderer: `directory` + `buildView`. */
export class LiveResumePickerSource implements ResumeTreeSource, ResumeSourceLike {
	initialScope: ResumeTreeScope;
	readonly deleteMode: ResumeTreeDeleteMode;
	/** Latest directory; null until the first scan finishes. */
	directory: ResumeDirectory | null = null;

	readonly #options: LiveResumePickerSourceOptions;
	#loading = true;
	#loadError: string | undefined;
	#scanWarningNames: string[] = [];
	#inFlight: Promise<void> | undefined;
	#state: ResumeTreePickerState;

	constructor(options: LiveResumePickerSourceOptions) {
		this.#options = options;
		this.initialScope = options.initialState?.scope ?? options.initialScope;
		this.deleteMode = options.deleteMode;
		this.#state = options.initialState ? { ...options.initialState } : { scope: this.initialScope };
	}

	pickerState(): ResumeTreePickerState {
		return {
			...this.#state,
			scope: this.initialScope,
			collapsedProjects: [...(this.#state.collapsedProjects ?? [])],
			expandedProjects: [...(this.#state.expandedProjects ?? [])],
			collapsedWorkspaces: [...(this.#state.collapsedWorkspaces ?? [])],
			expandedSubagents: [...(this.#state.expandedSubagents ?? [])],
		};
	}

	subagentsMode(): ResumeSubagentsMode {
		return this.#options.subagents ?? "grouped";
	}

	isLoading(): boolean {
		return this.#loading;
	}

	loadError(): string | undefined {
		return this.#loadError;
	}

	scanWarningNames(): readonly string[] {
		return this.#scanWarningNames;
	}

	currentSessionPath(): string | undefined {
		return this.#options.currentSessionPath?.();
	}

	/**
	 * The structural method both renderers call. Accepts a bare scope kind (the
	 * ANSI tree) or the model's `ResumeScope` object (native/web callers).
	 */
	buildView(input: {
		scope:
			| ResumeTreeScope
			| {
					kind: ResumeTreeScope;
					key?: string;
					projectKey?: string;
					workspaceKey?: string;
			  };
		query: string;
		currentSessionPath?: string;
	}): ResumeTreeView | null {
		if (!this.directory) return null;
		const scope: ResumeScopeKind | typeof input.scope = input.scope;
		return buildResumeView(this.directory, {
			scope,
			query: input.query,
			currentSessionPath: input.currentSessionPath ?? this.currentSessionPath(),
			subagents: this.subagentsMode(),
		}) as ResumeTreeView;
	}

	scopeSummary(): ResumeTreeScopeSummary {
		const directory = this.directory;
		if (!directory) {
			return { workspaceName: "", projectName: "", counts: { workspace: 0, project: 0, all: 0 } };
		}
		const resolved = resolveResumeScope(directory, { kind: "workspace" }, this.currentSessionPath());
		const workspace = directory.workspaces.find(candidate => candidate.key === resolved.workspaceKey);
		const project = directory.projects.find(candidate => candidate.key === resolved.projectKey);
		return {
			workspaceName: workspace?.name ?? path.basename(directory.defaultWorkspaceKey),
			projectName: project?.displayName ?? path.basename(directory.defaultProjectKey),
			counts: {
				workspace: workspace?.counts.conversations ?? 0,
				project: project?.counts.conversations ?? 0,
				all: directory.counts.conversations,
			},
		};
	}

	/** Coalesces concurrent refreshes (initial load, `r`, a pin) into one scan. */
	refresh(): Promise<void> {
		this.#inFlight ??= this.#scan().finally(() => {
			this.#inFlight = undefined;
		});
		return this.#inFlight;
	}

	async #scan(): Promise<void> {
		this.#loading = true;
		this.#loadError = undefined;
		this.#scanWarningNames = await unreadableSessionDirs(getSessionsDir());
		try {
			this.directory = await loadResumeDirectory({
				...(this.#options.storage ? { storage: this.#options.storage } : {}),
				...(this.#options.agentDir ? { agentDir: this.#options.agentDir } : {}),
				...(this.#options.workspacePath ? { defaultWorkspace: this.#options.workspacePath } : {}),
				currentSessionPath: this.currentSessionPath(),
			});
		} catch (error) {
			this.#loadError = error instanceof Error ? error.message : String(error);
			logger.warn("Failed to load the resume directory", { error });
		} finally {
			this.#loading = false;
		}
	}

	/** Persist the whole picker state (scope + local expansion). */
	async persistPickerState(state: ResumeTreePickerState): Promise<void> {
		this.#state = { ...state };
		this.initialScope = state.scope;
		try {
			await saveResumePickerState(this.pickerState(), this.#options.agentDir);
		} catch (error) {
			logger.warn("Failed to persist the resume picker state", { error });
		}
	}

	async persistScope(scope: ResumeTreeScope): Promise<void> {
		await this.persistPickerState({ ...this.pickerState(), scope });
	}

	async pinConversation(conversation: ResumeTreeConversation, pinned: boolean): Promise<void> {
		if (!conversation.id || conversation.pinned === pinned) return;
		await toggleSessionPin(conversation.id, this.#options.agentDir);
	}

	projectByKey(key: string): ResumeTreeProject | undefined {
		return this.directory?.projects.find(project => project.key === key);
	}

	async pinProject(project: ResumeTreeProject, pinned: boolean): Promise<void> {
		if (project.isDefault || project.pinned === pinned) return;
		await toggleProjectPin(project.key, this.#options.agentDir);
	}

	async deleteConversation(conversation: ResumeTreeConversation): Promise<boolean> {
		return this.#options.deleteConversation(conversation);
	}
}

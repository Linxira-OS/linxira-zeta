/**
 * Cross-surface resume picker preferences.
 *
 * Project pin/alias/collapse and the project registry live in one JSON file
 * under the config root (`<agent dir>/resume-projects.json`), so the terminal
 * picker and the serve/GUI side read and write the same state. This is
 * deliberately not browser localStorage: a pin made in `zetacode` must survive
 * in the web UI and vice versa, including with no backend running.
 *
 * Reads degrade to an empty store on a missing or corrupt file; writes take
 * the shared cross-process file lock and publish atomically, mirroring
 * `session-pins.ts`.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, isEnoent, logger } from "@linxiraos/pi-utils";
import { withFileLock } from "@linxiraos/pi-utils/file-lock";

import { defaultCoordinatorWorkspace } from "../default-workspace";
import { replaceFileAtomically } from "../utils/atomic-file";
import { resumePathKey, sameResumePath } from "./paths";
import type { ResumePreferences, ResumeProjectPreferences, ResumeWorkspacePreferences } from "./types";

export const RESUME_PREFERENCES_FILENAME = "resume-projects.json";
export const RESUME_PREFERENCES_VERSION = 1;

/** Absolute path of the shared preferences file. */
export function resumePreferencesPath(agentDir: string = getAgentDir()): string {
	return path.join(agentDir, RESUME_PREFERENCES_FILENAME);
}

function emptyPreferences(): ResumePreferences {
	return { version: RESUME_PREFERENCES_VERSION, projects: {} };
}

function sanitizeWorkspacePreference(value: unknown): ResumeWorkspacePreferences | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const result: ResumeWorkspacePreferences = {};
	if ("pinned" in value && typeof value.pinned === "boolean") result.pinned = value.pinned;
	if ("alias" in value && typeof value.alias === "string") {
		const alias = value.alias.trim();
		if (alias) result.alias = alias;
	}
	return Object.keys(result).length > 0 ? result : null;
}

function sanitizeProjectPreference(value: unknown): ResumeProjectPreferences | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const result: ResumeProjectPreferences = {};
	if ("pinned" in value && typeof value.pinned === "boolean") result.pinned = value.pinned;
	if ("collapsed" in value && typeof value.collapsed === "boolean") result.collapsed = value.collapsed;
	if ("registered" in value && typeof value.registered === "boolean") result.registered = value.registered;
	if ("alias" in value && typeof value.alias === "string") {
		const alias = value.alias.trim();
		if (alias) result.alias = alias;
	}
	if ("lastOpened" in value && typeof value.lastOpened === "number" && Number.isFinite(value.lastOpened)) {
		result.lastOpened = value.lastOpened;
	}
	return Object.keys(result).length > 0 ? result : null;
}

/**
 * Validate and canonicalize an arbitrary parsed JSON value. Unknown fields are
 * dropped; project keys are normalized so a Windows casing difference cannot
 * split one project into two preference entries.
 */
export function normalizeResumePreferences(value: unknown): ResumePreferences {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyPreferences();
	if (!("projects" in value)) return emptyPreferences();
	const projects = value.projects;
	if (typeof projects !== "object" || projects === null || Array.isArray(projects)) return emptyPreferences();
	const normalized: Record<string, ResumeProjectPreferences> = {};
	for (const [rawKey, rawPreference] of Object.entries(projects)) {
		const key = resumePathKey(rawKey);
		if (!key) continue;
		const preference = sanitizeProjectPreference(rawPreference);
		if (!preference) continue;
		normalized[key] = { ...normalized[key], ...preference };
	}
	const workspaces: Record<string, ResumeWorkspacePreferences> = {};
	const rawWorkspaces = "workspaces" in value ? value.workspaces : undefined;
	if (typeof rawWorkspaces === "object" && rawWorkspaces !== null && !Array.isArray(rawWorkspaces)) {
		for (const [rawKey, rawPreference] of Object.entries(rawWorkspaces)) {
			const key = resumePathKey(rawKey);
			if (!key) continue;
			const preference = sanitizeWorkspacePreference(rawPreference);
			if (!preference) continue;
			workspaces[key] = { ...workspaces[key], ...preference };
		}
	}
	return {
		version: RESUME_PREFERENCES_VERSION,
		projects: normalized,
		...(Object.keys(workspaces).length > 0 ? { workspaces } : {}),
	};
}

export interface LoadResumePreferencesOptions {
	/** Project key to seed as pinned and registered when absent. */
	defaultProjectKey?: string;
}

function seedDefaultProject(preferences: ResumePreferences, defaultProjectKey?: string): ResumePreferences {
	if (!defaultProjectKey) return preferences;
	const key = resumePathKey(defaultProjectKey);
	if (!key) return preferences;
	const current = preferences.projects[key] ?? {};
	preferences.projects[key] = { ...current, pinned: true, registered: true };
	return preferences;
}

/**
 * Read the shared preferences store. A missing file yields an empty store.
 * When `defaultProjectKey` is supplied, that project is seeded (in memory) as
 * pinned and registered so the default workspace is always present.
 */
export async function loadResumePreferences(
	agentDir: string = getAgentDir(),
	options: LoadResumePreferencesOptions = {},
): Promise<ResumePreferences> {
	let preferences: ResumePreferences;
	try {
		preferences = normalizeResumePreferences(JSON.parse(await fs.readFile(resumePreferencesPath(agentDir), "utf-8")));
	} catch (error) {
		if (isEnoent(error)) {
			preferences = emptyPreferences();
		} else {
			logger.warn("Failed to read resume preferences", { error });
			preferences = emptyPreferences();
		}
	}
	return seedDefaultProject(preferences, options.defaultProjectKey);
}

function writePreferencesFile(filePath: string, preferences: ResumePreferences): Promise<void> {
	const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	return (async () => {
		try {
			await fs.writeFile(temporaryPath, JSON.stringify(preferences, null, "\t"), { encoding: "utf-8", mode: 0o600 });
			await replaceFileAtomically(temporaryPath, filePath);
		} catch (error) {
			await fs.rm(temporaryPath, { force: true }).catch(() => {});
			throw error;
		}
	})();
}

/** Overwrite the whole store atomically under the cross-process lock. */
export async function saveResumePreferences(
	preferences: ResumePreferences,
	agentDir: string = getAgentDir(),
): Promise<void> {
	const filePath = resumePreferencesPath(agentDir);
	await fs.mkdir(agentDir, { recursive: true });
	await withFileLock(filePath, () => writePreferencesFile(filePath, normalizeResumePreferences(preferences)));
}

/**
 * Read-modify-write the store under one lock. The mutator receives a fresh
 * copy; returning it (or mutating it) both work, and changes are normalized
 * before they are persisted.
 */
export async function updateResumePreferences(
	mutator: (preferences: ResumePreferences) => void | ResumePreferences,
	agentDir: string = getAgentDir(),
): Promise<ResumePreferences> {
	const filePath = resumePreferencesPath(agentDir);
	await fs.mkdir(agentDir, { recursive: true });
	return withFileLock(filePath, async () => {
		const current = await loadResumePreferences(agentDir);
		const next = mutator(current) ?? current;
		const normalized = normalizeResumePreferences(next);
		await writePreferencesFile(filePath, normalized);
		return normalized;
	});
}

/** Merge a patch into one project's preferences (undefined removes a key). */
export async function setProjectPreference(
	projectKey: string,
	patch: ResumeProjectPreferences,
	agentDir: string = getAgentDir(),
): Promise<ResumePreferences> {
	const key = resumePathKey(projectKey);
	if (!key) throw new Error("A project key is required");
	return updateResumePreferences(preferences => {
		const next: ResumeProjectPreferences = { ...preferences.projects[key], ...patch };
		if (next.alias !== undefined) {
			const alias = next.alias.trim();
			if (alias) next.alias = alias;
			else delete next.alias;
		}
		for (const field of ["pinned", "collapsed", "registered", "lastOpened", "alias"] as const) {
			if (next[field] === undefined) delete next[field];
		}
		if (Object.keys(next).length > 0) preferences.projects[key] = next;
		else delete preferences.projects[key];
		return preferences;
	}, agentDir);
}

/** Toggle a project's pin; returns the new pinned state. */
export async function toggleProjectPin(projectKey: string, agentDir: string = getAgentDir()): Promise<boolean> {
	const key = resumePathKey(projectKey);
	let pinned = false;
	await updateResumePreferences(preferences => {
		pinned = !(preferences.projects[key]?.pinned ?? false);
		preferences.projects[key] = { ...preferences.projects[key], pinned };
		return preferences;
	}, agentDir);
	return pinned;
}

/** Set (or clear with null/empty) a project's display alias. */
export async function setProjectAlias(
	projectKey: string,
	alias: string | null,
	agentDir: string = getAgentDir(),
): Promise<void> {
	await setProjectPreference(projectKey, { alias: alias ?? undefined }, agentDir);
}

/** Set (or clear with null/empty) a workspace's display alias. */
export async function setWorkspaceAlias(
	workspaceKey: string,
	alias: string | null,
	agentDir: string = getAgentDir(),
): Promise<void> {
	const key = resumePathKey(workspaceKey);
	if (!key) throw new Error("A workspace key is required");
	await updateResumePreferences(preferences => {
		const workspaces = (preferences.workspaces ??= {});
		const next: ResumeWorkspacePreferences = { ...workspaces[key] };
		const trimmed = alias?.trim();
		if (trimmed) next.alias = trimmed;
		else delete next.alias;
		if (Object.keys(next).length > 0) workspaces[key] = next;
		else delete workspaces[key];
		if (Object.keys(workspaces).length === 0) delete preferences.workspaces;
		return preferences;
	}, agentDir);
}

/** Toggle a workspace's pin; returns the new pinned state. */
export async function toggleWorkspacePin(workspaceKey: string, agentDir: string = getAgentDir()): Promise<boolean> {
	const key = resumePathKey(workspaceKey);
	let pinned = false;
	await updateResumePreferences(preferences => {
		const workspaces = (preferences.workspaces ??= {});
		pinned = !(workspaces[key]?.pinned ?? false);
		workspaces[key] = { ...workspaces[key], pinned };
		return preferences;
	}, agentDir);
	return pinned;
}

/** Persist a project's collapsed state. */
export async function setProjectCollapsed(
	projectKey: string,
	collapsed: boolean,
	agentDir: string = getAgentDir(),
): Promise<void> {
	await setProjectPreference(projectKey, { collapsed }, agentDir);
}

/**
 * Register a project root in the on-disk registry. Registered projects stay
 * in the directory (with zero conversations) until explicitly removed.
 */
export async function registerProject(projectRoot: string, agentDir: string = getAgentDir()): Promise<void> {
	if (!resumePathKey(projectRoot)) throw new Error("A project root is required");
	await setProjectPreference(projectRoot, { registered: true }, agentDir);
}

/** Remove a project from the registry and drop its preferences. */
export async function unregisterProject(projectRoot: string, agentDir: string = getAgentDir()): Promise<void> {
	if (sameResumePath(projectRoot, defaultCoordinatorWorkspace())) {
		throw new Error("The default workspace project cannot be removed");
	}
	const key = resumePathKey(projectRoot);
	await updateResumePreferences(preferences => {
		delete preferences.projects[key];
		return preferences;
	}, agentDir);
}

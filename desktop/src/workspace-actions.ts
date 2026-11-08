/**
 * Workspace and file actions the desktop shell performs on the renderer's
 * behalf (`window.zetaStudioChrome`).
 *
 * The renderer only ever holds opaque `ws-*` workspace ids and workspace
 * relative paths; absolute paths stay in Main. The gateway's project inventory
 * (`GET /api/projects`) is the only authority for where a workspace lives, so
 * every action resolves the id through {@link findWorkspace} and then checks
 * containment again with `realpath`, the same contract `open-bridge.ts` uses
 * for gateway-signed opens.
 *
 * `workspaceIdFor` mirrors `workspaceIdOf` in
 * `packages/coding-agent/src/server/studio-host/ops/workspace.ts`; the renderer
 * receives those ids from that host, so the formula is part of the wire, not an
 * implementation detail.
 */
import { createHash } from "node:crypto";
import * as path from "node:path";

import { isRecord } from "./json";

export type WorkspaceFileKind = "file" | "dir";

export interface WorkspaceLocation {
	readonly workspaceId: string;
	readonly path: string;
	readonly name?: string;
}

export interface DroppedPathResult {
	readonly ok: true;
	readonly kind: WorkspaceFileKind | "image";
	readonly scope: "workspace" | "absolute";
	readonly path: string;
	readonly name: string;
}

export interface DroppedPathRejection {
	readonly ok: false;
	readonly reason: "missing" | "invalid";
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".ico"]);

/** Stable renderer-facing id for a canonical workspace key (see module doc). */
export function workspaceIdFor(key: string): string {
	const digest = createHash("sha256").update(`zeta-workspace\u0000${key}`).digest("hex");
	return `ws-${digest.slice(0, 16)}`;
}

/** The workspace a renderer id names inside a `GET /api/projects` payload. */
export function findWorkspace(payload: unknown, workspaceId: string): WorkspaceLocation | null {
	if (!isRecord(payload) || !Array.isArray(payload.projects)) return null;
	for (const project of payload.projects) {
		if (!isRecord(project) || !Array.isArray(project.workspaces)) continue;
		for (const workspace of project.workspaces) {
			if (!isRecord(workspace)) continue;
			const { key, path: workspacePath, name } = workspace;
			if (typeof key !== "string" || typeof workspacePath !== "string") continue;
			if (!path.isAbsolute(workspacePath)) continue;
			if (workspaceIdFor(key) !== workspaceId) continue;
			return { workspaceId, path: workspacePath, ...(typeof name === "string" ? { name } : {}) };
		}
	}
	return null;
}

/** Whether `candidate` (already resolved) stays inside `root` (already resolved). */
export function isPathWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/**
 * Resolve a workspace-relative path to its real absolute path, or `null` when
 * it is absolute, contains `..`, or resolves outside the workspace (symlinks
 * included). `realpath` is injected so tests can drive the platform behavior.
 */
export function resolveWorkspaceFile(
	workspacePath: string,
	relativePath: unknown,
	realpath: (target: string) => string,
): string | null {
	if (typeof relativePath !== "string" || relativePath.length === 0) return null;
	const normalized = relativePath.replace(/\\/g, "/").replace(/\/+$/, "");
	if (normalized === "") return null;
	if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return null;
	if (normalized.split("/").some(part => part === "..")) return null;
	try {
		const root = realpath(workspacePath);
		const target = realpath(path.join(workspacePath, normalized));
		return isPathWithin(root, target) ? target : null;
	} catch {
		return null;
	}
}

/** Posix-style workspace-relative path for an absolute file inside the workspace. */
export function workspaceRelativePath(workspacePath: string, absolutePath: string): string | null {
	const relative = path.relative(workspacePath, absolutePath);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
	return relative.split(path.sep).join("/");
}

function imageKind(fileName: string): boolean {
	return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/**
 * Classify one dropped path for `resolveDroppedPaths`: files inside the
 * workspace travel as workspace-relative paths, everything else as an absolute
 * path the caller must only use for display.
 */
export function classifyDroppedPath(
	workspacePath: string,
	droppedPath: string,
	stat: (target: string) => { isDirectory(): boolean },
	realpath: (target: string) => string,
): DroppedPathResult | DroppedPathRejection {
	try {
		if (!path.isAbsolute(droppedPath)) return { ok: false, reason: "invalid" };
		const root = realpath(workspacePath);
		const target = realpath(droppedPath);
		const isDirectory = stat(target).isDirectory();
		const relative = isPathWithin(root, target) ? workspaceRelativePath(root, target) : null;
		const name = path.basename(target);
		const kind: WorkspaceFileKind | "image" = isDirectory ? "dir" : imageKind(name) ? "image" : "file";
		return relative === null
			? { ok: true, kind, scope: "absolute", path: target, name }
			: { ok: true, kind, scope: "workspace", path: relative, name };
	} catch {
		return { ok: false, reason: "missing" };
	}
}

/**
 * The editor `openProjectInEditor` picks when the caller did not name one: the
 * first installed editor target, in the host's probe order.
 */
export function firstEditorTarget(targets: ReadonlyArray<{ readonly id: string }>): string | null {
	return targets.find(target => target.id.startsWith("editor:"))?.id ?? null;
}

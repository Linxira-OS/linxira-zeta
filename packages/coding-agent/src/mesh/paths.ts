/**
 * Filesystem layout for the machine-local mesh plane.
 *
 * Defaults to `<config root>/run` and `<config root>/mailboxes`. Deployments
 * that run several `serve` processes with *different* config roots can point
 * `ZETA_MESH_ROOT` at one shared directory so those processes still see each
 * other; the directory, endpoint, and mailboxes all move together.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getConfigRootDir } from "@linxiraos/pi-utils";

/** Directory name under the config root that holds process-scoped runtime state. */
const RUN_DIR = "run";
/** Directory (under the mesh root) that holds per-workspace directory records. */
const DIRECTORY_DIR = "mesh";
/** Directory (under the mesh root) that holds offline mailboxes. */
const MAILBOXES_DIR = "mailboxes";

export interface MeshPaths {
	/** Root of the mesh plane (normally the config root). */
	root: string;
	runDir: string;
	directoryDir: string;
	mailboxesDir: string;
	/** Loopback-only endpoint for one workspace. */
	endpoint(workspaceId: string): string;
	/** `run/mesh/<workspaceId>.json`. */
	directoryFile(workspaceId: string): string;
	/** Owner-only handshake token for one workspace endpoint. */
	tokenFile(workspaceId: string): string;
	/** `mailboxes/<workspaceId>/<agentId>/`; the agent segment is URI-encoded. */
	mailboxDir(workspaceId: string, agentId: string): string;
	/** `mailboxes/<workspaceId>/<agentId>/delivered/`. */
	deliveredDir(workspaceId: string, agentId: string): string;
}

/** Stable 12-hex workspace id derived from the canonical workspace root. */
export function workspaceIdFor(workspaceRoot: string): string {
	const canonical = path.resolve(workspaceRoot).replaceAll("\\", "/");
	return createHash("sha1").update(canonical).digest("hex").slice(0, 12);
}

/**
 * Root of the mesh plane: `ZETA_MESH_ROOT` when set, else the config root.
 * The override exists so processes with distinct config roots can share one
 * runtime plane (a plain `zeta serve` install uses the config root).
 */
export function resolveMeshRoot(configRoot?: string): string {
	const override = process.env.ZETA_MESH_ROOT?.trim();
	if (override) return path.resolve(override);
	return path.resolve(configRoot ?? getConfigRootDir());
}

/**
 * Named pipes are machine-global on Windows, so the name carries a digest of
 * the mesh root as well as the workspace id — two isolated planes that happen
 * to use the same workspace id must never collide.
 */
function windowsPipeName(root: string, workspaceId: string): string {
	const scope = createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 8);
	return `\\\\.\\pipe\\zeta-mesh-${scope}-${workspaceId}`;
}

/** Build the mesh layout for `configRoot` (or `ZETA_MESH_ROOT`). */
export function meshPaths(configRoot?: string): MeshPaths {
	return meshPathsAt(resolveMeshRoot(configRoot));
}

/** Build the mesh layout rooted exactly at `root` (explicit option, no env override). */
export function meshPathsAt(root: string): MeshPaths {
	root = path.resolve(root);
	const runDir = path.join(root, RUN_DIR);
	const directoryDir = path.join(runDir, DIRECTORY_DIR);
	const mailboxesDir = path.join(root, MAILBOXES_DIR);
	return {
		root,
		runDir,
		directoryDir,
		mailboxesDir,
		endpoint: workspaceId =>
			process.platform === "win32"
				? windowsPipeName(root, workspaceId)
				: path.join(runDir, `mesh-${workspaceId}.sock`),
		directoryFile: workspaceId => path.join(directoryDir, `${workspaceId}.json`),
		tokenFile: workspaceId => path.join(directoryDir, `${workspaceId}.token`),
		mailboxDir: (workspaceId, agentId) => path.join(mailboxesDir, workspaceId, encodeURIComponent(agentId)),
		deliveredDir: (workspaceId, agentId) =>
			path.join(mailboxesDir, workspaceId, encodeURIComponent(agentId), "delivered"),
	};
}

/** Create every directory the mesh plane writes to. */
export async function ensureMeshDirs(paths: MeshPaths): Promise<void> {
	await fs.mkdir(paths.runDir, { recursive: true, mode: 0o700 });
	await fs.mkdir(paths.directoryDir, { recursive: true, mode: 0o700 });
	await fs.mkdir(paths.mailboxesDir, { recursive: true, mode: 0o700 });
}

/** True when `value` is a safe workspace-id segment (no separators, no traversal). */
export function isSafeWorkspaceId(value: string): boolean {
	return /^[A-Za-z0-9_-]{1,64}$/.test(value) && value !== "." && value !== "..";
}

/**
 * Validate one address segment: no path separators, no traversal, no control
 * characters. Agent ids are otherwise free-form (task ids may contain dots,
 * colons, or spaces), so this rejects only what could escape a path or break
 * framing — mailbox directories encode the segment instead.
 */
export function isSafeAddressSegment(value: string): boolean {
	if (value.length === 0 || value.length > 128) return false;
	if (value === "." || value === "..") return false;
	if (/[/\\\0\r\n]/.test(value)) return false;
	// eslint-disable-next-line no-control-regex
	return !/[\u0000-\u001f\u007f]/.test(value);
}

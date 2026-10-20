/**
 * Workspace identity for a session.
 *
 * A session's workspace id is the mesh's workspace id (`sha1(realpath(root))[:12]`,
 * see `mesh/paths.ts`). When this process already owns a mesh node, sessions
 * rooted inside that node's workspace share its id — the node canonicalized the
 * root and its directory record publishes those agents under it. Any other
 * session (a workspace opened from `zeta serve`, a CLI session) derives the
 * same hash from its own directory, so a root's identity does not depend on
 * which other sessions happen to be live.
 *
 * The id scopes root ids and resolves `agent://main` to the caller's own
 * workspace main rather than to whichever root registered first.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getMeshNode } from "../mesh/global";
import { workspaceIdFor } from "../mesh/paths";

/** True when `candidate` is `root` or one of its descendants. */
export function isPathInsideWorkspace(root: string, candidate: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(candidate));
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Mesh workspace id of the workspace a session rooted at `cwd` belongs to. */
export function resolveSessionWorkspaceId(cwd: string): string {
	const mesh = getMeshNode();
	if (mesh && isPathInsideWorkspace(mesh.workspaceRoot, cwd)) return mesh.workspaceId;
	let canonical = path.resolve(cwd);
	try {
		canonical = fs.realpathSync.native(canonical);
	} catch {
		// A cwd that cannot be canonicalized (not created yet, permission) keeps
		// the resolved form; workspaceIdFor hashes exactly what it is given.
	}
	return workspaceIdFor(canonical);
}

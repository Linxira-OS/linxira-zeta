/**
 * Stable, path-free Studio workspace identity.
 *
 * Kept in its own module so read models can hash a cwd without importing an
 * operation family (which would pull the registry and create a module cycle).
 */
import { createHash } from "node:crypto";
import { resumePathKey } from "../../../resume/paths.js";
import type { WorkspaceId } from "../contract/index.js";

export function workspaceIdFor(cwd: string): WorkspaceId {
	const digest = createHash("sha256")
		.update(`zeta-workspace\u0000${resumePathKey(cwd)}`)
		.digest("hex");
	return `ws-${digest.slice(0, 16)}` as WorkspaceId;
}

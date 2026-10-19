/**
 * AgentDirectory — read-only, serializable view of the process agent tree for
 * integrations (extensions, plugins) that must not depend on `AgentRef`'s live
 * session handle.
 *
 * `list`/`get` snapshot the registry on every call and never expose the
 * underlying `AgentRef` or its `AgentSession`, so callers can render or
 * forward a descriptor without keeping a disposed session reachable.
 */

import type { AgentKind, AgentRef, AgentRegistry, AgentStatus } from "./agent-registry";

/** Workspace identity for cross-workspace addressing. `dir` is an absolute directory. */
export interface WorkspaceRef {
	dir: string;
	alias?: string;
}

/** Stable, session-free identity of one registered agent. */
export interface AgentDescriptor {
	id: string;
	displayName: string;
	kind: AgentKind;
	status: AgentStatus;
	parentId?: string;
	/** Workspace this agent belongs to, when the host resolves one. */
	workspace?: WorkspaceRef;
}

/** Read-only directory of every agent registered in this process. */
export interface AgentDirectory {
	list(): AgentDescriptor[];
	get(id: string): AgentDescriptor | undefined;
}

/** Registry slice the directory reads; lets callers pass a private registry or a stub. */
export type AgentDirectorySource = Pick<AgentRegistry, "list" | "get">;

/** Resolve the workspace an agent belongs to; return `undefined` for none. */
export type AgentWorkspaceResolver = (ref: AgentRef) => WorkspaceRef | undefined;

/**
 * Build a directory over `registry`. `workspaceOf` is optional because the
 * single-process CLI has no workspace concept; multi-workspace hosts (the
 * channel router) supply it.
 */
export function createAgentDirectory(
	registry: AgentDirectorySource,
	workspaceOf?: AgentWorkspaceResolver,
): AgentDirectory {
	const describe = (ref: AgentRef): AgentDescriptor => {
		const descriptor: AgentDescriptor = {
			id: ref.id,
			displayName: ref.displayName,
			kind: ref.kind,
			status: ref.status,
		};
		if (ref.parentId !== undefined) descriptor.parentId = ref.parentId;
		const workspace = workspaceOf?.(ref);
		// Copy so a mutable resolver result cannot rewrite an earlier snapshot.
		if (workspace) {
			descriptor.workspace = {
				dir: workspace.dir,
				...(workspace.alias !== undefined && { alias: workspace.alias }),
			};
		}
		return descriptor;
	};

	return {
		list: () => registry.list().map(describe),
		get: id => {
			const ref = registry.get(id);
			return ref ? describe(ref) : undefined;
		},
	};
}

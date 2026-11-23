/** Read-only view of a live local collab host. */
export interface CollabHostSnapshot {
	instanceId: string;
	generation: number;
	pid: number;
	sessionId: string;
	sessionName: string | null;
	cwd: string;
	model: { provider: string; id: string } | null;
	startedAt: number;
	busy: boolean;
	inputRequired: boolean;
	access: "control" | "view";
}

/** Live local collab hosts; collab live sessions are retired in Zeta, so this is empty. */
export async function listCollabHosts(): Promise<CollabHostSnapshot[]> {
	return [];
}

/** Resolve a host link; collab links are retired. */
export async function resolveCollabHostLink(instanceId: string, kind: "control" | "view"): Promise<{ url: string }> {
	throw new Error(`Collab host ${instanceId} is not available (${kind} links are retired)`);
}

import type { AgentSessionHandle } from "../../session/agent-session-handle";
import { findLocalSession } from "../../thread/session-directory";
import { revokeComputerControlForOwner } from "./supervisor";

export interface ComputerOwnerEndpoint {
	revoke(instanceKeys: string[]): Promise<void>;
}
const endpoints = new Map<string, ComputerOwnerEndpoint>();
const remoteSessions = new Map<string, { sessionId: string; ownerId: string }>();
export function bindRemoteComputerSession(
	instanceKey: string,
	identity: { sessionId: string; ownerId: string } | undefined,
): void {
	if (identity) remoteSessions.set(instanceKey, identity);
	else remoteSessions.delete(instanceKey);
}
export function registerComputerOwnerEndpoint(thread: string, endpoint: ComputerOwnerEndpoint): () => void {
	endpoints.set(thread, endpoint);
	return () => {
		if (endpoints.get(thread) === endpoint) endpoints.delete(thread);
	};
}
export function computerSessionId(session: AgentSessionHandle): string {
	return findLocalSession(session.instanceKey)?.sessionId ?? remoteSessions.get(session.instanceKey)?.sessionId ?? "";
}
export function computerSessionOwner(session: AgentSessionHandle): string | undefined {
	return (
		findLocalSession(session.instanceKey)?.getEvalKernelOwnerId() ?? remoteSessions.get(session.instanceKey)?.ownerId
	);
}
/** Receives only registry-proven sessions from the Host scope, then routes to their home threads. */
export async function revokeComputerSessions(sessions: readonly AgentSessionHandle[]): Promise<void> {
	const remote = new Map<string, string[]>();
	const pending: Promise<void>[] = [];
	for (const session of sessions) {
		const local = findLocalSession(session.instanceKey);
		if (local) {
			pending.push(revokeComputerControlForOwner(local.getEvalKernelOwnerId(), true));
			continue;
		}
		const thread = session.instanceKey.split(":", 1)[0]!;
		const group = remote.get(thread) ?? [];
		group.push(session.instanceKey);
		remote.set(thread, group);
	}
	for (const [thread, keys] of remote) {
		const endpoint = endpoints.get(thread);
		if (!endpoint) {
			pending.push(Promise.reject(new Error("Computer owner thread is unavailable; stop is unconfirmed")));
			continue;
		}
		pending.push(endpoint.revoke(keys));
	}
	const results = await Promise.allSettled(pending);
	const failed = results.find(result => result.status === "rejected");
	if (failed?.status === "rejected") throw failed.reason;
}
export async function revokeLocalComputerSessions(instanceKeys: string[]): Promise<void> {
	const settled = await Promise.allSettled(
		instanceKeys.map(key => {
			const session = findLocalSession(key);
			if (!session) return Promise.resolve();
			return revokeComputerControlForOwner(session.getEvalKernelOwnerId(), true);
		}),
	);
	const failed = settled.find(result => result.status === "rejected");
	if (failed?.status === "rejected") throw failed.reason;
}

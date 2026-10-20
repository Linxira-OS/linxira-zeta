/**
 * Mutual-wait deadlock probe (scenario S6).
 *
 * Both sides publish the address they are waiting on in their directory
 * record. Before blocking, an agent registers its wait; a poll then looks for
 * a *remote* record whose agent is waiting on this one. When that happens the
 * honest answer is `peer-waiting-on-you` — the peer must be allowed to answer
 * first, so blocking the full timeout would freeze both sessions.
 */

import { logger } from "@linxiraos/pi-utils";
import { MESH_MUTUAL_WAIT_POLL_MS } from "./types";

/** The slice of `MeshNode` this helper needs (kept structural to avoid a cycle). */
export interface MutualWaitSource {
	beginWait(localAgentId: string, on: string): Promise<void>;
	endWait(localAgentId: string, on: string): Promise<void>;
	peerWaitingOn(localAgentId: string, on: string): Promise<boolean>;
}

export type MutualWaitStatus = "peer-waiting-on-you";

/**
 * Register `localAgentId`'s wait for `on`, then race it against the deadlock
 * probe. Resolves with the wait's own value, or `peer-waiting-on-you`; the
 * registration is always withdrawn afterwards.
 *
 * The probe resolves as soon as the peer's registration becomes visible, so
 * the caller returns within roughly one poll interval of both sides waiting.
 */
export async function raceMutualWait<T>(
	source: MutualWaitSource,
	localAgentId: string,
	on: string,
	wait: Promise<T>,
	options: { pollMs?: number } = {},
): Promise<T | MutualWaitStatus> {
	// Publishing the wait is a directory write; it must never sit in front of a
	// wait's own timeout on a loaded filesystem. Both calls update the node's
	// in-memory wait map synchronously before their I/O, so the probe (and the
	// heartbeat) still see the correct state.
	void source.beginWait(localAgentId, on).catch(error => {
		logger.debug("mesh: could not publish wait", { localAgentId, on, error: String(error) });
	});
	const { promise: detected, resolve: detect } = Promise.withResolvers<MutualWaitStatus>();
	const pollMs = options.pollMs ?? MESH_MUTUAL_WAIT_POLL_MS;
	let stopped = false;
	let timer: NodeJS.Timeout | undefined;
	// Self-scheduling rather than setInterval: a directory read that outlives
	// one interval must not stack behind itself and saturate the fs pool.
	const poll = async (): Promise<void> => {
		if (stopped) return;
		try {
			if (await source.peerWaitingOn(localAgentId, on)) {
				detect("peer-waiting-on-you");
				return;
			}
		} catch {
			// A disappearing directory is not a deadlock signal.
		}
		if (!stopped) {
			timer = setTimeout(() => void poll(), pollMs);
		}
	};
	timer = setTimeout(() => void poll(), pollMs);
	try {
		return await Promise.race([wait, detected]);
	} finally {
		stopped = true;
		clearTimeout(timer);
		void source.endWait(localAgentId, on).catch(error => {
			logger.debug("mesh: could not withdraw wait", { localAgentId, on, error: String(error) });
		});
	}
}

import { rpcSync } from "../rpc";
import type { ThreadService } from "../services";
import { PeerCleanups, ignoreSettle } from "./support";
import { computerRunPermits, hasComputerScope, emitComputerLifecycle, computerUserMessageStarted, computerToolResultDelivered, installComputerScopeBridge, type ComputerScopeBridge } from "../../tools/computer/lifecycle";
import { registerComputerOwnerEndpoint, revokeLocalComputerSessions, bindRemoteComputerSession, type ComputerOwnerEndpoint } from "../../tools/computer/session-runtime";
import { findLocalSession, onLocalSessionRegistered } from "../session-directory";

interface ComputerThreadGlobals {
	readonly computer: ComputerScopeBridge;
	bind(endpoint: ComputerOwnerEndpoint): void;
	session(instanceKey: string, identity: { sessionId: string; ownerId: string } | undefined): void;
}
const cleanups = new PeerCleanups("computer");

/** Only the session's native home thread may publish its activity or acquire its stop permit. */
export const computerThreadService: ThreadService = {
	name: "computer",
	globals(peer): ComputerThreadGlobals {
		const identity = (key?: string) => typeof key === "string" && key.startsWith(peer.threadId + ":") && !peer.link.closed;
		return {
			computer: {
				has: rpcSync((id, owner, key) => identity(key) && hasComputerScope(id, owner, key)),
				permits: (id, owner, key) => {
					if (!identity(key)) return Promise.reject(new Error("Computer session thread changed"));
					return computerRunPermits(id, owner, key);
				},
				event: event => { if (identity(event.identity.instanceKey)) emitComputerLifecycle(event); },
				consumeIntent: rpcSync((id, message, key) => { if (identity(key)) computerUserMessageStarted(id, message, key); }),
				deliver: rpcSync((id, tool, result, key) => identity(key) ? computerToolResultDelivered(id, tool, result, key) : result),
			},
			bind: endpoint => { cleanups.track(peer.threadId, registerComputerOwnerEndpoint(peer.threadId, endpoint)); },
			session: rpcSync((key, value) => {
				if (!identity(key)) throw new Error("Computer session home thread changed");
				bindRemoteComputerSession(key, value);
				if (value) cleanups.track(peer.threadId, () => bindRemoteComputerSession(key, undefined));
			}),
		};
	},
	async boot(globals, link): Promise<void> {
		const source = globals as ComputerThreadGlobals;
		const owns = (id: string, key?: string) => {
			const session = key ? findLocalSession(key) : undefined;
			return !link.closed && !!session && !session.isDisposed && session.sessionId === id;
		};
		await source.bind({ revoke: revokeLocalComputerSessions });
		onLocalSessionRegistered(session => {
			const publish = () => source.session(session.instanceKey, session.isDisposed ? undefined : { sessionId: session.sessionId, ownerId: session.getEvalKernelOwnerId() });
			publish();
			session.registerSessionChangeCallback(publish);
			session.addDisposer(() => source.session(session.instanceKey, undefined));
		});
		installComputerScopeBridge({
			has: (id, owner, key) => owns(id, key) && source.computer.has(id, owner, key),
			permits: async (id, owner, key) => {
				if (!owns(id, key)) throw new Error("Computer host or session disconnected");
				const permits = await source.computer.permits(id, owner, key);
				if (!owns(id, key)) throw new Error("Computer session changed while authorizing");
				return permits;
			},
			event: event => { if (owns(event.identity.sessionId, event.identity.instanceKey)) ignoreSettle(source.computer.event(event)); },
			consumeIntent: (id, message, key) => { if (owns(id, key)) source.computer.consumeIntent(id, message, key); },
			deliver: (id, tool, result, key) => owns(id, key) ? source.computer.deliver(id, tool, result, key) : result,
		});
	},
	onWorkerExit(peer): void { cleanups.release(peer.threadId); },
};

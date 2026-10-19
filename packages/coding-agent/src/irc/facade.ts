/**
 * AgentMessenger — narrow facade over the process-wide {@link IrcBus} for
 * extensions and plugins.
 *
 * It adds no transport and no delivery semantics: every method delegates to
 * the bus instance it was created with (the global bus by default). Callers
 * that need the full tool behavior keep using the `irc` tools.
 */

import type { IrcDeliveryReceipt, IrcMessage } from "@linxiraos/pi-tui/tools/irc";
import { IrcBus } from "./bus";

/** Message metadata plus the existing bus delivery flags. */
export interface AgentMessageOptions {
	/** Message id being answered. */
	replyTo?: string;
	/** Mark this message as an automated wake-turn relay. */
	wakeRelay?: boolean;
	/** The caller is blocked on an answer (`send await:true`). */
	expectsReply?: boolean;
	/** Skip the display-only main-UI relay for this leg. */
	suppressRelay?: boolean;
}

/** Cross-agent send / wait / inbox surface handed to extensions. */
export interface AgentMessenger {
	/** Fire-and-forget delivery; resolve with the bus's delivery receipt. */
	send(from: string, to: string, body: string, opts?: AgentMessageOptions): Promise<IrcDeliveryReceipt>;
	/** Block for a message to `agentId`; null on timeout, rejects on abort. */
	wait(
		agentId: string,
		filter: { from?: string },
		timeoutMs: number,
		signal?: AbortSignal,
	): Promise<IrcMessage | null>;
	/** Drain (or peek at) an agent's mailbox. */
	inbox(agentId: string, opts?: { peek?: boolean }): IrcMessage[];
}

/** Bus slice the messenger delegates to; lets callers inject a private bus or a stub. */
export type AgentMessengerBus = Pick<IrcBus, "send" | "wait" | "inbox">;

/** Build a messenger over `bus` (defaults to the process-global bus). */
export function createAgentMessenger(bus: AgentMessengerBus = IrcBus.global()): AgentMessenger {
	return {
		send: (from, to, body, opts) => {
			const message: Omit<IrcMessage, "id" | "ts"> = { from, to, body };
			if (opts?.replyTo !== undefined) message.replyTo = opts.replyTo;
			if (opts?.wakeRelay) message.wakeRelay = true;
			const delivery =
				opts?.expectsReply === undefined && opts?.suppressRelay === undefined
					? undefined
					: { expectsReply: opts.expectsReply, suppressRelay: opts.suppressRelay };
			return bus.send(message, delivery);
		},
		wait: (agentId, filter, timeoutMs, signal) => bus.wait(agentId, filter, timeoutMs, signal),
		inbox: (agentId, opts) => bus.inbox(agentId, opts),
	};
}

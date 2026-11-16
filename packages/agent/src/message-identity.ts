import type { AgentMessage } from "./types";

/** Enumerable symbol survives immutable message spreads, never JSON/provider wire. */
export const AGENT_MESSAGE_IDENTITY = Symbol("agent-message-identity");
export type IdentifiedAgentMessage = AgentMessage & { [AGENT_MESSAGE_IDENTITY]?: object };

export function agentMessageIdentity(message: object): object | undefined {
	return (message as IdentifiedAgentMessage)[AGENT_MESSAGE_IDENTITY];
}

export function identifyAgentMessage(message: object, identity?: object): object {
	const identified = message as IdentifiedAgentMessage;
	return identified[AGENT_MESSAGE_IDENTITY] ??= identity ?? {};
}

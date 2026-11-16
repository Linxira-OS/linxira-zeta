import { AgentRegistry } from "../../../registry/agent-registry";
import type { AgentSession } from "../../../session/agent-session";
import { isAgentViewSession, type AgentViewSession } from "../../../session/agent-session-handle";
import { StudioOpError as SessionControlError } from "../errors.js";
import type { ExtensionLinkListInput, ExtensionLinkOperation } from "../protocol/contracts/extension-links.js";
import { ownedStudioSessions } from "./owned-sessions";

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_URL_LENGTH = 16_384;

function validIdentifier(value: unknown): value is string {
	return (
		typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH && !value.includes("\0")
	);
}

/** A live agent session the registry proves descends from this caller's session. */
function ownedStudioAgent(session: AgentSession, agentId: string): AgentViewSession | undefined {
	const candidate = AgentRegistry.global().get(agentId)?.session;
	if (!candidate) return undefined;
	const candidateId = candidate.sessionManager.getSessionId();
	return ownedStudioSessions(session).find(
		view => view.sessionId === candidateId || (!!candidate.instanceKey && view.instanceKey === candidate.instanceKey),
	);
}

/** The conversation that owns a link, or undefined when the target is foreign/not owned. */
export function studioLinkTarget(
	session: AgentSession,
	target: { sessionId: string; sourceSessionId?: string; agentId?: string },
): AgentViewSession | undefined {
	if (target.sessionId !== session.sessionId)
		throw new SessionControlError("UNAVAILABLE", "Extension links belong to another session");
	const owner = target.agentId ? ownedStudioAgent(session, target.agentId) : session;
	return owner &&
		isAgentViewSession(owner) &&
		(!target.sourceSessionId || target.sourceSessionId === owner.sessionManager.getSessionId())
		? owner
		: undefined;
}

export function listStudioExtensionLinks(session: AgentSession, target: ExtensionLinkListInput): { schemes: string[] } {
	if (
		!validIdentifier(target.sessionId) ||
		(target.sourceSessionId !== undefined && !validIdentifier(target.sourceSessionId))
	)
		throw new SessionControlError("INVALID_ARGUMENT", "Invalid extension link target");
	if (target.agentId !== undefined && !validIdentifier(target.agentId))
		throw new SessionControlError("INVALID_ARGUMENT", "Invalid extension link agent");
	const owner = studioLinkTarget(session, target);
	return { schemes: owner?.getStudioLinkSchemes() ?? [] };
}

export async function activateStudioExtensionLink(
	session: AgentSession,
	operation: ExtensionLinkOperation,
): Promise<{ handled: boolean }> {
	if (typeof operation.url !== "string" || operation.url.length === 0 || operation.url.length > MAX_URL_LENGTH)
		throw new SessionControlError("INVALID_ARGUMENT", "Invalid extension link");
	if (operation.url.includes("\0")) throw new SessionControlError("INVALID_ARGUMENT", "Invalid extension link");
	const target = studioLinkTarget(session, operation);
	if (!target)
		throw new SessionControlError("UNAVAILABLE", "The extension owning this conversation is no longer running");
	const colon = operation.url.indexOf(":");
	if (colon <= 0) return { handled: false };
	const scheme = operation.url.slice(0, colon).toLowerCase();
	// Only a scheme the owning session registered may reach a handler.
	if (!target.getStudioLinkSchemes().includes(scheme)) return { handled: false };
	return { handled: await target.activateStudioLink(operation.url) };
}

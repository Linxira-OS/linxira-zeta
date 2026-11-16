import { isAgentViewSession } from "../../../session/agent-session-handle";
import type { AgentSession } from "../../../session/agent-session";
import { SessionManager, extractSessionInit, type PersistedSessionInit } from "../../../session/session-manager";
import { buildSessionContext } from "../../../session/session-context";
import { loadEntriesFromFile } from "../../../session/session-loader";
import { migrateToCurrentVersion } from "../../../session/session-migrations";
import { PREWALK_MODEL_CHANGE_ROLE, resolveSessionLeafId, type SessionEntry } from "../../../session/session-entries";
import { AgentRegistry, type AgentRef } from "../../../registry/agent-registry";
import { unavailable } from "../errors.js";
import type { AgentModelInspection, AgentModelOperation } from "../protocol/contracts/agent-model.js";

/** Agent identities proven by the registry's parent chain, including parked descendants. */
function ownedRefs(session: AgentSession): AgentRef[] {
	if (session.isDisposed) return [];
	const registry = AgentRegistry.global();
	const refs = registry.list();
	const main =
		refs.find(ref => session.instanceKey && ref.session?.instanceKey === session.instanceKey) ??
		refs.find(ref => ref.session?.sessionManager.getSessionId() === session.sessionId);
	if (!main) return [];
	return refs.filter(candidate => {
		const seen = new Set<string>();
		let ref = candidate;
		for (;;) {
			if (ref.id === main.id) return true;
			if (seen.has(ref.id)) return false;
			seen.add(ref.id);
			const parent = ref.parentId ? registry.get(ref.parentId) : undefined;
			if (!parent) return false;
			ref = parent;
		}
	});
}
function ownedStudioAgent(session: AgentSession, agentId: string): AgentRef | undefined {
	return ownedRefs(session).find(ref => ref.id === agentId);
}
function candidates(
	init: PersistedSessionInit | null,
): Pick<AgentModelInspection, "candidates" | "candidatesTruncated"> {
	if (!init?.retryFallback) return {};
	const chain = [init.retryFallback.primary, ...init.retryFallback.chain];
	return { candidates: chain.slice(0, 16), candidatesTruncated: chain.length > 16 };
}

interface DormantProjection {
	selectedModel?: string;
	configuredThinking?: string;
	effectiveThinking?: string;
}

/**
 * Project the active branch exactly as native revival does: a session-local
 * model switch wins over the spawn selection, and the latest thinking change
 * supplies configured/effective levels. Old journals without `session_init`
 * still project the legacy default inferred from their transcript.
 */
async function dormantProjection(filePath: string): Promise<DormantProjection> {
	try {
		const entries = await loadEntriesFromFile(filePath);
		if (entries.length === 0) return {};
		migrateToCurrentVersion(entries);
		const sessionEntries = entries.filter((entry): entry is SessionEntry => entry.type !== "session");
		if (sessionEntries.length === 0) return {};
		const context = buildSessionContext(sessionEntries);
		const byId = new Map(sessionEntries.map(entry => [entry.id, entry]));
		const branch: SessionEntry[] = [];
		const seen = new Set<string>();
		const leafId = resolveSessionLeafId(sessionEntries);
		let cursor = leafId === null ? undefined : byId.get(leafId);
		while (cursor && !seen.has(cursor.id)) {
			seen.add(cursor.id);
			branch.push(cursor);
			cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
		}
		branch.reverse();
		let newestModelChange: SessionEntry | undefined;
		for (let index = branch.length - 1; index >= 0; index--) {
			if (branch[index]?.type === "model_change") {
				newestModelChange = branch[index];
				break;
			}
		}
		const sessionLocalModel =
			newestModelChange?.type === "model_change" &&
			(newestModelChange.role === "temporary" || newestModelChange.role === PREWALK_MODEL_CHANGE_ROLE)
				? newestModelChange.model
				: undefined;
		const selectedModel = sessionLocalModel ?? context.models.default;
		const configuredThinking = context.configuredThinkingLevel;
		return {
			...(selectedModel ? { selectedModel } : {}),
			...(configuredThinking ? { configuredThinking } : {}),
			...(configuredThinking !== undefined && context.thinkingLevel
				? { effectiveThinking: context.thinkingLevel }
				: {}),
		};
	} catch {
		return {};
	}
}

/**
 * Inspect a live descendant's effective routing, or a parked descendant's
 * persisted contract without starting or billing a session.
 */
export class StudioAgentModelService {
	constructor(readonly session: AgentSession) {}
	async execute(operation: AgentModelOperation): Promise<AgentModelInspection> {
		if (this.session.isDisposed) throw unavailable("The parent session is no longer live");
		if (operation.sessionId !== this.session.sessionId)
			throw unavailable("Agent model request belongs to another session");
		const ref = ownedStudioAgent(this.session, operation.agentId);
		if (!ref) throw unavailable("The agent is not available in this session's registry");
		if (ref.session && isAgentViewSession(ref.session) && Reflect.get(ref.session, "isDisposed") !== true) {
			const session = ref.session;
			const model = session.model;
			const serving = session.servingModel;
			const configured = session.configuredThinkingLevel(),
				effective = session.thinkingLevel;
			return {
				agentId: ref.id,
				source: "live",
				...(model ? { selectedModel: model.provider + "/" + model.id } : {}),
				...(serving
					? { servingModel: serving.modelIdentity ?? serving.selector, usingFallback: serving.isFallback }
					: {}),
				...(configured ? { configuredThinking: configured } : {}),
				...(effective ? { effectiveThinking: effective } : {}),
				...candidates(extractSessionInit(session.sessionManager.getBranch())),
			};
		}
		if (ref.sessionFile) {
			const file = ref.sessionFile;
			const sourceSession = ref.session;
			// Existing cold-read loaders: neither opens the session, takes its
			// write lock, nor revives it. `session_init` pins a per-call worker's
			// exact model; otherwise the active branch carries any later model or
			// thinking switch (and old journals carry their legacy default).
			const [peek, projection] = await Promise.all([SessionManager.peekSessionInit(file), dormantProjection(file)]);
			if (
				this.session.isDisposed ||
				ownedStudioAgent(this.session, operation.agentId) !== ref ||
				ref.sessionFile !== file ||
				ref.session !== sourceSession
			)
				throw unavailable("The agent changed while its saved model configuration was being read");
			const init = peek?.init ?? null;
			const pinned = init?.perCallModel === true;
			const selectedModel = pinned ? init.perCallModelIdentity : (projection.selectedModel ?? init?.resolvedModel);
			const configuredThinking = pinned
				? init.perCallThinkingLevel
				: (projection.configuredThinking ?? init?.perCallThinkingLevel);
			const effectiveThinking =
				!pinned && projection.configuredThinking !== undefined ? projection.effectiveThinking : undefined;
			return {
				agentId: ref.id,
				source: "saved",
				...(selectedModel ? { selectedModel } : {}),
				...(configuredThinking ? { configuredThinking } : {}),
				...(effectiveThinking ? { effectiveThinking } : {}),
				...candidates(init),
			};
		}
		return { agentId: ref.id, source: "starting" };
	}
}

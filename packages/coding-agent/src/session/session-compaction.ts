import { resolveThresholdTokens } from "@linxiraos/pi-agent-core/compaction";
import type { Model } from "@linxiraos/pi-ai";
import type { ScopeLike } from "../config/registry";
import type { CompactionSettings } from "./context-settings";
import { resolveModelCompactionSettings } from "./model-compaction-threshold";
import {
	type SessionCompactionState,
	type SessionCompactionThreshold,
	readSessionCompactionThreshold,
} from "./session-compaction-types";
import type { SessionManager } from "./session-manager";

type CompactionSessionManager = Pick<SessionManager, "getSessionId" | "getEntries">;

/** The conversation override recorded on this session, if any. */
export function sessionCompactionThreshold(manager: CompactionSessionManager): SessionCompactionThreshold | null {
	return readSessionCompactionThreshold(manager.getSessionId(), manager.getEntries());
}

/**
 * The conversation wins over model rules, without changing Settings or
 * child/advisor policies. Percentages are resolved against the current model
 * on every check, so a model-window change moves the trigger.
 */
export function resolveSessionCompactionSettings(
	settings: ScopeLike,
	model: Model | null | undefined,
	manager: CompactionSessionManager,
): CompactionSettings {
	const configured = resolveModelCompactionSettings(settings, model);
	const threshold = sessionCompactionThreshold(manager);
	if (!threshold) return configured;
	const { baseWindowTokens: _base, ...base } = configured;
	return {
		...base,
		thresholdPercent: threshold.kind === "percent" ? threshold.value : -1,
		thresholdTokens:
			threshold.kind === "tokens"
				? threshold.value
				: model?.contextWindow
					? Math.max(1, Math.floor((model.contextWindow * threshold.value) / 100))
					: -1,
	};
}

/** A host-facing snapshot of the policy in force for the live conversation. */
export function readSessionCompactionState(session: {
	readonly sessionId: string;
	readonly sessionManager: CompactionSessionManager;
	readonly settings: ScopeLike;
	readonly model: Model | null | undefined;
}): SessionCompactionState {
	const configured = resolveSessionCompactionSettings(session.settings, session.model, session.sessionManager);
	const contextWindow = session.model?.contextWindow ?? 0;
	const automatic = configured.enabled;
	return {
		sessionId: session.sessionId,
		threshold: sessionCompactionThreshold(session.sessionManager),
		contextWindow,
		automatic,
		triggerTokens: automatic && contextWindow > 0 ? resolveThresholdTokens(contextWindow, configured) : null,
	};
}

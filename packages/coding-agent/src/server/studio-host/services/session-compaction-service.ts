import { invalid } from "../errors.js";
import type { SessionCompactionState } from "../protocol/contracts/session-compaction.js";
import {
	formatSessionCompactionInput,
	parseSessionCompactionInput,
	SESSION_COMPACTION_ENTRY,
} from "../protocol/contracts/session-compaction.js";
import { readSessionCompactionState, sessionCompactionThreshold } from "./session-compaction-policy.js";
import type { AgentSession } from "../../../session/agent-session.js";

/** The native session surface this service needs; a real {@link AgentSession} satisfies it. */
export interface SessionCompactionHost {
	readonly sessionId: string;
	readonly sessionManager: AgentSession["sessionManager"];
	readonly settings: AgentSession["settings"];
	readonly model: AgentSession["model"];
	refreshIdleMaintenance(): void;
}

/**
 * The official conversation threshold surface. It writes the existing durable
 * `studio.compaction-threshold` custom entry for exactly this session and reads
 * it back through the same native policy maintenance and context usage use.
 */
export class StudioSessionCompactionService {
	constructor(readonly session: SessionCompactionHost) {}

	get(): SessionCompactionState {
		return readSessionCompactionState(this.session);
	}

	async set(input: string): Promise<SessionCompactionState> {
		let threshold;
		try {
			threshold = parseSessionCompactionInput(input);
		} catch (cause) {
			throw invalid(cause instanceof Error ? cause.message : "Invalid compaction threshold");
		}
		const manager = this.session.sessionManager;
		manager.appendCustomEntry(SESSION_COMPACTION_ENTRY, {
			sessionId: this.session.sessionId,
			input: formatSessionCompactionInput(threshold),
		});
		await manager.ensureOnDisk();
		await manager.flush();
		this.session.refreshIdleMaintenance();
		return this.get();
	}

	/** Persisted threshold without a live session, for the history conversation surface. */
	static read(manager: Pick<AgentSession["sessionManager"], "getSessionId" | "getEntries">): SessionCompactionState {
		const sessionId = manager.getSessionId();
		return {
			sessionId,
			threshold: sessionCompactionThreshold(manager),
			contextWindow: 0,
			triggerTokens: null,
			automatic: false,
		};
	}
}

/**
 * Web Gateway — live context accounting (`GET /api/agent/<id>/context`).
 *
 * Backs the web-ui context-statistics panel (right-dock "context" panel,
 * `web-ui/components/context-ring/**`): one snapshot per request carrying the
 * context-window occupancy, the per-category composition of the window, the
 * auto-compaction threshold, and the session's cumulative token/call counters.
 *
 * Everything here is a projection of existing accounting — no new token math:
 * - `computeSessionContextBreakdown` (session/context-usage-runtime.ts) gives
 *   the category split, the window, the free/auto-compaction budget and the
 *   `usedTokens` anchor arithmetic.
 * - `getSessionCompactionBoundaries` gives the threshold / speculation
 *   percentages for the gauge markers.
 * - `AgentSession.getSessionStats()` gives the cumulative usage and call
 *   counters (`tokens.*`, message/tool counts, cost, routed models).
 *
 * Requires a live in-process session: the breakdown reads the agent's live
 * message state and tokenizer, which only the gateway's own
 * `AgentSessionWrapper` owns. Non-live sessions answer `{ running: false }`,
 * mirroring `GET /api/agent/<id>`.
 */

import { logger } from "@linxiraos/pi-utils";
import { computeSessionContextBreakdown, getSessionCompactionBoundaries } from "../../session/context-usage-runtime";
import type { AgentSession } from "../../session/agent-session";
import { getRpcSession } from "./agents";

/** Category ids, in panel/legend order. Stable wire contract. */
export type ContextUsageCategoryId = "systemPrompt" | "systemTools" | "systemContext" | "skills" | "messages";

export interface ContextUsageCategory {
	id: ContextUsageCategoryId;
	/** Estimated tokens this category occupies in the active context. */
	tokens: number;
}

export interface ContextUsageReport {
	sessionId: string;
	model: { provider: string; modelId: string } | null;
	/** Total model context window, or 0 when the model is unknown. */
	contextWindow: number;
	/** Estimated tokens currently occupying the window. */
	usedTokens: number;
	/** `usedTokens / contextWindow * 100`, 0 when the window is unknown. */
	percent: number;
	categories: ContextUsageCategory[];
	/** Window tokens still free after `usedTokens` and the compaction buffer. */
	freeTokens: number;
	/** Window tokens reserved so auto-compaction can fire before the window fills. */
	autoCompactBufferTokens: number;
	compaction: {
		/** Whether auto-compaction is enabled and configured for this session. */
		enabled: boolean;
		/** Tokens at which auto-compaction fires, or null when disabled/unknown. */
		thresholdTokens: number | null;
		/** `thresholdTokens / contextWindow * 100`, or null. */
		thresholdPercent: number | null;
		/** Percent at which speculative summarization starts, or null. */
		speculationPercent: number | null;
	};
	/** Session-cumulative provider token counters (input excludes cache reads). */
	usage: {
		input: number;
		output: number;
		reasoning: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	/** Session-cumulative message and call counters. */
	calls: {
		userMessages: number;
		assistantMessages: number;
		toolCalls: number;
		toolResults: number;
		totalMessages: number;
		premiumRequests: number;
	};
	/** Session-cumulative provider cost, in the provider's currency. */
	cost: number;
	/** Concrete provider-routed model ids with finalized turn counts. */
	routedModels: Record<string, number> | null;
}

/**
 * Project a live session into the panel's wire report.
 *
 * Exported for the gateway tests: it is the whole data contract of
 * `GET /api/agent/<id>/context` minus the liveness gate.
 */
export function buildContextUsageReport(session: AgentSession): ContextUsageReport {
	const breakdown = computeSessionContextBreakdown(session);
	const stats = session.getSessionStats();
	const boundaries = getSessionCompactionBoundaries(session.settings, breakdown.contextWindow, session.model);
	const thresholdTokens = breakdown.thresholdTokens ?? null;
	const model = session.model;

	return {
		sessionId: session.sessionId,
		model: model ? { provider: model.provider, modelId: model.id } : null,
		contextWindow: breakdown.contextWindow,
		usedTokens: breakdown.usedTokens,
		percent: breakdown.contextWindow > 0 ? (breakdown.usedTokens / breakdown.contextWindow) * 100 : 0,
		categories: breakdown.categories.map(category => ({ id: category.id, tokens: category.tokens })),
		freeTokens: breakdown.freeTokens,
		autoCompactBufferTokens: breakdown.autoCompactBufferTokens,
		compaction: {
			enabled: thresholdTokens !== null,
			thresholdTokens,
			thresholdPercent: boundaries?.thresholdPercent ?? null,
			speculationPercent: boundaries?.speculationPercent ?? null,
		},
		usage: { ...stats.tokens },
		calls: {
			userMessages: stats.userMessages,
			assistantMessages: stats.assistantMessages,
			toolCalls: stats.toolCalls,
			toolResults: stats.toolResults,
			totalMessages: stats.totalMessages,
			premiumRequests: stats.premiumRequests,
		},
		cost: stats.cost,
		routedModels: stats.routedModels ?? null,
	};
}

export function handleAgentContextUsage(sessionId: string): Response {
	try {
		const wrapper = getRpcSession(sessionId);
		if (!wrapper?.isAlive()) {
			return Response.json({ running: false });
		}
		return Response.json({ running: true, context: buildContextUsageReport(wrapper.getSession()) });
	} catch (error) {
		logger.error("web-gateway: agent context usage failed", { sessionId, error: String(error) });
		return Response.json({ error: String(error) }, { status: 500 });
	}
}

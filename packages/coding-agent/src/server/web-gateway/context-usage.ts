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
 * - `AgentSession.messages` + the agent's tokenizer give `tools`: the live
 *   transcript's tool results aggregated by tool name. That is the one
 *   aggregation this file computes, and it is memoized per session (see
 *   {@link computeToolOccupancy}) because the panel polls this route.
 *
 * Requires a live in-process session: the breakdown reads the agent's live
 * message state and tokenizer, which only the gateway's own
 * `AgentSessionWrapper` owns. Non-live sessions answer
 * `{ running: false, tools: [] }`, mirroring `GET /api/agent/<id>`: the panel
 * gets an explicit empty tool list instead of an error.
 */

import type { AgentMessage } from "@linxiraos/pi-agent-core";
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

/** One tool's share of the live transcript's tool results. */
export interface ContextUsageToolEntry {
	/** `ToolResultMessage.toolName`, unique within a report's `tools`. */
	name: string;
	/** Estimated tokens all of this tool's live tool results occupy. */
	tokens: number;
	/** Number of live tool-result messages attributed to this tool. */
	results: number;
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
	/**
	 * Live transcript tool results aggregated by tool name, descending by
	 * `tokens` (ties broken by name, so the order is stable). Distinct from
	 * `calls.toolResults`, which is a cumulative session counter that survives
	 * compaction: this list only ever describes what is in the window now.
	 */
	tools: ContextUsageToolEntry[];
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
 * Identity of the newest message, for cache keying. Live messages carry no id
 * of their own, so this uses the fields that identify a settled message in
 * place: the tool-call id for tool results, otherwise role + timestamp.
 */
function lastMessageKey(message: AgentMessage | undefined): string {
	if (!message) return "";
	if (message.role === "toolResult") return `toolResult:${message.toolCallId}`;
	return typeof message.timestamp === "number" ? `${message.role}:${message.timestamp}` : message.role;
}

/**
 * Last computed occupancy per session. `WeakMap` so a disposed session's entry
 * dies with it — the gateway never has to invalidate anything.
 */
const toolOccupancyCache = new WeakMap<AgentSession, { version: string; tools: ContextUsageToolEntry[] }>();

/**
 * Aggregate the live transcript's tool results by tool name.
 *
 * `tokens` is the session's own tokenizer's estimate of each tool-result
 * message (the same counter the breakdown uses), summed per tool: no second
 * estimation scheme is introduced here. The walk is memoized on a transcript
 * version — length + newest-message identity — because the panel polls this
 * route, so an unchanged (append-only) transcript must not re-tokenize its
 * tool results; a compaction rewrite changes the length and recomputes.
 *
 * Exported for the gateway tests, like {@link buildContextUsageReport}: the
 * merge/sum and the memo hit are the contract being pinned.
 */
export function computeToolOccupancy(session: AgentSession): ContextUsageToolEntry[] {
	const messages = session.messages;
	const version = `${messages.length}|${lastMessageKey(messages[messages.length - 1])}`;
	const cached = toolOccupancyCache.get(session);
	if (cached?.version === version) return cached.tools;

	const tokenizer = session.agent.tokenizer;
	const byName = new Map<string, ContextUsageToolEntry>();
	for (const message of messages) {
		if (message.role !== "toolResult") continue;
		const name = message.toolName;
		const tokens = tokenizer.countMessage(message);
		const entry = byName.get(name);
		if (entry) {
			entry.tokens += tokens;
			entry.results += 1;
		} else {
			byName.set(name, { name, tokens, results: 1 });
		}
	}
	// Descending by tokens — the panel draws this order directly. The name
	// tie-break keeps equal-sized tools in a stable, reproducible order.
	const tools = [...byName.values()].sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
	toolOccupancyCache.set(session, { version, tools });
	return tools;
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
		tools: computeToolOccupancy(session),
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
			return Response.json({ running: false, tools: [] });
		}
		return Response.json({ running: true, context: buildContextUsageReport(wrapper.getSession()) });
	} catch (error) {
		logger.error("web-gateway: agent context usage failed", { sessionId, error: String(error) });
		return Response.json({ error: String(error) }, { status: 500 });
	}
}

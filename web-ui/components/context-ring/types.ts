/**
 * Wire contract of `GET /api/agent/<id>/context`
 * (gateway: `packages/coding-agent/src/server/web-gateway/context-usage.ts`).
 *
 * The web-ui process imports no `@linxiraos/*` runtime or type entry, so the
 * DTO is mirrored here and the gateway JSON is the source of truth.
 */

/** Context categories, in legend order. */
export type ContextCategoryId = "systemPrompt" | "systemTools" | "systemContext" | "skills" | "messages";

export const CONTEXT_CATEGORY_IDS: readonly ContextCategoryId[] = [
	"systemPrompt",
	"systemTools",
	"systemContext",
	"skills",
	"messages",
];

export interface ContextCategoryUsage {
	id: ContextCategoryId;
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
	categories: ContextCategoryUsage[];
	/** Window tokens still free after `usedTokens` and the compaction buffer. */
	freeTokens: number;
	/** Window tokens reserved so auto-compaction can fire before the window fills. */
	autoCompactBufferTokens: number;
	compaction: {
		enabled: boolean;
		thresholdTokens: number | null;
		thresholdPercent: number | null;
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
	routedModels: Record<string, number> | null;
}

/** Envelope of `GET /api/agent/<id>/context`: the session must be live. */
export type ContextUsageEnvelope =
	| { running: false }
	| { running: true; context: ContextUsageReport };

/**
 * Dedicated compaction agent.
 *
 * Owns exactly one responsibility: **produce the compaction summary artifact** —
 * build the summarizer's context (extension context + deterministic fidelity
 * ledger), call the engine summarizer once for a given model/candidate, and
 * return the summary together with the fidelity artifact.
 *
 * It does not pick a model, retry a candidate, classify auth failures, disconnect
 * the live turn, append an entry, or emit progress. Those stay where they already
 * live (`SessionMaintenance` and `CompactionService`), so the shared
 * manual/auto/speculation pipeline is untouched.
 */

import * as engine from "@linxiraos/pi-agent-core/compaction";
import type { CompactionPreparation, CompactionResult, SummaryOptions } from "@linxiraos/pi-agent-core/compaction";
import type { ApiKeyResolver, Model } from "@linxiraos/pi-ai";
import fidelityLedgerPrompt from "./prompts/fidelity-ledger.md" with { type: "text" };
import {
	type CompactionFidelity,
	type FidelityTracking,
	extractCompactionFidelity,
	hasFidelityFacts,
	renderFidelityLedger,
	withCompactionFidelity,
} from "./fidelity";

export interface CompactionAgentInput {
	preparation: CompactionPreparation;
	model: Model;
	/** Live key resolver from the session's registry (auth retry/refresh included). */
	resolver: ApiKeyResolver;
	customInstructions?: string;
	signal: AbortSignal;
	/** Engine request options assembled by the session (transport, cache keys, thinking level…). */
	options?: SummaryOptions;
	/** Present only when project tracking is enabled for this session. */
	tracking?: FidelityTracking;
	/** Injected clock for deterministic artifacts in tests. */
	now?: () => number;
}

export interface CompactionAgentArtifact {
	result: CompactionResult;
	fidelity: CompactionFidelity;
}

/** The summarizer context this agent builds for one attempt. */
export interface CompactionSummarizerContext {
	extraContext: string[] | undefined;
	fidelity: CompactionFidelity;
}

export class CompactionAgent {
	/**
	 * Build the summarizer's side context: the extension/memory context the session
	 * already collected, plus the fidelity ledger when the discarded range carried
	 * any retainable fact. An empty extraction adds nothing — it never fabricates a
	 * ledger, and the artifact records the empty buckets honestly.
	 */
	buildContext(
		preparation: CompactionPreparation,
		options: { extraContext?: string[]; tracking?: FidelityTracking; now?: () => number } = {},
	): CompactionSummarizerContext {
		const fidelity = extractCompactionFidelity({
			messages: [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages],
			...(options.tracking ? { tracking: options.tracking } : {}),
			...(options.now ? { now: options.now } : {}),
		});
		if (!hasFidelityFacts(fidelity)) {
			return { extraContext: options.extraContext, fidelity };
		}
		const ledger = renderFidelityLedger(fidelity, { instructions: fidelityLedgerPrompt });
		return {
			extraContext: [...(options.extraContext ?? []), ledger],
			fidelity,
		};
	}

	/**
	 * Produce the summary artifact for one model candidate. Errors from the engine
	 * propagate unchanged: retry/auth/fallback classification is the caller's
	 * existing policy, not this agent's.
	 */
	async summarize(input: CompactionAgentInput): Promise<CompactionAgentArtifact> {
		const context = this.buildContext(input.preparation, {
			...(input.options?.extraContext ? { extraContext: input.options.extraContext } : {}),
			...(input.tracking ? { tracking: input.tracking } : {}),
			...(input.now ? { now: input.now } : {}),
		});
		const result = await engine.compact(
			input.preparation,
			input.model,
			input.resolver,
			input.customInstructions,
			input.signal,
			{ ...input.options, ...(context.extraContext ? { extraContext: context.extraContext } : {}) },
		);
		return {
			result: { ...result, preserveData: withCompactionFidelity(result.preserveData, context.fidelity) },
			fidelity: context.fidelity,
		};
	}
}

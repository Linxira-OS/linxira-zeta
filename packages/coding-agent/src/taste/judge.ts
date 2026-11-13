/**
 * The optional semantic step: ask a model what a candidate *is*, never how much
 * to trust it.
 *
 * Three tiers, selected by the `taste` model role (then `judge`, then `smol`):
 *
 * - **T2 — decision model** (`kind: judge`): answers a `noul` question with a
 *   calibrated probability, plus category/polarity/strength. The probability
 *   enters the Beta posterior as pseudo-counts; the category drives nothing but
 *   the coverage term. Nothing here can raise the posterior on its own: a judge
 *   that says "certainly" over an empty evidence tally lands near 0.75, not 1.
 * - **T1 — chat model**: classification only. Category and polarity are taken;
 *   whatever confidence the model wrote is discarded, because an uncalibrated
 *   number in a Beta posterior is worse than no number.
 * - **T0 — no model**: no call at all. The host falls back to the extraction
 *   step's own labels, which is the default and costs nothing.
 *
 * A failed, timed-out or unparseable call degrades to T0 for that candidate. The
 * layer never blocks consolidation on a model.
 */
import { completeSimple, createNativeJudge, type Model } from "@linxiraos/pi-ai";
import type { FetchImpl } from "@linxiraos/pi-utils";
import { type ChoiceQuestion, type NoulQuestion, type Questions, type ScoreQuestion } from "@linxiraos/pi-ai";
import { modelKind } from "@linxiraos/pi-catalog/types";
import { logger } from "@linxiraos/pi-utils";

import { cfgJudgmentAttemptTimeoutMs } from "../config/model-settings";
import type { ModelRegistry } from "../config/model-registry";
import { resolveRoleSelection } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import { cfgMemoryBackend } from "../memory-backend/settings";
import { cfgMnemopiLlmMode } from "../mnemopi/settings";
import { TASTE_CATEGORIES, type TasteCategory, type TastePolarity } from "./store";

/** Tiers, in decreasing capability. `T0` is the documented default. */
export type TasteTier = "T0" | "T1" | "T2";

/** What a judge call can tell the host. Absent fields mean "not answered". */
export interface TasteJudgment {
	tier: TasteTier;
	category?: TasteCategory;
	polarity?: TastePolarity;
	/** T2 only: the calibrated probability and the strength that scales its pseudo-counts. */
	posterior?: { p: number; strength: number };
	/** Role the call resolved through (`taste`, `judge`, `smol`), for logs. */
	role?: string;
	/** Backend label, e.g. `typesafe/jev-latest`. */
	model?: string;
}

/** A candidate as the judge sees it: the statement plus what the user actually said. */
export interface TasteJudgeInput {
	statement: string;
	evidence: string;
}

/** Roles tried in order; the first that resolves to a model wins. */
const TASTE_ROLE_CHAIN = ["taste", "judge", "smol"] as const;

/** Strength level → pseudo-count scale. */
const STRENGTH_SCALE = { 0: 0.5, 1: 0.75, 2: 1 } as const;

/** Below this choice-distribution concentration the category is not trusted. */
const CATEGORY_CONFIDENCE_FLOOR = 0.4;

const CATEGORY_CRITERIA: Record<TasteCategory, string | null> = {
	cli: "how the user runs or configures the command-line tool",
	typescript: "TypeScript/JavaScript language, typing or build-tool conventions",
	architecture: "system structure, module boundaries or protocol decisions",
	style: "code style, formatting or naming",
	workflow: "process: review, testing, branching, release or agent working habits",
	other: null,
};

const QUESTIONS = {
	is_preference: {
		type: "noul",
		instructions:
			"Does the user state a durable preference about how this codebase or tool should be used, rather than a one-off request about the current task?",
		criteria: {
			true: "A habit, convention or taste that would still hold on a different day or a different file",
			false: "A request about this task, this file, or this moment only",
		},
	} satisfies NoulQuestion,
	category: {
		type: "choice",
		instructions: "Which area does the preference belong to?",
		criteria: CATEGORY_CRITERIA,
	} satisfies ChoiceQuestion,
	polarity: {
		type: "choice",
		instructions: "Is the user asking for this, or asking to avoid it?",
		criteria: {
			prefer: "The user wants this to happen",
			avoid: "The user does not want this to happen",
		},
	} satisfies ChoiceQuestion,
	strength: {
		type: "score",
		instructions: "How firmly is the preference expressed?",
		criteria: [
			"mentioned in passing",
			"stated as a preference",
			"stated as a rule, or corrected once already violated",
		],
	} satisfies ScoreQuestion,
} satisfies Questions;

export interface TasteJudgeDeps {
	settings: Settings;
	modelRegistry: ModelRegistry;
	sessionId: string;
	/** Transport override for tests; production uses the registry's provider. */
	fetch?: FetchImpl;
}

/**
 * Ask a model what a candidate is. Returns `undefined` in T0, when no role
 * resolves, or when the call fails — callers treat all three identically.
 */
export async function scoreWithJudge(input: TasteJudgeInput, deps: TasteJudgeDeps): Promise<TasteJudgment | undefined> {
	if (cfgMemoryBackend.get(deps.settings) === "mnemopi" && cfgMnemopiLlmMode.get(deps.settings) === "none")
		return undefined;
	for (const role of TASTE_ROLE_CHAIN) {
		const selection = resolveRoleSelection([role], deps.settings, deps.modelRegistry.getAvailable("all"));
		if (!selection) continue;
		const model = selection.model;
		try {
			if (modelKind(model) === "judge") {
				return await judgeNative(input, model, deps, role);
			}
			if (modelKind(model) === "chat" || modelKind(model) === "tiny") {
				return await judgeChat(input, model, deps, role);
			}
			// Image/speech/web models cannot classify text; keep walking the chain.
			continue;
		} catch (error) {
			logger.debug("taste: judge call failed", {
				role,
				model: `${model.provider}/${model.id}`,
				error: error instanceof Error ? error.message : String(error),
			});
			return undefined;
		}
	}
	return undefined;
}

async function judgeNative(
	input: TasteJudgeInput,
	model: Model,
	deps: TasteJudgeDeps,
	role: string,
): Promise<TasteJudgment | undefined> {
	if (!(await deps.modelRegistry.getApiKey(model, deps.sessionId))) return undefined;
	const apiKey = deps.modelRegistry.resolver(model, deps.sessionId);
	const headers = await deps.modelRegistry.resolveModelHeaders(model);
	const judge = createNativeJudge(model, { apiKey, headers, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
	const result = await judge.judge({
		state: { statement: input.statement, said: input.evidence },
		questions: QUESTIONS,
	});
	const answers = result.answers;
	const category = answers.category.choice as TasteCategory;
	return {
		tier: "T2",
		role,
		model: judge.label,
		posterior: {
			p: answers.is_preference.noul,
			strength: STRENGTH_SCALE[Math.round(answers.strength.score) as 0 | 1 | 2] ?? 0.75,
		},
		category: answers.category.confidence < CATEGORY_CONFIDENCE_FLOOR ? "other" : category,
		polarity: answers.polarity.choice as TastePolarity,
	};
}

async function judgeChat(
	input: TasteJudgeInput,
	model: Model,
	deps: TasteJudgeDeps,
	role: string,
): Promise<TasteJudgment | undefined> {
	if (!(await deps.modelRegistry.getApiKey(model, deps.sessionId))) return undefined;
	const apiKey = deps.modelRegistry.resolver(model, deps.sessionId);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), cfgJudgmentAttemptTimeoutMs.get(deps.settings));
	try {
		const message = await completeSimple(
			model,
			{
				systemPrompt: [
					"You classify coding preferences. Answer with JSON only.",
					`{"is_preference": true|false, "category": ${TASTE_CATEGORIES.map(category => JSON.stringify(category)).join("|")}, "polarity": "prefer"|"avoid"}`,
				],
				messages: [
					{
						role: "user",
						content: `<statement>${input.statement}</statement>\n<user_said>${input.evidence}</user_said>`,
						timestamp: Date.now(),
					},
				],
			},
			{ apiKey, signal: controller.signal, sessionId: deps.sessionId, maxTokens: 200 },
		);
		const text = message.content
			.map(part => (part.type === "text" ? part.text : ""))
			.join("")
			.trim();
		const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {
			is_preference?: unknown;
			category?: unknown;
			polarity?: unknown;
		};
		if (parsed.is_preference === false) return undefined;
		// Classification only: any confidence the model emitted is ignored on
		// purpose, an uncalibrated number must not move the Beta posterior.
		return {
			tier: "T1",
			role,
			model: `${model.provider}/${model.id}`,
			category: isTasteCategory(parsed.category) ? parsed.category : "other",
			polarity: parsed.polarity === "avoid" ? "avoid" : "prefer",
		};
	} finally {
		clearTimeout(timer);
	}
}

function isTasteCategory(value: unknown): value is TasteCategory {
	return typeof value === "string" && (TASTE_CATEGORIES as readonly string[]).includes(value);
}

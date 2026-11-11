/**
 * Candidate extraction: read the prompt the user just sent and record what looks
 * like a durable preference.
 *
 * This step is deliberately *untrusted*. It runs on the cheap text model, its
 * schema has no confidence field, and every candidate must quote the user's own
 * words (`evidenceText` must be a verbatim substring of the prompt). Whatever it
 * returns is a candidate, not a preference: the host decides later whether the
 * behaviour around it corroborates the claim (see `consolidate.ts`).
 *
 * Extraction is fired from the session's `message_start` event, exactly like the
 * sharpshooter backend, so it also covers mid-turn steering prompts. Nothing is
 * awaited on the turn itself: a slow model only delays its own candidates.
 */
import type { AgentMessage } from "@linxiraos/pi-agent-core";
import { completeSimple, Effort, retryTransientCompletion } from "@linxiraos/pi-ai";
import { clampThinkingLevelForModel } from "@linxiraos/pi-catalog/model-thinking";
import { type } from "@linxiraos/zeta-schema";
import { getSegmenter } from "@linxiraos/pi-tui";
import { logger, prompt } from "@linxiraos/pi-utils";

import type { ModelRegistry } from "../config/model-registry";
import { resolveRoleSelection } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import extractInputTemplate from "../prompts/taste/extract-input.md" with { type: "text" };
import extractSystemTemplate from "../prompts/taste/extract-system.md" with { type: "text" };
import type { AgentSession } from "../session/agent-session";
import { customMessageContentText } from "../session/checkpoint-entries";
import { tasteWriteScope } from "./consolidate";
import { appendTasteCandidate, type TasteCandidate } from "./queue";
import { resolveTasteScopes } from "./scope";
import { cfgTasteMinPromptLength } from "./settings";
import { TASTE_CATEGORIES, type TasteCategory, type TastePolarity } from "./store";

const candidateSchema = type({
	category: "'cli' | 'typescript' | 'architecture' | 'style' | 'workflow' | 'other'",
	statement: "string",
	polarity: "'prefer' | 'avoid'",
	evidenceText: "string",
});

const recordPreferencesTool = {
	name: "record_preferences",
	description: "Record every durable preference the current user prompt states, quoting the user's own words.",
	parameters: type({ preferences: candidateSchema.array() }),
};

/** Smallest prompt worth a model call (grapheme count). */
const MIN_PROMPT_LENGTH_FLOOR = 8;

const kExtractionInFlight = Symbol("taste.extractionInFlight");

interface ExtractionHost extends AgentSession {
	[kExtractionInFlight]?: Promise<void>;
}

interface RawCandidate {
	category?: unknown;
	statement?: unknown;
	polarity?: unknown;
	evidenceText?: unknown;
}

/** Await the in-flight extraction, bounded by `timeoutMs`, so a short process still persists it. */
export async function flushTasteExtraction(session: AgentSession, timeoutMs = 5_000): Promise<void> {
	const pending = (session as ExtractionHost)[kExtractionInFlight];
	if (!pending) return;
	const bound = Promise.withResolvers<void>();
	const timer = setTimeout(bound.resolve, Math.max(0, timeoutMs));
	try {
		await Promise.race([pending, bound.promise]);
	} finally {
		clearTimeout(timer);
	}
}

/** The user-visible text of one message. */
function visibleMessageText(message: AgentMessage): string {
	const content = "content" in message ? message.content : undefined;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return customMessageContentText(content as Parameters<typeof customMessageContentText>[0]);
}

/** The prompt to read: the triggering message, or the transcript's latest user turn. */
function currentPrompt(messages: readonly AgentMessage[], current?: AgentMessage): string | undefined {
	const source = current ?? [...messages].reverse().find(message => message.role === "user");
	if (!source) return undefined;
	const text = visibleMessageText(source).trim();
	return text.length > 0 ? text : undefined;
}

/**
 * Fire extraction for one user message. Never throws and never blocks the turn:
 * failures are logged at debug level and the next prompt simply tries again.
 */
export function maybeStartTasteExtraction(options: {
	session: AgentSession;
	settings: Settings;
	modelRegistry: ModelRegistry;
	agentDir: string;
	message?: AgentMessage;
}): void {
	try {
		const { session, settings } = options;
		if (session.isDisposed || (session as ExtractionHost)[kExtractionInFlight]) return;
		const text = currentPrompt(session.messages, options.message);
		if (!text) return;
		// A slash command is the user operating the tool, not stating a preference.
		if (text.startsWith("/")) return;
		const minimum = Math.max(MIN_PROMPT_LENGTH_FLOOR, cfgTasteMinPromptLength.get(settings));
		let characters = 0;
		for (const _grapheme of getSegmenter().segment(text)) {
			if (++characters >= minimum) break;
		}
		if (characters < minimum) return;

		const run = runTasteExtraction(options, text)
			.catch(error => {
				logger.debug("taste: extraction failed", { error: String(error), sessionId: session.sessionId });
			})
			.finally(() => {
				(session as ExtractionHost)[kExtractionInFlight] = undefined;
			});
		(session as ExtractionHost)[kExtractionInFlight] = run;
	} catch (error) {
		logger.debug("taste: extraction could not start", { error: String(error) });
	}
}

async function runTasteExtraction(
	options: { session: AgentSession; settings: Settings; modelRegistry: ModelRegistry; agentDir: string },
	text: string,
): Promise<void> {
	const { session, settings, modelRegistry, agentDir } = options;
	const selection = resolveRoleSelection(["memory", "smol"], settings, modelRegistry.getAvailable("all"));
	const model = selection?.model;
	if (!model || session.isDisposed) return;

	const input = prompt.render(extractInputTemplate, { prompt: text });
	const response = await retryTransientCompletion(
		() =>
			completeSimple(
				model,
				{
					systemPrompt: [prompt.render(extractSystemTemplate)],
					messages: [{ role: "user", content: [{ type: "text", text: input }], timestamp: Date.now() }],
					tools: [recordPreferencesTool],
				},
				{
					apiKey: modelRegistry.resolver(model, session.sessionId),
					sessionId: session.sessionId,
					maxTokens: 1024,
					reasoning: clampThinkingLevelForModel(model, Effort.Low),
					toolChoice: "required",
				},
			),
		{ provider: model.provider },
	);
	if (response.stopReason === "error") {
		throw new Error(response.errorMessage || "taste extraction model error");
	}

	const key = tasteWriteScope(
		{
			cwd: session.sessionManager.getCwd(),
			agentId: session.getAgentId(),
			...(session.sessionManager.getMemoryNamespace()
				? { namespace: session.sessionManager.getMemoryNamespace() }
				: {}),
		},
		settings,
	);
	for (const block of response.content) {
		if (block.type !== "toolCall" || block.name !== recordPreferencesTool.name) continue;
		const args = block.arguments;
		if (!args || typeof args !== "object" || !("preferences" in args) || !Array.isArray(args.preferences)) {
			logger.debug("taste: rejected malformed record_preferences call");
			continue;
		}
		for (const raw of args.preferences) {
			const candidate = admitCandidate(raw, text, session.sessionId);
			if (!candidate) continue;
			if (session.isDisposed) return;
			await appendTasteCandidate(agentDir, key, candidate);
		}
	}
}

/**
 * Validate one candidate. The evidence check is the whole point: a model that
 * paraphrased the user is rejected, so nothing enters the store that the user did
 * not literally say.
 */
export function admitCandidate(raw: unknown, currentPromptText: string, sessionId: string): TasteCandidate | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const candidate = raw as RawCandidate;
	const statement = typeof candidate.statement === "string" ? candidate.statement.trim() : "";
	if (!statement) return undefined;
	const evidenceText = typeof candidate.evidenceText === "string" ? candidate.evidenceText.trim() : "";
	if (!evidenceText || !currentPromptText.includes(evidenceText)) {
		logger.debug("taste: rejected candidate with unverifiable evidence", { evidenceText });
		return undefined;
	}
	if (
		typeof candidate.category !== "string" ||
		!(TASTE_CATEGORIES as readonly string[]).includes(candidate.category)
	) {
		return undefined;
	}
	const polarity = candidate.polarity === "avoid" ? "avoid" : candidate.polarity === "prefer" ? "prefer" : undefined;
	if (!polarity) return undefined;
	return {
		v: 1,
		ts: Date.now(),
		sessionId,
		category: candidate.category as TasteCategory,
		statement,
		polarity: polarity as TastePolarity,
		evidenceText,
	};
}

/** Scopes this caller writes to; exported for the tool so both paths agree. */
export { resolveTasteScopes };

/**
 * Thin OpenAI-compatible decision client (`judge` role). It asks one question,
 * optionally with a closed choice set, and returns only the answer text and
 * the matched declared choice. Candidate selection policy is separate and
 * deterministic; this client never silently picks a fallback.
 */
import { assertClientOptions, prepareCapabilityCall, type ClientOptions } from "./client-common";
import { ModelSdkError } from "./errors";
import { joinUrl, requestJson } from "./http";
import { cloneJsonValue, JsonDataError } from "./json";
import { type ChatCompletion, parseChatCompletion } from "./openai-chat";
import type { JsonObject, JsonValue } from "./types";

export interface DecisionClientOptions extends ClientOptions {}

export interface DecisionRequest {
	readonly question: string;
	readonly choices?: readonly string[];
	readonly context?: JsonValue;
	readonly model?: string;
	readonly temperature?: number;
	readonly maxTokens?: number;
	readonly responseFormat?: "text" | "json";
	readonly signal?: AbortSignal;
}

export interface DecisionResult extends ChatCompletion {
	/** The declared choice matched by the answer, when one matched exactly. */
	readonly choice?: string;
}

const DEFAULT_SYSTEM_PROMPT =
	"You are a decision judge. Answer the question directly and concisely. " +
	"When choices are provided, reply with exactly one of them and nothing else.";

function validateDecisionRequest(request: DecisionRequest): void {
	if (typeof request.question !== "string" || request.question.trim() === "") {
		throw new ModelSdkError("Decision request requires a non-empty question.", "invalid_request");
	}
	if (request.choices !== undefined) {
		if (!Array.isArray(request.choices) || request.choices.length === 0) {
			throw new ModelSdkError("Decision choices must be a non-empty array when provided.", "invalid_request");
		}
		const seen = new Set<string>();
		for (const choice of request.choices) {
			if (typeof choice !== "string" || choice.trim() === "") {
				throw new ModelSdkError("Decision choices must be non-empty strings.", "invalid_request");
			}
			const key = choice.trim().toLowerCase();
			if (seen.has(key)) {
				throw new ModelSdkError("Decision choices must be unique ignoring case and whitespace.", "invalid_request");
			}
			seen.add(key);
		}
	}
	if (request.model !== undefined && (typeof request.model !== "string" || request.model.trim() === "")) {
		throw new ModelSdkError("Decision model override must be a non-empty string.", "invalid_request");
	}
	if (
		request.temperature !== undefined &&
		(typeof request.temperature !== "number" ||
			!Number.isFinite(request.temperature) ||
			request.temperature < 0 ||
			request.temperature > 2)
	) {
		throw new ModelSdkError("Decision temperature must be a finite number from 0 to 2.", "invalid_request");
	}
	if (request.maxTokens !== undefined && (!Number.isInteger(request.maxTokens) || request.maxTokens < 1)) {
		throw new ModelSdkError("Decision maxTokens must be a positive integer.", "invalid_request");
	}
	if (request.responseFormat !== undefined && request.responseFormat !== "text" && request.responseFormat !== "json") {
		throw new ModelSdkError('Decision responseFormat must be "text" or "json".', "invalid_request");
	}
}

function decisionPrompt(request: DecisionRequest, contextText: string | undefined): string {
	let prompt = `Question: ${request.question}`;
	if (contextText !== undefined) prompt += `\n\nContext:\n${contextText}`;
	if (request.choices !== undefined) {
		prompt += `\n\nChoices (reply with exactly one):\n${request.choices.map(choice => `- ${choice}`).join("\n")}`;
	}
	return prompt;
}

function matchChoice(answer: string, choices: readonly string[] | undefined): string | undefined {
	if (choices === undefined) return undefined;
	const normalized = answer.trim().toLowerCase();
	return choices.find(choice => choice.trim().toLowerCase() === normalized);
}

function jsonModeAnswer(text: string): { answer: string; choice?: string } {
	try {
		const parsed: unknown = JSON.parse(text);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { answer: text };
		const choice = "choice" in parsed && typeof parsed.choice === "string" ? parsed.choice : undefined;
		const answer = "answer" in parsed && typeof parsed.answer === "string" ? parsed.answer : (choice ?? text);
		return { answer, ...(choice === undefined ? {} : { choice }) };
	} catch {
		return { answer: text };
	}
}

export class DecisionClient {
	readonly #options: DecisionClientOptions;

	constructor(options: DecisionClientOptions) {
		assertClientOptions(options);
		this.#options = options;
	}

	async judge(request: DecisionRequest): Promise<DecisionResult> {
		validateDecisionRequest(request);
		let contextText: string | undefined;
		if (request.context !== undefined) {
			try {
				contextText = JSON.stringify(cloneJsonValue(request.context));
			} catch (error) {
				if (error instanceof JsonDataError) {
					throw new ModelSdkError("Decision context must be plain JSON data.", "invalid_request");
				}
				throw error;
			}
		}
		const prepared = await prepareCapabilityCall(this.#options, "decision", request.signal);
		const declared = prepared.declaration.options;
		const systemPrompt =
			typeof declared.systemPrompt === "string" && declared.systemPrompt.trim() !== ""
				? declared.systemPrompt
				: DEFAULT_SYSTEM_PROMPT;
		const body: JsonObject = {
			model: request.model?.trim() || prepared.declaration.model,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: decisionPrompt(request, contextText) },
			],
		};
		const temperature =
			request.temperature ?? (typeof declared.temperature === "number" ? declared.temperature : undefined);
		if (temperature !== undefined) body.temperature = temperature;
		const maxTokens = request.maxTokens ?? (typeof declared.maxTokens === "number" ? declared.maxTokens : undefined);
		if (maxTokens !== undefined) body.max_tokens = maxTokens;
		const responseFormat =
			request.responseFormat ??
			(declared.responseFormat === "text" || declared.responseFormat === "json" ? declared.responseFormat : "text");
		if (responseFormat === "json") body.response_format = { type: "json_object" };

		const response = await requestJson({
			fetch: this.#options.fetch,
			url: joinUrl(prepared.baseUrl, "/chat/completions"),
			method: "POST",
			headers: prepared.headers,
			body,
			signal: request.signal,
			timeoutMs: this.#options.timeoutMs,
			provider: prepared.declaration.provider,
			capability: "decision",
			secrets: prepared.secret === undefined ? [] : [prepared.secret],
			maxResponseBytes: this.#options.maxResponseBytes,
		});
		const completion = parseChatCompletion(response.data, prepared.declaration.provider, "decision");
		const parsed = responseFormat === "json" ? jsonModeAnswer(completion.text) : { answer: completion.text };
		const choice = matchChoice(parsed.choice ?? parsed.answer, request.choices);
		return {
			...completion,
			text: parsed.answer.trim(),
			...(choice === undefined ? {} : { choice }),
		};
	}
}

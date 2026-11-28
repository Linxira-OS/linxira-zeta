/**
 * OpenAI-compatible chat-completions shapes shared by the chat and decision
 * clients. Parsing is allowlisted: only text, model, finish reason, and token
 * counts leave the SDK, so provider error text or echoed credentials cannot
 * ride a successful response back to the caller.
 */
import { ModelSdkError } from "./errors";
import type { JsonValue, ModelCapability } from "./types";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
	readonly role: ChatRole;
	readonly content: string;
}

export interface ChatUsage {
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly totalTokens?: number;
}

export interface ChatCompletion {
	readonly text: string;
	readonly model?: string;
	readonly finishReason?: string;
	readonly usage?: ChatUsage;
}

function asObject(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | undefined {
	if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value;
}

function textContent(value: JsonValue | undefined): string | undefined {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return undefined;
	const parts: string[] = [];
	for (const part of value) {
		const record = asObject(part);
		if (record === undefined || record.type !== "text" || typeof record.text !== "string") return undefined;
		parts.push(record.text);
	}
	return parts.join("");
}

function usageFrom(value: JsonValue | undefined): ChatUsage | undefined {
	const record = asObject(value);
	if (record === undefined) return undefined;
	const usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
	if (typeof record.prompt_tokens === "number" && Number.isFinite(record.prompt_tokens)) {
		usage.inputTokens = record.prompt_tokens;
	}
	if (typeof record.completion_tokens === "number" && Number.isFinite(record.completion_tokens)) {
		usage.outputTokens = record.completion_tokens;
	}
	if (typeof record.total_tokens === "number" && Number.isFinite(record.total_tokens)) {
		usage.totalTokens = record.total_tokens;
	}
	return Object.keys(usage).length === 0 ? undefined : usage;
}

/** Extracts the assistant text from a chat-completions response body. */
export function parseChatCompletion(data: JsonValue, provider: string, capability: ModelCapability): ChatCompletion {
	const record = asObject(data);
	const choices = record?.choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new ModelSdkError(`Provider "${provider}" ${capability} response has no choices.`, "invalid_response", {
			provider,
			capability,
		});
	}
	const choice = asObject(choices[0]);
	const message = asObject(choice?.message);
	const text = textContent(message?.content) ?? (typeof choice?.text === "string" ? choice.text : undefined);
	if (text === undefined) {
		throw new ModelSdkError(
			`Provider "${provider}" ${capability} response has no assistant text.`,
			"invalid_response",
			{ provider, capability },
		);
	}
	const completion: {
		text: string;
		model?: string;
		finishReason?: string;
		usage?: ChatUsage;
	} = { text };
	if (typeof record?.model === "string") completion.model = record.model;
	if (typeof choice?.finish_reason === "string") completion.finishReason = choice.finish_reason;
	const usage = usageFrom(record?.usage);
	if (usage !== undefined) completion.usage = usage;
	return completion;
}

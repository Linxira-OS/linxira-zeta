/**
 * Thin OpenAI-compatible chat client. Provider capability validation and
 * credential resolution are delegated to the shared call preparation, which
 * runs before fetch; the resolved secret is used only in the Authorization
 * header and in error scrubbing.
 */
import { assertClientOptions, prepareCapabilityCall, type ClientOptions } from "./client-common";
import { ModelSdkError } from "./errors";
import { joinUrl, requestJson } from "./http";
import { type ChatCompletion, type ChatMessage, parseChatCompletion } from "./openai-chat";
import type { JsonObject } from "./types";

export interface ChatClientOptions extends ClientOptions {}

export interface ChatRequest {
	readonly messages: readonly ChatMessage[];
	readonly model?: string;
	readonly temperature?: number;
	readonly maxTokens?: number;
	readonly responseFormat?: "text" | "json";
	readonly signal?: AbortSignal;
}

function validateChatRequest(request: ChatRequest): void {
	if (!Array.isArray(request.messages) || request.messages.length === 0) {
		throw new ModelSdkError("Chat request requires at least one message.", "invalid_request");
	}
	for (const message of request.messages) {
		if (message === null || typeof message !== "object") {
			throw new ModelSdkError("Chat messages must be objects.", "invalid_request");
		}
		if (message.role !== "system" && message.role !== "user" && message.role !== "assistant") {
			throw new ModelSdkError('Chat message role must be "system", "user", or "assistant".', "invalid_request");
		}
		if (typeof message.content !== "string") {
			throw new ModelSdkError("Chat message content must be a string.", "invalid_request");
		}
	}
	if (request.model !== undefined && (typeof request.model !== "string" || request.model.trim() === "")) {
		throw new ModelSdkError("Chat model override must be a non-empty string.", "invalid_request");
	}
	if (
		request.temperature !== undefined &&
		(typeof request.temperature !== "number" ||
			!Number.isFinite(request.temperature) ||
			request.temperature < 0 ||
			request.temperature > 2)
	) {
		throw new ModelSdkError("Chat temperature must be a finite number from 0 to 2.", "invalid_request");
	}
	if (request.maxTokens !== undefined && (!Number.isInteger(request.maxTokens) || request.maxTokens < 1)) {
		throw new ModelSdkError("Chat maxTokens must be a positive integer.", "invalid_request");
	}
	if (request.responseFormat !== undefined && request.responseFormat !== "text" && request.responseFormat !== "json") {
		throw new ModelSdkError('Chat responseFormat must be "text" or "json".', "invalid_request");
	}
}

export class ChatClient {
	readonly #options: ChatClientOptions;

	constructor(options: ChatClientOptions) {
		assertClientOptions(options);
		this.#options = options;
	}

	async complete(request: ChatRequest): Promise<ChatCompletion> {
		validateChatRequest(request);
		const prepared = await prepareCapabilityCall(this.#options, "chat", request.signal);
		const declared = prepared.declaration.options;
		const messages: JsonObject[] = [];
		if (typeof declared.systemPrompt === "string" && declared.systemPrompt.trim() !== "") {
			messages.push({ role: "system", content: declared.systemPrompt });
		}
		for (const message of request.messages) {
			messages.push({ role: message.role, content: message.content });
		}
		const body: JsonObject = {
			model: request.model?.trim() || prepared.declaration.model,
			messages,
		};
		const temperature =
			request.temperature ?? (typeof declared.temperature === "number" ? declared.temperature : undefined);
		if (temperature !== undefined) body.temperature = temperature;
		const maxTokens = request.maxTokens ?? (typeof declared.maxTokens === "number" ? declared.maxTokens : undefined);
		if (maxTokens !== undefined) body.max_tokens = maxTokens;
		const responseFormat =
			request.responseFormat ??
			(declared.responseFormat === "text" || declared.responseFormat === "json"
				? declared.responseFormat
				: undefined);
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
			capability: "chat",
			secrets: prepared.secret === undefined ? [] : [prepared.secret],
			maxResponseBytes: this.#options.maxResponseBytes,
		});
		return parseChatCompletion(response.data, prepared.declaration.provider, "chat");
	}
}

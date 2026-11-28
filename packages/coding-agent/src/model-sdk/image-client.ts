/**
 * Thin OpenAI-compatible image generation client. Image bytes or URLs are
 * returned explicitly; the provider's raw response is discarded.
 */
import { assertClientOptions, prepareCapabilityCall, type ClientOptions } from "./client-common";
import { ModelSdkError } from "./errors";
import { joinUrl, requestJson } from "./http";
import type { JsonObject, JsonValue } from "./types";

export interface ImageClientOptions extends ClientOptions {}

export interface ImageRequest {
	readonly prompt: string;
	readonly model?: string;
	readonly n?: number;
	readonly size?: string;
	readonly quality?: string;
	readonly style?: string;
	readonly responseFormat?: "url" | "b64_json";
	readonly signal?: AbortSignal;
}

export interface GeneratedImage {
	readonly url?: string;
	readonly base64?: string;
	readonly revisedPrompt?: string;
}

export interface ImageResult {
	readonly images: readonly GeneratedImage[];
	readonly model?: string;
}

function validateImageRequest(request: ImageRequest): void {
	if (typeof request.prompt !== "string" || request.prompt.trim() === "") {
		throw new ModelSdkError("Image request requires a non-empty prompt.", "invalid_request");
	}
	if (request.model !== undefined && (typeof request.model !== "string" || request.model.trim() === "")) {
		throw new ModelSdkError("Image model override must be a non-empty string.", "invalid_request");
	}
	if (request.n !== undefined && (!Number.isInteger(request.n) || request.n < 1 || request.n > 10)) {
		throw new ModelSdkError("Image count must be an integer from 1 to 10.", "invalid_request");
	}
	if (
		request.responseFormat !== undefined &&
		request.responseFormat !== "url" &&
		request.responseFormat !== "b64_json"
	) {
		throw new ModelSdkError('Image responseFormat must be "url" or "b64_json".', "invalid_request");
	}
	for (const [name, value] of Object.entries({
		size: request.size,
		quality: request.quality,
		style: request.style,
	})) {
		if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
			throw new ModelSdkError(`Image ${name} must be a non-empty string.`, "invalid_request");
		}
	}
}

function asObject(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | undefined {
	if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value;
}

function parseImages(data: JsonValue, provider: string): readonly GeneratedImage[] {
	const record = asObject(data);
	const entries = record?.data;
	if (!Array.isArray(entries)) {
		throw new ModelSdkError(`Provider "${provider}" image response has no data array.`, "invalid_response", {
			provider,
			capability: "image",
		});
	}
	const images: GeneratedImage[] = [];
	for (const entry of entries) {
		const item = asObject(entry);
		if (item === undefined) continue;
		const image: { url?: string; base64?: string; revisedPrompt?: string } = {};
		if (typeof item.url === "string" && item.url.trim() !== "") image.url = item.url;
		if (typeof item.b64_json === "string" && item.b64_json !== "") image.base64 = item.b64_json;
		if (image.url === undefined && image.base64 === undefined) continue;
		if (typeof item.revised_prompt === "string") image.revisedPrompt = item.revised_prompt;
		images.push(image);
	}
	if (images.length === 0) {
		throw new ModelSdkError(`Provider "${provider}" image response contained no usable images.`, "invalid_response", {
			provider,
			capability: "image",
		});
	}
	return images;
}

export class ImageClient {
	readonly #options: ImageClientOptions;

	constructor(options: ImageClientOptions) {
		assertClientOptions(options);
		this.#options = options;
	}

	async generate(request: ImageRequest): Promise<ImageResult> {
		validateImageRequest(request);
		const prepared = await prepareCapabilityCall(this.#options, "image", request.signal);
		const declared = prepared.declaration.options;
		const body: JsonObject = {
			model: request.model?.trim() || prepared.declaration.model,
			prompt: request.prompt,
		};
		const n = request.n ?? (typeof declared.n === "number" ? declared.n : undefined);
		if (n !== undefined) body.n = n;
		for (const [field, value] of [
			["size", request.size ?? declared.size],
			["quality", request.quality ?? declared.quality],
			["style", request.style ?? declared.style],
		] as const) {
			if (typeof value === "string") body[field] = value;
		}
		const responseFormat =
			request.responseFormat ??
			(declared.responseFormat === "url" || declared.responseFormat === "b64_json"
				? declared.responseFormat
				: undefined);
		if (responseFormat !== undefined) body.response_format = responseFormat;

		const response = await requestJson({
			fetch: this.#options.fetch,
			url: joinUrl(prepared.baseUrl, "/images/generations"),
			method: "POST",
			headers: prepared.headers,
			body,
			signal: request.signal,
			timeoutMs: this.#options.timeoutMs,
			provider: prepared.declaration.provider,
			capability: "image",
			secrets: prepared.secret === undefined ? [] : [prepared.secret],
			maxResponseBytes: this.#options.maxResponseBytes,
		});
		const record = asObject(response.data);
		const result: { images: readonly GeneratedImage[]; model?: string } = {
			images: parseImages(response.data, prepared.declaration.provider),
		};
		if (typeof record?.model === "string") result.model = record.model;
		return result;
	}
}

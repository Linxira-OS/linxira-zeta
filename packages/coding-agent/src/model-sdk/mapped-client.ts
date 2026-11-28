/**
 * Generic client for providers whose wire shape differs from the
 * OpenAI-compatible chat/image endpoints. The provider declaration and
 * credential injection are the same as every other client; only the mapped
 * request/response bodies and endpoint path are provider-specific.
 */
import { assertClientOptions, prepareCapabilityCall, type ClientOptions } from "./client-common";
import { ModelSdkError } from "./errors";
import { joinUrl, requestJson } from "./http";
import { compileApiMapping, type ApiMappingSpec, type CompiledApiMapping, type MappingOptions } from "./mapping";
import { isModelCapability } from "./capabilities";
import type { JsonValue, ModelCapability } from "./types";

export interface MappedClientOptions extends ClientOptions {
	readonly capability: ModelCapability;
	readonly mapping: ApiMappingSpec;
	readonly mappingOptions?: MappingOptions;
}

export interface MappedCallOptions {
	readonly signal?: AbortSignal;
	/** Data visible to mapping expressions as `context`; never sent unless mapped. */
	readonly context?: JsonValue;
}

export class MappedModelClient {
	readonly #options: MappedClientOptions;
	readonly #capability: ModelCapability;
	readonly #mapping: CompiledApiMapping;

	constructor(options: MappedClientOptions) {
		assertClientOptions(options);
		if (!isModelCapability(options.capability)) {
			throw new ModelSdkError("Mapped client requires a known capability.", "invalid_request");
		}
		this.#options = options;
		this.#capability = options.capability;
		this.#mapping = compileApiMapping(options.mapping, options.mappingOptions);
	}

	async call(input?: JsonValue, options: MappedCallOptions = {}): Promise<JsonValue> {
		const prepared = await prepareCapabilityCall(this.#options, this.#capability, options.signal);
		const mapped = this.#mapping.request(input, options.context);
		const credentialHeader = (this.#options.credentialHeader ?? "authorization").toLowerCase();
		for (const name of Object.keys(mapped.headers)) {
			if (name.toLowerCase() === credentialHeader) {
				throw new ModelSdkError("Mapped headers must not override the credential header.", "invalid_request");
			}
		}
		const response = await requestJson({
			fetch: this.#options.fetch,
			url: joinUrl(prepared.baseUrl, mapped.path),
			method: mapped.method,
			headers: { ...prepared.headers, ...mapped.headers },
			body: mapped.body,
			signal: options.signal,
			timeoutMs: this.#options.timeoutMs,
			provider: prepared.declaration.provider,
			capability: this.#capability,
			secrets: prepared.secret === undefined ? [] : [prepared.secret],
			maxResponseBytes: this.#options.maxResponseBytes,
		});
		return this.#mapping.response(response.data, input, options.context);
	}
}

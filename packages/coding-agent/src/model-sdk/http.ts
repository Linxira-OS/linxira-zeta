/**
 * Transport primitive shared by every SDK client.
 *
 * The helper exists so one place owns timeout/abort handling, response shape
 * checks, and error redaction. Provider response bodies never appear in an
 * error: they may echo the credential that was just rejected.
 */
import { ModelSdkError, safeErrorMessage } from "./errors";
import { cloneJsonValue, JsonDataError } from "./json";
import type { JsonValue, ModelCapability, ModelFetch } from "./types";

export interface JsonHttpRequest {
	readonly fetch: ModelFetch;
	readonly url: string;
	readonly method: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body?: JsonValue;
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
	readonly provider: string;
	readonly capability: ModelCapability;
	/** Resolved secrets known to this request, used only to scrub thrown text. */
	readonly secrets?: readonly string[];
	readonly maxResponseBytes?: number;
}

export interface JsonHttpResponse {
	readonly status: number;
	readonly data: JsonValue;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Joins a validated base URL with a relative endpoint path. */
export function joinUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Validates a header map before it reaches fetch. Header values are never
 * included in the thrown message, only the offending name.
 */
export function assertHeaderMap(headers: unknown, label: string): void {
	if (headers === undefined) return;
	if (headers === null || typeof headers !== "object" || Array.isArray(headers)) {
		throw new ModelSdkError(`${label} must be an object of string header values.`, "invalid_request");
	}
	for (const [name, value] of Object.entries(headers)) {
		if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
			throw new ModelSdkError(`${label} contains an invalid header name.`, "invalid_request");
		}
		if (typeof value !== "string" || /[\r\n]/.test(value)) {
			throw new ModelSdkError(`${label} header "${name}" must be a single-line string.`, "invalid_request");
		}
	}
}

/** Rejects caller-supplied credential-bearing headers on SDK-owned maps. */
export function assertNoCredentialHeaders(
	headers: Readonly<Record<string, string>> | undefined,
	credentialHeader = "authorization",
): void {
	if (headers === undefined) return;
	for (const name of Object.keys(headers)) {
		const lowered = name.toLowerCase();
		if (
			lowered === "authorization" ||
			lowered === "proxy-authorization" ||
			lowered === "x-api-key" ||
			lowered === "api-key" ||
			lowered === credentialHeader.toLowerCase()
		) {
			throw new ModelSdkError(
				'Credential headers are injected by the credential resolver, not by static "headers".',
				"invalid_request",
			);
		}
		if (lowered === "cookie") {
			throw new ModelSdkError('The model SDK does not forward "cookie" headers.', "invalid_request");
		}
	}
}

/**
 * Executes one JSON request/response round trip. A non-2xx response throws
 * `http_error` with only the status; the body is not read.
 */
export async function requestJson(request: JsonHttpRequest): Promise<JsonHttpResponse> {
	const controller = new AbortController();
	const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	let timedOut = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const onAbort = () => controller.abort();
	if (request.signal?.aborted) {
		throw new ModelSdkError("Request was aborted before it started.", "request_aborted", {
			provider: request.provider,
			capability: request.capability,
		});
	}
	request.signal?.addEventListener("abort", onAbort, { once: true });
	if (timeoutMs > 0) {
		timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
	}
	const transportFailure = (error: unknown): never => {
		if (timedOut) {
			throw new ModelSdkError(
				`Provider "${request.provider}" ${request.capability} request timed out after ${timeoutMs}ms.`,
				"request_timeout",
				{ provider: request.provider, capability: request.capability },
			);
		}
		if (request.signal?.aborted) {
			throw new ModelSdkError(
				`Provider "${request.provider}" ${request.capability} request was aborted.`,
				"request_aborted",
				{ provider: request.provider, capability: request.capability },
			);
		}
		throw new ModelSdkError(
			`Provider "${request.provider}" ${request.capability} transport failed: ${safeErrorMessage(
				error,
				request.secrets ?? [],
			).slice(0, 300)}`,
			"transport_error",
			{ provider: request.provider, capability: request.capability },
		);
	};
	let response: Response | undefined;
	let text = "";
	let status = 0;
	try {
		try {
			response = await request.fetch(request.url, {
				method: request.method,
				headers: request.headers,
				body: request.body === undefined ? undefined : JSON.stringify(request.body),
				signal: controller.signal,
			});
		} catch (error) {
			transportFailure(error);
		}
		if (response === undefined) {
			throw new ModelSdkError(
				`Provider "${request.provider}" ${request.capability} transport returned no response.`,
				"transport_error",
				{ provider: request.provider, capability: request.capability },
			);
		}
		if (!response.ok) {
			throw new ModelSdkError(
				`Provider "${request.provider}" ${request.capability} request failed with HTTP ${response.status}.`,
				"http_error",
				{ provider: request.provider, capability: request.capability, status: response.status },
			);
		}
		status = response.status;
		try {
			text = await response.text();
		} catch (error) {
			transportFailure(error);
		}
	} finally {
		request.signal?.removeEventListener("abort", onAbort);
		clearTimeout(timer);
	}

	const maxResponseBytes = request.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
	if (text.length > maxResponseBytes) {
		throw new ModelSdkError(
			`Provider "${request.provider}" ${request.capability} response exceeded the size limit.`,
			"invalid_response",
			{ provider: request.provider, capability: request.capability },
		);
	}
	if (text.trim() === "") {
		throw new ModelSdkError(
			`Provider "${request.provider}" ${request.capability} returned an empty response body.`,
			"invalid_response",
			{ provider: request.provider, capability: request.capability },
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new ModelSdkError(
			`Provider "${request.provider}" ${request.capability} returned a non-JSON response body.`,
			"invalid_response",
			{ provider: request.provider, capability: request.capability },
		);
	}
	try {
		return { status, data: cloneJsonValue(parsed) };
	} catch (error) {
		if (error instanceof JsonDataError) {
			throw new ModelSdkError(
				`Provider "${request.provider}" ${request.capability} returned unsupported JSON data.`,
				"invalid_response",
				{ provider: request.provider, capability: request.capability },
			);
		}
		throw error;
	}
}

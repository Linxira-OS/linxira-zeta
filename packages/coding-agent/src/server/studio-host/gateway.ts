/**
 * In-process bridge from Studio operations to the Zeta web gateway.
 *
 * Every Studio operation is a semantic name; the gateway speaks REST. The ops
 * files translate one into the other through here instead of making loopback
 * HTTP calls: `webGatewayFetch` already owns access control, origin checks and
 * the per-process caches, and calling it directly keeps the pair on one code
 * path (no second listener, no second auth scheme).
 */
import { webGatewayFetch } from "../web-gateway";
import type { ClientErrorCode } from "./contract/index.js";

/** The gateway's answer, with a parsed JSON body when it sent one. */
export interface GatewayReply {
	readonly status: number;
	readonly body: unknown;
}

/**
 * A semantic failure the Renderer can map; carries a contract error code, or
 * this host's own `"unsupported"` for an operation it does not implement.
 */
export class StudioOpError extends Error {
	readonly code: ClientErrorCode | "unsupported";

	constructor(code: ClientErrorCode | "unsupported", message: string) {
		super(message);
		this.name = "StudioOpError";
		this.code = code;
	}
}

export function invalid(message: string): StudioOpError {
	return new StudioOpError("INVALID_ARGUMENT", message);
}

export function unavailable(message: string): StudioOpError {
	return new StudioOpError("UNAVAILABLE", message);
}

/** The loopback origin the gateway expects on its own requests. */
const GATEWAY_ORIGIN = "http://127.0.0.1";

export interface GatewayCallOptions {
	readonly method?: string;
	readonly body?: unknown;
	/** Workspace the call reads for; forwarded as `x-zeta-cwd`. */
	readonly cwd?: string;
	readonly headers?: Readonly<Record<string, string>>;
	/** Raw query string, already encoded (without `?`). */
	readonly query?: string;
}

/**
 * Call one gateway route. Non-2xx answers are returned, not thrown, so a caller
 * can distinguish "missing" from "broken" and shape the Studio error itself.
 */
export async function callGateway(path: string, options: GatewayCallOptions = {}): Promise<GatewayReply> {
	if (!path.startsWith("/api/")) throw invalid(`gateway path must start with /api/: ${path}`);
	const url = new URL(path + (options.query ? `?${options.query}` : ""), GATEWAY_ORIGIN);
	const headers = new Headers({ origin: GATEWAY_ORIGIN });
	for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
	if (options.cwd) headers.set("x-zeta-cwd", options.cwd);
	let body: string | undefined;
	if (options.body !== undefined) {
		headers.set("content-type", "application/json");
		body = JSON.stringify(options.body);
	}
	const method = options.method ?? (body === undefined ? "GET" : "POST");
	const response = await webGatewayFetch(new Request(url.toString(), { method, headers, body }), "127.0.0.1");
	const text = await response.text();
	let parsed: unknown;
	if (text !== "") {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text;
		}
	}
	return { status: response.status, body: parsed };
}

/** Call a gateway route and require a 2xx JSON answer. */
export async function gatewayJson<T>(path: string, options: GatewayCallOptions = {}): Promise<T> {
	const reply = await callGateway(path, options);
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`${options.method ?? "GET"} ${path} → ${reply.status}${describe(reply.body)}`);
	}
	return reply.body as T;
}

/** Call a gateway route whose answer is not read (mutations). */
export async function gatewayOk(path: string, options: GatewayCallOptions = {}): Promise<void> {
	const reply = await callGateway(path, options);
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`${options.method ?? "POST"} ${path} → ${reply.status}${describe(reply.body)}`);
	}
}

/** The gateway's own error sentence, when it sent one. */
function describe(body: unknown): string {
	if (body !== null && typeof body === "object" && "error" in body) {
		const error = (body as { error: unknown }).error;
		if (typeof error === "string" && error !== "") return `: ${error}`;
	}
	return "";
}

/** Encode a path segment (session ids, provider ids, file paths). */
export function segment(value: string): string {
	return encodeURIComponent(value);
}

/** Read a required string field from an op input. */
export function requiredString(input: unknown, field: string): string {
	const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>)[field] : undefined;
	if (typeof value !== "string" || value === "") throw invalid(`${field} must be a non-empty string`);
	return value;
}

/** Read an optional string field from an op input. */
export function optionalString(input: unknown, field: string): string | undefined {
	const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>)[field] : undefined;
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw invalid(`${field} must be a string`);
	return value;
}

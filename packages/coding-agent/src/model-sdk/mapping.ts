/**
 * Declarative request/response mapping for nonstandard model APIs.
 *
 * A mapping is inert configuration: literal JSON, path references, templates,
 * and bounded sandbox expressions. Compilation validates every node and
 * precompiles expressions; application clones the input once and evaluates
 * against that shared inert environment.
 */
import { MappingError } from "./errors";
import { compileExpression, type ExpressionLimits, SandboxEnvironment, type SandboxExpression } from "./expression";
import { cloneJsonValue, isUnsafeJsonKey, JsonDataError, parseJsonPath, type JsonPath } from "./json";
import type { JsonObject, JsonValue } from "./types";

export type MappingNode =
	| { readonly kind: "literal"; readonly value: JsonValue }
	| { readonly kind: "ref"; readonly path: string }
	| { readonly kind: "expression"; readonly source: string }
	| { readonly kind: "template"; readonly parts: readonly (string | MappingNode)[] }
	| { readonly kind: "array"; readonly items: readonly MappingNode[] }
	| { readonly kind: "object"; readonly fields: Readonly<Record<string, MappingNode>> };

/** Concise constructors for code-authored mappings. */
export function literalNode(value: JsonValue): MappingNode {
	return { kind: "literal", value };
}

export function refNode(path: string): MappingNode {
	return { kind: "ref", path };
}

export function expressionNode(source: string): MappingNode {
	return { kind: "expression", source };
}

export function templateNode(...parts: (string | MappingNode)[]): MappingNode {
	return { kind: "template", parts };
}

export function arrayNode(items: readonly MappingNode[]): MappingNode {
	return { kind: "array", items };
}

export function objectNode(fields: Readonly<Record<string, MappingNode>>): MappingNode {
	return { kind: "object", fields };
}

export type MappingHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const HTTP_METHODS: Readonly<Record<string, true>> = Object.freeze({
	GET: true,
	POST: true,
	PUT: true,
	PATCH: true,
	DELETE: true,
});

const RESERVED_HEADERS: Readonly<Record<string, true>> = Object.freeze({
	authorization: true,
	"proxy-authorization": true,
	"x-api-key": true,
	"api-key": true,
	cookie: true,
});

export interface RequestMappingSpec {
	readonly method?: MappingHttpMethod;
	/** Static relative path or a node producing one. */
	readonly path: string | MappingNode;
	readonly headers?: Readonly<Record<string, MappingNode>>;
	readonly body?: MappingNode;
}

export interface ResponseMappingSpec {
	readonly body: MappingNode;
}

export interface ApiMappingSpec {
	readonly request: RequestMappingSpec;
	readonly response: ResponseMappingSpec;
}

export interface MappingLimits {
	readonly maxExpressions?: number;
	readonly maxTotalSourceLength?: number;
	readonly maxNodes?: number;
	readonly maxDepth?: number;
}

export interface MappingOptions {
	readonly limits?: MappingLimits;
	/** Per-expression limits; allowed roots are fixed by the mapping phase. */
	readonly expressionLimits?: Partial<ExpressionLimits>;
}

export interface MappedHttpRequest {
	readonly method: MappingHttpMethod;
	readonly path: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body?: JsonValue;
}

export interface CompiledApiMapping {
	/** Maps a canonical request input into a provider-shaped HTTP request. */
	request(input?: JsonValue, context?: JsonValue): MappedHttpRequest;
	/** Maps a provider JSON response into canonical output; `request` is the canonical input. */
	response(response: JsonValue, request?: JsonValue, context?: JsonValue): JsonValue;
}

interface CompiledNode {
	readonly kind: "literal" | "ref" | "expression" | "template" | "array" | "object";
	readonly value?: JsonValue;
	readonly path?: JsonPath;
	readonly expression?: SandboxExpression;
	readonly parts?: readonly (string | CompiledNode)[];
	readonly items?: readonly CompiledNode[];
	readonly entries?: readonly { readonly key: string; readonly value: CompiledNode }[];
}

type MappingPhase = "request" | "response";

const REQUEST_ROOTS = Object.freeze(["input", "context"]);
const RESPONSE_ROOTS = Object.freeze(["response", "request", "context"]);
const DEFAULT_MAPPING_LIMITS = Object.freeze({
	maxExpressions: 512,
	maxTotalSourceLength: 32_768,
	maxNodes: 4096,
	maxDepth: 64,
});
const HARD_MAPPING_LIMITS = Object.freeze({
	maxExpressions: 4096,
	maxTotalSourceLength: 262_144,
	maxNodes: 16_384,
	maxDepth: 256,
});

interface CompileState {
	expressions: number;
	sourceLength: number;
	nodes: number;
	readonly limits: Required<MappingLimits>;
	readonly expressionLimits: Partial<ExpressionLimits> | undefined;
}

function resolveMappingLimit(value: number | undefined, fallback: number, hard: number, name: string): number {
	if (value === undefined) return fallback;
	if (!Number.isFinite(value) || value < 0) {
		throw new MappingError(`Mapping limit "${name}" must be a non-negative finite number.`, "mapping_invalid");
	}
	return Math.min(Math.floor(value), hard);
}

function resolveMappingLimits(limits: MappingLimits | undefined): Required<MappingLimits> {
	return {
		maxExpressions: resolveMappingLimit(
			limits?.maxExpressions,
			DEFAULT_MAPPING_LIMITS.maxExpressions,
			HARD_MAPPING_LIMITS.maxExpressions,
			"maxExpressions",
		),
		maxTotalSourceLength: resolveMappingLimit(
			limits?.maxTotalSourceLength,
			DEFAULT_MAPPING_LIMITS.maxTotalSourceLength,
			HARD_MAPPING_LIMITS.maxTotalSourceLength,
			"maxTotalSourceLength",
		),
		maxNodes: resolveMappingLimit(
			limits?.maxNodes,
			DEFAULT_MAPPING_LIMITS.maxNodes,
			HARD_MAPPING_LIMITS.maxNodes,
			"maxNodes",
		),
		maxDepth: resolveMappingLimit(
			limits?.maxDepth,
			DEFAULT_MAPPING_LIMITS.maxDepth,
			HARD_MAPPING_LIMITS.maxDepth,
			"maxDepth",
		),
	};
}

function recordOf(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new MappingError(`${label} must be an object.`, "mapping_invalid");
	}
	// The runtime check above proves an object; fields are validated one by one.
	return value as Readonly<Record<string, unknown>>;
}

function validatePath(path: string): string {
	if (
		!/^\/(?!\/)/.test(path) ||
		path.includes("\\") ||
		/[\u0000-\u001f\u007f]/.test(path) ||
		/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)
	) {
		throw new MappingError("Mapped request path must be an absolute relative path.", "mapping_invalid");
	}
	const pathname = path.split("?", 1)[0]!;
	for (const segment of pathname.split("/")) {
		if (segment === "." || segment === "..") {
			throw new MappingError("Mapped request path must not contain traversal segments.", "mapping_invalid");
		}
	}
	return path;
}

function validateHeaderName(name: string): void {
	if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
		throw new MappingError("Mapped header names must be valid HTTP tokens.", "mapping_invalid");
	}
	const lowered = name.toLowerCase();
	if (lowered === "__proto__" || lowered === "prototype" || lowered === "constructor") {
		throw new MappingError("Mapped header names must not be prototype keys.", "mapping_invalid");
	}
	if (Object.prototype.hasOwnProperty.call(RESERVED_HEADERS, lowered)) {
		throw new MappingError(
			"Credential and cookie headers are owned by the SDK, not by a mapping.",
			"mapping_invalid",
		);
	}
}

function incrementNode(state: CompileState, depth: number, path: string): void {
	state.nodes += 1;
	if (state.nodes > state.limits.maxNodes) {
		throw new MappingError(`Mapping exceeded its node limit at ${path}.`, "mapping_invalid");
	}
	if (depth > state.limits.maxDepth) {
		throw new MappingError(`Mapping exceeded its nesting limit at ${path}.`, "mapping_invalid");
	}
}

function compileRef(node: Readonly<Record<string, unknown>>, phase: MappingPhase, path: string): CompiledNode {
	const text = node.path;
	if (typeof text !== "string") {
		throw new MappingError(`${path}.path must be a string.`, "mapping_invalid");
	}
	let parsed: JsonPath;
	try {
		parsed = parseJsonPath(text);
	} catch (error) {
		if (error instanceof JsonDataError) {
			throw new MappingError(`${path}.path is not a valid JSON path.`, "mapping_invalid");
		}
		throw error;
	}
	const root = parsed.segments[0];
	if (typeof root !== "string" || !(phase === "request" ? REQUEST_ROOTS : RESPONSE_ROOTS).includes(root)) {
		throw new MappingError(`${path}.path must start with an allowed mapping root.`, "mapping_invalid");
	}
	for (const segment of parsed.segments) {
		if (typeof segment === "string" && isUnsafeJsonKey(segment)) {
			throw new MappingError(`${path}.path contains a disallowed key.`, "mapping_invalid");
		}
	}
	return { kind: "ref", path: parsed };
}

function compileNode(
	node: unknown,
	phase: MappingPhase,
	state: CompileState,
	path: string,
	depth: number,
): CompiledNode {
	incrementNode(state, depth, path);
	const record = recordOf(node, path);
	const kind = record.kind;
	switch (kind) {
		case "literal": {
			try {
				return { kind: "literal", value: cloneJsonValue(record.value) };
			} catch (error) {
				if (error instanceof JsonDataError) {
					throw new MappingError(`${path}.value must be plain JSON data.`, "mapping_invalid");
				}
				throw error;
			}
		}
		case "ref":
			return compileRef(record, phase, path);
		case "expression": {
			const source = record.source;
			if (typeof source !== "string") {
				throw new MappingError(`${path}.source must be a string.`, "mapping_invalid");
			}
			state.expressions += 1;
			state.sourceLength += source.length;
			if (state.expressions > state.limits.maxExpressions) {
				throw new MappingError("Mapping exceeded its expression limit.", "mapping_invalid");
			}
			if (state.sourceLength > state.limits.maxTotalSourceLength) {
				throw new MappingError("Mapping exceeded its total expression source limit.", "mapping_invalid");
			}
			return {
				kind: "expression",
				expression: compileExpression(source, {
					...state.expressionLimits,
					allowedRoots: phase === "request" ? REQUEST_ROOTS : RESPONSE_ROOTS,
				}),
			};
		}
		case "template": {
			if (!Array.isArray(record.parts)) {
				throw new MappingError(`${path}.parts must be an array.`, "mapping_invalid");
			}
			const parts: (string | CompiledNode)[] = [];
			for (const [index, part] of record.parts.entries()) {
				parts.push(
					typeof part === "string" ? part : compileNode(part, phase, state, `${path}.parts[${index}]`, depth + 1),
				);
			}
			return { kind: "template", parts };
		}
		case "array": {
			if (!Array.isArray(record.items)) {
				throw new MappingError(`${path}.items must be an array.`, "mapping_invalid");
			}
			const items: CompiledNode[] = [];
			for (const [index, item] of record.items.entries()) {
				items.push(compileNode(item, phase, state, `${path}.items[${index}]`, depth + 1));
			}
			return { kind: "array", items };
		}
		case "object": {
			const fields = recordOf(record.fields, `${path}.fields`);
			const entries: { key: string; value: CompiledNode }[] = [];
			for (const [key, value] of Object.entries(fields)) {
				if (isUnsafeJsonKey(key)) {
					throw new MappingError(`${path}.fields contains a disallowed key.`, "mapping_invalid");
				}
				entries.push({
					key,
					value: compileNode(value, phase, state, `${path}.fields[${JSON.stringify(key)}]`, depth + 1),
				});
			}
			return { kind: "object", entries };
		}
		default:
			throw new MappingError(
				`${path}.kind must be one of literal, ref, expression, template, array, object.`,
				"mapping_invalid",
			);
	}
}

function scalarText(value: JsonValue | undefined): string | undefined {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
	if (typeof value === "boolean") return value ? "true" : "false";
	return undefined;
}

function evaluateNode(node: CompiledNode, environment: SandboxEnvironment, path: string): JsonValue | undefined {
	switch (node.kind) {
		case "literal":
			return cloneJsonValue(node.value);
		case "ref":
			try {
				return environment.read(node.path!);
			} catch (error) {
				if (error instanceof JsonDataError) {
					throw new MappingError(`${path} resolved an unsafe path.`, "mapping_failed");
				}
				throw error;
			}
		case "expression":
			return node.expression!.evaluate(environment);
		case "template": {
			const parts: string[] = [];
			for (const [index, part] of node.parts!.entries()) {
				if (typeof part === "string") {
					parts.push(part);
					continue;
				}
				const value = evaluateNode(part, environment, `${path}.parts[${index}]`);
				const text = scalarText(value);
				if (text === undefined) {
					throw new MappingError(`${path}.parts[${index}] must resolve to a scalar.`, "mapping_failed");
				}
				parts.push(text);
			}
			return parts.join("");
		}
		case "array": {
			const result: JsonValue[] = [];
			for (const [index, item] of node.items!.entries()) {
				const value = evaluateNode(item, environment, `${path}.items[${index}]`);
				result.push(value === undefined ? null : value);
			}
			return result;
		}
		case "object": {
			const result: JsonObject = {};
			for (const entry of node.entries!) {
				const value = evaluateNode(entry.value, environment, `${path}.fields[${JSON.stringify(entry.key)}]`);
				if (value !== undefined) result[entry.key] = value;
			}
			return result;
		}
	}
}

function prepareEnvironment(value: Readonly<Record<string, unknown>>): SandboxEnvironment {
	try {
		return SandboxEnvironment.from(value);
	} catch {
		throw new MappingError("Mapping input must be plain JSON data.", "mapping_failed");
	}
}

function headerValue(value: JsonValue | undefined, path: string): string {
	const text = scalarText(value);
	if (text === undefined) {
		throw new MappingError(`${path} must resolve to a scalar header value.`, "mapping_failed");
	}
	if (/[\r\n]/.test(text)) {
		throw new MappingError(`${path} must be a single-line header value.`, "mapping_failed");
	}
	return text;
}

/**
 * Compiles and validates a declarative mapping. Expressions are sandboxed
 * with the phase's root allowlist; malformed mappings fail here, not at
 * request time.
 */
export function compileApiMapping(spec: ApiMappingSpec, options: MappingOptions = {}): CompiledApiMapping {
	const specRecord = recordOf(spec, "mapping");
	const requestSpec = recordOf(specRecord.request, "mapping.request");
	const responseSpec = recordOf(specRecord.response, "mapping.response");
	const state: CompileState = {
		expressions: 0,
		sourceLength: 0,
		nodes: 0,
		limits: resolveMappingLimits(options.limits),
		expressionLimits: options.expressionLimits,
	};

	const methodValue = requestSpec.method === undefined ? "POST" : requestSpec.method;
	if (typeof methodValue !== "string" || !Object.prototype.hasOwnProperty.call(HTTP_METHODS, methodValue)) {
		throw new MappingError("mapping.request.method must be an HTTP verb.", "mapping_invalid");
	}
	const method = methodValue as MappingHttpMethod;

	if (requestSpec.path === undefined) {
		throw new MappingError("mapping.request.path is required.", "mapping_invalid");
	}
	const pathNode =
		typeof requestSpec.path === "string"
			? validatePath(requestSpec.path)
			: compileNode(requestSpec.path, "request", state, "mapping.request.path", 0);

	const compiledHeaders: { readonly name: string; readonly node: CompiledNode }[] = [];
	if (requestSpec.headers !== undefined) {
		const headers = recordOf(requestSpec.headers, "mapping.request.headers");
		for (const [name, node] of Object.entries(headers)) {
			validateHeaderName(name);
			compiledHeaders.push({
				name,
				node: compileNode(node, "request", state, `mapping.request.headers[${JSON.stringify(name)}]`, 0),
			});
		}
	}
	const bodyNode =
		requestSpec.body === undefined
			? undefined
			: compileNode(requestSpec.body, "request", state, "mapping.request.body", 0);

	if (responseSpec.body === undefined) {
		throw new MappingError("mapping.response.body is required.", "mapping_invalid");
	}
	const responseNode = compileNode(responseSpec.body, "response", state, "mapping.response.body", 0);

	return {
		request(input?: JsonValue, context?: JsonValue): MappedHttpRequest {
			const environment = prepareEnvironment({ input: input ?? null, context: context ?? null });
			const path =
				typeof pathNode === "string"
					? pathNode
					: (() => {
							const value = evaluateNode(pathNode, environment, "mapping.request.path");
							if (typeof value !== "string") {
								throw new MappingError("mapping.request.path must resolve to a string.", "mapping_failed");
							}
							return validatePath(value);
						})();
			const headers: Record<string, string> = {};
			for (const header of compiledHeaders) {
				const value = evaluateNode(
					header.node,
					environment,
					`mapping.request.headers[${JSON.stringify(header.name)}]`,
				);
				if (value === null || value === undefined) continue;
				headers[header.name] = headerValue(value, `mapping.request.headers[${JSON.stringify(header.name)}]`);
			}
			const body = bodyNode === undefined ? undefined : evaluateNode(bodyNode, environment, "mapping.request.body");
			return {
				method,
				path,
				headers: Object.freeze(headers),
				...(body === undefined ? {} : { body }),
			};
		},
		response(response: JsonValue, request?: JsonValue, context?: JsonValue): JsonValue {
			const environment = prepareEnvironment({
				response,
				request: request ?? null,
				context: context ?? null,
			});
			const value = evaluateNode(responseNode, environment, "mapping.response.body");
			return value === undefined ? null : value;
		},
	};
}

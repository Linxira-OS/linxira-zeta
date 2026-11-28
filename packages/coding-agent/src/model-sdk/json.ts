/**
 * JSON-only data helpers shared by the sandbox and the mapping layer.
 *
 * Inputs are cloned through property descriptors instead of direct reads so a
 * getter can never execute while a model configuration is being examined.
 * Non-plain objects, cycles, accessors, non-finite numbers, and the prototype
 * escape keys are rejected: the value that enters the sandbox is always inert
 * data.
 */
import { ModelSdkError } from "./errors";
import type { JsonObject, JsonValue } from "./types";

export interface JsonCloneOptions {
	readonly maxDepth?: number;
	readonly maxNodes?: number;
	/** Reject `__proto__`, `prototype`, and `constructor` keys. Defaults to true. */
	readonly rejectUnsafeKeys?: boolean;
}

const DEFAULT_MAX_DEPTH = 128;
const DEFAULT_MAX_NODES = 200_000;
const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

export class JsonDataError extends ModelSdkError {
	constructor(message: string) {
		super(message, "invalid_request");
		this.name = "JsonDataError";
	}
}

/** True for keys that could be used to escape object traversal or pollute prototypes. */
export function isUnsafeJsonKey(key: string): boolean {
	return UNSAFE_KEYS.has(key);
}

function isPlainObject(value: object): boolean {
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/**
 * Deep-clones a JSON value. Throws {@link JsonDataError} for anything that is
 * not inert JSON data, including accessors and prototype-bearing objects.
 */
export function cloneJsonValue(value: unknown, options: JsonCloneOptions = {}): JsonValue {
	const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
	const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
	const rejectUnsafeKeys = options.rejectUnsafeKeys ?? true;
	let nodes = 0;

	const visit = (current: unknown, depth: number): JsonValue => {
		nodes += 1;
		if (nodes > maxNodes) {
			throw new JsonDataError("JSON data exceeds the node limit.");
		}
		if (depth > maxDepth) {
			throw new JsonDataError("JSON data exceeds the nesting limit.");
		}
		if (current === null) return null;
		switch (typeof current) {
			case "string":
			case "boolean":
				return current;
			case "number":
				if (!Number.isFinite(current)) {
					throw new JsonDataError("JSON data contains a non-finite number.");
				}
				return current;
			case "undefined":
				throw new JsonDataError("JSON data contains undefined.");
			case "bigint":
			case "function":
			case "symbol":
				throw new JsonDataError(`JSON data contains a value of type ${typeof current}.`);
			case "object":
				break;
		}

		if (Array.isArray(current)) {
			const result: JsonValue[] = [];
			const length = current.length;
			for (let index = 0; index < length; index += 1) {
				const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
				if (descriptor === undefined || !("value" in descriptor)) {
					throw new JsonDataError("JSON arrays must contain plain values without holes.");
				}
				result.push(visit(descriptor.value, depth + 1));
			}
			return result;
		}

		if (!isPlainObject(current)) {
			throw new JsonDataError("JSON data must contain only plain objects and arrays.");
		}
		const result: JsonObject = {};
		for (const key of Object.keys(current)) {
			if (rejectUnsafeKeys && isUnsafeJsonKey(key)) {
				throw new JsonDataError("JSON data contains a disallowed object key.");
			}
			const descriptor = Object.getOwnPropertyDescriptor(current, key);
			if (descriptor === undefined || !("value" in descriptor)) {
				throw new JsonDataError("JSON data must not contain accessor properties.");
			}
			result[key] = visit(descriptor.value, depth + 1);
		}
		return result;
	};

	return visit(value, 0);
}

/** Structural equality for cloned JSON values. */
export function jsonEquals(left: JsonValue, right: JsonValue): boolean {
	if (left === right) return true;
	if (left === null || right === null) return false;
	if (typeof left !== typeof right) return false;
	if (typeof left !== "object") return false;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
		for (let index = 0; index < left.length; index += 1) {
			if (!jsonEquals(left[index]!, right[index]!)) return false;
		}
		return true;
	}
	// The array branch above returned, so both values are non-array JSON objects.
	const leftObject = left as { readonly [key: string]: JsonValue };
	const rightObject = right as { readonly [key: string]: JsonValue };
	const leftKeys = Object.keys(leftObject);
	const rightKeys = Object.keys(rightObject);
	if (leftKeys.length !== rightKeys.length) return false;
	for (const key of leftKeys) {
		if (!Object.prototype.hasOwnProperty.call(rightObject, key)) return false;
		if (!jsonEquals(leftObject[key]!, rightObject[key]!)) return false;
	}
	return true;
}

export type JsonPathSegment = string | number;

export interface JsonPath {
	readonly segments: readonly JsonPathSegment[];
	readonly text: string;
}

function isIdentifierStart(character: string): boolean {
	return /[A-Za-z_$]/.test(character);
}

function isIdentifierPart(character: string): boolean {
	return /[A-Za-z0-9_$]/.test(character);
}

/**
 * Parses `a.b[0].c` into segments. Only identifiers and non-negative integer
 * indexes are accepted; bracket-quoted keys belong in an expression instead.
 */
export function parseJsonPath(path: string, maxSegments = 32): JsonPath {
	if (path.length === 0) {
		throw new JsonDataError("JSON path must not be empty.");
	}
	if (path.length > 1024) {
		throw new JsonDataError("JSON path exceeds the length limit.");
	}
	const segments: JsonPathSegment[] = [];
	let index = 0;

	const readIdentifier = (): string => {
		const start = index;
		if (!isIdentifierStart(path[index] ?? "")) {
			throw new JsonDataError("JSON path contains an invalid segment.");
		}
		index += 1;
		while (index < path.length && isIdentifierPart(path[index]!)) index += 1;
		return path.slice(start, index);
	};

	while (index < path.length) {
		if (segments.length > 0 && path[index] === ".") {
			index += 1;
			segments.push(readIdentifier());
		} else if (path[index] === "[") {
			index += 1;
			const start = index;
			while (index < path.length && path[index] !== "]") index += 1;
			if (index >= path.length) {
				throw new JsonDataError("JSON path has an unterminated index.");
			}
			const digits = path.slice(start, index);
			if (!/^(?:0|[1-9][0-9]*)$/.test(digits)) {
				throw new JsonDataError("JSON path index must be a non-negative integer.");
			}
			index += 1;
			segments.push(Number(digits));
		} else if (segments.length === 0) {
			segments.push(readIdentifier());
		} else {
			throw new JsonDataError("JSON path contains an invalid segment separator.");
		}
		if (segments.length > maxSegments) {
			throw new JsonDataError("JSON path has too many segments.");
		}
	}

	if (segments.length === 0) {
		throw new JsonDataError("JSON path must contain at least one segment.");
	}
	return { segments, text: path };
}

function isArrayIndex(segment: string | number): segment is number {
	return typeof segment === "number" && Number.isInteger(segment) && segment >= 0;
}

/**
 * Reads a path from JSON data. A missing path returns `undefined`; a
 * disallowed key throws. Arrays accept `length` and non-negative indexes.
 */
export function readJsonPath(root: JsonValue | undefined, path: string | JsonPath): JsonValue | undefined {
	const segments = typeof path === "string" ? parseJsonPath(path).segments : path.segments;
	let current: JsonValue | undefined = root;
	for (const segment of segments) {
		if (current === undefined || current === null) return undefined;
		if (typeof segment === "string" && isUnsafeJsonKey(segment)) {
			throw new JsonDataError("JSON path contains a disallowed key.");
		}
		if (Array.isArray(current)) {
			if (segment === "length") {
				current = current.length;
				continue;
			}
			if (!isArrayIndex(segment)) return undefined;
			current = current[segment];
			continue;
		}
		if (typeof current === "string") {
			if (segment === "length") {
				current = current.length;
				continue;
			}
			if (!isArrayIndex(segment)) return undefined;
			current = current[segment] ?? undefined;
			continue;
		}
		if (typeof current !== "object") return undefined;
		if (typeof segment !== "string") return undefined;
		if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
		current = current[segment];
	}
	return current;
}

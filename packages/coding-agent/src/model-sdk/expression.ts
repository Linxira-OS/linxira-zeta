/**
 * Bounded, sandboxed expression interpreter for declarative mappings.
 *
 * This is a purpose-built language, not JavaScript: no `eval`, no `Function`,
 * no assignment, no method calls, no globals, no loops, and no access to the
 * host. The only identifiers are roots supplied in the environment plus a
 * frozen table of pure data functions. Source length, token count, AST size,
 * evaluation depth, evaluation steps, and output bytes are all capped.
 */
import { ExpressionError } from "./errors";
import {
	cloneJsonValue,
	isUnsafeJsonKey,
	JsonDataError,
	jsonEquals,
	parseJsonPath,
	readJsonPath,
	type JsonPath,
} from "./json";
import type { JsonObject, JsonValue } from "./types";

export interface ExpressionLimits {
	readonly maxSourceLength: number;
	readonly maxTokens: number;
	readonly maxNodes: number;
	readonly maxSteps: number;
	readonly maxDepth: number;
	readonly maxOutputBytes: number;
}

export interface ExpressionOptions extends Partial<ExpressionLimits> {
	/** If set, only these environment roots may be referenced. */
	readonly allowedRoots?: readonly string[];
}

export interface SandboxExpression {
	readonly source: string;
	readonly nodeCount: number;
	/**
	 * Evaluates against fresh JSON data, or a pre-validated
	 * {@link SandboxEnvironment} shared by a mapping. Returns `undefined` when
	 * the expression resolves an absent value (mapping turns that into an
	 * omitted object field).
	 */
	evaluate(environment: SandboxEnvironment | Readonly<Record<string, unknown>>): JsonValue | undefined;
}

const preparedEnvironments = new WeakMap<object, Readonly<Record<string, JsonValue>>>();

/**
 * Immutable, pre-validated JSON environment. The mapping layer prepares one
 * per mapping call so every expression in the mapping reads the same inert
 * clone instead of deep-copying the input again.
 */
export class SandboxEnvironment {
	private constructor() {}

	/** Clones and validates the roots once. Throws on non-JSON data. */
	static from(value: Readonly<Record<string, unknown>>): SandboxEnvironment {
		const cloned = cloneEnvironment(value);
		const environment = new SandboxEnvironment();
		preparedEnvironments.set(environment, cloned);
		return environment;
	}

	/** Reads a validated path from the prepared data; used by declarative refs. */
	read(path: JsonPath | string): JsonValue | undefined {
		const value = preparedEnvironments.get(this);
		if (value === undefined) {
			throw new ExpressionError("Sandbox environment was not initialized.", "expression_invalid_environment");
		}
		return readJsonPath(value, path);
	}
}

const DEFAULT_LIMITS: ExpressionLimits = Object.freeze({
	maxSourceLength: 4096,
	maxTokens: 2048,
	maxNodes: 1024,
	maxSteps: 20_000,
	maxDepth: 128,
	maxOutputBytes: 1024 * 1024,
});

const HARD_LIMITS: ExpressionLimits = Object.freeze({
	maxSourceLength: 65_536,
	maxTokens: 16_384,
	maxNodes: 8192,
	maxSteps: 1_000_000,
	maxDepth: 512,
	maxOutputBytes: 16 * 1024 * 1024,
});

/** Environment JSON is cloned under a wider node budget than the expression AST. */
const MAX_ENVIRONMENT_NODES = 8192;
const MAX_JSON_FUNCTION_TEXT = 1024 * 1024;

type SandboxValue = JsonValue | undefined;

interface EvalState {
	steps: number;
	depth: number;
	readonly maxSteps: number;
	readonly maxDepth: number;
	readonly maxOutputBytes: number;
}

function resolveLimit(value: number | undefined, fallback: number, hard: number, name: string): number {
	if (value === undefined) return fallback;
	if (!Number.isFinite(value) || value < 0) {
		throw new ExpressionError(`Expression limit "${name}" must be a non-negative finite number.`, "expression_limit");
	}
	return Math.min(Math.floor(value), hard);
}

function resolveLimits(options: ExpressionOptions): ExpressionLimits {
	return {
		maxSourceLength: resolveLimit(
			options.maxSourceLength,
			DEFAULT_LIMITS.maxSourceLength,
			HARD_LIMITS.maxSourceLength,
			"maxSourceLength",
		),
		maxTokens: resolveLimit(options.maxTokens, DEFAULT_LIMITS.maxTokens, HARD_LIMITS.maxTokens, "maxTokens"),
		maxNodes: resolveLimit(options.maxNodes, DEFAULT_LIMITS.maxNodes, HARD_LIMITS.maxNodes, "maxNodes"),
		maxSteps: resolveLimit(options.maxSteps, DEFAULT_LIMITS.maxSteps, HARD_LIMITS.maxSteps, "maxSteps"),
		maxDepth: resolveLimit(options.maxDepth, DEFAULT_LIMITS.maxDepth, HARD_LIMITS.maxDepth, "maxDepth"),
		maxOutputBytes: resolveLimit(
			options.maxOutputBytes,
			DEFAULT_LIMITS.maxOutputBytes,
			HARD_LIMITS.maxOutputBytes,
			"maxOutputBytes",
		),
	};
}

function syntaxError(message: string, position: number): never {
	throw new ExpressionError(`${message} (position ${position}).`, "expression_syntax");
}

function spend(state: EvalState, amount = 1): void {
	state.steps += amount;
	if (state.steps > state.maxSteps) {
		throw new ExpressionError("Expression exceeded its evaluation step limit.", "expression_limit");
	}
}

function spendWork(state: EvalState, amount: number): void {
	if (amount <= 0) return;
	spend(state, Math.ceil(amount));
}

function isTruthy(value: SandboxValue): boolean {
	return !(value === null || value === undefined || value === false || value === 0 || value === "");
}

function requireString(value: SandboxValue, name: string): string {
	if (typeof value !== "string") {
		throw new ExpressionError(`${name} expects a string.`, "expression_type");
	}
	return value;
}

function requireNumber(value: SandboxValue, name: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new ExpressionError(`${name} expects a finite number.`, "expression_type");
	}
	return value;
}

function requireArray(value: SandboxValue, name: string): JsonValue[] {
	if (!Array.isArray(value)) {
		throw new ExpressionError(`${name} expects an array.`, "expression_type");
	}
	return value;
}

function requireObject(value: SandboxValue, name: string): JsonObject {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new ExpressionError(`${name} expects an object.`, "expression_type");
	}
	return value;
}

function scalarToString(value: SandboxValue): string | undefined {
	if (value === null || value === undefined) return "";
	switch (typeof value) {
		case "string":
			return value;
		case "number":
			return Number.isFinite(value) ? String(value) : undefined;
		case "boolean":
			return value ? "true" : "false";
		default:
			return undefined;
	}
}

function safeKey(key: string): void {
	if (isUnsafeJsonKey(key)) {
		throw new ExpressionError(`Property "${key}" is not accessible in the sandbox.`, "expression_unsafe_access");
	}
}

interface Token {
	readonly kind: "number" | "string" | "identifier" | "operator" | "eof";
	readonly value: string | number | null;
	readonly position: number;
}

class Lexer {
	readonly #source: string;
	readonly #maxTokens: number;
	#index = 0;
	#count = 0;
	readonly #tokens: Token[] = [];

	constructor(source: string, maxTokens: number) {
		this.#source = source;
		this.#maxTokens = maxTokens;
	}

	tokenize(): readonly Token[] {
		while (this.#index < this.#source.length) {
			const character = this.#source[this.#index]!;
			if (/\s/.test(character)) {
				this.#index += 1;
				continue;
			}
			const token = this.#readToken(character);
			this.#add(token);
		}
		this.#tokens.push({ kind: "eof", value: null, position: this.#index });
		return this.#tokens;
	}

	#add(token: Token): void {
		this.#count += 1;
		if (this.#count > this.#maxTokens) {
			throw new ExpressionError("Expression exceeded its token limit.", "expression_limit");
		}
		this.#tokens.push(token);
	}

	#readToken(character: string): Token {
		if (character === '"' || character === "'") return this.#readString(character);
		if (character >= "0" && character <= "9") return this.#readNumber();
		if (/[A-Za-z_$]/.test(character)) return this.#readIdentifier();
		return this.#readOperator(character);
	}

	#readString(quote: string): Token {
		const start = this.#index;
		this.#index += 1;
		let result = "";
		while (this.#index < this.#source.length) {
			const character = this.#source[this.#index]!;
			if (character === quote) {
				this.#index += 1;
				return { kind: "string", value: result, position: start };
			}
			if (character === "\n" || character === "\r") {
				syntaxError("Unterminated string literal", this.#index);
			}
			if (character !== "\\") {
				result += character;
				this.#index += 1;
				continue;
			}
			this.#index += 1;
			const escape = this.#source[this.#index];
			if (escape === undefined) syntaxError("Unterminated string escape", this.#index);
			switch (escape) {
				case '"':
				case "'":
				case "\\":
				case "/":
					result += escape;
					this.#index += 1;
					break;
				case "b":
					result += "\b";
					this.#index += 1;
					break;
				case "f":
					result += "\f";
					this.#index += 1;
					break;
				case "n":
					result += "\n";
					this.#index += 1;
					break;
				case "r":
					result += "\r";
					this.#index += 1;
					break;
				case "t":
					result += "\t";
					this.#index += 1;
					break;
				case "u": {
					const hex = this.#source.slice(this.#index + 1, this.#index + 5);
					if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
						syntaxError("Invalid unicode escape", this.#index);
					}
					result += String.fromCharCode(Number.parseInt(hex, 16));
					this.#index += 5;
					break;
				}
				default:
					syntaxError("Unsupported string escape", this.#index);
			}
		}
		syntaxError("Unterminated string literal", start);
	}

	#readNumber(): Token {
		const start = this.#index;
		while (this.#index < this.#source.length && /[0-9]/.test(this.#source[this.#index]!)) this.#index += 1;
		if (this.#source[this.#index] === ".") {
			this.#index += 1;
			if (!/[0-9]/.test(this.#source[this.#index] ?? "")) {
				syntaxError("Invalid number literal", start);
			}
			while (this.#index < this.#source.length && /[0-9]/.test(this.#source[this.#index]!)) this.#index += 1;
		}
		if (this.#source[this.#index] === "e" || this.#source[this.#index] === "E") {
			this.#index += 1;
			if (this.#source[this.#index] === "+" || this.#source[this.#index] === "-") this.#index += 1;
			if (!/[0-9]/.test(this.#source[this.#index] ?? "")) {
				syntaxError("Invalid number exponent", start);
			}
			while (this.#index < this.#source.length && /[0-9]/.test(this.#source[this.#index]!)) this.#index += 1;
		}
		const value = Number(this.#source.slice(start, this.#index));
		if (!Number.isFinite(value)) {
			throw new ExpressionError("Number literal is outside the supported finite range.", "expression_type");
		}
		return { kind: "number", value, position: start };
	}

	#readIdentifier(): Token {
		const start = this.#index;
		this.#index += 1;
		while (this.#index < this.#source.length && /[A-Za-z0-9_$]/.test(this.#source[this.#index]!)) {
			this.#index += 1;
		}
		return { kind: "identifier", value: this.#source.slice(start, this.#index), position: start };
	}

	#readOperator(character: string): Token {
		const start = this.#index;
		for (const operator of ["===", "!=="]) {
			if (this.#source.startsWith(operator, this.#index)) {
				this.#index += operator.length;
				return { kind: "operator", value: operator, position: start };
			}
		}
		for (const operator of ["==", "!="]) {
			if (this.#source.startsWith(operator, this.#index)) {
				this.#index += operator.length;
				return { kind: "operator", value: operator, position: start };
			}
		}
		if (character === "=") {
			if (this.#source[this.#index + 1] === ">") {
				syntaxError("Arrow functions are not allowed", start);
			}
			syntaxError("Assignment is not allowed in the sandbox", start);
		}
		if (character === ";") syntaxError("Statements are not allowed in the sandbox", start);
		if (character === "`") syntaxError("Template literals are not allowed in the sandbox", start);
		for (const operator of ["<=", ">=", "&&", "||", "??"]) {
			if (this.#source.startsWith(operator, this.#index)) {
				this.#index += operator.length;
				return { kind: "operator", value: operator, position: start };
			}
		}
		if ("+-*/%<>!?:.,()[]{}".includes(character)) {
			this.#index += 1;
			return { kind: "operator", value: character, position: start };
		}
		syntaxError("Unsupported character", start);
	}
}

type ExprNode =
	| { readonly kind: "literal"; readonly value: JsonValue }
	| { readonly kind: "identifier"; readonly name: string }
	| { readonly kind: "member"; readonly object: ExprNode; readonly key: string | ExprNode }
	| { readonly kind: "call"; readonly name: string; readonly args: readonly ExprNode[] }
	| { readonly kind: "unary"; readonly operator: "!" | "-" | "+"; readonly operand: ExprNode }
	| {
			readonly kind: "binary";
			readonly operator: string;
			readonly left: ExprNode;
			readonly right: ExprNode;
	  }
	| {
			readonly kind: "conditional";
			readonly test: ExprNode;
			readonly consequent: ExprNode;
			readonly alternate: ExprNode;
	  }
	| { readonly kind: "array"; readonly items: readonly ExprNode[] }
	| { readonly kind: "object"; readonly entries: readonly { readonly key: string; readonly value: ExprNode }[] };

interface PureFunctionSpec {
	readonly minArgs: number;
	readonly maxArgs: number;
	readonly call: (args: readonly SandboxValue[], state: EvalState) => SandboxValue;
}

const PURE_FUNCTIONS: Readonly<Record<string, PureFunctionSpec>> = Object.freeze({
	get: {
		minArgs: 2,
		maxArgs: 3,
		call: args => {
			const path = requireString(args[1], "get() path");
			try {
				const result = readJsonPath(args[0], parseJsonPath(path));
				return result === undefined && args.length === 3 ? args[2] : result;
			} catch (error) {
				if (error instanceof JsonDataError) {
					throw new ExpressionError("get() received an invalid or unsafe path.", "expression_unsafe_access");
				}
				throw error;
			}
		},
	},
	has: {
		minArgs: 2,
		maxArgs: 2,
		call: args => {
			const path = requireString(args[1], "has() path");
			try {
				return readJsonPath(args[0], parseJsonPath(path)) !== undefined;
			} catch (error) {
				if (error instanceof JsonDataError) {
					throw new ExpressionError("has() received an invalid or unsafe path.", "expression_unsafe_access");
				}
				throw error;
			}
		},
	},
	coalesce: {
		minArgs: 1,
		maxArgs: Number.POSITIVE_INFINITY,
		call: args => args.find(value => value !== null && value !== undefined),
	},
	default: {
		minArgs: 2,
		maxArgs: 2,
		call: args => (args[0] === null || args[0] === undefined ? args[1] : args[0]),
	},
	concat: {
		minArgs: 1,
		maxArgs: Number.POSITIVE_INFINITY,
		call: args => {
			const parts: string[] = [];
			for (const value of args) {
				const part = scalarToString(value);
				if (part === undefined) {
					throw new ExpressionError("concat() accepts only scalar values.", "expression_type");
				}
				parts.push(part);
			}
			return parts.join("");
		},
	},
	join: {
		minArgs: 1,
		maxArgs: 2,
		call: (args, state) => {
			const values = requireArray(args[0], "join()");
			const separator = args.length === 2 ? requireString(args[1], "join() separator") : ",";
			spendWork(state, values.length);
			const parts = values.map(value => {
				const part = scalarToString(value);
				if (part === undefined) {
					throw new ExpressionError("join() accepts only scalar array items.", "expression_type");
				}
				return part;
			});
			return parts.join(separator);
		},
	},
	length: {
		minArgs: 1,
		maxArgs: 1,
		call: args => {
			const value = args[0];
			if (value === null || value === undefined) return 0;
			if (typeof value === "string" || Array.isArray(value)) return value.length;
			if (typeof value === "object") return Object.keys(value).length;
			throw new ExpressionError("length() expects a string, array, object, or null.", "expression_type");
		},
	},
	keys: {
		minArgs: 1,
		maxArgs: 1,
		call: (args, state) => {
			const value = args[0];
			if (value === null || value === undefined) return [];
			const keys = Array.isArray(value)
				? value.map((_item, index) => String(index))
				: Object.keys(requireObject(value, "keys()"));
			spendWork(state, keys.length);
			return keys;
		},
	},
	values: {
		minArgs: 1,
		maxArgs: 1,
		call: (args, state) => {
			const value = args[0];
			if (value === null || value === undefined) return [];
			if (Array.isArray(value)) {
				spendWork(state, value.length);
				return value.slice();
			}
			const object = requireObject(value, "values()");
			const keys = Object.keys(object);
			spendWork(state, keys.length);
			return keys.map(key => object[key]!);
		},
	},
	lower: {
		minArgs: 1,
		maxArgs: 1,
		call: args => requireString(args[0], "lower()").toLowerCase(),
	},
	upper: {
		minArgs: 1,
		maxArgs: 1,
		call: args => requireString(args[0], "upper()").toUpperCase(),
	},
	trim: {
		minArgs: 1,
		maxArgs: 1,
		call: args => requireString(args[0], "trim()").trim(),
	},
	replace: {
		minArgs: 3,
		maxArgs: 3,
		call: args => {
			const value = requireString(args[0], "replace()");
			const search = requireString(args[1], "replace() search");
			const replacement = requireString(args[2], "replace() replacement");
			return value.replace(search, replacement);
		},
	},
	startsWith: {
		minArgs: 2,
		maxArgs: 2,
		call: args => requireString(args[0], "startsWith()").startsWith(requireString(args[1], "startsWith() prefix")),
	},
	endsWith: {
		minArgs: 2,
		maxArgs: 2,
		call: args => requireString(args[0], "endsWith()").endsWith(requireString(args[1], "endsWith() suffix")),
	},
	includes: {
		minArgs: 2,
		maxArgs: 2,
		call: (args, state) => {
			const value = args[0];
			if (typeof value === "string") return value.includes(requireString(args[1], "includes() search"));
			const values = requireArray(value, "includes()");
			spendWork(state, values.length);
			return values.some(item => jsonEquals(item, args[1]!));
		},
	},
	slice: {
		minArgs: 2,
		maxArgs: 3,
		call: (args, state) => {
			const value = args[0];
			const start = requireNumber(args[1], "slice() start");
			const end = args.length === 3 ? requireNumber(args[2], "slice() end") : undefined;
			if (typeof value === "string") return end === undefined ? value.slice(start) : value.slice(start, end);
			const values = requireArray(value, "slice()");
			const result = end === undefined ? values.slice(start) : values.slice(start, end);
			spendWork(state, result.length);
			return result;
		},
	},
	json: {
		minArgs: 1,
		maxArgs: 1,
		call: (args, state) => {
			const text = requireString(args[0], "json()");
			if (text.length > MAX_JSON_FUNCTION_TEXT) {
				throw new ExpressionError("json() input exceeds the supported size.", "expression_limit");
			}
			spendWork(state, Math.ceil(text.length / 64));
			let parsed: unknown;
			try {
				parsed = JSON.parse(text);
			} catch {
				throw new ExpressionError("json() received invalid JSON text.", "expression_type");
			}
			try {
				return cloneJsonValue(parsed, { maxDepth: state.maxDepth, maxNodes: MAX_ENVIRONMENT_NODES });
			} catch (error) {
				if (error instanceof JsonDataError) {
					throw new ExpressionError("json() produced unsupported JSON data.", "expression_type");
				}
				throw error;
			}
		},
	},
	number: {
		minArgs: 1,
		maxArgs: 1,
		call: args => {
			const value = args[0];
			if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
			if (typeof value !== "string") return undefined;
			const trimmed = value.trim();
			if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(trimmed)) return undefined;
			const parsed = Number(trimmed);
			return Number.isFinite(parsed) ? parsed : undefined;
		},
	},
	string: {
		minArgs: 1,
		maxArgs: 1,
		call: args => {
			const result = scalarToString(args[0]);
			if (result === undefined) {
				throw new ExpressionError("string() accepts only scalar values.", "expression_type");
			}
			return result;
		},
	},
	boolean: {
		minArgs: 1,
		maxArgs: 1,
		call: args => isTruthy(args[0]),
	},
	min: {
		minArgs: 1,
		maxArgs: Number.POSITIVE_INFINITY,
		call: args => Math.min(...args.map(value => requireNumber(value, "min()"))),
	},
	max: {
		minArgs: 1,
		maxArgs: Number.POSITIVE_INFINITY,
		call: args => Math.max(...args.map(value => requireNumber(value, "max()"))),
	},
	round: {
		minArgs: 1,
		maxArgs: 2,
		call: args => {
			const value = requireNumber(args[0], "round()");
			const digits = args.length === 2 ? requireNumber(args[1], "round() digits") : 0;
			if (!Number.isInteger(digits) || digits < 0 || digits > 10) {
				throw new ExpressionError("round() digits must be an integer from 0 to 10.", "expression_type");
			}
			const factor = 10 ** digits;
			const result = Math.round(value * factor) / factor;
			return Number.isFinite(result) ? result : undefined;
		},
	},
	type: {
		minArgs: 1,
		maxArgs: 1,
		call: args => {
			const value = args[0];
			if (value === null) return "null";
			if (Array.isArray(value)) return "array";
			return typeof value;
		},
	},
});

class Parser {
	readonly #tokens: readonly Token[];
	readonly #limits: ExpressionLimits;
	readonly #roots: ReadonlySet<string> | undefined;
	#index = 0;
	#nodeCount = 0;

	constructor(tokens: readonly Token[], limits: ExpressionLimits, roots: ReadonlySet<string> | undefined) {
		this.#tokens = tokens;
		this.#limits = limits;
		this.#roots = roots;
	}

	get nodeCount(): number {
		return this.#nodeCount;
	}

	parse(): ExprNode {
		const expression = this.#parseConditional(0);
		const token = this.#peek();
		if (token.kind !== "eof") syntaxError("Unexpected token after expression", token.position);
		return expression;
	}

	#peek(): Token {
		return this.#tokens[this.#index]!;
	}

	#next(): Token {
		const token = this.#tokens[this.#index]!;
		this.#index += 1;
		return token;
	}

	#isOperator(operator: string): boolean {
		const token = this.#peek();
		return token.kind === "operator" && token.value === operator;
	}

	#matchOperator(operator: string): boolean {
		if (!this.#isOperator(operator)) return false;
		this.#index += 1;
		return true;
	}

	#expectOperator(operator: string): void {
		const token = this.#next();
		if (token.kind !== "operator" || token.value !== operator) {
			syntaxError(`Expected "${operator}"`, token.position);
		}
	}

	#node<T extends ExprNode>(node: T): T {
		this.#nodeCount += 1;
		if (this.#nodeCount > this.#limits.maxNodes) {
			throw new ExpressionError("Expression exceeded its node limit.", "expression_limit");
		}
		return node;
	}

	#checkDepth(depth: number): void {
		if (depth > this.#limits.maxDepth) {
			throw new ExpressionError("Expression exceeded its nesting limit.", "expression_limit");
		}
	}

	#parseConditional(depth: number): ExprNode {
		this.#checkDepth(depth);
		const test = this.#parseNullish(depth);
		if (!this.#matchOperator("?")) return test;
		const consequent = this.#parseConditional(depth + 1);
		this.#expectOperator(":");
		const alternate = this.#parseConditional(depth + 1);
		return this.#node({ kind: "conditional", test, consequent, alternate });
	}

	#parseBinaryLevel(depth: number, operators: readonly string[], next: (depth: number) => ExprNode): ExprNode {
		let left = next(depth);
		while (this.#peek().kind === "operator" && operators.includes(this.#peek().value as string)) {
			const operator = this.#next().value as string;
			const right = next(depth);
			left = this.#node({ kind: "binary", operator, left, right });
		}
		return left;
	}

	#parseNullish(depth: number): ExprNode {
		return this.#parseBinaryLevel(depth, ["??"], childDepth => this.#parseLogicalOr(childDepth));
	}

	#parseLogicalOr(depth: number): ExprNode {
		return this.#parseBinaryLevel(depth, ["||"], childDepth => this.#parseLogicalAnd(childDepth));
	}

	#parseLogicalAnd(depth: number): ExprNode {
		return this.#parseBinaryLevel(depth, ["&&"], childDepth => this.#parseEquality(childDepth));
	}

	#parseEquality(depth: number): ExprNode {
		return this.#parseBinaryLevel(depth, ["===", "!==", "==", "!="], childDepth => this.#parseRelational(childDepth));
	}

	#parseRelational(depth: number): ExprNode {
		return this.#parseBinaryLevel(depth, ["<=", ">=", "<", ">"], childDepth => this.#parseAdditive(childDepth));
	}

	#parseAdditive(depth: number): ExprNode {
		return this.#parseBinaryLevel(depth, ["+", "-"], childDepth => this.#parseMultiplicative(childDepth));
	}

	#parseMultiplicative(depth: number): ExprNode {
		return this.#parseBinaryLevel(depth, ["*", "/", "%"], childDepth => this.#parseUnary(childDepth));
	}

	#parseUnary(depth: number): ExprNode {
		this.#checkDepth(depth);
		const token = this.#peek();
		if (token.kind === "operator" && (token.value === "!" || token.value === "-" || token.value === "+")) {
			this.#index += 1;
			const operand = this.#parseUnary(depth + 1);
			return this.#node({ kind: "unary", operator: token.value, operand });
		}
		return this.#parsePostfix(depth);
	}

	#parsePostfix(depth: number): ExprNode {
		let expression = this.#parsePrimary(depth);
		for (;;) {
			if (this.#matchOperator(".")) {
				const token = this.#next();
				if (token.kind !== "identifier" || typeof token.value !== "string") {
					syntaxError("Expected a property name after dot", token.position);
				}
				safeKey(token.value);
				expression = this.#node({ kind: "member", object: expression, key: token.value });
				continue;
			}
			if (this.#matchOperator("[")) {
				const key = this.#parseConditional(depth + 1);
				this.#expectOperator("]");
				if (key.kind === "literal" && typeof key.value === "string") safeKey(key.value);
				expression = this.#node({ kind: "member", object: expression, key });
				continue;
			}
			return expression;
		}
	}

	#parsePrimary(depth: number): ExprNode {
		this.#checkDepth(depth);
		const token = this.#next();
		switch (token.kind) {
			case "number":
			case "string":
				return this.#node({ kind: "literal", value: token.value as JsonValue });
			case "identifier": {
				const name = token.value as string;
				if (name === "true") return this.#node({ kind: "literal", value: true });
				if (name === "false") return this.#node({ kind: "literal", value: false });
				if (name === "null") return this.#node({ kind: "literal", value: null });
				if (this.#matchOperator("(")) {
					const spec = PURE_FUNCTIONS[name];
					if (spec === undefined) {
						throw new ExpressionError(
							`Function "${name}" is not available in the sandbox.`,
							"expression_unknown_function",
						);
					}
					const args: ExprNode[] = [];
					if (!this.#matchOperator(")")) {
						for (;;) {
							args.push(this.#parseConditional(depth + 1));
							if (this.#matchOperator(")")) break;
							this.#expectOperator(",");
						}
					}
					if (args.length < spec.minArgs || args.length > spec.maxArgs) {
						throw new ExpressionError(
							`Function "${name}" received an unsupported number of arguments.`,
							"expression_type",
						);
					}
					return this.#node({ kind: "call", name, args });
				}
				if (this.#roots !== undefined && !this.#roots.has(name)) {
					throw new ExpressionError(
						`Identifier "${name}" is not available in this sandbox.`,
						"expression_unknown_identifier",
					);
				}
				return this.#node({ kind: "identifier", name });
			}
			case "operator": {
				if (token.value === "(") {
					const expression = this.#parseConditional(depth + 1);
					this.#expectOperator(")");
					return expression;
				}
				if (token.value === "[") {
					const items: ExprNode[] = [];
					if (!this.#matchOperator("]")) {
						for (;;) {
							items.push(this.#parseConditional(depth + 1));
							if (this.#matchOperator("]")) break;
							this.#expectOperator(",");
						}
					}
					return this.#node({ kind: "array", items });
				}
				if (token.value === "{") {
					const entries: { key: string; value: ExprNode }[] = [];
					const seen = new Set<string>();
					if (!this.#matchOperator("}")) {
						for (;;) {
							const keyToken = this.#next();
							let key: string;
							if (keyToken.kind === "identifier") {
								key = keyToken.value as string;
							} else if (keyToken.kind === "string") {
								key = keyToken.value as string;
							} else {
								syntaxError("Object keys must be identifiers or strings", keyToken.position);
							}
							safeKey(key);
							if (seen.has(key)) {
								throw new ExpressionError("Object literal contains a duplicate key.", "expression_syntax");
							}
							seen.add(key);
							this.#expectOperator(":");
							entries.push({ key, value: this.#parseConditional(depth + 1) });
							if (this.#matchOperator("}")) break;
							this.#expectOperator(",");
						}
					}
					return this.#node({ kind: "object", entries });
				}
				syntaxError("Unexpected token", token.position);
			}
			case "eof":
				syntaxError("Unexpected end of expression", token.position);
		}
	}
}

function readMember(object: SandboxValue, key: string | number): SandboxValue {
	if (object === null || object === undefined) return undefined;
	if (Array.isArray(object)) {
		if (key === "length") return object.length;
		const index = typeof key === "number" ? key : /^[0-9]+$/.test(key) ? Number(key) : Number.NaN;
		return Number.isInteger(index) && index >= 0 ? object[index] : undefined;
	}
	if (typeof object === "string") {
		if (key === "length") return object.length;
		const index = typeof key === "number" ? key : /^[0-9]+$/.test(key) ? Number(key) : Number.NaN;
		return Number.isInteger(index) && index >= 0 ? object[index] : undefined;
	}
	if (typeof object !== "object") return undefined;
	const property = String(key);
	safeKey(property);
	return Object.prototype.hasOwnProperty.call(object, property) ? object[property] : undefined;
}

function evaluateNode(
	node: ExprNode,
	environment: Readonly<Record<string, JsonValue>>,
	state: EvalState,
): SandboxValue {
	spend(state);
	state.depth += 1;
	if (state.depth > state.maxDepth) {
		throw new ExpressionError("Expression exceeded its evaluation depth limit.", "expression_limit");
	}
	try {
		switch (node.kind) {
			case "literal":
				return node.value;
			case "identifier": {
				if (!Object.prototype.hasOwnProperty.call(environment, node.name)) {
					throw new ExpressionError(
						`Identifier "${node.name}" is not available in the sandbox.`,
						"expression_unknown_identifier",
					);
				}
				return environment[node.name];
			}
			case "member": {
				const object = evaluateNode(node.object, environment, state);
				const key = typeof node.key === "string" ? node.key : evaluateNode(node.key, environment, state);
				if (key !== undefined && typeof key !== "string" && typeof key !== "number") {
					throw new ExpressionError("Property access requires a string or numeric key.", "expression_type");
				}
				return key === undefined ? undefined : readMember(object, key);
			}
			case "call": {
				const spec = PURE_FUNCTIONS[node.name]!;
				const args: SandboxValue[] = [];
				for (const argument of node.args) {
					args.push(evaluateNode(argument, environment, state));
				}
				return spec.call(args, state);
			}
			case "unary": {
				const operand = evaluateNode(node.operand, environment, state);
				if (node.operator === "!") return !isTruthy(operand);
				if (typeof operand !== "number" || !Number.isFinite(operand)) {
					throw new ExpressionError(`Unary "${node.operator}" expects a finite number.`, "expression_type");
				}
				return node.operator === "-" ? -operand : operand;
			}
			case "binary":
				return evaluateBinary(node.operator, node.left, node.right, environment, state);
			case "conditional":
				return isTruthy(evaluateNode(node.test, environment, state))
					? evaluateNode(node.consequent, environment, state)
					: evaluateNode(node.alternate, environment, state);
			case "array": {
				const result: JsonValue[] = [];
				for (const item of node.items) {
					const value = evaluateNode(item, environment, state);
					result.push(value === undefined ? null : value);
				}
				return result;
			}
			case "object": {
				const result: JsonObject = {};
				for (const entry of node.entries) {
					const value = evaluateNode(entry.value, environment, state);
					if (value !== undefined) result[entry.key] = value;
				}
				return result;
			}
		}
	} finally {
		state.depth -= 1;
	}
}

function evaluateBinary(
	operator: string,
	leftNode: ExprNode,
	rightNode: ExprNode,
	environment: Readonly<Record<string, JsonValue>>,
	state: EvalState,
): SandboxValue {
	if (operator === "&&" || operator === "||" || operator === "??") {
		const left = evaluateNode(leftNode, environment, state);
		if (operator === "&&") return isTruthy(left) ? evaluateNode(rightNode, environment, state) : left;
		if (operator === "||") return isTruthy(left) ? left : evaluateNode(rightNode, environment, state);
		return left === null || left === undefined ? evaluateNode(rightNode, environment, state) : left;
	}
	const left = evaluateNode(leftNode, environment, state);
	const right = evaluateNode(rightNode, environment, state);
	if (operator === "===" || operator === "!==" || operator === "==" || operator === "!=") {
		const equal = left !== undefined && right !== undefined ? jsonEquals(left, right) : left === right;
		return operator === "===" || operator === "==" ? equal : !equal;
	}
	if (operator === "<" || operator === "<=" || operator === ">" || operator === ">=") {
		let comparison: number;
		if (typeof left === "number" && typeof right === "number") {
			comparison = left - right;
		} else if (typeof left === "string" && typeof right === "string") {
			comparison = left < right ? -1 : left > right ? 1 : 0;
		} else {
			throw new ExpressionError(`Operator "${operator}" requires two numbers or two strings.`, "expression_type");
		}
		if (operator === "<") return comparison < 0;
		if (operator === "<=") return comparison <= 0;
		if (operator === ">") return comparison > 0;
		return comparison >= 0;
	}
	if (operator === "+") {
		if (typeof left === "number" && typeof right === "number") {
			const result = left + right;
			if (!Number.isFinite(result)) {
				throw new ExpressionError("Numeric addition produced a non-finite value.", "expression_type");
			}
			return result;
		}
		if (typeof left === "string" || typeof right === "string") {
			const leftText = scalarToString(left);
			const rightText = scalarToString(right);
			if (leftText === undefined || rightText === undefined) {
				throw new ExpressionError('Operator "+" cannot concatenate objects or arrays.', "expression_type");
			}
			return leftText + rightText;
		}
		throw new ExpressionError('Operator "+" requires two numbers or a string operand.', "expression_type");
	}
	const leftNumber = requireNumber(left, `Operator "${operator}"`);
	const rightNumber = requireNumber(right, `Operator "${operator}"`);
	if ((operator === "/" || operator === "%") && rightNumber === 0) {
		throw new ExpressionError("Division by zero is not allowed.", "expression_type");
	}
	let result: number;
	switch (operator) {
		case "-":
			result = leftNumber - rightNumber;
			break;
		case "*":
			result = leftNumber * rightNumber;
			break;
		case "/":
			result = leftNumber / rightNumber;
			break;
		case "%":
			result = leftNumber % rightNumber;
			break;
		default:
			throw new ExpressionError(`Unsupported operator "${operator}".`, "expression_syntax");
	}
	if (!Number.isFinite(result)) {
		throw new ExpressionError("Arithmetic produced a non-finite value.", "expression_type");
	}
	return result;
}

function cloneEnvironment(value: Readonly<Record<string, unknown>>): Readonly<Record<string, JsonValue>> {
	let cloned: JsonValue;
	try {
		cloned = cloneJsonValue(value, {
			maxDepth: HARD_LIMITS.maxDepth,
			maxNodes: MAX_ENVIRONMENT_NODES,
		});
	} catch {
		throw new ExpressionError("Sandbox environment must be plain JSON data.", "expression_invalid_environment");
	}
	if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
		throw new ExpressionError(
			"Sandbox environment must be a JSON object of named roots.",
			"expression_invalid_environment",
		);
	}
	return cloned;
}

class SandboxExpressionImplementation implements SandboxExpression {
	readonly source: string;
	readonly nodeCount: number;
	readonly #ast: ExprNode;
	readonly #limits: ExpressionLimits;
	readonly #roots: ReadonlySet<string> | undefined;

	constructor(
		source: string,
		ast: ExprNode,
		nodeCount: number,
		limits: ExpressionLimits,
		roots: ReadonlySet<string> | undefined,
	) {
		this.source = source;
		this.nodeCount = nodeCount;
		this.#ast = ast;
		this.#limits = limits;
		this.#roots = roots;
	}

	evaluate(environment: SandboxEnvironment | Readonly<Record<string, unknown>>): JsonValue | undefined {
		const source =
			environment instanceof SandboxEnvironment
				? preparedEnvironments.get(environment)
				: cloneEnvironment(environment);
		if (source === undefined) {
			throw new ExpressionError("Sandbox environment was not initialized.", "expression_invalid_environment");
		}
		let prepared: Readonly<Record<string, JsonValue>> = source;
		if (this.#roots !== undefined) {
			const filtered: Record<string, JsonValue> = {};
			for (const root of this.#roots) {
				if (Object.prototype.hasOwnProperty.call(prepared, root)) filtered[root] = prepared[root]!;
			}
			prepared = filtered;
		}
		const state: EvalState = {
			steps: 0,
			depth: 0,
			maxSteps: this.#limits.maxSteps,
			maxDepth: this.#limits.maxDepth,
			maxOutputBytes: this.#limits.maxOutputBytes,
		};
		const result = evaluateNode(this.#ast, prepared, state);
		if (result !== undefined) {
			const serialized = JSON.stringify(result);
			if (new TextEncoder().encode(serialized).length > this.#limits.maxOutputBytes) {
				throw new ExpressionError("Expression result exceeded the output size limit.", "expression_limit");
			}
		}
		return result;
	}
}

function normalizeRoots(roots: readonly string[] | undefined): ReadonlySet<string> | undefined {
	if (roots === undefined) return undefined;
	const set = new Set<string>();
	for (const root of roots) {
		if (typeof root !== "string" || root.trim() === "") {
			throw new ExpressionError("Allowed expression roots must be non-empty strings.", "expression_syntax");
		}
		set.add(root);
	}
	return set;
}

/**
 * Compiles an expression into a reusable sandbox. Compilation does not touch
 * the environment; every evaluation clones it and runs under fresh counters.
 */
export function compileExpression(source: string, options: ExpressionOptions = {}): SandboxExpression {
	if (typeof source !== "string") {
		throw new ExpressionError("Expression source must be a string.", "expression_syntax");
	}
	const limits = resolveLimits(options);
	if (source.length > limits.maxSourceLength) {
		throw new ExpressionError("Expression source exceeded the size limit.", "expression_limit");
	}
	const tokens = new Lexer(source, limits.maxTokens).tokenize();
	const roots = normalizeRoots(options.allowedRoots);
	const parser = new Parser(tokens, limits, roots);
	const ast = parser.parse();
	return new SandboxExpressionImplementation(source, ast, parser.nodeCount, limits, roots);
}

/** Compile-and-evaluate convenience for one-off transforms. */
export function evaluateExpression(
	source: string,
	environment: Readonly<Record<string, unknown>>,
	options: ExpressionOptions = {},
): JsonValue | undefined {
	return compileExpression(source, options).evaluate(environment);
}

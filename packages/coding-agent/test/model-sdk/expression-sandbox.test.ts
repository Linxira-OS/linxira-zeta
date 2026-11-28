import { describe, expect, it } from "bun:test";
import { compileExpression, evaluateExpression, type ExpressionOptions } from "@linxiraos/zeta/model-sdk";

function thrown(fn: () => unknown): Error & { code?: string; provider?: string; capability?: string } {
	try {
		fn();
	} catch (error) {
		return error as Error & { code?: string; provider?: string; capability?: string };
	}
	throw new Error("Expected function to throw");
}

function failure(expression: string, environment: Record<string, unknown>, options: ExpressionOptions = {}) {
	try {
		evaluateExpression(expression, environment, options);
	} catch (error) {
		return error as Error & { code?: string };
	}
	throw new Error("Expected expression to fail");
}

describe("sandboxed expression language", () => {
	it("performs pure data transforms", () => {
		const environment = {
			input: {
				name: "Ada",
				score: 7,
				ratio: 0.5,
				list: [1, 2, 3],
				meta: { tags: ["a", "b"] },
			},
		};
		expect(evaluateExpression("input.score + 3 * 2", environment)).toBe(13);
		expect(evaluateExpression("input.score == 7 && input.name != 'Bob'", environment)).toBe(true);
		expect(evaluateExpression("input.ratio < 1 && !false", environment)).toBe(true);
		expect(evaluateExpression("input.list[1] + 10", environment)).toBe(12);
		expect(evaluateExpression("length(input.meta.tags)", environment)).toBe(2);
		expect(evaluateExpression("input.missing ?? 'fallback'", environment)).toBe("fallback");
		expect(evaluateExpression("input.name === 'Ada' ? upper(input.name) : 'no'", environment)).toBe("ADA");
		expect(
			evaluateExpression(
				"{name: lower(input.name), tags: [input.list[0], get(input, 'meta.tags[1]')]}",
				environment,
			),
		).toEqual({ name: "ada", tags: [1, "b"] });
		expect(evaluateExpression("join(slice(input.list, 1), '-')", environment)).toBe("2-3");
		expect(evaluateExpression("json('{\"a\":1}').a + 1", environment)).toBe(2);
	});

	it("does not mutate the caller's environment", () => {
		const environment = { input: { items: [3, 1, 2], nested: { value: 4 } } };
		const snapshot = JSON.stringify(environment);
		evaluateExpression("slice(input.items, 0).sort", environment);
		evaluateExpression("get(input, 'nested.value')", environment);
		expect(JSON.stringify(environment)).toBe(snapshot);
	});

	it("rejects globals, host functions, and method calls", () => {
		expect(failure("globalThis.x", { input: {} }).code).toBe("expression_unknown_identifier");
		expect(failure("process(1)", { input: {} }).code).toBe("expression_unknown_function");
		expect(failure("process.exit(1)", { input: {} }).code).toBe("expression_syntax");
		expect(failure("fetch('https://example.test')", { input: {} }).code).toBe("expression_unknown_function");
		const evalName = "ev" + "al";
		expect(failure(`${evalName}('1')`, { input: {} }).code).toBe("expression_unknown_function");
		expect(failure("input.secret()", { input: {} }).code).toBe("expression_syntax");
		expect(failure("this.input", { input: {} }).code).toBe("expression_unknown_identifier");
	});

	it("rejects assignments, arrows, statements, and template literals", () => {
		for (const expression of [
			"input.x = 1",
			"input.x += 1",
			"(() => 1)()",
			"input.x; input.y",
			"`template`",
			"input.x++",
		]) {
			expect(failure(expression, { input: {} }).code).toBe("expression_syntax");
		}
	});

	it("blocks prototype and constructor traversal at compile and runtime", () => {
		expect(failure("input.__proto__", { input: {} }).code).toBe("expression_unsafe_access");
		expect(failure("input.constructor", { input: {} }).code).toBe("expression_unsafe_access");
		expect(failure("input['prototype']", { input: {} }).code).toBe("expression_unsafe_access");
		expect(failure("get(input, '__proto__')", { input: {} }).code).toBe("expression_unsafe_access");
		expect(failure("input[input.key]", { input: { key: "constructor" } }).code).toBe("expression_unsafe_access");
	});

	it("enforces source, token, node, step, depth, and output limits", () => {
		expect(failure("input.a", { input: { a: 1 } }, { maxSourceLength: 3 }).code).toBe("expression_limit");
		expect(failure("input.a", { input: { a: 1 } }, { maxTokens: 1 }).code).toBe("expression_limit");
		expect(failure("[1, 2, 3]", {}, { maxNodes: 2 }).code).toBe("expression_limit");
		expect(failure("concat(input.a, input.b, input.c)", { input: { a: 1, b: 2, c: 3 } }, { maxSteps: 3 }).code).toBe(
			"expression_limit",
		);
		expect(failure(`${"(".repeat(10)}1${")".repeat(10)}`, {}, { maxDepth: 5 }).code).toBe("expression_limit");
		expect(failure("input.text", { input: { text: "x".repeat(100) } }, { maxOutputBytes: 10 }).code).toBe(
			"expression_limit",
		);
	});

	it("treats non-JSON environments as invalid without invoking accessors", () => {
		let invoked = false;
		const input: Record<string, unknown> = {};
		Object.defineProperty(input, "secret", {
			enumerable: true,
			get() {
				invoked = true;
				return "value";
			},
		});
		expect(failure("input.secret", { input }).code).toBe("expression_invalid_environment");
		expect(invoked).toBe(false);

		expect(failure("input.a", { input: { a: () => 1 } }).code).toBe("expression_invalid_environment");
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(failure("input.self", { input: cyclic }).code).toBe("expression_invalid_environment");
		const dangerous: Record<string, unknown> = {};
		Object.defineProperty(dangerous, "__proto__", { enumerable: true, value: { polluted: true } });
		expect(failure("input.x", { input: dangerous }).code).toBe("expression_invalid_environment");
	});

	it("rejects json() output with escape keys", () => {
		expect(failure('json(\'{"__proto__":{"x":1}}\')', {}).code).toBe("expression_type");
	});

	it("supports compile-time root allowlists", () => {
		expect(thrown(() => compileExpression("globalThis.x", { allowedRoots: ["input"] }))).toMatchObject({
			code: "expression_unknown_identifier",
		});
		expect(compileExpression("input.x", { allowedRoots: ["input"] }).evaluate({ input: { x: 1 } })).toBe(1);
	});
});

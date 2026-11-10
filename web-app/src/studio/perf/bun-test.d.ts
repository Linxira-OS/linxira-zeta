/**
 * Minimal ambient declaration for `bun:test`.
 *
 * `web-app` is a browser project: its tsconfig does not pull in `bun-types`
 * (only the repo-root `packages/*` projects do), so the `bun:test` specifier has
 * no types here and `tsc -p tsconfig.app.json` would report TS2307 for the perf
 * tests. This declares exactly the surface those tests use — nothing more.
 *
 * This file must stay a script (no top-level `import`/`export`), otherwise the
 * `declare module` block becomes an augmentation of a module that does not exist.
 */
declare module "bun:test" {
	/** Chainable matcher returned by `expect`. */
	export interface Expectation {
		readonly not: Expectation;
		toBe(expected: unknown): void;
		toBeNull(): void;
		toBeUndefined(): void;
		toBeDefined(): void;
		toBeGreaterThan(expected: number): void;
		toBeLessThan(expected: number): void;
		toEqual(expected: unknown): void;
		toContain(expected: unknown): void;
		toMatch(expected: RegExp | string): void;
		toThrow(): void;
		toHaveBeenCalled(): void;
		toHaveBeenCalledTimes(count: number): void;
	}

	/** A bare function with the `mock` bookkeeping Bun attaches to it. */
	export interface MockFunction<Args extends ReadonlyArray<unknown>, Result> {
		(...args: Args): Result;
		readonly mock: { readonly calls: ReadonlyArray<Args> };
	}

	/** Register a test suite. */
	export function describe(name: string, body: () => void): void;

	/** Register one test case; async bodies are awaited. */
	export function it(name: string, body: () => void | Promise<void>): void;

	/** Assert on a value. */
	export function expect(actual: unknown): Expectation;

	/** Wrap `impl` in a function that records its calls. */
	export function mock<Args extends ReadonlyArray<unknown>, Result>(
		impl: (...args: Args) => Result,
	): MockFunction<Args, Result>;
}

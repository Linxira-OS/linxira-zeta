/**
 * Gateway npx resolver contract — the web-gateway skills endpoints shell out to
 * the npm package runner without a shell. Under Node that means the running
 * Node's own `npx-cli.js`; under Bun — which ships no `npx-cli.js` and where
 * `process.execPath` is the Bun binary — it must fall through to `bun x`, the
 * built-in npx equivalent. Assuming Node here (the pre-Bun branch) is what
 * breaks the skills install/search/update endpoints once the process runs on
 * Bun.
 *
 * `bun test` always runs under Bun, so these cases pin the Bun branch.
 */
import { describe, expect, test } from "bun:test";
import { resolveNpxInvocation } from "../../src/server/web-gateway/npx";

describe("resolveNpxInvocation under Bun", () => {
	test("routes through the Bun binary with the `x` subcommand", () => {
		const invocation = resolveNpxInvocation(["skills", "find", "pdf"]);
		expect(invocation.command).toBe(process.execPath);
		expect(invocation.commandArgs).toEqual(["x", "skills", "find", "pdf"]);
	});

	test("preserves argument order and never inserts a shell", () => {
		const args = ["skills", "add", "owner/repo@skill", "-y", "--agent", "cursor", "-g"];
		const invocation = resolveNpxInvocation(args);
		expect(invocation.commandArgs).toEqual(["x", ...args]);
		expect(invocation.commandArgs).not.toContain("-c");
	});

	test("empty args still target the package-runner subcommand", () => {
		expect(resolveNpxInvocation([]).commandArgs).toEqual(["x"]);
	});
});

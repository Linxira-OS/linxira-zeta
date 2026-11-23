import { describe, expect, it } from "bun:test";
import { resolveInvokedArgv } from "../src/cli";

describe("zeta launcher alias", () => {
	it("runs bare zeta standalone and leaves zetacode shared", () => {
		expect(resolveInvokedArgv("zeta", [])).toEqual(["--standalone"]);
		expect(resolveInvokedArgv("zeta.exe", [])).toEqual(["--standalone"]);
		expect(resolveInvokedArgv("zetacode", [])).toEqual([]);
	});
	it("keeps zeta subcommands and routes zeta help to help", () => {
		expect(resolveInvokedArgv("zeta", ["serve", "--no-browser"])).toEqual(["serve", "--no-browser"]);
		expect(resolveInvokedArgv("zeta", ["help"])).toEqual(["--help"]);
		expect(resolveInvokedArgv("zeta", ["--version"])).toEqual(["--version"]);
	});
});

/**
 * Zeta serve/web command tests — validate the CLI command definitions
 * for `zeta serve` and `zeta web`.
 */
import { describe, expect, it } from "bun:test";
import Serve from "@zeta/pi-coding-agent/commands/serve";
import Web from "@zeta/pi-coding-agent/commands/web";

describe("zeta serve command", () => {
	it("has the expected description", () => {
		expect(Serve.description).toBe("Start the Stats Dashboard and Web UI, then open the browser");
	});

	it("defines stats-port flag with default 3847", () => {
		const flags = Serve.flags;
		expect(flags).toBeDefined();
		expect(flags["stats-port"]).toBeDefined();
		expect(flags["stats-port"].default).toBe(3847);
	});

	it("defines web-port flag with default 30141", () => {
		const flags = Serve.flags;
		expect(flags["web-port"]).toBeDefined();
		expect(flags["web-port"].default).toBe(30141);
	});

	it("defines no-browser boolean flag", () => {
		const flags = Serve.flags;
		expect(flags["no-browser"]).toBeDefined();
		expect(flags["no-browser"].default).toBe(false);
	});

	it("defines stats-only boolean flag", () => {
		const flags = Serve.flags;
		expect(flags["stats-only"]).toBeDefined();
		expect(flags["stats-only"].default).toBe(false);
	});

	it("defines web-only boolean flag", () => {
		const flags = Serve.flags;
		expect(flags["web-only"]).toBeDefined();
		expect(flags["web-only"].default).toBe(false);
	});
});

describe("zeta web command", () => {
	it("has the expected description", () => {
		expect(Web.description).toBe("Start the Web UI server and open the browser");
	});

	it("defines port flag with default 30141", () => {
		const flags = Web.flags;
		expect(flags.port).toBeDefined();
		expect(flags.port.default).toBe(30141);
	});

	it("defines no-browser boolean flag", () => {
		const flags = Web.flags;
		expect(flags["no-browser"]).toBeDefined();
		expect(flags["no-browser"].default).toBe(false);
	});
});

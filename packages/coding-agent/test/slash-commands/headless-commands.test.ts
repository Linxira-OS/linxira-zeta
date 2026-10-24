import { describe, expect, test } from "bun:test";
import { parseCleanseArgs } from "../../src/slash-commands/cleanse";
import { parseOmfgArgs } from "../../src/slash-commands/omfg";

describe("headless TUI commands", () => {
	test("parses /cleanse flags and free-form request", () => {
		expect(parseCleanseArgs("fix the lint --all --tests -n 4 -m @smol")).toMatchObject({
			request: "fix the lint",
			all: true,
			includeTests: true,
			maxAgents: 4,
			model: "@smol",
		});
		expect(parseCleanseArgs("--agents 0").error).toBeString();
		expect(parseCleanseArgs("--model").error).toBeString();
		expect(parseCleanseArgs("--unknown").error).toBeString();
	});

	test("parses /omfg scope and force flags", () => {
		expect(parseOmfgArgs("stop writing globals")).toMatchObject({
			complaint: "stop writing globals",
			global: false,
			force: false,
		});
		expect(parseOmfgArgs("--global --force stop writing globals")).toMatchObject({
			complaint: "stop writing globals",
			global: true,
			force: true,
		});
		expect(parseOmfgArgs("--global").error).toBeString();
	});
});

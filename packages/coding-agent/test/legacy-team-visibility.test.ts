import { describe, expect, test } from "bun:test";
import { buildAvailableSlashCommands } from "../src/slash-commands/available-commands";
import { commands } from "../src/cli-commands";

describe("legacy Super Team discovery", () => {
	test("advertises active Team while preserving callable legacy definitions outside discovery", async () => {
		const available = await buildAvailableSlashCommands(
			{ customCommands: [], skills: [], setSlashCommands() {}, sessionManager: { getCwd: () => "/project" } },
			async () => [],
		);
		const names = available.flatMap(command => [command.name, ...(command.aliases ?? [])]);
		expect(names).toContain("team");
		expect(names).not.toContain("lead");
		expect(names).not.toContain("pm");
		expect(names).not.toContain("initzetateam");
		expect(names).not.toContain("teamworker");
		const legacy = commands.find(command => command.name === "team");
		expect(legacy?.help?.hidden).toBe(true);
		expect(typeof legacy?.load).toBe("function");
	});
});

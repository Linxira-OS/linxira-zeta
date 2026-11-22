import { describe, expect, it } from "bun:test";
import { parseTeamPersonaPack } from "../../src/team/persona-pack";

const valid = {
	schemaVersion: 1,
	id: "release-manager",
	revision: 3,
	name: "Release Manager",
	role: "release",
	description: "Coordinates the distribution repositories",
	model: "odd/model",
	thinkingLevel: "high",
	skills: ["release-notes", "changelog"],
	permissions: { write_file: "prompt", send_out: "deny" },
	memoryScope: "team",
	workingFolder: "repos/distro",
	pluginPack: { root: "plugins/release", hash: "sha256:abc" },
};

describe("parseTeamPersonaPack", () => {
	it("accepts a complete versioned persona", () => {
		const result = parseTeamPersonaPack(valid);
		expect(result.ok).toBe(true);
		expect(result.pack).toMatchObject({ id: "release-manager", revision: 3, memoryScope: "team" });
		expect(result.problems).toEqual([]);
	});

	it("rejects a malformed identity and plugin root", () => {
		const result = parseTeamPersonaPack({
			...valid,
			id: "Release Manager",
			revision: 0,
			permissions: { write_file: "always" },
			thinkingLevel: "extreme",
			pluginPack: { root: "../outside" },
		});
		expect(result.ok).toBe(false);
		expect(result.problems).toEqual(
			expect.arrayContaining([
				"id must be a lowercase slug (a-z, 0-9, -)",
				"revision must be a positive integer",
				"permissions.write_file must be allow, prompt or deny",
				"thinkingLevel is invalid",
				"pluginPack.root must be relative and contained",
			]),
		);
	});

	it("rejects non-object data and a missing role", () => {
		expect(parseTeamPersonaPack(null).ok).toBe(false);
		const result = parseTeamPersonaPack({ ...valid, role: "" });
		expect(result.ok).toBe(false);
		expect(result.problems).toContain("role is required");
	});
});

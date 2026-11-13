import { describe, expect, it } from "bun:test";

import {
	findAgentRoleReferences,
	findRoleAssignmentReferences,
	selectorNamesRole,
} from "@linxiraos/zeta/config/role-references";

describe("custom role reference protection", () => {
	it("finds agent definition and override references, including legacy pi/ aliases", () => {
		const agents = [
			{ name: "scout", model: ["@research"] },
			{ name: "worker", model: ["openai/gpt-5"] },
			{ name: "legacy", model: ["pi/research:high"] },
			{ name: "sonic", model: ["@smol"] },
		];
		expect(
			findAgentRoleReferences(agents, { scout: "@research", worker: "local/m", sonic: "@smol" }, "research"),
		).toEqual(["legacy", "scout"]);
		expect(findAgentRoleReferences(agents, {}, "smol")).toEqual(["sonic"]);
		expect(findAgentRoleReferences(agents, {}, "default")).toEqual([]);
	});

	it("treats similar names and other roles as unrelated", () => {
		expect(selectorNamesRole("@research", "research")).toBe(true);
		expect(selectorNamesRole("@research:high", "research")).toBe(true);
		expect(selectorNamesRole("@research-fast", "research")).toBe(false);
		expect(selectorNamesRole("provider/model", "research")).toBe(false);
	});

	it("finds modelRoles assignments delegating to the same alias", () => {
		expect(
			findRoleAssignmentReferences({ default: "a/b", slow: "@research", plan: "@research:high" }, "research"),
		).toEqual(["plan", "slow"]);
		expect(findRoleAssignmentReferences({ default: "a/b" }, "research")).toEqual([]);
	});
});

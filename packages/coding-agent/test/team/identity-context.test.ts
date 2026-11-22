import { describe, expect, it } from "bun:test";
import { resolveTeamIdentity, type TeamIdentityLayer } from "../../src/team/identity-context";

const layers: TeamIdentityLayer[] = [
	{ id: "global", kind: "global", appliesTo: "all", content: "global user preference" },
	{ id: "project", kind: "project", appliesTo: "all", content: "repository convention" },
	{ id: "team", kind: "team", appliesTo: "all", content: "team convention" },
	{ id: "persona-dev", kind: "persona", personaId: "dev", appliesTo: "all", content: "developer identity" },
	{ id: "persona-main", kind: "persona", personaId: "main", appliesTo: "all", content: "main identity" },
	{ id: "main-only", kind: "assignment", agentId: "main", appliesTo: "all", content: "main-only instruction" },
	{ id: "dev-only", kind: "assignment", agentId: "dev", appliesTo: "all", content: "dev-only instruction" },
	{ id: "workers-only", kind: "assignment", appliesTo: "worker", content: "worker role policy" },
];

describe("resolveTeamIdentity", () => {
	it("keeps repository conventions but excludes main-only identity from a worker", () => {
		const resolved = resolveTeamIdentity({ role: "worker", agentId: "dev", personaId: "dev", layers });
		expect(resolved.layers.map(layer => layer.id)).toEqual([
			"global",
			"project",
			"team",
			"persona-dev",
			"dev-only",
			"workers-only",
		]);
		expect(resolved.excluded).toContain("persona-main");
		expect(resolved.excluded).toContain("main-only");
	});

	it("excludes the worker persona and worker-only policy from main", () => {
		const resolved = resolveTeamIdentity({ role: "main", agentId: "main", personaId: "main", layers });
		expect(resolved.layers.map(layer => layer.id)).toEqual([
			"global",
			"project",
			"team",
			"persona-main",
			"main-only",
		]);
		expect(resolved.excluded).toContain("persona-dev");
		expect(resolved.excluded).toContain("dev-only");
		expect(resolved.excluded).toContain("workers-only");
	});

	it("excludes a persona layer for a different persona", () => {
		const resolved = resolveTeamIdentity({ role: "worker", agentId: "dev", personaId: "qa", layers });
		expect(resolved.layers.some(layer => layer.id === "persona-dev")).toBe(false);
	});

	it("supports an explicit agent allow-list", () => {
		const resolved = resolveTeamIdentity({
			role: "worker",
			agentId: "qa",
			personaId: "qa",
			layers: [
				...layers,
				{ id: "qa-only", kind: "assignment", appliesTo: ["qa"], content: "qa policy" },
				{ id: "dev-only-explicit", kind: "assignment", appliesTo: ["dev"], content: "dev policy" },
			],
		});
		expect(resolved.layers.some(layer => layer.id === "qa-only")).toBe(true);
		expect(resolved.layers.some(layer => layer.id === "dev-only-explicit")).toBe(false);
	});

	it("is deterministic and changes digest when an applied revision changes", () => {
		const one = resolveTeamIdentity({ role: "worker", agentId: "dev", personaId: "dev", layers });
		const two = resolveTeamIdentity({ role: "worker", agentId: "dev", personaId: "dev", layers });
		expect(one.digest).toBe(two.digest);
		const changed = resolveTeamIdentity({
			role: "worker",
			agentId: "dev",
			personaId: "dev",
			layers: layers.map(layer => (layer.id === "persona-dev" ? { ...layer, revision: "2" } : layer)),
		});
		expect(changed.digest).not.toBe(one.digest);
	});
});

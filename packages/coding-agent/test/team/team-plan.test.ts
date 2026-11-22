import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { advanceTeamPlan, parseTeamPlan, readTeamPlan, writeTeamPlan, type TeamPlan } from "../../src/team/team-plan";

const roots: string[] = [];
async function root(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-team-plan-"));
	roots.push(dir);
	return dir;
}
afterEach(async () => {
	for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

function valid(): Record<string, unknown> {
	return {
		schemaVersion: 1,
		id: "release",
		revision: 1,
		teamId: "core",
		title: "Ship 1.5.14",
		status: "draft",
		createdBy: "Main",
		createdAt: 1,
		updatedAt: 1,
		items: [
			{ id: "build", title: "Build", acceptance: ["tests pass"] },
			{ id: "ship", title: "Ship", dependsOn: ["build"], acceptance: ["tag exists"] },
		],
	};
}

describe("TeamPlan", () => {
	it("parses a dependency-ordered plan", () => {
		const result = parseTeamPlan(valid());
		expect(result.ok).toBe(true);
		expect(result.plan?.items.map(item => item.id)).toEqual(["build", "ship"]);
	});

	it("rejects unknown and cyclic dependencies", () => {
		const unknown = valid();
		unknown.items = [{ id: "ship", title: "Ship", dependsOn: ["missing"] }];
		expect(parseTeamPlan(unknown).problems.join(" ")).toContain("unknown dependency");

		const cyclic = valid();
		cyclic.items = [
			{ id: "a", title: "A", dependsOn: ["b"] },
			{ id: "b", title: "B", dependsOn: ["a"] },
		];
		expect(parseTeamPlan(cyclic).problems.join(" ")).toContain("cycle");
	});

	it("requires an explicit approval path and a reject reason", () => {
		const plan = parseTeamPlan(valid()).plan!;
		const submitting = advanceTeamPlan(plan, "submit", "Main", { at: 2 });
		const approved = advanceTeamPlan(submitting, "approve", "Owner", { at: 3 });
		expect(approved.status).toBe("approved");
		expect(approved.approvedBy).toBe("Owner");
		expect(approved.revision).toBe(3);
		expect(() => advanceTeamPlan(approved, "complete", "Main")).toThrow("cannot complete");
		expect(() => advanceTeamPlan(submitting, "reject", "Owner")).toThrow("requires a reason");
	});

	it("round-trips through the Team plan store", async () => {
		const teamRoot = await root();
		const plan = parseTeamPlan(valid()).plan as TeamPlan;
		await writeTeamPlan(teamRoot, plan);
		expect((await readTeamPlan(teamRoot, "release"))?.title).toBe("Ship 1.5.14");
		expect(await readTeamPlan(teamRoot, "../escape")).toBeUndefined();
	});
});

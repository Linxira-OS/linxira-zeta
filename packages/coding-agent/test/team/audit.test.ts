import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { auditTeam, teamAuditPath } from "../../src/team/audit";

const roots: string[] = [];
afterEach(async () => {
	for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("Team audit", () => {
	it("appends team, agent and room ids without message bodies", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-team-audit-"));
		roots.push(root);
		await auditTeam(root, { action: "room.post", teamId: "demo", agentId: "core", roomId: "acme:core" });
		await auditTeam(root, { action: "plan.approve", teamId: "demo", agentId: "main", planId: "release" });
		const lines = (await fs.readFile(teamAuditPath(root), "utf8")).trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]!)).toMatchObject({ teamId: "demo", agentId: "core", roomId: "acme:core" });
		expect(JSON.parse(lines[1]!)).toMatchObject({ teamId: "demo", agentId: "main", planId: "release" });
	});
});

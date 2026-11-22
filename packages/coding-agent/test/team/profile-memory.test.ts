import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { appendTeamMemory, listTeamMemory, readTeamMemory } from "../../src/team/memory";
import { parseTeamProfile, readTeamProfile, writeTeamProfile } from "../../src/team/profile";

const roots: string[] = [];
async function root(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-team-profile-"));
	roots.push(dir);
	return dir;
}
afterEach(async () => {
	for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("Team profile", () => {
	it("validates a default persona and external liaison", () => {
		const parsed = parseTeamProfile({
			schemaVersion: 1,
			teamId: "demo",
			defaultPersonaId: "reviewer",
			externalLiaison: { agentId: "main", channels: ["im", "im"], listen: true },
			updatedAt: 1,
		});
		expect(parsed.ok).toBe(true);
		expect(parsed.profile?.externalLiaison?.channels).toEqual(["im"]);
	});

	it("round-trips and falls back to an empty profile", async () => {
		const teamRoot = await root();
		expect((await readTeamProfile(teamRoot, "demo")).updatedAt).toBe(0);
		await writeTeamProfile(teamRoot, {
			schemaVersion: 1,
			teamId: "demo",
			defaultPersonaId: "reviewer",
			updatedAt: 1,
		});
		expect((await readTeamProfile(teamRoot, "demo")).defaultPersonaId).toBe("reviewer");
	});
});

describe("Team memory", () => {
	it("appends and lists scoped notes", async () => {
		const teamRoot = await root();
		await appendTeamMemory(teamRoot, "reviewer", "Prefer small diffs.", 1);
		await appendTeamMemory(teamRoot, "reviewer", "Always run tests.", 2);
		expect(await readTeamMemory(teamRoot, "reviewer")).toContain("Always run tests.");
		expect(await listTeamMemory(teamRoot)).toEqual(["reviewer"]);
		expect(await readTeamMemory(teamRoot, "../escape")).toBeUndefined();
	});
});

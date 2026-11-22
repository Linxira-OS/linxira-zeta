import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	readTeamIdentityLayers,
	renderTeamIdentityContext,
	resolveTeamWorkerIdentity,
} from "../../src/team/identity-store";

const roots: string[] = [];
async function root(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-team-identity-"));
	roots.push(dir);
	return dir;
}
afterEach(async () => {
	for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("Team identity layers", () => {
	it("keeps global, project, team, persona and assignment distinct", async () => {
		const base = await root();
		const home = path.join(base, "home");
		const cwd = path.join(base, "repo");
		const teamRoot = path.join(base, "team");
		for (const dir of [home, cwd, teamRoot]) await fs.mkdir(path.join(dir, ".zeta"), { recursive: true });
		await fs.mkdir(path.join(home, ".zeta", "identity"), { recursive: true });
		await fs.writeFile(path.join(home, ".zeta", "identity", "global.md"), "Global taste.");
		await fs.writeFile(path.join(cwd, ".zeta", "identity.md"), "Project identity.");
		await fs.writeFile(path.join(teamRoot, ".zeta", "identity.md"), "Team identity.");
		await fs.writeFile(path.join(cwd, "AGENTS.md"), "Repository conventions, not identity.");
		const options = {
			cwd,
			teamRoot,
			agentId: "reviewer-1",
			personaId: "reviewer",
			assignment: "Review the patch.",
			personaContent: "Reviewer persona.",
			homeDir: home,
		};
		const layers = await readTeamIdentityLayers(options);
		const context = resolveTeamWorkerIdentity(options, layers);
		const text = renderTeamIdentityContext(context);
		expect(context.layers.map(layer => layer.kind)).toEqual(["global", "project", "team", "persona", "assignment"]);
		expect(text).toContain("Global taste.");
		expect(text).toContain("Review the patch.");
		expect(text).not.toContain("Repository conventions");
	});
});

import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runTeamSessionCommand } from "../../src/team/session-commands";

const roots: string[] = [];
async function root(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-team-slash-"));
	roots.push(dir);
	await fs.mkdir(path.join(dir, ".zeta"), { recursive: true });
	await fs.writeFile(
		path.join(dir, ".zeta", "team.json"),
		JSON.stringify({ schemaVersion: 1, kind: "team", teamId: "demo", name: "Demo" }),
	);
	return dir;
}
afterEach(async () => {
	for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("in-session /team commands", () => {
	it("creates and lists a persona without the CLI", async () => {
		const cwd = await root();
		expect((await runTeamSessionCommand(cwd, "persona create reviewer code-review Reviewer")).ok).toBe(true);
		const listed = await runTeamSessionCommand(cwd, "persona list");
		expect(listed.ok).toBe(true);
		expect(listed.text).toContain("reviewer · code-review · Reviewer");
	});

	it("creates a plan and walks it through approval", async () => {
		const cwd = await root();
		expect((await runTeamSessionCommand(cwd, "plan create release Ship it")).ok).toBe(true);
		expect((await runTeamSessionCommand(cwd, "plan submit release")).text).toContain("awaiting_approval");
		expect((await runTeamSessionCommand(cwd, "plan approve release")).text).toContain("approved");
		expect((await runTeamSessionCommand(cwd, "plan start release")).text).toContain("in_progress");
		expect((await runTeamSessionCommand(cwd, "plan complete release")).text).toContain("done");
	});

	it("stores a default persona, liaison and scoped memory", async () => {
		const cwd = await root();
		await runTeamSessionCommand(cwd, "persona create reviewer code-review Reviewer");
		expect((await runTeamSessionCommand(cwd, "profile persona reviewer")).ok).toBe(true);
		expect((await runTeamSessionCommand(cwd, "profile liaison main im")).text).toContain("listening");
		expect((await runTeamSessionCommand(cwd, "memory add reviewer Prefer small diffs")).ok).toBe(true);
		expect((await runTeamSessionCommand(cwd, "memory show reviewer")).text).toContain("Prefer small diffs");
		expect((await runTeamSessionCommand(cwd, "identity set")).ok).toBe(false);
		expect((await runTeamSessionCommand(cwd, "identity set Prefer small diffs")).ok).toBe(true);
		expect((await runTeamSessionCommand(cwd, "identity show")).text).toContain("Prefer small diffs");
		expect((await runTeamSessionCommand(cwd, "status")).text).toContain("Default persona · reviewer");
		const audit = await fs.readFile(path.join(cwd, ".zeta", "audit", "team.jsonl"), "utf8");
		expect(audit).toContain('"teamId":"demo"');
		expect(audit).toContain('"personaId":"reviewer"');
	});

	it("rejects an invalid command and a missing Team root", async () => {
		const cwd = await root();
		expect((await runTeamSessionCommand(cwd, "plan approve missing")).ok).toBe(false);
		const noTeam = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-no-team-"));
		try {
			expect((await runTeamSessionCommand(noTeam, "status")).ok).toBe(false);
		} finally {
			await fs.rm(noTeam, { recursive: true, force: true });
		}
	});
});

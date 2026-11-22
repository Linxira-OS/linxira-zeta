import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { deleteTeamPersona, listTeamPersonas, readTeamPersona, writeTeamPersona } from "../../src/team/personas";

const roots: string[] = [];
async function root(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-team-personas-"));
	roots.push(dir);
	return dir;
}
afterEach(async () => {
	for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

const valid = {
	schemaVersion: 1,
	id: "reviewer",
	revision: 1,
	name: "Reviewer",
	role: "code-review",
	permissions: { write_file: "deny", run_command: "allow" },
	memoryScope: "team",
};

describe("Team persona store", () => {
	it("writes, reads and lists a validated persona", async () => {
		const teamRoot = await root();
		await writeTeamPersona(teamRoot, valid);
		expect((await readTeamPersona(teamRoot, "reviewer"))?.name).toBe("Reviewer");
		const listed = await listTeamPersonas(teamRoot);
		expect(listed.personas.map(persona => persona.id)).toEqual(["reviewer"]);
		expect(listed.problems).toEqual([]);
	});

	it("skips invalid and misnamed persona files with a problem", async () => {
		const teamRoot = await root();
		const dir = path.join(teamRoot, ".zeta", "personas");
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, "bad.json"), "{not json", "utf8");
		await fs.writeFile(path.join(dir, "other.json"), JSON.stringify(valid), "utf8");
		const listed = await listTeamPersonas(teamRoot);
		expect(listed.personas).toEqual([]);
		expect(listed.problems).toHaveLength(2);
	});

	it("rejects an invalid persona and deletes only a contained id", async () => {
		const teamRoot = await root();
		await expect(writeTeamPersona(teamRoot, { ...valid, id: "../escape" })).rejects.toThrow("Invalid Team persona");
		await writeTeamPersona(teamRoot, valid);
		expect(await deleteTeamPersona(teamRoot, "reviewer")).toBe(true);
		expect(await deleteTeamPersona(teamRoot, "../escape")).toBe(false);
		expect(await readTeamPersona(teamRoot, "reviewer")).toBeUndefined();
	});
});

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TUI } from "@linxiraos/pi-tui";
import { initTheme } from "@linxiraos/pi-tui/theme";
import type { TeamWorkspaceOverlayComponent } from "@linxiraos/pi-tui/overlays/team-workspace";
import { showTeamWorkspace } from "../../../src/modes/controllers/team-workspace";
import { addPm, initTeam } from "../../../src/team/service";
import { createRoom } from "../../../src/team/rooms";
import { writeTeamPersona } from "../../../src/team/personas";
import { createTeamWorkspaceSource } from "../../../src/vibe/team-workspace-data";

const scratchDirs: string[] = [];
beforeAll(async () => {
	await initTheme();
});
afterEach(() => {
	for (const dir of scratchDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("Team workspace overlay", () => {
	test("projects every registered Team and its contacts", async () => {
		const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-team-workspace-"));
		scratchDirs.push(scratch);
		const root = path.join(scratch, "acme");
		const dbPath = path.join(scratch, "team.db");
		await initTeam({ name: "Acme", root, dbPath });
		await addPm({ pm: "core", teamRoot: root, dbPath });
		await createRoom({ name: "core", pm: "core", teamRoot: root, dbPath });
		await writeTeamPersona(root, {
			schemaVersion: 1,
			id: "reviewer",
			revision: 1,
			name: "Reviewer",
			role: "code-review",
			permissions: {},
			memoryScope: "team",
		});
		const source = createTeamWorkspaceSource({ dbPath });
		const snapshot = await source.load();
		expect(snapshot.teams.map(team => team.name)).toEqual(["Acme"]);
		expect(snapshot.personas.map(persona => persona.id)).toEqual(["reviewer"]);
		expect(snapshot.pms.map(pm => pm.name)).toEqual(["core"]);
		expect(snapshot.rooms.map(room => room.name)).toEqual(["core"]);
	});
});

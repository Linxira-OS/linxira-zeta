import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	loadResumePreferences,
	registerProject,
	resumePathKey,
	resumePreferencesPath,
	setProjectAlias,
	setProjectCollapsed,
	setProjectPreference,
	toggleProjectPin,
	unregisterProject,
} from "@linxiraos/zeta/resume";
import { DEFAULT_WORKSPACE, EMPTY_PROJECT, REPO_A, REPO_B } from "./helpers";

describe("resume preferences", () => {
	let agentDir: string;
	const originalDefaultWorkspace = process.env.ZETA_DEFAULT_WORKSPACE;

	beforeEach(() => {
		agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-prefs-"));
		process.env.ZETA_DEFAULT_WORKSPACE = DEFAULT_WORKSPACE;
	});

	afterEach(() => {
		fs.rmSync(agentDir, { recursive: true, force: true });
		if (originalDefaultWorkspace === undefined) delete process.env.ZETA_DEFAULT_WORKSPACE;
		else process.env.ZETA_DEFAULT_WORKSPACE = originalDefaultWorkspace;
	});

	it("round-trips project pin, alias, collapse and registry entries through disk", async () => {
		await setProjectAlias(REPO_A, "  Alpha  ", agentDir);
		await setProjectCollapsed(REPO_A, true, agentDir);
		expect(await toggleProjectPin(REPO_B, agentDir)).toBe(true);
		await registerProject(EMPTY_PROJECT, agentDir);

		const loaded = await loadResumePreferences(agentDir);
		expect(loaded.version).toBe(1);
		expect(loaded.projects[resumePathKey(REPO_A)]).toEqual({ alias: "Alpha", collapsed: true });
		expect(loaded.projects[resumePathKey(REPO_B)]).toEqual({ pinned: true });
		expect(loaded.projects[resumePathKey(EMPTY_PROJECT)]).toEqual({ registered: true });

		const onDisk: unknown = JSON.parse(fs.readFileSync(resumePreferencesPath(agentDir), "utf-8"));
		expect(onDisk).toEqual(loaded);

		await setProjectAlias(REPO_A, null, agentDir);
		await setProjectCollapsed(REPO_A, false, agentDir);
		const updated = await loadResumePreferences(agentDir);
		expect(updated.projects[resumePathKey(REPO_A)]).toEqual({ collapsed: false });
	});

	it("seeds the default project as pinned and registered", async () => {
		const seeded = await loadResumePreferences(agentDir, { defaultProjectKey: DEFAULT_WORKSPACE });
		expect(seeded.projects[resumePathKey(DEFAULT_WORKSPACE)]).toEqual({ pinned: true, registered: true });
		await expect(unregisterProject(DEFAULT_WORKSPACE, agentDir)).rejects.toThrow(
			"The default workspace project cannot be removed",
		);
	});

	it("ignores corrupt files and invalid entries instead of breaking the picker", async () => {
		fs.writeFileSync(resumePreferencesPath(agentDir), "{not json");
		expect(await loadResumePreferences(agentDir)).toEqual({ version: 1, projects: {} });

		fs.writeFileSync(
			resumePreferencesPath(agentDir),
			JSON.stringify({
				version: 1,
				projects: {
					[resumePathKey(REPO_A)]: { pinned: true, alias: 42, collapsed: "yes" },
					"": { registered: true },
				},
			}),
		);
		const loaded = await loadResumePreferences(agentDir);
		expect(loaded.projects[resumePathKey(REPO_A)]).toEqual({ pinned: true });
		expect(Object.keys(loaded.projects)).toHaveLength(1);
	});

	it("merges patches under the shared lock and removes empty entries", async () => {
		await setProjectPreference(REPO_A, { pinned: true, alias: "Alpha" }, agentDir);
		await setProjectPreference(REPO_A, { pinned: false }, agentDir);
		expect((await loadResumePreferences(agentDir)).projects[resumePathKey(REPO_A)]).toEqual({
			pinned: false,
			alias: "Alpha",
		});

		await setProjectPreference(REPO_A, { pinned: undefined, alias: undefined }, agentDir);
		expect((await loadResumePreferences(agentDir)).projects[resumePathKey(REPO_A)]).toBeUndefined();
	});
});

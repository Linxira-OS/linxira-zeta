import { afterAll, afterEach, beforeEach, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Settings, settings } from "@linxiraos/zeta/config/settings";
import { createSettingsHost } from "@linxiraos/zeta/config/settings-ui";
import { createPluginSettingsHost } from "@linxiraos/zeta/extensibility/plugins/settings-host";
import { AgentStorage } from "@linxiraos/zeta/session/agent-storage";
import { TempDir } from "@linxiraos/pi-utils";
import { createTestTerminal } from "@linxiraos/pi-tui/testing/terminal";
import { SettingsWindow } from "../../src/ui/overlays/settings/settings";
import { YAML } from "bun";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "../helpers/settings-test-state";

import { cfgTaskPerCallModelAllow } from "@linxiraos/zeta/task/settings";
import { cfgSearxngEndpoint } from "@linxiraos/zeta/web/settings";
import { currentTheme, setCurrentTheme } from "@linxiraos/pi-tui/theme/runtime";

const restoreTheme = currentTheme();
afterAll(() => setCurrentTheme(restoreTheme));

let state: SettingsTestState | undefined;
let tempDir: TempDir;
let agentDir: string;
let projectDir: string;

beforeEach(() => {
	state = beginSettingsTest();
	tempDir = TempDir.createSync("@pi-settings-panel-clear-");
	agentDir = tempDir.join("agent");
	projectDir = tempDir.join("project");
	for (const dir of [agentDir, projectDir]) fs.mkdirSync(dir, { recursive: true });
});

afterEach(() => {
	restoreSettingsTestState(state);
	state = undefined;
	AgentStorage.close();
	tempDir.removeSync();
});

it("clearing a settings-panel text field removes the key from config.yml so its env fallback applies again", async () => {
	Bun.env.SEARXNG_ENDPOINT = "https://env.example";
	Bun.env.HINDSIGHT_API_TOKEN = "env-secret";
	const configPath = path.join(agentDir, "config.yml");
	await Bun.write(configPath, YAML.stringify({ searxng: { endpoint: "https://cfg.example" }, temperature: 0.4 }));
	await Settings.init({ cwd: projectDir, agentDir });
	const host = createSettingsHost();
	// The panel edits the configured layers: env values are never shown or pre-filled.
	expect(host.get("hindsight.apiToken")).toBeUndefined();

	const term = createTestTerminal(
		() => ({
			layer: SettingsWindow({
				context: {
					availableThinkingLevels: [],
					availableThemes: ["dark"],
					providers: [],
					settings: host,
					plugins: createPluginSettingsHost(projectDir),
				},
				callbacks: { onChange: () => {}, onCancel: () => {} },
			}),
		}),
		{ columns: 120, rows: 40 },
	);
	try {
		term.focus(term.surface.layer()[0] ?? null);
		term.type("searxng endpoint");
		term.press("enter"); // open the text field
		term.press("ctrl+u"); // clear it
		term.press("enter"); // submit
	} finally {
		term.dispose();
	}

	expect(cfgSearxngEndpoint.get(settings)).toBe("https://env.example");
	await settings.flush();
	expect(YAML.parse(await Bun.file(configPath).text())).toEqual({ temperature: 0.4 });
});

it("hides the per-call allowlist editor for a project-supplied list so it cannot be promoted to global", async () => {
	const projectConfig = path.join(projectDir, ".zeta", "settings.json");
	fs.mkdirSync(path.dirname(projectConfig), { recursive: true });
	await Bun.write(projectConfig, JSON.stringify({ task: { perCallModelAllow: ["mock/target"] } }));
	const settings = await Settings.init({ cwd: projectDir, agentDir });
	expect(cfgTaskPerCallModelAllow.provenance(settings)).toBe("project");
	const entry = createSettingsHost().entries.find(candidate => candidate.path === "task.perCallModelAllow");
	expect(entry?.condition?.()).toBe(false);
});

it("keeps the per-call allowlist editor when only the global layer supplies it", async () => {
	await Settings.init({ cwd: projectDir, agentDir });
	const entry = createSettingsHost().entries.find(candidate => candidate.path === "task.perCallModelAllow");
	expect(entry?.condition?.()).toBe(true);
});

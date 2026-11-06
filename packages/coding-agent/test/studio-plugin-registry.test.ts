/**
 * The Studio plugin list is the Zeta-native registry, not `settings.extensions`.
 *
 * `plugins/official/example-panel` is the reference install: its `plugin.json`
 * declares four panels (list/form/chart/html) and its `package.json` names an
 * extension entry. The suite pins both halves of the ticket:
 *
 * - `GET /api/plugins` carries an `installed[]` row built from that package,
 *   panels included, and `skills.get` maps it onto `PluginRecord`;
 * - `POST /api/plugins { id }` writes the same lockfile the CLI toggles, so a
 *   disabled plugin is visible (disabled) on the next read.
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as piUtils from "@linxiraos/pi-utils";
import { PLUGINS_LOCKFILE_CANONICAL, refreshDirsFromEnv, symlinkDirectorySync, TempDir } from "@linxiraos/pi-utils";
import { resetSettingsForTest } from "@linxiraos/zeta/config/settings";
// Evaluated first so the Studio family graph initializes top-down; importing
// `skillsOps` alone re-enters ops/index.ts through the gateway's session
// handlers and hits its temporal dead zone.
import { StudioOperations } from "../src/server/studio-host/registry";
import { handlePluginsGet, handlePluginsPost } from "../src/server/web-gateway/plugins";
import { skillsOps } from "../src/server/studio-host/ops/skills";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const EXAMPLE_ROOT = path.join(REPO_ROOT, "plugins", "official", "example-panel");
const PACKAGE_NAME = "@linxiraos/example-panel";

interface RegistryBody {
	packages: unknown[];
	installed: Array<{
		id: string;
		name: string;
		version: string;
		sourceKind: string;
		scope: "user" | "project";
		enabled: boolean;
		toolItems: string[];
		panels: Array<{ id: string; title: string; kind: string }>;
	}>;
	diagnostics: unknown[];
}

let root: string;
let pluginsDir: string;
let projectDir: string;
let lockfile: string;
let agentDir: TempDir;
let previousAgentDir: string | undefined;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-studio-plugins-"));
	pluginsDir = path.join(root, "plugins");
	projectDir = path.join(root, "project");
	lockfile = path.join(pluginsDir, PLUGINS_LOCKFILE_CANONICAL);
	fs.mkdirSync(path.join(pluginsDir, "node_modules", "@linxiraos"), { recursive: true });
	fs.mkdirSync(projectDir, { recursive: true });

	fs.writeFileSync(
		path.join(pluginsDir, "package.json"),
		JSON.stringify({ name: "zeta-plugins", private: true, dependencies: {} }, null, 2),
	);
	fs.writeFileSync(
		lockfile,
		JSON.stringify({
			plugins: { [PACKAGE_NAME]: { version: "1.0.0", enabledFeatures: null, enabled: true } },
			settings: {},
		}),
	);
	symlinkDirectorySync(EXAMPLE_ROOT, path.join(pluginsDir, "node_modules", PACKAGE_NAME));

	spyOn(piUtils, "getPluginsDir").mockReturnValue(pluginsDir);
	spyOn(piUtils, "getPluginsLockfile").mockReturnValue(lockfile);
	spyOn(piUtils, "getPluginsPackageJson").mockReturnValue(path.join(pluginsDir, "package.json"));
	spyOn(piUtils, "getProjectDir").mockReturnValue(projectDir);
	spyOn(piUtils, "getProjectPluginOverridesPath").mockReturnValue(path.join(projectDir, "plugin-overrides.json"));

	agentDir = TempDir.createSync("@zeta-studio-plugin-registry-");
	previousAgentDir = process.env.ZETA_CODING_AGENT_DIR;
	process.env.ZETA_CODING_AGENT_DIR = agentDir.path();
	refreshDirsFromEnv();
	resetSettingsForTest();
});

afterEach(() => {
	mock.restore();
	if (previousAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = previousAgentDir;
	refreshDirsFromEnv();
	resetSettingsForTest();
	fs.rmSync(root, { recursive: true, force: true });
});

async function readRegistry(): Promise<RegistryBody> {
	const response = await handlePluginsGet(
		new Request(`http://127.0.0.1/api/plugins?cwd=${encodeURIComponent(projectDir)}`),
	);
	expect(response.status).toBe(200);
	return (await response.json()) as RegistryBody;
}

describe("GET /api/plugins installed registry", () => {
	test("lists the real package with every declared panel", async () => {
		const body = await readRegistry();
		const plugin = body.installed.find(row => row.id === PACKAGE_NAME);
		expect(plugin).toBeDefined();
		expect(plugin).toMatchObject({
			name: "Example Panel",
			version: "1.0.0",
			sourceKind: "link",
			scope: "user",
			enabled: true,
		});
		expect(plugin?.panels).toEqual([
			{ id: "tasks", title: "Tasks", kind: "list" },
			{ id: "settings", title: "Settings", kind: "form" },
			{ id: "throughput", title: "Tasks by state", kind: "chart" },
			{ id: "guide", title: "Guide", kind: "html" },
		]);
		// The extension-package view is untouched by the registry addition.
		expect(Array.isArray(body.packages)).toBe(true);
	});

	test("skills.get maps the registry row, not theme-derived guesses", async () => {
		const getSkills = skillsOps.queries?.["skills.get"];
		if (getSkills === undefined) throw new Error("skills.get is not registered");
		const context = { capabilities: new StudioOperations([skillsOps]).capabilities().manifest };
		const model = await getSkills({}, context);
		const plugin = model.plugins.find(row => row.name === PACKAGE_NAME);
		expect(plugin).toBeDefined();
		expect(plugin).toMatchObject({
			title: "Example Panel",
			sourceKind: "link",
			scope: "user",
			enabled: true,
			status: "configured",
			ui: true,
		});
		expect(plugin?.panels.map(panel => panel.kind)).toEqual(["list", "form", "chart", "html"]);
		expect(plugin?.uiItems).toEqual(["Tasks", "Settings", "Tasks by state", "Guide"]);
	});
});

describe("POST /api/plugins registry toggle", () => {
	test("disable writes the CLI lockfile and the next read reflects it", async () => {
		const before = JSON.parse(fs.readFileSync(lockfile, "utf8")) as {
			plugins: Record<string, { enabled: boolean }>;
		};
		expect(before.plugins[PACKAGE_NAME]?.enabled).toBe(true);

		const response = await handlePluginsPost(
			new Request("http://127.0.0.1/api/plugins", {
				method: "POST",
				headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
				body: JSON.stringify({ action: "disable", id: PACKAGE_NAME, scope: "user", cwd: projectDir }),
			}),
		);
		expect(response.status).toBe(200);

		const after = JSON.parse(fs.readFileSync(lockfile, "utf8")) as {
			plugins: Record<string, { enabled: boolean }>;
		};
		expect(after.plugins[PACKAGE_NAME]?.enabled).toBe(false);

		const list = await readRegistry();
		expect(list.installed.find(row => row.id === PACKAGE_NAME)?.enabled).toBe(false);

		const reenabled = await handlePluginsPost(
			new Request("http://127.0.0.1/api/plugins", {
				method: "POST",
				headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
				body: JSON.stringify({ action: "enable", id: PACKAGE_NAME, scope: "user", cwd: projectDir }),
			}),
		);
		expect(reenabled.status).toBe(200);
		const final = JSON.parse(fs.readFileSync(lockfile, "utf8")) as {
			plugins: Record<string, { enabled: boolean }>;
		};
		expect(final.plugins[PACKAGE_NAME]?.enabled).toBe(true);
	});
});

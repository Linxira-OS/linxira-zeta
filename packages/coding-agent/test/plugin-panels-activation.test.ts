/**
 * The declarative-panel activation gate.
 *
 * Panels are a workbench surface. The gate must hold at every place the agent
 * hands a declaration to a host: the declaration reader, the panel-data call
 * (what the desktop shells out to), and the plugin loader's `manifest.ui`.
 *
 * The three acceptance states are pinned separately:
 *   - inside the workbench terminal → visible;
 *   - a plain terminal → invisible;
 *   - `PI_FORCE_PLUGIN_PANELS=1` → visible anywhere (the debug switch).
 */
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { removeWithRetries } from "@linxiraos/pi-utils";
import { clearClaudePluginRootsCache } from "@linxiraos/zeta/discovery/helpers";
import {
	isInsideWorkbenchTerminal,
	PANELS_INACTIVE_MESSAGE,
	PLUGIN_PANELS_FORCE_ENV,
	panelActivation,
} from "@linxiraos/zeta/extensibility/plugins/activation";
import { getEnabledPlugins } from "@linxiraos/zeta/extensibility/plugins/loader";
import { readPanelData, readPanelDeclaration } from "@linxiraos/zeta/extensibility/plugins/panels";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const PLUGIN_ROOT = path.join(REPO_ROOT, "plugins", "official", "example-panel");

const PLAIN_ENV = { TERM: "xterm-256color", TERM_PROGRAM: "vscode" };
const LOCAL_PANE_ENV = { ZETA_WORKBENCH: "1" };
const SERVE_PANE_ENV = { TERM_PROGRAM: "zetawork", TERM_PROGRAM_VERSION: "1.4.0" };

const tempRoots: string[] = [];

afterEach(async () => {
	for (const root of tempRoots.splice(0)) {
		await removeWithRetries(root);
	}
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await Bun.write(filePath, `${JSON.stringify(value)}\n`);
}

describe("panel activation predicate", () => {
	test("a plain terminal is outside", () => {
		expect(panelActivation(PLAIN_ENV)).toEqual({ enabled: false, reason: "outside-workbench" });
		expect(isInsideWorkbenchTerminal(PLAIN_ENV)).toBe(false);
	});

	test("both workbench pane identities count as inside", () => {
		// A pane spawned by termide.
		expect(panelActivation(LOCAL_PANE_ENV)).toEqual({ enabled: true, reason: "workbench" });
		// A pane attached to serve, whose gateway stamps the terminal identity.
		expect(panelActivation(SERVE_PANE_ENV)).toEqual({ enabled: true, reason: "workbench" });
		expect(isInsideWorkbenchTerminal(SERVE_PANE_ENV)).toBe(true);
		// Terminal detection is case-insensitive.
		expect(isInsideWorkbenchTerminal({ TERM_PROGRAM: "ZetaWork" })).toBe(true);
	});

	test("the force switch wins anywhere, including a plain terminal", () => {
		expect(panelActivation({ ...PLAIN_ENV, [PLUGIN_PANELS_FORCE_ENV]: "1" })).toEqual({
			enabled: true,
			reason: "forced",
		});
		expect(panelActivation({ ...PLAIN_ENV, [PLUGIN_PANELS_FORCE_ENV]: "true" })).toEqual({
			enabled: true,
			reason: "forced",
		});
		// `0` is an explicit off, not a force-on.
		expect(panelActivation({ ...PLAIN_ENV, [PLUGIN_PANELS_FORCE_ENV]: "0" })).toEqual({
			enabled: false,
			reason: "outside-workbench",
		});
	});

	test("a bare ZETA_WORKBENCH=0 does not claim the workbench", () => {
		expect(panelActivation({ ZETA_WORKBENCH: "0" })).toEqual({ enabled: false, reason: "outside-workbench" });
	});
});

describe("readPanelDeclaration gate", () => {
	test("inside the workbench, the example plugin's four panels are visible", () => {
		const declaration = readPanelDeclaration(PLUGIN_ROOT, { env: LOCAL_PANE_ENV });
		expect(declaration.ok).toBe(true);
		if (!declaration.ok) return;
		expect(declaration.ui.panels?.map(panel => panel.kind)).toEqual(["list", "form", "chart", "html"]);
	});

	test("a plain terminal reads the same plugin as declaring no panels", () => {
		const declaration = readPanelDeclaration(PLUGIN_ROOT, { env: PLAIN_ENV });
		expect(declaration).toEqual({ ok: true, ui: {} });
	});

	test("the force switch restores the declaration outside the workbench", () => {
		const declaration = readPanelDeclaration(PLUGIN_ROOT, {
			env: { ...PLAIN_ENV, [PLUGIN_PANELS_FORCE_ENV]: "1" },
		});
		expect(declaration.ok).toBe(true);
		if (!declaration.ok) return;
		expect(declaration.ui.panels).toHaveLength(4);
	});
});

describe("readPanelData gate", () => {
	test("inside the workbench, a declarative panel's data tool runs", async () => {
		const data = await readPanelData(PLUGIN_ROOT, "tasks", { env: LOCAL_PANE_ENV });
		expect(data.plugin).toBe("example-panel");
		expect(data.kind).toBe("list");
		const details = data.data;
		if (!details || typeof details !== "object" || !("rows" in details) || !Array.isArray(details.rows)) {
			throw new Error("the list panel's data must carry a `rows` array");
		}
		expect(details.rows.length).toBeGreaterThan(0);
	});

	test("a plain terminal refuses by naming the debug switch", async () => {
		const error = readPanelData(PLUGIN_ROOT, "tasks", { env: PLAIN_ENV });
		await expect(error).rejects.toThrow(PANELS_INACTIVE_MESSAGE);
		await expect(readPanelData(PLUGIN_ROOT, "tasks", { env: PLAIN_ENV })).rejects.toThrow(
			new RegExp(`${PLUGIN_PANELS_FORCE_ENV}=1`),
		);
	});

	test("the force switch makes the same call succeed outside the workbench", async () => {
		const data = await readPanelData(PLUGIN_ROOT, "tasks", {
			env: { ...PLAIN_ENV, [PLUGIN_PANELS_FORCE_ENV]: "1" },
		});
		expect(data.kind).toBe("list");
	});
});

describe("plugin loader gate (manifest.ui)", () => {
	async function installFixture(): Promise<{ cwd: string; home: string }> {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-panel-gate-"));
		tempRoots.push(root);
		const home = path.join(root, "home");
		const cwd = path.join(root, "project");
		const pluginsDir = path.join(home, ".zeta", "plugins");
		const pluginDir = path.join(pluginsDir, "node_modules", "gated-panel");
		await fs.mkdir(pluginDir, { recursive: true });
		await fs.mkdir(cwd, { recursive: true });
		await writeJson(path.join(pluginDir, "package.json"), {
			name: "gated-panel",
			version: "1.0.0",
			zeta: {
				version: "1.0.0",
				ui: { panels: [{ id: "tasks", title: "Tasks", kind: "list", source: { tool: "panel_data" } }] },
			},
		});
		await writeJson(path.join(pluginsDir, "package.json"), {
			dependencies: { "gated-panel": "1.0.0" },
		});
		return { cwd, home };
	}

	async function withEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
		const saved = new Map<string, string | undefined>();
		for (const [key, value] of Object.entries(env)) {
			saved.set(key, Bun.env[key]);
			if (value === undefined) delete Bun.env[key];
			else Bun.env[key] = value;
		}
		clearClaudePluginRootsCache();
		try {
			return await run();
		} finally {
			for (const [key, value] of saved) {
				if (value === undefined) delete Bun.env[key];
				else Bun.env[key] = value;
			}
			clearClaudePluginRootsCache();
		}
	}

	test("a plain terminal's loader does not expose the declaration", async () => {
		const { cwd, home } = await installFixture();
		const plugins = await withEnv({ ...PLAIN_ENV, [PLUGIN_PANELS_FORCE_ENV]: undefined }, () =>
			getEnabledPlugins(cwd, { home }),
		);
		expect(plugins).toHaveLength(1);
		expect(plugins[0]!.manifest.ui).toBeUndefined();
	});

	test("inside the workbench the same plugin keeps its panels", async () => {
		const { cwd, home } = await installFixture();
		const plugins = await withEnv({ ...PLAIN_ENV, ZETA_WORKBENCH: "1", [PLUGIN_PANELS_FORCE_ENV]: undefined }, () =>
			getEnabledPlugins(cwd, { home }),
		);
		expect(plugins[0]!.manifest.ui?.panels?.map(panel => panel.id)).toEqual(["tasks"]);
	});

	test("the force switch exposes the declaration outside the workbench", async () => {
		const { cwd, home } = await installFixture();
		const plugins = await withEnv({ ...PLAIN_ENV, ZETA_WORKBENCH: undefined, [PLUGIN_PANELS_FORCE_ENV]: "1" }, () =>
			getEnabledPlugins(cwd, { home }),
		);
		expect(plugins[0]!.manifest.ui?.panels?.map(panel => panel.id)).toEqual(["tasks"]);
	});
});

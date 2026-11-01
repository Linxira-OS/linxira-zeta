/**
 * Agent-facing plugin tools: `plugin_manager` and `plugin_inspect`.
 *
 * Covers the main-agent-only contract (plan gate + execute-time guard) and the
 * lifecycle/inspection behavior against a hermetic temp plugin root. Nothing
 * here touches the network: `install`/`link`/`uninstall` are spies.
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@linxiraos/pi-agent-core";
import * as piUtils from "@linxiraos/pi-utils";
import { getPluginCacheDir, getPluginDataDir, getPluginStateDir, removeWithRetries } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import { PluginManager } from "@linxiraos/zeta/extensibility/plugins/manager";
import type { InstalledPlugin } from "@linxiraos/zeta/extensibility/plugins/types";
import { PluginInspectTool, PluginManagerTool, resolveBuiltinToolPlan, type ToolSession } from "@linxiraos/zeta/tools";

function textOf(result: AgentToolResult): string {
	return result.content.map(block => (block.type === "text" ? block.text : "")).join("");
}

function makeSession(overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		settings: Settings.isolated({ "autolearn.enabled": false }),
		getSessionFile: () => null,
		getSessionSpawns: () => "",
		skipPythonPreflight: true,
		enableLsp: false,
		...overrides,
	};
}

const FAKE_INSTALLED: InstalledPlugin = {
	name: "fixture-plugin",
	version: "2.1.0",
	path: "/tmp/fake/node_modules/fixture-plugin",
	manifest: { version: "2.1.0" },
	enabledFeatures: null,
	enabled: true,
	storage: {
		dataDir: getPluginDataDir("fixture-plugin"),
		cacheDir: getPluginCacheDir("fixture-plugin"),
		stateDir: getPluginStateDir("fixture-plugin"),
	},
};

describe("plugin tools are main-agent only", () => {
	test("the main-agent plan includes both tools", async () => {
		const plan = await resolveBuiltinToolPlan(makeSession(), ["plugin_manager", "plugin_inspect"]);
		expect(plan.names).toEqual(["plugin_manager", "plugin_inspect"]);
		expect(plan.isAllowed("plugin_manager")).toBe(true);
		expect(plan.isAllowed("plugin_inspect")).toBe(true);
	});

	test("the default main-agent plan advertises both tools", async () => {
		const plan = await resolveBuiltinToolPlan(makeSession());
		expect(plan.names).toContain("plugin_manager");
		expect(plan.names).toContain("plugin_inspect");
	});

	test("a subagent plan excludes them even when explicitly requested", async () => {
		const plan = await resolveBuiltinToolPlan(makeSession({ taskDepth: 1 }), ["plugin_manager", "plugin_inspect"]);
		expect(plan.names).toEqual([]);
		expect(plan.isAllowed("plugin_manager")).toBe(false);
		expect(plan.isAllowed("plugin_inspect")).toBe(false);
	});

	test("a subagent plan excludes them from the default set", async () => {
		const plan = await resolveBuiltinToolPlan(makeSession({ taskDepth: 1 }));
		expect(plan.names).not.toContain("plugin_manager");
		expect(plan.names).not.toContain("plugin_inspect");
	});

	test("direct execution from a subagent session rejects", async () => {
		await expect(
			new PluginManagerTool(makeSession({ taskDepth: 1 })).execute("call-1", { action: "list" }),
		).rejects.toThrow(/main agent only/);
		await expect(
			new PluginInspectTool(makeSession({ taskDepth: 1 })).execute("call-2", { name: "fixture-plugin" }),
		).rejects.toThrow(/main agent only/);
	});
});

describe("plugin_manager", () => {
	let tmpRoot: string;
	let pluginsDir: string;
	let pluginDir: string;

	beforeEach(async () => {
		tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-plugin-tools-"));
		pluginsDir = path.join(tmpRoot, "plugins");
		pluginDir = path.join(pluginsDir, "node_modules", "fixture-plugin");
		await fs.mkdir(pluginDir, { recursive: true });
		await Bun.write(
			path.join(pluginsDir, "package.json"),
			JSON.stringify({ name: "zeta-plugins", private: true, dependencies: { "fixture-plugin": "^2.0.0" } }),
		);
		await Bun.write(
			path.join(pluginsDir, "zeta-plugins.lock.json"),
			JSON.stringify({
				plugins: { "fixture-plugin": { version: "2.1.0", enabledFeatures: null, enabled: true } },
				settings: {},
			}),
		);
		await writeFixturePlugin(pluginDir);

		spyOn(piUtils, "getPluginsDir").mockReturnValue(pluginsDir);
		spyOn(piUtils, "getPluginsNodeModules").mockReturnValue(path.join(pluginsDir, "node_modules"));
		spyOn(piUtils, "getPluginsPackageJson").mockReturnValue(path.join(pluginsDir, "package.json"));
		spyOn(piUtils, "getPluginsLockfile").mockReturnValue(path.join(pluginsDir, "zeta-plugins.lock.json"));
		spyOn(piUtils, "getProjectDir").mockReturnValue(tmpRoot);
		spyOn(piUtils, "getProjectPluginOverridesPath").mockReturnValue(path.join(tmpRoot, "plugin-overrides.json"));
	});

	afterEach(async () => {
		mock.restore();
		await removeWithRetries(tmpRoot);
	});

	test("list reports name, version, source, and enabled state", async () => {
		const result = await new PluginManagerTool(makeSession({ cwd: tmpRoot })).execute("list", { action: "list" });
		expect(result.details?.plugins).toEqual([
			{ name: "fixture-plugin", version: "2.1.0", source: "^2.0.0", enabled: true, path: pluginDir },
		]);
		expect(textOf(result)).toContain("fixture-plugin@2.1.0 [enabled] source=^2.0.0");
	});

	test("set_enabled flips the lockfile state and carries the restart note", async () => {
		const result = await new PluginManagerTool(makeSession({ cwd: tmpRoot })).execute("disable", {
			action: "set_enabled",
			target: "fixture-plugin",
			enabled: false,
		});
		expect(result.details?.plugin?.enabled).toBe(false);
		expect(result.details?.restartRequired).toBe(true);
		expect(textOf(result)).toContain("restart-required");
		expect(textOf(result)).toContain("disabled");

		const lock = await Bun.file(path.join(pluginsDir, "zeta-plugins.lock.json")).json();
		expect(lock.plugins["fixture-plugin"].enabled).toBe(false);
	});

	test("install routes package specs to PluginManager.install", async () => {
		const installSpy = spyOn(PluginManager.prototype, "install").mockResolvedValue(FAKE_INSTALLED);
		const linkSpy = spyOn(PluginManager.prototype, "link").mockResolvedValue(FAKE_INSTALLED);
		try {
			const result = await new PluginManagerTool(makeSession({ cwd: tmpRoot })).execute("install", {
				action: "install",
				target: "@scope/fixture@1.2.3",
			});
			expect(installSpy).toHaveBeenCalledTimes(1);
			expect(installSpy.mock.calls[0]?.[0]).toBe("@scope/fixture@1.2.3");
			expect(linkSpy).not.toHaveBeenCalled();
			expect(result.details?.plugin?.source).toBe("@scope/fixture@1.2.3");
			expect(result.details?.restartRequired).toBe(true);
		} finally {
			installSpy.mockRestore();
			linkSpy.mockRestore();
		}
	});

	test("install routes local directories to link with an absolute path", async () => {
		const installSpy = spyOn(PluginManager.prototype, "install").mockResolvedValue(FAKE_INSTALLED);
		const linkSpy = spyOn(PluginManager.prototype, "link").mockResolvedValue(FAKE_INSTALLED);
		try {
			await new PluginManagerTool(makeSession({ cwd: tmpRoot })).execute("install", {
				action: "install",
				target: "./local-plugin",
			});
			expect(linkSpy).toHaveBeenCalledTimes(1);
			expect(linkSpy.mock.calls[0]?.[0]).toBe(path.resolve(tmpRoot, "local-plugin"));
			expect(installSpy).not.toHaveBeenCalled();
		} finally {
			installSpy.mockRestore();
			linkSpy.mockRestore();
		}
	});

	test("uninstall delegates to PluginManager.uninstall", async () => {
		const uninstallSpy = spyOn(PluginManager.prototype, "uninstall").mockResolvedValue(undefined);
		try {
			const result = await new PluginManagerTool(makeSession({ cwd: tmpRoot })).execute("uninstall", {
				action: "uninstall",
				target: "fixture-plugin",
			});
			expect(uninstallSpy).toHaveBeenCalledWith("fixture-plugin");
			expect(result.details?.plugin?.name).toBe("fixture-plugin");
			expect(textOf(result)).toContain("Uninstalled fixture-plugin@2.1.0");
		} finally {
			uninstallSpy.mockRestore();
		}
	});
});

describe("plugin_inspect", () => {
	let tmpRoot: string;
	let pluginsDir: string;
	let pluginDir: string;

	beforeEach(async () => {
		tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-plugin-inspect-"));
		pluginsDir = path.join(tmpRoot, "plugins");
		pluginDir = path.join(pluginsDir, "node_modules", "fixture-plugin");
		await fs.mkdir(pluginDir, { recursive: true });
		await Bun.write(
			path.join(pluginsDir, "package.json"),
			JSON.stringify({ name: "zeta-plugins", private: true, dependencies: { "fixture-plugin": "2.1.0" } }),
		);
		await Bun.write(
			path.join(pluginsDir, "zeta-plugins.lock.json"),
			JSON.stringify({
				plugins: { "fixture-plugin": { version: "2.1.0", enabledFeatures: null, enabled: true } },
				settings: { "fixture-plugin": { mode: "fast" } },
			}),
		);
		await writeFixturePlugin(pluginDir);

		spyOn(piUtils, "getPluginsDir").mockReturnValue(pluginsDir);
		spyOn(piUtils, "getPluginsNodeModules").mockReturnValue(path.join(pluginsDir, "node_modules"));
		spyOn(piUtils, "getPluginsPackageJson").mockReturnValue(path.join(pluginsDir, "package.json"));
		spyOn(piUtils, "getPluginsLockfile").mockReturnValue(path.join(pluginsDir, "zeta-plugins.lock.json"));
		spyOn(piUtils, "getProjectDir").mockReturnValue(tmpRoot);
		spyOn(piUtils, "getProjectPluginOverridesPath").mockReturnValue(path.join(tmpRoot, "plugin-overrides.json"));
	});

	afterEach(async () => {
		mock.restore();
		await removeWithRetries(tmpRoot);
	});

	test("reports identity, features, capabilities, entries, dependencies, and settings", async () => {
		const result = await new PluginInspectTool(makeSession({ cwd: tmpRoot })).execute("inspect", {
			name: "fixture-plugin",
		});
		const details = result.details;
		expect(details?.name).toBe("fixture-plugin");
		expect(details?.version).toBe("2.1.0");
		expect(details?.source).toBe("2.1.0");
		expect(details?.path).toBe(pluginDir);
		expect(details?.enabled).toBe(true);
		expect(details?.identity).toEqual({
			name: "fixture-plugin",
			version: "2.1.0",
			description: "Fixture plugin used by the plugin tool tests.",
		});
		expect(details?.features).toEqual([
			{
				name: "extra",
				description: "Extra entry",
				default: true,
				enabled: true,
				extensions: 1,
				tools: 0,
				hooks: 0,
				commands: 0,
			},
		]);
		expect(details?.capabilities.extensions).toEqual([
			path.join(pluginDir, "ext.ts"),
			path.join(pluginDir, "extra.ts"),
		]);
		expect(details?.capabilities.tools).toEqual([path.join(pluginDir, "tools.ts")]);
		expect(details?.capabilities.settings).toBe(2);
		expect(details?.entry.extensions).toEqual(["./ext.ts"]);
		expect(details?.entry.tools).toEqual(["./tools.ts"]);
		expect(details?.dependencies).toEqual({ "left-pad": "^1.0.0" });
		expect(details?.settings.map(setting => `${setting.key}:${setting.type}`)).toEqual([
			"apiKey:string",
			"mode:enum",
		]);
		expect(details?.validation).toEqual({ valid: true, errors: [] });
		expect(textOf(result)).toContain("validation: ok");
	});

	test("reports a missing declared entry as a validation error", async () => {
		await Bun.write(
			path.join(pluginDir, "package.json"),
			JSON.stringify({
				name: "fixture-plugin",
				version: "2.1.0",
				dependencies: { "left-pad": "^1.0.0" },
				zeta: {
					version: "2.1.0",
					extensions: ["./ext.ts", "./missing.ts"],
					settings: { apiKey: { type: "string" } },
				},
			}),
		);

		const result = await new PluginInspectTool(makeSession({ cwd: tmpRoot })).execute("inspect", {
			name: "fixture-plugin",
		});
		expect(result.details?.validation.valid).toBe(false);
		expect(result.details?.validation.errors).toContain("declared extensions entry not found on disk: ./missing.ts");
		expect(textOf(result)).toContain("MISSING");
	});

	test("rejects an unknown plugin", async () => {
		await expect(
			new PluginInspectTool(makeSession({ cwd: tmpRoot })).execute("inspect", { name: "not-installed" }),
		).rejects.toThrow(/is not installed/);
	});
});

/** Writes the shared fixture package the manager/inspector tests read. */
async function writeFixturePlugin(dir: string): Promise<void> {
	await Bun.write(
		path.join(dir, "package.json"),
		JSON.stringify({
			name: "fixture-plugin",
			version: "2.1.0",
			dependencies: { "left-pad": "^1.0.0" },
			zeta: {
				version: "2.1.0",
				description: "Fixture plugin used by the plugin tool tests.",
				extensions: ["./ext.ts"],
				tools: "./tools.ts",
				features: {
					extra: { description: "Extra entry", default: true, extensions: ["./extra.ts"] },
				},
				settings: {
					apiKey: { type: "string", secret: true },
					mode: { type: "enum", values: ["fast", "slow"], default: "fast" },
				},
			},
		}),
	);
	await Bun.write(path.join(dir, "ext.ts"), "export default function () {}\n");
	await Bun.write(path.join(dir, "extra.ts"), "export default function () {}\n");
	await Bun.write(path.join(dir, "tools.ts"), "export default function () {}\n");
}

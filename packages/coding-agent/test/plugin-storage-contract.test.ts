import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	adoptLegacyFile,
	adoptLegacyFileOnce,
	getPluginCacheDir,
	getPluginDataDir,
	getPluginStateDir,
	normalizePluginId,
} from "@linxiraos/pi-utils";
import { getEnabledPlugins, resolvePluginStorage } from "@linxiraos/zeta/extensibility/plugins/loader";
import { removeWithRetries } from "@linxiraos/pi-utils";

const tempRoots: string[] = [];

afterEach(async () => {
	for (const root of tempRoots.splice(0)) {
		await removeWithRetries(root);
	}
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await Bun.write(filePath, `${JSON.stringify(value)}\n`);
}

describe("normalizePluginId", () => {
	test("lowercases and maps illegal characters to dashes", () => {
		expect(normalizePluginId("My-Plugin")).toBe("my-plugin");
		expect(normalizePluginId("@scope/name")).toBe("-scope-name");
		expect(normalizePluginId("a b:c")).toBe("a-b-c");
	});

	test("path traversal cannot escape: separators become dashes", () => {
		const normalized = normalizePluginId("../../etc");
		expect(normalized).not.toContain("/");
		expect(normalized).not.toContain("\\");
		expect(path.basename(path.join("base", normalized))).toBe(normalized);
		expect(normalizePluginId("..%2F..%2Fetc")).toBe("..-2f..-2fetc");
	});

	test("degenerate ids throw", () => {
		expect(() => normalizePluginId("")).toThrow(TypeError);
		expect(() => normalizePluginId(".")).toThrow(TypeError);
		expect(() => normalizePluginId("..")).toThrow(TypeError);
	});
});

describe("per-plugin storage dirs", () => {
	test("path layout follows spec §4.2 under the plugins root", () => {
		const home = "/tmp/fake-home";
		expect(getPluginDataDir("my-plugin", home)).toBe(path.join(home, ".zeta", "plugins", "data", "my-plugin"));
		expect(getPluginCacheDir("my-plugin", home)).toBe(path.join(home, ".zeta", "plugins", "cache", "my-plugin"));
		expect(getPluginStateDir("my-plugin", home)).toBe(path.join(home, ".zeta", "plugins", "state", "my-plugin"));
	});

	test("plugin ids are normalized into a single segment", () => {
		expect(getPluginDataDir("@Scope/Name", "/tmp/h")).toBe(
			path.join("/tmp/h", ".zeta", "plugins", "data", "-scope-name"),
		);
	});
});

describe("InstalledPlugin.storage fill (collectPluginsAtRoot)", () => {
	test("enabled plugins carry storage with pre-created dirs", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-plugin-storage-"));
		tempRoots.push(root);
		const home = path.join(root, "home");
		const cwd = path.join(root, "project");
		const pluginsDir = path.join(home, ".zeta", "plugins");
		const pluginDir = path.join(pluginsDir, "node_modules", "storage-plugin");
		await fs.mkdir(pluginDir, { recursive: true });
		await fs.mkdir(cwd, { recursive: true });
		await writeJson(path.join(pluginDir, "package.json"), {
			name: "storage-plugin",
			version: "1.0.0",
			omp: { version: "1.0.0" },
		});
		await writeJson(path.join(pluginsDir, "package.json"), {
			dependencies: { "storage-plugin": "1.0.0" },
		});

		const plugins = await getEnabledPlugins(cwd, { home });
		expect(plugins).toHaveLength(1);
		const storage = plugins[0]!.storage;
		expect(storage.dataDir).toBe(getPluginDataDir("storage-plugin", home));
		expect(storage.cacheDir).toBe(getPluginCacheDir("storage-plugin", home));
		expect(storage.stateDir).toBe(getPluginStateDir("storage-plugin", home));
		// Host contract: the three dirs exist before the plugin runs.
		for (const dir of [storage.dataDir, storage.cacheDir, storage.stateDir]) {
			const stat = await fs.stat(dir);
			expect(stat.isDirectory()).toBe(true);
		}
	});
});

describe("resolvePluginStorage (extension exposure)", () => {
	test("resolves storage for a plugin manifest entry path, undefined otherwise", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-plugin-extstorage-"));
		tempRoots.push(root);
		const home = path.join(root, "home");
		const cwd = path.join(root, "project");
		const pluginsDir = path.join(home, ".zeta", "plugins");
		const pluginDir = path.join(pluginsDir, "node_modules", "ext-plugin");
		await fs.mkdir(pluginDir, { recursive: true });
		await fs.mkdir(cwd, { recursive: true });
		await writeJson(path.join(pluginDir, "package.json"), {
			name: "ext-plugin",
			version: "1.0.0",
			omp: { version: "1.0.0", extensions: ["ext.ts"] },
		});
		await writeJson(path.join(pluginsDir, "package.json"), {
			dependencies: { "ext-plugin": "1.0.0" },
		});

		const storage = await resolvePluginStorage(cwd, path.join(pluginDir, "ext.ts"), { home });
		expect(storage?.dataDir).toBe(getPluginDataDir("ext-plugin", home));

		const outside = await resolvePluginStorage(cwd, path.join(cwd, ".zeta", "extensions", "solo.ts"));
		expect(outside).toBeUndefined();
	});
});

describe("adoptLegacyFile / adoptLegacyFileOnce migration primitives", () => {
	test("adoptLegacyFile copies once and keeps the legacy file", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-adopt-"));
		tempRoots.push(root);
		const legacy = path.join(root, "legacy.json");
		const target = path.join(root, "new", "data.json");
		await Bun.write(legacy, '{"v":1}');

		expect(adoptLegacyFile(legacy, target)).toBe(true);
		expect(await Bun.file(target).text()).toBe('{"v":1}');
		expect(await Bun.file(legacy).exists()).toBe(true);
		// Target wins on subsequent calls: no overwrite.
		await Bun.write(target, '{"v":2}');
		expect(adoptLegacyFile(legacy, target)).toBe(false);
		expect(await Bun.file(target).text()).toBe('{"v":2}');
		// Adopting into a not-yet-existing target dir creates it and copies.
		const freshTarget = path.join(root, "absent-target", "x.json");
		expect(adoptLegacyFile(legacy, freshTarget)).toBe(true);
		expect(await Bun.file(freshTarget).exists()).toBe(true);
	});

	test("adoptLegacyFileOnce is one-shot via marker and idempotent", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-adopt-once-"));
		tempRoots.push(root);
		const legacy = path.join(root, "legacy.json");
		const target = path.join(root, "new", "data.json");
		const marker = path.join(root, "migrations", "legacy-adopt-v1.json");
		await Bun.write(legacy, '{"v":1}');

		// First run: adopts and writes the marker.
		expect(adoptLegacyFileOnce(legacy, target, marker)).toBe(true);
		expect(await Bun.file(target).exists()).toBe(true);
		const markerBody = (await Bun.file(marker).json()) as { migratedAt: string };
		expect(typeof markerBody.migratedAt).toBe("string");

		// Marker present: later runs (even with the target deleted) are no-ops.
		await fs.rm(target);
		expect(adoptLegacyFileOnce(legacy, target, marker)).toBe(false);
		expect(await Bun.file(target).exists()).toBe(false);

		// No legacy data: still records the migration as executed, idempotently.
		const marker2 = path.join(root, "migrations", "legacy-adopt-v2.json");
		expect(adoptLegacyFileOnce(path.join(root, "missing.json"), target, marker2)).toBe(false);
		expect(adoptLegacyFileOnce(path.join(root, "missing.json"), target, marker2)).toBe(false);
		expect(await Bun.file(marker2).exists()).toBe(true);
	});
});

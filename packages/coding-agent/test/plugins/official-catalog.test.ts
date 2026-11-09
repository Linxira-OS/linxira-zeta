/**
 * The built-in `official` catalog and the official plugins' default state.
 *
 * Two contracts are covered here, both user-visible:
 *
 *   1. The catalog is derived from the shipped `plugin.json` manifests — no
 *      second, hand-written list of plugin ids — and it exists without network
 *      access in every build shape (source tree, or a manifest snapshot only).
 *   2. The bundled official plugins appear **installed and disabled** without
 *      anyone asking, and nothing turns them on: `enable` flips exactly one
 *      entry, and an uninstall is never undone by a later run.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PLUGINS_LOCKFILE_CANONICAL, removeWithRetries } from "@linxiraos/pi-utils";
import {
	MarketplaceManager,
	OFFICIAL_MARKETPLACE_NAME,
	officialCatalogEntries,
	readInstalledPluginsRegistry,
	readOfficialPluginManifests,
} from "@linxiraos/zeta/extensibility/plugins/marketplace";
import { readPluginRuntimeConfig } from "@linxiraos/zeta/extensibility/plugins/runtime-config";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const OFFICIAL_DIR_ENV = "ZETA_OFFICIAL_PLUGINS_DIR";
const OFFICIAL_EMBED_ENV = "ZETA_OFFICIAL_PLUGINS_EMBED";

const ORIGINAL_DIR = process.env[OFFICIAL_DIR_ENV];
const ORIGINAL_EMBED = process.env[OFFICIAL_EMBED_ENV];

function restoreEnv(): void {
	if (ORIGINAL_DIR === undefined) delete process.env[OFFICIAL_DIR_ENV];
	else process.env[OFFICIAL_DIR_ENV] = ORIGINAL_DIR;
	if (ORIGINAL_EMBED === undefined) delete process.env[OFFICIAL_EMBED_ENV];
	else process.env[OFFICIAL_EMBED_ENV] = ORIGINAL_EMBED;
}

afterAll(restoreEnv);

interface FixturePlugin {
	id: string;
	version: string;
	/** Defaults to true; `false` leaves the plugin out of the built-in catalog. */
	bundled?: boolean;
	publish?: string;
	description?: string;
}

/** One official plugin tree, shaped like `plugins/official/<id>`. */
async function writeOfficialPlugin(root: string, plugin: FixturePlugin): Promise<string> {
	const dir = path.join(root, plugin.id);
	await fs.mkdir(dir, { recursive: true });
	await Bun.write(
		path.join(dir, "plugin.json"),
		JSON.stringify(
			{
				id: plugin.id,
				name: plugin.id,
				description: plugin.description ?? `${plugin.id} does something`,
				...(plugin.publish ? { publish: plugin.publish } : {}),
				install: "npm",
				category: "official",
				...(plugin.bundled === false ? {} : { distribution: "bundled" }),
			},
			null,
			2,
		),
	);
	await Bun.write(
		path.join(dir, "package.json"),
		JSON.stringify({ name: plugin.publish ?? plugin.id, version: plugin.version }),
	);
	// A package.json `pi.extensions` entry the runtime can actually resolve, so a
	// materialized copy is a real plugin package rather than an empty directory.
	await Bun.write(path.join(dir, "index.ts"), "export default {};\n");
	return dir;
}

interface OfficialFixture {
	root: string;
	pluginsDir: string;
	managerDir: string;
}

/** Point the catalog at a scratch plugin root and build isolated manager paths. */
async function createOfficialFixture(plugins: FixturePlugin[]): Promise<OfficialFixture> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-official-plugins-"));
	const pluginsDir = path.join(root, "official");
	await fs.mkdir(pluginsDir, { recursive: true });
	for (const plugin of plugins) await writeOfficialPlugin(pluginsDir, plugin);
	process.env[OFFICIAL_DIR_ENV] = pluginsDir;
	delete process.env[OFFICIAL_EMBED_ENV];
	return { root, pluginsDir, managerDir: path.join(root, "state") };
}

function createManager(managerDir: string): MarketplaceManager {
	return new MarketplaceManager({
		marketplacesRegistryPath: path.join(managerDir, "marketplaces.json"),
		installedRegistryPath: path.join(managerDir, "installed_plugins.json"),
		marketplacesCacheDir: path.join(managerDir, "cache", "marketplaces"),
		pluginsCacheDir: path.join(managerDir, "cache", "plugins"),
		clearPluginRootsCache: () => {},
	});
}

async function readRuntimeState(managerDir: string): Promise<Record<string, { enabled?: boolean }>> {
	const read = await readPluginRuntimeConfig(path.join(managerDir, PLUGINS_LOCKFILE_CANONICAL));
	return read.status === "read" ? read.config.plugins : {};
}

describe("official plugin catalog", () => {
	let fixture: OfficialFixture | undefined;

	beforeEach(() => {
		fixture = undefined;
	});

	afterEach(async () => {
		restoreEnv();
		if (fixture) await removeWithRetries(fixture.root);
	});

	test("derives the catalog from the bundled plugin manifests only", async () => {
		fixture = await createOfficialFixture([
			{ id: "alpha", version: "2.3.4" },
			{ id: "a-sample", version: "0.1.0", bundled: false },
		]);

		const manifests = readOfficialPluginManifests();

		expect(manifests.map(m => m.id)).toEqual(["alpha"]);
		expect(manifests[0].version).toBe("2.3.4");
		expect(manifests[0].dir).toBe(path.join(fixture.pluginsDir, "alpha"));
	});

	test("maps a manifest to a catalog entry with a relative source", async () => {
		fixture = await createOfficialFixture([{ id: "alpha", version: "2.3.4", publish: "@zeta/alpha" }]);

		const [manifest] = readOfficialPluginManifests();
		expect(officialCatalogEntries([manifest])).toEqual([
			{
				name: "alpha",
				source: "./alpha",
				version: "2.3.4",
				description: "alpha does something",
				category: "official",
			},
		]);
	});

	test("lists the catalog from a manifest snapshot when no sources ship", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-official-snapshot-"));
		fixture = { root, pluginsDir: path.join(root, "official"), managerDir: path.join(root, "state") };
		// A dead override means "this build has no plugin tree", exactly like a
		// standalone binary; the embedded snapshot is then the whole catalog.
		process.env[OFFICIAL_DIR_ENV] = path.join(root, "missing");
		process.env[OFFICIAL_EMBED_ENV] = JSON.stringify({
			version: 1,
			plugins: [{ id: "alpha", version: "2.3.4", publish: "@zeta/alpha", description: "alpha does something" }],
		});

		const manifests = readOfficialPluginManifests();

		expect(manifests.map(m => m.id)).toEqual(["alpha"]);
		expect(manifests[0].dir).toBeUndefined();
		expect(officialCatalogEntries(manifests)[0].source).toEqual({
			source: "npm",
			package: "@zeta/alpha",
			version: "2.3.4",
		});
	});

	test("the repository ships pi-messenger as the bundled official plugin", async () => {
		// No override: this reads the real `plugins/official` tree next to the package.
		delete process.env[OFFICIAL_DIR_ENV];
		delete process.env[OFFICIAL_EMBED_ENV];
		const pkg = (await Bun.file(
			path.join(REPO_ROOT, "plugins", "official", "pi-messenger", "package.json"),
		).json()) as { version: string };

		const manifests = readOfficialPluginManifests();

		const messenger = manifests.find(m => m.id === "pi-messenger");
		expect(messenger).toBeDefined();
		expect(messenger?.version).toBe(pkg.version);
		expect(messenger?.dir).toBe(path.join(REPO_ROOT, "plugins", "official", "pi-messenger"));
		// The teaching sample stays out of the built-in set.
		expect(manifests.map(m => m.id)).not.toContain("example-panel");
	});

	test("the shipped pi-messenger manifest seeds installed and disabled", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-pi-messenger-seed-"));
		const shippedDir = path.join(REPO_ROOT, "plugins", "official", "pi-messenger");
		const officialRoot = path.join(root, "official");
		const pluginDir = path.join(officialRoot, "pi-messenger");
		await fs.mkdir(pluginDir, { recursive: true });
		// Copy the shipped identity/marker manifests, not the whole tree: this
		// proves the real `distribution: bundled` + package name seed disabled
		// without copying a developer's plugin node_modules.
		const pluginJson = (await Bun.file(path.join(shippedDir, "plugin.json")).json()) as Record<string, unknown>;
		const pkg = (await Bun.file(path.join(shippedDir, "package.json")).json()) as {
			name: string;
			version: string;
		};
		await Bun.write(path.join(pluginDir, "plugin.json"), JSON.stringify(pluginJson));
		await Bun.write(path.join(pluginDir, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version }));
		await Bun.write(path.join(pluginDir, "index.ts"), "export default {};\n");
		process.env[OFFICIAL_DIR_ENV] = officialRoot;
		delete process.env[OFFICIAL_EMBED_ENV];
		try {
			const manager = createManager(path.join(root, "state"));

			expect(await manager.ensureOfficialPluginsInstalled()).toEqual(["pi-messenger@official"]);

			const registry = await readInstalledPluginsRegistry(path.join(root, "state", "installed_plugins.json"));
			expect(registry.plugins["pi-messenger@official"]?.[0]?.enabled).toBe(false);
			expect((await readRuntimeState(path.join(root, "state")))["@linxiraos/pi-messenger"]?.enabled).toBe(false);
		} finally {
			restoreEnv();
			await removeWithRetries(root);
		}
	});
});

describe("official plugins in the marketplace manager", () => {
	let fixture: OfficialFixture;

	beforeEach(async () => {
		fixture = await createOfficialFixture([
			{ id: "alpha", version: "2.3.4", publish: "@zeta/alpha" },
			{ id: "bravo", version: "1.0.0", publish: "@zeta/bravo" },
		]);
	});

	afterEach(async () => {
		restoreEnv();
		await removeWithRetries(fixture.root);
	});

	test("the built-in catalog is a marketplace that cannot be removed", async () => {
		const manager = createManager(fixture.managerDir);

		// `listMarketplaces` is the persisted registry; the listing surfaces use
		// `listAvailableMarketplaces`, which puts the built-in catalog first.
		expect(await manager.listMarketplaces()).toEqual([]);
		const marketplaces = await manager.listAvailableMarketplaces();
		expect(marketplaces[0]).toMatchObject({
			name: OFFICIAL_MARKETPLACE_NAME,
			sourceType: "builtin",
			sourceUri: "builtin:official",
		});

		await expect(manager.removeMarketplace(OFFICIAL_MARKETPLACE_NAME)).rejects.toThrow(/built in/);
		// Updating it is a no-op: the catalog is the shipped manifests.
		expect(await manager.updateMarketplace(OFFICIAL_MARKETPLACE_NAME)).toMatchObject({
			name: OFFICIAL_MARKETPLACE_NAME,
		});
	});

	test("discover lists the official plugins with their versions", async () => {
		const manager = createManager(fixture.managerDir);

		const plugins = await manager.listAvailablePlugins(OFFICIAL_MARKETPLACE_NAME);

		expect(plugins.map(p => [p.name, p.version, p.source])).toEqual([
			["alpha", "2.3.4", "./alpha"],
			["bravo", "1.0.0", "./bravo"],
		]);
		// The unfiltered listing includes the built-in catalog too.
		expect((await manager.listAvailablePlugins()).map(p => p.name)).toEqual(["alpha", "bravo"]);
	});

	test("seeds the official plugins installed and disabled, offline", async () => {
		const manager = createManager(fixture.managerDir);

		expect(await manager.ensureOfficialPluginsInstalled()).toEqual(["alpha@official", "bravo@official"]);

		const registry = await readInstalledPluginsRegistry(path.join(fixture.managerDir, "installed_plugins.json"));
		expect(Object.keys(registry.plugins).sort()).toEqual(["alpha@official", "bravo@official"]);
		for (const entries of Object.values(registry.plugins)) {
			expect(entries).toHaveLength(1);
			expect(entries[0].enabled).toBe(false);
			// Point at a managed copy of the plugin, never at the shipped tree, so an
			// uninstall can delete it without touching the product's own files.
			expect(entries[0].installPath).toContain(path.join("cache", "plugins"));
			expect(existsSync(path.join(entries[0].installPath, "plugin.json"))).toBe(true);
		}
		// The runtime link exists but is disabled: enabling is a pure flag flip.
		expect(existsSync(path.join(fixture.managerDir, "node_modules", "@zeta", "alpha"))).toBe(true);
		expect((await readRuntimeState(fixture.managerDir))["@zeta/alpha"]?.enabled).toBe(false);

		// Idempotent: a second pass has nothing left to do.
		expect(await manager.ensureOfficialPluginsInstalled()).toEqual([]);
	});

	test("enable flips exactly one entry", async () => {
		const manager = createManager(fixture.managerDir);
		await manager.ensureOfficialPluginsInstalled();

		await manager.setPluginEnabled("alpha@official", true);

		const registry = await readInstalledPluginsRegistry(path.join(fixture.managerDir, "installed_plugins.json"));
		expect(registry.plugins["alpha@official"]?.[0]?.enabled).toBe(true);
		expect(registry.plugins["bravo@official"]?.[0]?.enabled).toBe(false);

		const runtime = await readRuntimeState(fixture.managerDir);
		expect(runtime["@zeta/alpha"]?.enabled).toBe(true);
		expect(runtime["@zeta/bravo"]?.enabled).toBe(false);

		const summaries = await manager.listInstalledPlugins();
		expect(summaries.map(s => [s.id, s.entries[0]?.enabled])).toEqual([
			["alpha@official", true],
			["bravo@official", false],
		]);
	});

	test("an uninstalled official plugin is not resurrected by the next run", async () => {
		const manager = createManager(fixture.managerDir);
		await manager.ensureOfficialPluginsInstalled();

		await manager.uninstallPlugin("alpha@official");
		expect(await manager.ensureOfficialPluginsInstalled()).toEqual([]);

		const registry = await readInstalledPluginsRegistry(path.join(fixture.managerDir, "installed_plugins.json"));
		expect(registry.plugins["alpha@official"]).toBeUndefined();
		expect(registry.plugins["bravo@official"]).toBeDefined();
	});

	test("a newer bundled version is reported and upgradable", async () => {
		const seedManager = createManager(fixture.managerDir);
		await seedManager.ensureOfficialPluginsInstalled();
		// A later product build ships a newer plugin; a fresh manager is what a new
		// process sees (manifests are read once per manager).
		await Bun.write(
			path.join(fixture.pluginsDir, "alpha", "package.json"),
			JSON.stringify({ name: "@zeta/alpha", version: "3.0.0" }),
		);
		const manager = createManager(fixture.managerDir);

		const updates = await manager.checkForUpdates();
		expect(updates).toEqual([{ pluginId: "alpha@official", scope: "user", from: "2.3.4", to: "3.0.0" }]);

		const upgraded = await manager.upgradePlugin("alpha@official");
		expect(upgraded.version).toBe("3.0.0");
		// The disabled flag survives an upgrade, exactly like a marketplace install.
		const registry = await readInstalledPluginsRegistry(path.join(fixture.managerDir, "installed_plugins.json"));
		expect(registry.plugins["alpha@official"]?.[0]?.enabled).toBe(false);
	});

	test("installing an official plugin from the catalog works without a registry", async () => {
		const manager = createManager(fixture.managerDir);

		const entry = await manager.installPlugin("alpha", OFFICIAL_MARKETPLACE_NAME);

		expect(entry.version).toBe("2.3.4");
		expect(entry.installPath).toContain(path.join("cache", "plugins"));
		const registry = await readInstalledPluginsRegistry(path.join(fixture.managerDir, "installed_plugins.json"));
		expect(registry.plugins["alpha@official"]?.[0]?.enabled).not.toBe(false);
	});
});

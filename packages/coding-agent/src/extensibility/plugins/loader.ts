/**
 * Plugin loader - discovers and loads manifest entry points from installed plugins.
 *
 * Reads enabled plugins from the runtime config and loads their
 * tools/hooks/extensions/commands based on manifest entries and enabled features.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
	getPluginCacheDir,
	getPluginDataDir,
	getPluginStateDir,
	getPluginsDir,
	hasFsCode,
	isEacces,
	isEnoent,
	logger,
	normalizePathForComparison,
	PLUGINS_LOCKFILE_CANONICAL,
	PLUGINS_LOCKFILE_LEGACY,
} from "@linxiraos/pi-utils";
import { getConfigDirPaths } from "../../config";
import { registerPluginCacheInvalidator, resolveActiveProjectRegistryPath } from "../../discovery/helpers";
import { findExtensionDirectoryIndex, resolveExtensionDirectory } from "../extensions/directory-resolution";
import { installLegacyPiSpecifierShim } from "./legacy-pi-compat";
import { normalizePluginRuntimeConfig } from "./runtime-config";
import type {
	InstalledPlugin,
	PluginManifest,
	PluginRuntimeConfig,
	PluginStorage,
	ProjectPluginOverrides,
} from "./types";

/**
 * Host-managed storage roots for a plugin (spec §4.3): resolve the three
 * per-plugin dirs for `pluginName` and lazily `mkdir(recursive)` them —
 * directory existence is a host contract, plugins must not recreate it
 * elsewhere. `home` pins the plugins root for non-default-home callers.
 */
export function buildPluginStorage(pluginName: string, home?: string): PluginStorage {
	const storage: PluginStorage = {
		dataDir: getPluginDataDir(pluginName, home),
		cacheDir: getPluginCacheDir(pluginName, home),
		stateDir: getPluginStateDir(pluginName, home),
	};
	for (const dir of [storage.dataDir, storage.cacheDir, storage.stateDir]) {
		fs.mkdirSync(dir, { recursive: true });
	}
	return storage;
}

/** Installed plugin plus the root scope that supplied its runtime metadata. */
export interface ScopedInstalledPlugin extends InstalledPlugin {
	scope: "user" | "project";
}

installLegacyPiSpecifierShim();

const enabledPluginsCache = new Map<string, Promise<ScopedInstalledPlugin[]>>();

function enabledPluginsCacheKey(cwd: string, home?: string): string {
	return `${path.resolve(cwd)}\0${home === undefined ? "" : path.resolve(home)}`;
}

function clearEnabledPluginsCache(): void {
	enabledPluginsCache.clear();
}

registerPluginCacheInvalidator(clearEnabledPluginsCache);

// =============================================================================
// Runtime Config Loading
// =============================================================================

/**
 * Load plugin runtime config from lock file, migrating the legacy filename.
 *
 * Read-old / write-new: the lockfile carries per-plugin runtime state (enabled
 * flag, version), so an upgrade must not orphan it. The Zeta-named file is
 * canonical; when only the pre-rename file exists we read it, write the new
 * one, and remove the old — a one-time, idempotent migration.
 *
 * `home` controls which `<plugins>/` directory is used — pass it through
 * whenever the caller is loading plugins for a tempdir-rooted scenario (tests,
 * discovery sub-surfaces that need to mirror an alternate `LoadContext.home`).
 */
async function loadRuntimeConfig(home?: string): Promise<PluginRuntimeConfig> {
	const dir = getPluginsDir(home);
	const canonical = path.join(dir, PLUGINS_LOCKFILE_CANONICAL);
	const legacy = path.join(dir, PLUGINS_LOCKFILE_LEGACY);

	/** Missing file, or a path we cannot read at all. */
	const readIfPossible = async (p: string): Promise<Partial<PluginRuntimeConfig> | undefined> => {
		try {
			return (await Bun.file(p).json()) as Partial<PluginRuntimeConfig>;
		} catch {
			// Anything unreadable — absent, a directory, EACCES — is treated as
			// "no config here" so a broken path cannot take every plugin down
			// with it. A legacy file with real state is still preferred below.
			return undefined;
		}
	};

	const canonicalData = await readIfPossible(canonical);
	if (canonicalData !== undefined) return normalizePluginRuntimeConfig(canonicalData);

	const legacyData = await readIfPossible(legacy);
	if (legacyData === undefined) return normalizePluginRuntimeConfig({});

	// First run after the rename: carry the state forward, then drop the old
	// file so the migration cannot run twice or drift.
	const migrated = normalizePluginRuntimeConfig(legacyData);
	try {
		await Bun.write(canonical, `${JSON.stringify(migrated, null, "\t")}\n`);
		await fs.promises.unlink(legacy);
	} catch {
		// A read-only or concurrently-locked plugins dir must not break loading;
		// the legacy file simply stays authoritative until the write succeeds.
	}
	return migrated;
}

/**
 * Load project-local plugin overrides (checks .zeta and .pi directories).
 */
async function loadProjectOverrides(cwd: string): Promise<ProjectPluginOverrides> {
	for (const overridesPath of getConfigDirPaths("plugin-overrides.json", { user: false, cwd })) {
		try {
			return await Bun.file(overridesPath).json();
		} catch (err) {
			if (isEnoent(err)) continue;
			// Malformed or unreadable overrides would otherwise silently act
			// as {} — project-disabled plugins re-enable and project settings
			// vanish without a trace. Report it, then fall through like a
			// missing file so plugin collection still degrades gracefully.
			logger.warn("plugins: failed to load project plugin overrides, ignoring them", {
				path: overridesPath,
				error: String(err),
			});
		}
	}
	return {};
}
/**
 * A plugin root the process is not allowed to read is an environment
 * condition — a sandbox, restrictive permissions, or a manifest symlinked into
 * a denied path — not a broken configuration. Skip the root with a warning:
 * rethrowing aborts plugin tool-path collection, which fails agent and
 * subagent startup outright, and no plugin is worth that. A malformed manifest
 * still throws, because that one is the user's to fix.
 */
function isUnreadableRoot(err: unknown): boolean {
	return isEacces(err) || hasFsCode(err, "EPERM");
}

/**
 * Per-root enumeration of plugins from `<root>/node_modules`,
 * `<root>/package.json#dependencies`, and `<root>/omp-plugins.lock.json#plugins`.
 * Honors `projectOverrides.disabled` and `projectOverrides.features`. Returns an
 * empty array when the root has no `node_modules` yet.
 */
async function collectPluginsAtRoot(
	root: string,
	projectOverrides: ProjectPluginOverrides,
	scope: ScopedInstalledPlugin["scope"],
	home?: string,
): Promise<ScopedInstalledPlugin[]> {
	const nodeModulesPath = path.join(root, "node_modules");
	if (!fs.existsSync(nodeModulesPath)) return [];

	let depsKeys: string[] = [];
	let hasPackageManifest = false;
	const pkgJsonPath = path.join(root, "package.json");
	try {
		const pkg: { dependencies?: Record<string, string> } = await Bun.file(pkgJsonPath).json();
		depsKeys = Object.keys(pkg.dependencies ?? {});
		hasPackageManifest = true;
	} catch (err) {
		// Linked-only setups may have no `<root>/package.json` yet — that's
		// fine, the lockfile still records the link.
		if (isUnreadableRoot(err)) {
			logger.warn("plugins: skipping unreadable plugin root", { root, path: pkgJsonPath });
			return [];
		}
		if (!isEnoent(err)) throw err;
	}

	const lockPath = path.join(root, "omp-plugins.lock.json");
	let runtimeConfig: PluginRuntimeConfig;
	try {
		runtimeConfig = normalizePluginRuntimeConfig(await Bun.file(lockPath).json());
	} catch (err) {
		if (isUnreadableRoot(err)) {
			logger.warn("plugins: skipping unreadable plugin root", { root, path: lockPath });
			return [];
		}
		if (!isEnoent(err)) throw err;
		runtimeConfig = normalizePluginRuntimeConfig({});
	}

	// Union: dependencies (npm/marketplace installs) ∪ runtime-config plugins
	// (links + already-recorded installs). Set preserves first-seen order,
	// putting deps before link-only entries for deterministic output.
	const names = new Set<string>(depsKeys);
	for (const name of Object.keys(runtimeConfig.plugins ?? {})) {
		names.add(name);
	}

	const isSymlink = async (target: string): Promise<boolean> => {
		try {
			return (await fs.promises.lstat(target)).isSymbolicLink();
		} catch (err) {
			if (isEnoent(err)) return false;
			// Unreadable means unclassifiable, and the caller only asks in order
			// to keep a lockfile-only entry: treat it as not linked and let that
			// entry be skipped with its own warning.
			if (isUnreadableRoot(err)) return false;
			throw err;
		}
	};
	const plugins: ScopedInstalledPlugin[] = [];
	for (const name of names) {
		// When a package manifest exists, a lockfile-only entry is legitimate
		// only for linked plugins (`zetacode plugin link`, marketplace runtime
		// registration), which are symlinks into node_modules. Without a
		// manifest, retain the established lockfile-only directory layout.
		if (hasPackageManifest && !depsKeys.includes(name) && !(await isSymlink(path.join(nodeModulesPath, name)))) {
			logger.warn("plugins: skipping stale lockfile entry not declared in package.json", {
				name,
				root,
			});
			continue;
		}
		const pluginPkgPath = path.join(nodeModulesPath, name, "package.json");
		let pluginPkg: { version: string; omp?: PluginManifest; pi?: PluginManifest };
		try {
			pluginPkg = await Bun.file(pluginPkgPath).json();
		} catch (err) {
			// Lockfile entry without a corresponding node_modules tree means the
			// link was deleted out from under us; skip silently.
			if (isEnoent(err)) continue;
			// One unreadable plugin does not invalidate its siblings, so skip
			// just this one — loudly, because unlike a deleted link it is a
			// plugin the user still expects to load.
			if (isUnreadableRoot(err)) {
				logger.warn("plugins: skipping unreadable plugin", { name, root, path: pluginPkgPath });
				continue;
			}
			throw err;
		}

		const manifest: PluginManifest | undefined = pluginPkg.omp || pluginPkg.pi;
		if (!manifest) {
			// Not an zetacode plugin, skip
			continue;
		}
		manifest.version = pluginPkg.version;

		const runtimeState = runtimeConfig.plugins[name];

		// Check if disabled globally
		if (runtimeState && !runtimeState.enabled) {
			continue;
		}

		// Check if disabled in project
		if (projectOverrides.disabled?.includes(name)) {
			continue;
		}

		// Resolve enabled features (project overrides take precedence)
		const enabledFeatures = projectOverrides.features?.[name] ?? runtimeState?.enabledFeatures ?? null;
		plugins.push({
			name,
			version: pluginPkg.version,
			path: path.join(nodeModulesPath, name),
			scope,
			manifest,
			enabledFeatures,
			enabled: true,
			storage: buildPluginStorage(name, home),
		});
	}

	return plugins;
}

/**
 * Get list of enabled plugins with their resolved configurations.
 *
 * Enumerates two plugin roots in order: the user root
 * (`getPluginsDir(home)`) and, when a project anchor (`.zeta/` or `.git/`)
 * exists at or above `cwd`, the project root
 * (`<projectAnchor>/.zeta/plugins`). Each root contributes the union of its
 * `package.json#dependencies` and `omp-plugins.lock.json#plugins`. Project
 * entries shadow user entries with the same package name, matching the
 * shadow semantics of `MarketplaceManager.listInstalledPlugins`.
 *
 * The optional `home` parameter pins the user plugins root for callers that
 * need to enumerate plugins relative to a non-default home (tests with a
 * tempdir, discovery loaders threaded with `LoadContext.home`).
 */
export async function getEnabledPlugins(cwd: string, opts: { home?: string } = {}): Promise<ScopedInstalledPlugin[]> {
	const { home } = opts;
	const cacheKey = enabledPluginsCacheKey(cwd, home);
	const cached = enabledPluginsCache.get(cacheKey);
	if (cached) return cached;

	const loadPromise = loadEnabledPlugins(cwd, home);
	enabledPluginsCache.set(cacheKey, loadPromise);
	try {
		return await loadPromise;
	} catch (err) {
		if (enabledPluginsCache.get(cacheKey) === loadPromise) {
			enabledPluginsCache.delete(cacheKey);
		}
		throw err;
	}
}

async function loadEnabledPlugins(cwd: string, home?: string): Promise<ScopedInstalledPlugin[]> {
	const projectOverrides = await loadProjectOverrides(cwd);

	const userRoot = getPluginsDir(home);
	const userPlugins = await collectPluginsAtRoot(userRoot, projectOverrides, "user", home);

	let projectPlugins: ScopedInstalledPlugin[] = [];
	const projectRegistryPath = await resolveActiveProjectRegistryPath(cwd);
	if (projectRegistryPath) {
		const projectRoot = path.dirname(projectRegistryPath);
		if (normalizePathForComparison(projectRoot) !== normalizePathForComparison(userRoot)) {
			projectPlugins = await collectPluginsAtRoot(projectRoot, projectOverrides, "project");
		}
	}

	if (projectPlugins.length === 0) return userPlugins;
	if (userPlugins.length === 0) return projectPlugins;

	// Project entries shadow user entries with the same package name.
	const merged = new Map<string, ScopedInstalledPlugin>();
	for (const plugin of userPlugins) merged.set(plugin.name, plugin);
	for (const plugin of projectPlugins) merged.set(plugin.name, plugin);
	return Array.from(merged.values());
}

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Storage roots for the plugin that owns `extensionPath`, or `undefined` when
 * the path is not a manifest entry of an enabled plugin (top-level extension,
 * inline factory). Used by the extension loader to expose `pi.storage` with
 * the same roots `InstalledPlugin.storage` carries; directories already exist
 * (the loader created them at collection time).
 */
export async function resolvePluginStorage(
	cwd: string,
	extensionPath: string,
	opts: { home?: string } = {},
): Promise<PluginStorage | undefined> {
	const resolved = path.resolve(extensionPath);
	const plugin = (await getEnabledPlugins(cwd, opts)).find(candidate => {
		const rel = path.relative(candidate.path, resolved);
		return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
	});
	return plugin?.storage;
}

const MANIFEST_ENTRY_MODULE_EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"];
const MANIFEST_ENTRY_INDEX_NAMES = MANIFEST_ENTRY_MODULE_EXTENSIONS.map(ext => `index${ext}`);

/** `.d.ts` / `.d.mts` / `.d.cts` TypeScript declaration files — never loadable as modules. */
const DECLARATION_FILE_RE = /\.d\.[mc]?ts$/;

/** A loadable module file: a .ts/.js/.mjs/.cjs that is not a declaration file. */
function isModuleFile(name: string): boolean {
	return MANIFEST_ENTRY_MODULE_EXTENSIONS.includes(path.extname(name)) && !DECLARATION_FILE_RE.test(name);
}

const PLUGIN_EXTENSION_DIRECTORY_OPTIONS = {
	indexNames: MANIFEST_ENTRY_INDEX_NAMES,
	isScanFile: isModuleFile,
	sortChildren: true,
};

/**
 * Resolve a plugin manifest entry to the loadable module files it names:
 * - a file entry → that file
 * - a directory:
 *   - when `expandDirectory` (the `extensions` key), resolved by
 *     {@link resolveExtensionDirectory} — its own package.json `zetacode`/`pi`
 *     `extensions`, then a direct index, then a one-level scan of
 *     sub-extensions — matching the pi `extensions/<name>/index.ts` convention
 *     and OMP's configured-directory (`-e`) extension loader
 *   - otherwise (tools/hooks/commands) only a direct index.{ts,js,mjs,cjs}.
 *     The sub-extension scan and the `zetacode`/`pi` `extensions` manifest are
 *     extensions-specific and must not hijack a non-extension directory entry
 *     (e.g. a `tools: "."` entry must still resolve `./index.ts`).
 *
 * Returns an empty array when nothing loadable exists at `joined`, letting
 * callers flag a missing entry instead of silently dropping it.
 */
function resolveManifestEntryFiles(joined: string, expandDirectory: boolean): string[] {
	let stats: fs.Stats;
	try {
		stats = fs.statSync(joined);
	} catch {
		return [];
	}
	if (!stats.isDirectory()) {
		return [joined];
	}
	if (expandDirectory) {
		return resolveExtensionDirectory(joined, PLUGIN_EXTENSION_DIRECTORY_OPTIONS).files;
	}
	const index = findExtensionDirectoryIndex(joined, MANIFEST_ENTRY_INDEX_NAMES);
	return index ? [index] : [];
}

/**
 * Generic path resolver for plugin manifest entries (tools, hooks, commands, extensions).
 * Handles both single-string and string[] base entries, plus feature-specific entries.
 */
function resolvePluginPaths(plugin: InstalledPlugin, key: "tools" | "hooks" | "commands" | "extensions"): string[] {
	const resolved: string[] = [];
	for (const entry of resolvePluginManifestEntries(plugin, key)) {
		if (entry.resolvedPath) {
			resolved.push(entry.resolvedPath);
		}
	}
	return resolved;
}

/**
 * Declared manifest entries paired with their resolved file path. Returns one
 * record per declared entry — base entries first, then enabled-feature entries
 * — so callers (e.g. install-time validation) can detect manifest entries that
 * point at missing files instead of silently skipping them like
 * {@link resolvePluginPaths} does.
 */
export function resolvePluginManifestEntries(
	plugin: InstalledPlugin,
	key: "tools" | "hooks" | "commands" | "extensions",
): Array<{ entry: string; resolvedPath: string | null }> {
	const declared: Array<{ entry: string; resolvedPath: string | null }> = [];
	const manifest = plugin.manifest;

	const expandDirectory = key === "extensions";
	const resolveEntry = (entry: string): Array<{ entry: string; resolvedPath: string | null }> => {
		const files = resolveManifestEntryFiles(path.join(plugin.path, entry), expandDirectory);
		return files.length > 0 ? files.map(resolvedPath => ({ entry, resolvedPath })) : [{ entry, resolvedPath: null }];
	};

	const base = manifest[key];
	if (base) {
		const entries = Array.isArray(base) ? base : [base];
		for (const entry of entries) {
			declared.push(...resolveEntry(entry));
		}
	}

	if (manifest.features && plugin.enabledFeatures) {
		const enabledSet = new Set(plugin.enabledFeatures);
		for (const [featName, feat] of Object.entries(manifest.features)) {
			if (!enabledSet.has(featName)) continue;
			if (feat[key]) {
				for (const entry of feat[key]) {
					declared.push(...resolveEntry(entry));
				}
			}
		}
	} else if (manifest.features && plugin.enabledFeatures === null) {
		// null means use defaults - enable features with default: true
		for (const [_featName, feat] of Object.entries(manifest.features)) {
			if (!feat.default) continue;
			if (feat[key]) {
				for (const entry of feat[key]) {
					declared.push(...resolveEntry(entry));
				}
			}
		}
	}

	return declared;
}

export function resolvePluginToolPaths(plugin: InstalledPlugin): string[] {
	return resolvePluginPaths(plugin, "tools");
}

export function resolvePluginHookPaths(plugin: InstalledPlugin): string[] {
	return resolvePluginPaths(plugin, "hooks");
}

export function resolvePluginCommandPaths(plugin: InstalledPlugin): string[] {
	return resolvePluginPaths(plugin, "commands");
}

export function resolvePluginExtensionPaths(plugin: InstalledPlugin): string[] {
	return resolvePluginPaths(plugin, "extensions");
}

// =============================================================================
// Aggregated Discovery
// =============================================================================

/**
 * Get all tool paths from all enabled plugins.
 */
export async function getAllPluginToolPaths(cwd: string): Promise<string[]> {
	const plugins = await getEnabledPlugins(cwd);
	const paths: string[] = [];

	for (const plugin of plugins) {
		paths.push(...resolvePluginToolPaths(plugin));
	}

	return paths;
}

/**
 * Get all hook paths from all enabled plugins.
 */
export async function getAllPluginHookPaths(cwd: string): Promise<string[]> {
	const plugins = await getEnabledPlugins(cwd);
	const paths: string[] = [];

	for (const plugin of plugins) {
		paths.push(...resolvePluginHookPaths(plugin));
	}

	return paths;
}

/**
 * Get all command paths from all enabled plugins.
 */
export async function getAllPluginCommandPaths(cwd: string): Promise<string[]> {
	const plugins = await getEnabledPlugins(cwd);
	const paths: string[] = [];

	for (const plugin of plugins) {
		paths.push(...resolvePluginCommandPaths(plugin));
	}

	return paths;
}

/**
 * Get all extension module paths from all enabled plugins.
 */
export async function getAllPluginExtensionPaths(cwd: string): Promise<string[]> {
	const plugins = await getEnabledPlugins(cwd);
	const paths: string[] = [];

	for (const plugin of plugins) {
		paths.push(...resolvePluginExtensionPaths(plugin));
	}

	return paths;
}

/**
 * Get plugin settings for use in tool/hook contexts.
 * Merges global settings with project overrides.
 */
export async function getPluginSettings(
	pluginName: string,
	cwd: string,
	home?: string,
): Promise<Record<string, unknown>> {
	const runtimeConfig = await loadRuntimeConfig(home);
	const projectOverrides = await loadProjectOverrides(cwd);

	const global = runtimeConfig.settings[pluginName] || {};
	const project = projectOverrides.settings?.[pluginName] || {};

	return { ...global, ...project };
}

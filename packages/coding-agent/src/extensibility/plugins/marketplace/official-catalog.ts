/**
 * Built-in `official` plugin catalog.
 *
 * The official set is Zeta's first-party plugins — the `plugins/official/` tree in
 * the repository. This module is the only place that decides what "official"
 * means, and it reads that decision from the shipped plugin manifests: a plugin
 * is in the built-in catalog when its `plugin.json` declares
 * `"distribution": "bundled"` (see `plugins/official/INDEX.md`). There is no
 * second, hand-written list of plugin ids anywhere.
 *
 * Manifest resolution order (first source that yields manifests wins):
 *
 *   1. `ZETA_OFFICIAL_PLUGINS_DIR` — explicit override of the source root
 *      (tests, operators). A dead path means "no official plugins", the same
 *      escape hatch `ZETA_OFFICIAL_SKILLS_DIR` provides.
 *   2. On-disk candidates: the repository checkout (`<repo>/plugins/official`,
 *      the dev and source-run layout) and the packaged copy
 *      (`<pkg>/dist/official-plugins`, written by `scripts/official-plugins.ts`
 *      at prepack, shipped through the package.json `files` list).
 *   3. `ZETA_OFFICIAL_PLUGINS_EMBED` — a manifest snapshot burned into bundles
 *      and standalone binaries at build time. It carries no sources.
 *   4. `<pkg>/dist/official-plugins.generated.json` — the same snapshot for an
 *      install whose source copy is missing (a hand-copied dist, say).
 *
 * A manifest snapshot without sources still answers "what exists?" for
 * `plugin marketplace` and `plugin discover`; only installing needs the on-disk
 * tree, and {@link OfficialPluginManifest.dir} is what says whether this build
 * has it.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { isValidNameSegment, type MarketplacePluginEntry } from "./types";

/** Marketplace name of the built-in catalog; plugin ids read `name@official`. */
export const OFFICIAL_MARKETPLACE_NAME = "official";

/** Explicit official plugin root; a dead path disables the catalog. */
export const OFFICIAL_PLUGINS_DIR_ENV = "ZETA_OFFICIAL_PLUGINS_DIR";

/** Build-time manifest snapshot (`--define`d at bundle/binary build). */
export const OFFICIAL_PLUGINS_EMBED_ENV = "ZETA_OFFICIAL_PLUGINS_EMBED";

/** File name of the generated manifest snapshot inside the package `dist/`. */
export const OFFICIAL_CATALOG_FILE = "official-plugins.generated.json";

/** The `plugin.json` marker that puts a plugin in the built-in catalog. */
export const OFFICIAL_DISTRIBUTION = "bundled";

/** One official plugin, as its shipped manifests declare it. */
export interface OfficialPluginManifest {
	/** Plugin id, also the directory name (`plugins/official/<id>`). */
	id: string;
	/** Version from the plugin's own `package.json` (the plugin.json carries none). */
	version: string;
	name?: string;
	description?: string;
	/** npm package published for this plugin — the lazy fallback when no source tree ships. */
	publish?: string;
	install?: string;
	category?: string;
	source?: string;
	/** Absolute plugin directory; absent when this build ships manifests only. */
	dir?: string;
}

interface OfficialPluginSnapshot {
	id: string;
	version: string;
	name?: string;
	description?: string;
	publish?: string;
	install?: string;
	category?: string;
	source?: string;
}

interface OfficialSnapshotFile {
	version: 1;
	plugins: OfficialPluginSnapshot[];
}

/**
 * Candidate plugin roots probed by {@link resolveOfficialPluginsDir}.
 *
 * `fromDir` is this module's directory, which differs by build shape: the
 * bundle sits at `<pkg>/dist`, while a source run is at
 * `<pkg>/src/extensibility/plugins/marketplace`. Both are probed (plus one level
 * shallower, in case this module moves), and every probe yields the packaged
 * copy, a package-root copy, and the repository checkout.
 */
export function officialPluginsDirCandidates(fromDir: string): string[] {
	const candidates = packageDirCandidates(fromDir).flatMap(packageDir => [
		path.join(packageDir, "dist", "official-plugins"), // packaged copy (scripts/official-plugins.ts)
		path.join(packageDir, "plugins", "official"), // a package that ships the tree at its root
		path.resolve(packageDir, "../../../plugins/official"), // repository checkout
	]);
	return [...new Set(candidates)];
}

/** Candidate package roots for this module's directory (see {@link officialPluginsDirCandidates}). */
function packageDirCandidates(fromDir: string): string[] {
	return [
		path.dirname(fromDir), // <pkg>/dist, or <pkg>/src/extensibility/plugins
		path.resolve(fromDir, "../../../.."), // <pkg>, from src/extensibility/plugins/marketplace
		path.resolve(fromDir, "../../.."), // <pkg>, from src/extensibility/plugins
	];
}

/** Resolve the on-disk official plugin root, or null when this build ships manifests only. */
export function resolveOfficialPluginsDir(): string | null {
	const override = process.env[OFFICIAL_PLUGINS_DIR_ENV];
	if (override !== undefined) return override;
	for (const candidate of officialPluginsDirCandidates(import.meta.dir)) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/**
 * Read the built-in catalog's manifests.
 *
 * The shipped source tree wins when it is present; otherwise the manifest
 * snapshot answers, which is all a bundle or a standalone binary carries.
 * Returns `[]` when this build ships neither — a bare library import, or a test
 * process that scoped the catalog to an empty directory.
 * Synchronous on purpose: the manifests are one small JSON per plugin, and every
 * caller (CLI startup, marketplace listing) wants them inline.
 */
export function readOfficialPluginManifests(): OfficialPluginManifest[] {
	const override = process.env[OFFICIAL_PLUGINS_DIR_ENV];
	const dir = resolveOfficialPluginsDir();
	if (dir !== null && existsSync(dir)) {
		const manifests = readManifestsFromDir(dir);
		if (manifests.length > 0) return manifests;
	}

	const embedded = process.env[OFFICIAL_PLUGINS_EMBED_ENV];
	if (embedded !== undefined) return snapshotManifests(readSnapshotText(embedded));
	// A configured root means the caller owns where the catalog lives: a dead
	// path is "no official plugins", not "probe the package for one".
	if (override !== undefined) return [];
	return snapshotManifests(readGeneratedSnapshot());
}

function snapshotManifests(snapshot: OfficialSnapshotFile | null): OfficialPluginManifest[] {
	return (snapshot?.plugins ?? [])
		.filter(plugin => isValidNameSegment(plugin.id))
		.sort((a, b) => a.id.localeCompare(b.id));
}

function readManifestsFromDir(dir: string): OfficialPluginManifest[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	const manifests: OfficialPluginManifest[] = [];
	for (const entry of entries.sort()) {
		if (entry.startsWith(".") || entry === "node_modules") continue;
		const pluginDir = path.join(dir, entry);
		const manifest = readManifestAt(pluginDir, entry);
		if (manifest) manifests.push(manifest);
	}
	return manifests;
}

function readManifestAt(pluginDir: string, id: string): OfficialPluginManifest | undefined {
	const raw = readJsonFile(path.join(pluginDir, "plugin.json"));
	if (!isJsonObject(raw)) return undefined;
	if (raw.distribution !== OFFICIAL_DISTRIBUTION) return undefined;
	if (!isValidNameSegment(id)) return undefined;

	// `package.json` carries the version this plugin is published and distributed
	// at; `plugin.json` may override it, matching the marketplace version rules.
	const pkg = readJsonFile(path.join(pluginDir, "package.json"));
	const pkgVersion = isJsonObject(pkg) && typeof pkg.version === "string" ? pkg.version : undefined;
	const declaredVersion = typeof raw.version === "string" && raw.version.length > 0 ? raw.version : undefined;
	const version = declaredVersion ?? (pkgVersion && pkgVersion.length > 0 ? pkgVersion : "0.0.0");

	const manifest: OfficialPluginManifest = { id, dir: pluginDir, version };
	if (typeof raw.name === "string" && raw.name.length > 0) manifest.name = raw.name;
	if (typeof raw.description === "string" && raw.description.length > 0) manifest.description = raw.description;
	if (typeof raw.publish === "string" && raw.publish.length > 0) manifest.publish = raw.publish;
	if (typeof raw.install === "string" && raw.install.length > 0) manifest.install = raw.install;
	if (typeof raw.category === "string" && raw.category.length > 0) manifest.category = raw.category;
	if (typeof raw.source === "string" && raw.source.length > 0) manifest.source = raw.source;
	return manifest;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(filePath: string): unknown {
	try {
		return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
	} catch {
		return null;
	}
}

function readSnapshotText(text: string): OfficialSnapshotFile | null {
	try {
		return normalizeSnapshot(JSON.parse(text) as unknown);
	} catch {
		return null;
	}
}

function readGeneratedSnapshot(): OfficialSnapshotFile | null {
	for (const packageDir of packageDirCandidates(import.meta.dir)) {
		const parsed = readJsonFile(path.join(packageDir, "dist", OFFICIAL_CATALOG_FILE));
		if (parsed !== null) return normalizeSnapshot(parsed);
	}
	return null;
}

function normalizeSnapshot(value: unknown): OfficialSnapshotFile | null {
	if (!isJsonObject(value) || !Array.isArray(value.plugins)) return null;
	const plugins: OfficialPluginSnapshot[] = [];
	for (const raw of value.plugins) {
		if (!isJsonObject(raw) || typeof raw.id !== "string" || raw.id.length === 0) continue;
		const plugin: OfficialPluginSnapshot = {
			id: raw.id,
			version: typeof raw.version === "string" && raw.version.length > 0 ? raw.version : "0.0.0",
		};
		if (typeof raw.name === "string") plugin.name = raw.name;
		if (typeof raw.description === "string") plugin.description = raw.description;
		if (typeof raw.publish === "string") plugin.publish = raw.publish;
		if (typeof raw.install === "string") plugin.install = raw.install;
		if (typeof raw.category === "string") plugin.category = raw.category;
		if (typeof raw.source === "string") plugin.source = raw.source;
		plugins.push(plugin);
	}
	return { version: 1, plugins };
}

/**
 * Catalog entries for the built-in marketplace.
 *
 * A plugin with an on-disk directory gets a relative source, so installing it is
 * the ordinary offline marketplace install. A plugin this build ships only as a
 * manifest advertises its published npm package instead — the install then fails
 * with the npm-source message rather than pretending a directory exists.
 */
export function officialCatalogEntries(
	manifests: readonly OfficialPluginManifest[] = readOfficialPluginManifests(),
): MarketplacePluginEntry[] {
	return manifests.map(manifest => {
		const entry: MarketplacePluginEntry = {
			name: manifest.id,
			source: manifest.dir
				? `./${manifest.id}`
				: {
						source: "npm" as const,
						package: manifest.publish ?? manifest.id,
						version: manifest.version,
					},
			version: manifest.version,
			...(manifest.description !== undefined && { description: manifest.description }),
			category: manifest.category ?? "official",
		};
		if (manifest.source !== undefined) entry.homepage = manifest.source;
		return entry;
	});
}

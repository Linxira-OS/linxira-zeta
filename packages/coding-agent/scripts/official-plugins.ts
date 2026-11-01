#!/usr/bin/env bun
/**
 * Official plugin packaging for the coding-agent npm bundle.
 *
 * The built-in `official` catalog is derived from the shipped
 * `plugins/official/<id>/plugin.json` manifests (a plugin joins it by declaring
 * `"distribution": "bundled"`), and the coding-agent package ships those plugin
 * trees verbatim so an npm install can materialize them offline:
 *
 *   dist/official-plugins/<id>/…          the plugin sources
 *   dist/official-plugins.generated.json  the manifest snapshot (no sources)
 *
 * `bundleDist` calls {@link writeOfficialPluginsBundle} at prepack, and both the
 * npm bundle and the standalone binary embed the snapshot through
 * `process.env.ZETA_OFFICIAL_PLUGINS_EMBED`, so a build whose source copy is
 * missing still lists the official catalog (see
 * `src/extensibility/plugins/marketplace/official-catalog.ts`).
 *
 * Nothing here decides what "official" means: the manifests do. This file only
 * reads them, copies the trees, and serializes the snapshot.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** `plugins/official` in the repository checkout (`plugins/*` is a workspace member). */
export const OFFICIAL_PLUGINS_SOURCE_DIR = path.resolve(import.meta.dir, "../../../plugins/official");

/** Directory the plugin trees are copied to, relative to the package `dist/`. */
export const OFFICIAL_PLUGINS_DIST_DIR = "official-plugins";

/** Manifest snapshot file name, written beside the copied trees. */
export const OFFICIAL_CATALOG_FILE = "official-plugins.generated.json";

/** The `plugin.json` marker that makes a plugin part of the built-in catalog. */
const DISTRIBUTION_MARKER = "bundled";

/** Never copied into the package: plugin tests and any resolved dependencies. */
const COPY_EXCLUDE: Record<string, true> = { node_modules: true, tests: true };

/**
 * Copied even when `package.json#files` omits them: the catalog reads both, and
 * neither is publishable content the plugin lists for its own npm package.
 */
const ALWAYS_COPY: Record<string, true> = { "plugin.json": true, "package.json": true };

export interface OfficialPluginSnapshot {
	id: string;
	version: string;
	name?: string;
	description?: string;
	publish?: string;
	install?: string;
	category?: string;
	source?: string;
}

interface OfficialPluginSource {
	id: string;
	dir: string;
	snapshot: OfficialPluginSnapshot;
	/** What the plugin publishes, from `package.json#files`; null copies the whole tree. */
	selector: FilesSelector | null;
}

/** Decide what a plugin's published payload contains (see {@link compileFilesSelector}). */
interface FilesSelector {
	keep(relativePath: string): boolean;
}

/**
 * Keep-set derived from a plugin's own `package.json#files`.
 *
 * The supported forms are the ones plugin packages use: exact relative paths,
 * `dir/**` (a directory subtree), and `*.ext` (top-level files). `plugin.json`
 * and `package.json` are always kept — the catalog needs both, and plugins
 * normally leave them out of their publish list. A package with no `files` list
 * copies its whole tree.
 */
function compileFilesSelector(pkg: unknown): FilesSelector | null {
	if (!isJsonObject(pkg) || !Array.isArray(pkg.files)) return null;
	const exact: Record<string, true> = { ...ALWAYS_COPY };
	const prefixes: string[] = [];
	const rootExtensions: string[] = [];
	let patterns = 0;
	for (const entry of pkg.files) {
		if (typeof entry !== "string") continue;
		const normalized = entry.replace(/\\/g, "/").replace(/^\.\//, "");
		if (normalized.length === 0) continue;
		patterns++;
		if (normalized.endsWith("/**")) {
			prefixes.push(normalized.slice(0, -3));
		} else if (normalized.startsWith("*.")) {
			rootExtensions.push(normalized.slice(1));
		} else {
			exact[normalized] = true;
		}
	}
	if (patterns === 0) return null;

	const exactPaths = Object.keys(exact);
	return {
		keep(relativePath: string): boolean {
			const normalized = relativePath.split(path.sep).join("/");
			if (exact[normalized] === true) return true;
			if (prefixes.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`))) return true;
			// `fs.cp` asks about a directory before its contents: keep every ancestor of
			// a kept path, or the walk never reaches the file inside it.
			if (prefixes.some(prefix => prefix.startsWith(`${normalized}/`))) return true;
			if (exactPaths.some(exactPath => exactPath.startsWith(`${normalized}/`))) return true;
			return !normalized.includes("/") && rootExtensions.some(extension => normalized.endsWith(extension));
		},
	};
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(filePath: string): unknown {
	try {
		return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
	} catch {
		return null;
	}
}

/** Every bundled official plugin in the checkout, ordered by id. */
export function readOfficialPluginSources(sourceDir: string = OFFICIAL_PLUGINS_SOURCE_DIR): OfficialPluginSource[] {
	if (!existsSync(sourceDir)) return [];
	const sources: OfficialPluginSource[] = [];
	for (const entry of readdirSync(sourceDir).sort()) {
		if (entry.startsWith(".") || entry === "node_modules") continue;
		const dir = path.join(sourceDir, entry);
		const manifest = readJson(path.join(dir, "plugin.json"));
		if (!isJsonObject(manifest) || manifest.distribution !== DISTRIBUTION_MARKER) continue;
		const pkg = readJson(path.join(dir, "package.json"));
		const pkgVersion = isJsonObject(pkg) && typeof pkg.version === "string" ? pkg.version : undefined;
		const declaredVersion = typeof manifest.version === "string" ? manifest.version : undefined;
		const snapshot: OfficialPluginSnapshot = {
			id: entry,
			version: declaredVersion ?? (pkgVersion && pkgVersion.length > 0 ? pkgVersion : "0.0.0"),
		};
		if (typeof manifest.name === "string") snapshot.name = manifest.name;
		if (typeof manifest.description === "string") snapshot.description = manifest.description;
		if (typeof manifest.publish === "string") snapshot.publish = manifest.publish;
		if (typeof manifest.install === "string") snapshot.install = manifest.install;
		if (typeof manifest.category === "string") snapshot.category = manifest.category;
		if (typeof manifest.source === "string") snapshot.source = manifest.source;
		sources.push({ id: entry, dir, snapshot, selector: compileFilesSelector(pkg) });
	}
	return sources;
}

/** The manifest snapshot, as JSON, for `ZETA_OFFICIAL_PLUGINS_EMBED` and the `dist/` sidecar. */
export function buildOfficialCatalogPayload(
	sourceDir: string = OFFICIAL_PLUGINS_SOURCE_DIR,
): { payload: string; plugins: OfficialPluginSnapshot[] } {
	const plugins = readOfficialPluginSources(sourceDir).map(source => source.snapshot);
	return { payload: JSON.stringify({ version: 1, plugins }), plugins };
}

/** Top-level entries of a plugin tree that the package must not carry. */
function isCopyExcluded(relativePath: string): boolean {
	const first = relativePath.split(path.sep)[0];
	return first !== undefined && COPY_EXCLUDE[first] === true;
}

/** Copy the bundled plugin trees into `<outDir>/official-plugins/<id>`. */
export async function copyOfficialPlugins(
	outDir: string,
	sourceDir: string = OFFICIAL_PLUGINS_SOURCE_DIR,
): Promise<string[]> {
	const sources = readOfficialPluginSources(sourceDir);
	const targetRoot = path.join(outDir, OFFICIAL_PLUGINS_DIST_DIR);
	await fs.rm(targetRoot, { recursive: true, force: true });
	if (sources.length === 0) return [];
	await fs.mkdir(targetRoot, { recursive: true });
	const copied: string[] = [];
	for (const source of sources) {
		const target = path.join(targetRoot, source.id);
		await fs.cp(source.dir, target, {
			recursive: true,
			filter: sourcePath => {
				const relative = path.relative(source.dir, sourcePath);
				if (relative === "") return true;
				if (isCopyExcluded(relative)) return false;
				return source.selector === null || source.selector.keep(relative);
			},
		});
		copied.push(target);
	}
	return copied;
}

/** Write the manifest snapshot beside the copied trees. */
export async function writeOfficialCatalogPayload(
	outDir: string,
	sourceDir: string = OFFICIAL_PLUGINS_SOURCE_DIR,
): Promise<string> {
	const { payload } = buildOfficialCatalogPayload(sourceDir);
	const target = path.join(outDir, OFFICIAL_CATALOG_FILE);
	await Bun.write(target, `${payload}\n`);
	return target;
}

/** Both steps of the prepack packaging: the copied trees and the manifest snapshot. */
export async function writeOfficialPluginsBundle(
	outDir: string,
	sourceDir: string = OFFICIAL_PLUGINS_SOURCE_DIR,
): Promise<{ copied: string[]; catalog: string }> {
	const copied = await copyOfficialPlugins(outDir, sourceDir);
	const catalog = await writeOfficialCatalogPayload(outDir, sourceDir);
	return { copied, catalog };
}

if (import.meta.main) {
	const outDir = process.argv[2] ?? path.join(import.meta.dir, "..", "dist");
	const { copied, catalog } = await writeOfficialPluginsBundle(outDir);
	process.stdout.write(`Copied ${copied.length} official plugin(s) into ${outDir}\nCatalog: ${catalog}\n`);
}

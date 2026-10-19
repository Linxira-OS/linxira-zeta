/**
 * Plugin message catalogues for `ctx.t()`.
 *
 * A plugin declares per-language JSON files in its manifest:
 *
 * ```json
 * { "zeta": { "version": "1.0.0", "locales": { "zh": "locales/zh.json", "en": "locales/en.json" } } }
 * ```
 *
 * When the manifest omits `locales`, the conventional `locales/zh.json` and
 * `locales/en.json` files are used if they exist, matching the reserved
 * directory the plugin template documents. Files must contain a flat
 * `Record<string, string>`; malformed or non-string content is skipped with a
 * warning so one bad catalogue cannot keep the plugin from loading.
 *
 * Lookup order is `current host language → en → caller fallback → key`, read
 * on every call so a `/language` switch takes effect without reloading
 * plugins.
 */
import * as path from "node:path";
import { isRecord, logger } from "@linxiraos/pi-utils";
import { currentLanguage, LANGUAGE_TAGS, type ZetaLanguage } from "../../i18n";
import { parsePluginLocales } from "./parser";
import type { PluginManifest } from "./types";

/** A flat key → translated string table for one language. */
export type PluginMessageTable = Readonly<Record<string, string>>;

/** Lookup surface injected into an extension's `ctx.t()`. */
export interface PluginLocaleCatalog {
	/** Parsed tables by language tag (absent language = no catalogue shipped). */
	readonly tables: Partial<Record<ZetaLanguage, PluginMessageTable>>;
	/** Translate `key`, falling back to `fallback`, then to the key itself. */
	t(key: string, fallback?: string): string;
}

/** Minimum shape a plugin needs to contribute catalogues. */
export interface PluginLocaleSource {
	path: string;
	manifest: PluginManifest;
}

type LocaleCache = Map<string, Promise<PluginLocaleCatalog | undefined>>;

const catalogCache: LocaleCache = new Map();

/** Drop cached catalogues (plugin discovery cache invalidation). */
export function clearPluginLocaleCache(): void {
	catalogCache.clear();
}

/**
 * Resolve `key` against `tables`: current language first, then `en`, then the
 * caller's fallback, then the key. `language` defaults to the live host
 * language so callers get `/language` refresh for free.
 */
export function translatePluginMessage(
	tables: Partial<Record<ZetaLanguage, PluginMessageTable>>,
	key: string,
	fallback?: string,
	language: ZetaLanguage = currentLanguage(),
): string {
	const localized = tables[language]?.[key];
	if (typeof localized === "string") return localized;
	const english = tables.en?.[key];
	if (typeof english === "string") return english;
	return fallback ?? key;
}

/**
 * Read one catalogue file. Returns `undefined` for a missing conventional file,
 * and warns (still returning `undefined`) for a declared-but-missing file,
 * malformed JSON, or a non-flat/non-string table.
 */
async function readLocaleTable(
	filePath: string,
	options: { declaredPath: boolean; pluginName: string },
): Promise<PluginMessageTable | undefined> {
	let text: string;
	try {
		text = await Bun.file(filePath).text();
	} catch (error) {
		if (options.declaredPath) {
			logger.warn("plugins: locale catalogue declared but unreadable", {
				plugin: options.pluginName,
				path: filePath,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		logger.warn("plugins: malformed locale catalogue", {
			plugin: options.pluginName,
			path: filePath,
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}

	if (!isRecord(parsed)) {
		logger.warn("plugins: locale catalogue must be a flat JSON object", {
			plugin: options.pluginName,
			path: filePath,
		});
		return undefined;
	}

	const table: Record<string, string> = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (typeof value !== "string") {
			logger.warn("plugins: locale catalogue values must be strings", {
				plugin: options.pluginName,
				path: filePath,
				key,
				valueType: value === null ? "null" : typeof value,
			});
			return undefined;
		}
		table[key] = value;
	}
	return table;
}

/** Resolve a declared catalogue path, rejecting escapes from the plugin root. */
function resolveDeclaredPath(root: string, declared: string): string | undefined {
	const resolved = path.resolve(root, declared);
	const relative = path.relative(root, resolved);
	if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return resolved;
	return undefined;
}

async function readPluginLocaleCatalog(source: PluginLocaleSource): Promise<PluginLocaleCatalog | undefined> {
	const root = path.resolve(source.path);
	const parsed = parsePluginLocales(source.manifest.locales);
	if (!parsed.ok) {
		logger.warn("plugins: invalid locales declaration", {
			plugin: source.manifest.name ?? root,
			error: parsed.error,
		});
		return undefined;
	}

	const tables: Partial<Record<ZetaLanguage, PluginMessageTable>> = {};
	for (const language of LANGUAGE_TAGS) {
		const declared = parsed.locales[language];
		if (declared !== undefined) {
			const filePath = resolveDeclaredPath(root, declared);
			if (!filePath) {
				logger.warn("plugins: locale catalogue path escapes the plugin root", {
					plugin: source.manifest.name ?? root,
					locales: declared,
				});
				continue;
			}
			const table = await readLocaleTable(filePath, {
				declaredPath: true,
				pluginName: source.manifest.name ?? root,
			});
			if (table) tables[language] = table;
			continue;
		}

		const conventional = path.join(root, "locales", `${language}.json`);
		const table = await readLocaleTable(conventional, {
			declaredPath: false,
			pluginName: source.manifest.name ?? root,
		});
		if (table) tables[language] = table;
	}

	return Object.keys(tables).length > 0
		? { tables, t: (key, fallback) => translatePluginMessage(tables, key, fallback) }
		: undefined;
}

/**
 * Load (and cache) a plugin's catalogues. The cache is keyed by the plugin
 * root; {@link clearPluginLocaleCache} drops it when plugin discovery is
 * invalidated. A plugin without catalogues resolves to `undefined`, which
 * keeps `ctx.t()` on its no-catalogue behaviour.
 */
export function loadPluginLocaleCatalog(source: PluginLocaleSource): Promise<PluginLocaleCatalog | undefined> {
	const root = path.resolve(source.path);
	const cached = catalogCache.get(root);
	if (cached) return cached;
	const loading = readPluginLocaleCatalog(source);
	catalogCache.set(root, loading);
	return loading;
}

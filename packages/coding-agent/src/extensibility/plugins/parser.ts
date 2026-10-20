import {
	PLUGIN_DECLARATIVE_PANEL_KINDS,
	PLUGIN_PANEL_KINDS,
	type PluginLocalePaths,
	type PluginPanel,
	type PluginPanelKind,
	type PluginPanelToolSource,
	type PluginUi,
} from "./types";

/**
 * Feature bracket parser for plugin specifiers.
 *
 * Supports syntax like:
 * - "my-plugin" -> base features (null)
 * - "my-plugin[search,web]" -> specific features
 * - "my-plugin[*]" -> all features
 * - "my-plugin[]" -> no optional features
 * - "@scope/plugin@1.2.3[feat]" -> scoped with version and features
 */

export interface ParsedPluginSpec {
	/** Package name (may include version specifier like @1.0.0) */
	packageName: string;
	/**
	 * Feature selection:
	 * - null: use defaults (base features on first install, preserve on reinstall)
	 * - "*": all features
	 * - string[]: specific features (empty array = no optional features)
	 */
	features: string[] | null | "*";
}

/**
 * Parse plugin specifier with feature bracket syntax.
 *
 * @example
 * parsePluginSpec("my-plugin") // { packageName: "my-plugin", features: null }
 * parsePluginSpec("my-plugin[search,web]") // { packageName: "my-plugin", features: ["search", "web"] }
 * parsePluginSpec("my-plugin[*]") // { packageName: "my-plugin", features: "*" }
 * parsePluginSpec("my-plugin[]") // { packageName: "my-plugin", features: [] }
 * parsePluginSpec("@scope/pkg@1.2.3[feat]") // { packageName: "@scope/pkg@1.2.3", features: ["feat"] }
 */
export function parsePluginSpec(spec: string): ParsedPluginSpec {
	// Find the last bracket pair (to handle version specifiers like @1.0.0)
	const bracketStart = spec.lastIndexOf("[");
	const bracketEnd = spec.lastIndexOf("]");

	// No brackets or malformed -> base features
	if (bracketStart === -1 || bracketEnd === -1 || bracketEnd < bracketStart) {
		return { packageName: spec, features: null };
	}

	const packageName = spec.slice(0, bracketStart);
	const featureStr = spec.slice(bracketStart + 1, bracketEnd).trim();

	// All features
	if (featureStr === "*") {
		return { packageName, features: "*" };
	}

	// No optional features
	if (featureStr === "") {
		return { packageName, features: [] };
	}

	// Specific features (comma-separated)
	const features = featureStr
		.split(",")
		.map(f => f.trim())
		.filter(Boolean);

	return { packageName, features };
}

/**
 * Format a parsed plugin spec back to string form.
 *
 * @example
 * formatPluginSpec({ packageName: "pkg", features: null }) // "pkg"
 * formatPluginSpec({ packageName: "pkg", features: "*" }) // "pkg[*]"
 * formatPluginSpec({ packageName: "pkg", features: [] }) // "pkg[]"
 * formatPluginSpec({ packageName: "pkg", features: ["a", "b"] }) // "pkg[a,b]"
 */
export function formatPluginSpec(spec: ParsedPluginSpec): string {
	if (spec.features === null) {
		return spec.packageName;
	}
	if (spec.features === "*") {
		return `${spec.packageName}[*]`;
	}
	if (spec.features.length === 0) {
		return `${spec.packageName}[]`;
	}
	return `${spec.packageName}[${spec.features.join(",")}]`;
}

/**
 * Extract the dependency key from an npm package specifier.
 * Used for path lookups after npm install.
 *
 * @example
 * extractPackageName("lodash@4.17.21") // "lodash"
 * extractPackageName("@scope/pkg@1.0.0") // "@scope/pkg"
 * extractPackageName("@scope/pkg") // "@scope/pkg"
 * extractPackageName("npm:lodash") // "lodash"
 */
export function extractPackageName(specifier: string): string {
	const npmSpecifier = specifier.replace(/^npm:/i, "");
	// Handle scoped packages: @scope/name@version -> @scope/name
	if (npmSpecifier.startsWith("@")) {
		const match = npmSpecifier.match(/^(@[^/]+\/[^@]+)/);
		return match ? match[1] : npmSpecifier;
	}
	// Unscoped: name@version -> name
	return npmSpecifier.replace(/@[^@]+$/, "");
}

/** Language tags a plugin manifest may declare a message catalogue for. */
export const PLUGIN_LOCALE_TAGS = ["zh", "en"] as const;

export type PluginLocaleTag = (typeof PLUGIN_LOCALE_TAGS)[number];

const PLUGIN_LOCALE_TAG_SET: Readonly<Record<PluginLocaleTag, true>> = { zh: true, en: true };

/** Outcome of validating a manifest's `locales` declaration. */
export type PluginLocalesParseResult = { ok: true; locales: PluginLocalePaths } | { ok: false; error: string };

function describeValue(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "an array";
	return typeof value;
}

/**
 * Validate a plugin manifest's `locales` field.
 *
 * The declaration must map supported language tags to catalogue file paths:
 * `{ "zh": "locales/zh.json", "en": "locales/en.json" }`. Anything else is
 * reported as a parse error naming the offending entry, so a typo in a
 * manifest surfaces as a diagnostic instead of silently disabling translation.
 */
export function parsePluginLocales(value: unknown): PluginLocalesParseResult {
	if (value === undefined) return { ok: true, locales: {} };
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return { ok: false, error: `\`locales\` must be an object, got ${describeValue(value)}` };
	}

	const locales: PluginLocalePaths = {};
	for (const [tag, entry] of Object.entries(value as Record<string, unknown>)) {
		if (!Object.hasOwn(PLUGIN_LOCALE_TAG_SET, tag)) {
			return {
				ok: false,
				error: `\`locales.${tag}\` is not a supported language (expected one of: ${PLUGIN_LOCALE_TAGS.join(", ")})`,
			};
		}
		if (typeof entry !== "string") {
			return {
				ok: false,
				error: `\`locales.${tag}\` must be a string path to a JSON catalogue, got ${describeValue(entry)}`,
			};
		}
		if (entry.trim() === "") {
			return { ok: false, error: `\`locales.${tag}\` must not be empty` };
		}
		locales[tag as PluginLocaleTag] = entry;
	}
	return { ok: true, locales };
}

/** Panel ids are URL-ish: lowercase, digits and `-`, starting alphanumeric. */
const PLUGIN_PANEL_ID = /^[a-z0-9][a-z0-9-]*$/;

const PLUGIN_PANEL_KIND_SET: Readonly<Record<PluginPanelKind, true>> = {
	list: true,
	form: true,
	chart: true,
	html: true,
};

const DECLARATIVE_PANEL_KIND_SET: Readonly<Record<string, true>> = Object.fromEntries(
	PLUGIN_DECLARATIVE_PANEL_KINDS.map(kind => [kind, true]),
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Outcome of validating a manifest's `ui` declaration. */
export type PluginUiParseResult = { ok: true; ui: PluginUi } | { ok: false; error: string };

/**
 * Validate one declarative panel's `source`: the tool call that produces the
 * panel's data, plus optional arguments.
 */
function parsePanelSource(
	entry: Record<string, unknown>,
	at: string,
): { ok: true; source: PluginPanelToolSource } | { ok: false; error: string } {
	const source = entry.source;
	if (!isPlainObject(source)) {
		return {
			ok: false,
			error: `\`${at}.source\` must be an object naming the \`tool\` that produces the panel's data, got ${describeValue(source)}`,
		};
	}
	const tool = source.tool;
	if (typeof tool !== "string" || tool.trim() === "") {
		return {
			ok: false,
			error: `\`${at}.source.tool\` must be a non-empty tool name, got ${describeValue(tool)}`,
		};
	}
	const args = source.args;
	if (args !== undefined && !isPlainObject(args)) {
		return {
			ok: false,
			error: `\`${at}.source.args\` must be an object, got ${describeValue(args)}`,
		};
	}
	return { ok: true, source: args === undefined ? { tool: tool.trim() } : { tool: tool.trim(), args } };
}

/** Validate the `columns` hint of a list panel. */
function parsePanelColumns(
	entry: Record<string, unknown>,
	at: string,
): { ok: true; columns?: string[] } | { ok: false; error: string } {
	const columns = entry.columns;
	if (columns === undefined) return { ok: true };
	if (!Array.isArray(columns)) {
		return {
			ok: false,
			error: `\`${at}.columns\` must be an array of row keys, got ${describeValue(columns)}`,
		};
	}
	const keys: string[] = [];
	for (const [index, key] of columns.entries()) {
		if (typeof key !== "string" || key.trim() === "") {
			return {
				ok: false,
				error: `\`${at}.columns[${index}]\` must be a non-empty row key, got ${describeValue(key)}`,
			};
		}
		keys.push(key.trim());
	}
	return { ok: true, columns: keys };
}

/**
 * Validate an html panel's `entry`: a package-relative `.html` path the web-ui
 * page host can address (`/plugins/view/<plugin>/<page>`).
 */
function parsePanelEntry(
	entry: Record<string, unknown>,
	at: string,
): { ok: true; entry: string } | { ok: false; error: string } {
	const value = entry.entry;
	if (typeof value !== "string" || value.trim() === "") {
		return {
			ok: false,
			error: `\`${at}.entry\` must be a non-empty path to an .html file inside the plugin package, got ${describeValue(value)}`,
		};
	}
	const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
	if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
		return { ok: false, error: `\`${at}.entry\` must be relative to the plugin root, got ${value}` };
	}
	if (normalized.split("/").includes("..")) {
		return { ok: false, error: `\`${at}.entry\` must not leave the plugin package, got ${value}` };
	}
	if (!/\.html?$/i.test(normalized)) {
		return { ok: false, error: `\`${at}.entry\` must name an .html file, got ${value}` };
	}
	return { ok: true, entry: normalized };
}

function parsePanel(entry: unknown, at: string): { ok: true; panel: PluginPanel } | { ok: false; error: string } {
	if (!isPlainObject(entry)) {
		return { ok: false, error: `\`${at}\` must be an object, got ${describeValue(entry)}` };
	}
	const kind = entry.kind;
	if (typeof kind !== "string" || !Object.hasOwn(PLUGIN_PANEL_KIND_SET, kind)) {
		return {
			ok: false,
			error: `\`${at}.kind\` must be one of: ${PLUGIN_PANEL_KINDS.join(", ")} — got ${describeValue(kind)}`,
		};
	}
	const id = entry.id;
	if (typeof id !== "string" || !PLUGIN_PANEL_ID.test(id)) {
		return {
			ok: false,
			error: `\`${at}.id\` must match ${PLUGIN_PANEL_ID.source}, got ${describeValue(id)}`,
		};
	}
	const title = entry.title;
	if (typeof title !== "string" || title.trim() === "") {
		return {
			ok: false,
			error: `\`${at}.title\` must be a non-empty string, got ${describeValue(title)}`,
		};
	}
	const base = { id, title: title.trim() };

	if (Object.hasOwn(DECLARATIVE_PANEL_KIND_SET, kind)) {
		const source = parsePanelSource(entry, at);
		if (!source.ok) return source;
		const columns = parsePanelColumns(entry, at);
		if (!columns.ok) return columns;
		if (kind !== "list" && columns.columns !== undefined) {
			return { ok: false, error: `\`${at}.columns\` is only meaningful for a list panel, this one is a ${kind}` };
		}
		if (kind === "list") {
			return {
				ok: true,
				panel:
					columns.columns === undefined
						? { ...base, kind: "list", source: source.source }
						: { ...base, kind: "list", source: source.source, columns: columns.columns },
			};
		}
		return { ok: true, panel: { ...base, kind: kind === "form" ? "form" : "chart", source: source.source } };
	}

	if (entry.source !== undefined) {
		return {
			ok: false,
			error: `\`${at}.source\` is only for list/form/chart panels; an html panel navigates to \`entry\``,
		};
	}
	const entryPath = parsePanelEntry(entry, at);
	if (!entryPath.ok) return entryPath;
	return { ok: true, panel: { ...base, kind: "html", entry: entryPath.entry } };
}

/**
 * Validate a plugin manifest's `ui` field.
 *
 * Every rejected shape names the entry that is wrong (`ui.panels[2].kind`,
 * `ui.panels[0].source.tool`, …), so a typo in a manifest is a diagnostic
 * instead of a panel that silently never appears. `undefined` is valid and
 * means "no panels", which is what every plugin that predates this field
 * declares.
 */
export function parsePluginUi(value: unknown): PluginUiParseResult {
	if (value === undefined) return { ok: true, ui: {} };
	if (!isPlainObject(value)) {
		return { ok: false, error: `\`ui\` must be an object, got ${describeValue(value)}` };
	}

	const rawPanels = value.panels;
	if (rawPanels === undefined) return { ok: true, ui: {} };
	if (!Array.isArray(rawPanels)) {
		return { ok: false, error: `\`ui.panels\` must be an array, got ${describeValue(rawPanels)}` };
	}

	const panels: PluginPanel[] = [];
	const seen = new Set<string>();
	for (const [index, raw] of rawPanels.entries()) {
		const at = `ui.panels[${index}]`;
		const parsed = parsePanel(raw, at);
		if (!parsed.ok) return parsed;
		if (seen.has(parsed.panel.id)) {
			return { ok: false, error: `\`${at}.id\` duplicates the panel id "${parsed.panel.id}"` };
		}
		seen.add(parsed.panel.id);
		panels.push(parsed.panel);
	}
	return { ok: true, ui: { panels } };
}

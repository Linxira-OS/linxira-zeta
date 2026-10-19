import type { PluginLocalePaths } from "./types";

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

function describeLocaleValue(value: unknown): string {
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
		return { ok: false, error: `\`locales\` must be an object, got ${describeLocaleValue(value)}` };
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
				error: `\`locales.${tag}\` must be a string path to a JSON catalogue, got ${describeLocaleValue(entry)}`,
			};
		}
		if (entry.trim() === "") {
			return { ok: false, error: `\`locales.${tag}\` must not be empty` };
		}
		locales[tag as PluginLocaleTag] = entry;
	}
	return { ok: true, locales };
}

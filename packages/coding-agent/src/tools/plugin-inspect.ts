import * as path from "node:path";
import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/pi-omptype";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { isEnoent } from "@linxiraos/pi-utils";
import { PluginManager, validateSetting } from "../extensibility/plugins/manager";
import { resolvePluginManifestEntries } from "../extensibility/plugins/loader";
import { parsePluginLocales, parsePluginUi } from "../extensibility/plugins/parser";
import type { InstalledPlugin, PluginManifest, PluginSettingSchema } from "../extensibility/plugins/types";
import pluginInspectDescription from "../prompts/tools/plugin-inspect.md" with { type: "text" };
import type { ToolSession } from ".";
import { assertMainAgentSession, readInstalledPluginDependencies, resolvePluginSource } from "./plugin-tool-shared";

const pluginInspectSchema = type({
	name: type("string").describe("Installed plugin package name (as shown by plugin_manager list)"),
	"path?": type("string").describe(
		"Optional plugin directory, absolute or relative to the session cwd, for a package outside the normal lookup roots",
	),
});

export type PluginInspectParams = typeof pluginInspectSchema.infer;

/** One manifest setting, flattened for a compact schema summary. */
export interface PluginInspectSetting {
	key: string;
	type: string;
	default?: unknown;
	description?: string;
	secret?: boolean;
	env?: string;
	values?: string[];
	min?: number;
	max?: number;
}

export interface PluginInspectFeature {
	name: string;
	description?: string;
	default: boolean;
	enabled: boolean;
	extensions: number;
	tools: number;
	hooks: number;
	commands: number;
}

/** What the plugin can contribute, counted from resolved manifest entries. */
export interface PluginInspectCapabilities {
	extensions: string[];
	tools: string[];
	hooks: string[];
	commands: string[];
	features: number;
	settings: number;
	locales: string[];
	panels: number;
}

export interface PluginInspectDetails {
	name: string;
	version: string;
	source: string;
	path: string;
	enabled: boolean;
	enabledFeatures: string[] | null;
	identity: { name: string; version: string; description?: string };
	/** Installation context: where it lives, whether it loads, and how it is configured. */
	background: {
		enabled: boolean;
		source: string;
		path: string;
		enabledFeatures: string[] | null;
		hasUi: boolean;
	};
	features: PluginInspectFeature[];
	capabilities: PluginInspectCapabilities;
	entry: Record<string, string[]>;
	entries: Array<{ kind: "extensions" | "tools" | "hooks" | "commands"; entry: string; resolvedPath: string | null }>;
	dependencies: Record<string, string>;
	peerDependencies: Record<string, string>;
	settings: PluginInspectSetting[];
	validation: { valid: boolean; errors: string[] };
}

const ENTRY_KINDS = ["extensions", "tools", "hooks", "commands"] as const;
/** Runtime guard: manifest settings come from JSON, not the TypeScript type. */
const SETTING_TYPES: Record<string, true> = { string: true, number: true, boolean: true, enum: true };

function settingTypeOf(schema: PluginSettingSchema): string {
	const type: unknown = schema.type;
	return typeof type === "string" ? type : "";
}

/** Render a manifest entry (`string | string[] | undefined`) as the declared array it means. */
function declaredEntries(value: string | string[] | undefined): string[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function summarizeSetting(key: string, schema: PluginSettingSchema): PluginInspectSetting {
	const summary: PluginInspectSetting = {
		key,
		type: schema.type,
		description: schema.description,
		secret: schema.secret,
		env: schema.env,
	};
	if (schema.type === "enum") {
		summary.values = schema.values;
		summary.default = schema.default;
	} else if (schema.type === "number") {
		summary.default = schema.default;
		summary.min = schema.min;
		summary.max = schema.max;
	} else {
		summary.default = schema.default;
	}
	return summary;
}

/**
 * Main-agent-only, read-only plugin inspector. Reads the package manifest and
 * resolves declared entry paths on disk; never imports plugin code.
 */
export class PluginInspectTool implements AgentTool<typeof pluginInspectSchema, PluginInspectDetails> {
	readonly name = "plugin_inspect";
	readonly label = "Plugin Inspect";
	readonly summary = "Inspect one installed plugin's manifest, entries, settings, and validity";
	readonly description = pluginInspectDescription;
	readonly parameters = pluginInspectSchema;
	readonly strict = true;
	readonly approval = "read" as const;

	constructor(private readonly session: Pick<ToolSession, "cwd" | "taskDepth">) {}

	static createIf(session: ToolSession): PluginInspectTool {
		return new PluginInspectTool(session);
	}

	async execute(_id: string, params: PluginInspectParams): Promise<AgentToolResult<PluginInspectDetails>> {
		assertMainAgentSession(this.name, this.session.taskDepth);
		const name = params.name.trim();
		if (name.length === 0) throw new ToolError("name is required.");

		const manager = new PluginManager(this.session.cwd);
		const pluginPath = params.path ? path.resolve(this.session.cwd, params.path) : undefined;
		const plugin = await manager.getPlugin(name, pluginPath ? { path: pluginPath } : {});
		if (!plugin) {
			throw new ToolError(
				`Plugin "${name}" is not installed${pluginPath ? ` at ${pluginPath}` : ""}. Use plugin_manager action "list" to see installed plugins.`,
			);
		}

		const details = await inspectPlugin(manager, plugin);
		return { content: [{ type: "text", text: formatInspection(details) }], details };
	}
}

async function inspectPlugin(manager: PluginManager, plugin: InstalledPlugin): Promise<PluginInspectDetails> {
	const manifest = plugin.manifest;
	const errors: string[] = [];
	const dependencies = await readInstalledPluginDependencies();
	const source = await resolvePluginSource(plugin.name, plugin, dependencies);

	// The manifest entries the loader would follow for this plugin's current
	// feature selection, paired with the file each one resolves to.
	const entries = ENTRY_KINDS.flatMap(kind =>
		resolvePluginManifestEntries(plugin, kind).map(resolved => ({ kind, ...resolved })),
	);
	for (const entry of entries) {
		if (entry.resolvedPath === null) {
			errors.push(`declared ${entry.kind} entry not found on disk: ${entry.entry}`);
		}
	}
	const resolvedByKind = (kind: (typeof ENTRY_KINDS)[number]): string[] =>
		entries.flatMap(entry => (entry.kind === kind && entry.resolvedPath ? [entry.resolvedPath] : []));

	const featureNames = Object.keys(manifest.features ?? {});
	const activeFeatures =
		plugin.enabledFeatures === null
			? new Set(featureNames.filter(feature => manifest.features?.[feature]?.default === true))
			: new Set(plugin.enabledFeatures);
	const features = Object.entries(manifest.features ?? {}).map(([featureName, feature]) => ({
		name: featureName,
		description: feature.description,
		default: feature.default === true,
		enabled: activeFeatures.has(featureName),
		extensions: feature.extensions?.length ?? 0,
		tools: feature.tools?.length ?? 0,
		hooks: feature.hooks?.length ?? 0,
		commands: feature.commands?.length ?? 0,
	}));

	if (manifest.locales) {
		const parsed = parsePluginLocales(manifest.locales);
		if (!parsed.ok) errors.push(`locales: ${parsed.error}`);
	}
	if (manifest.ui) {
		const parsed = parsePluginUi(manifest.ui);
		if (!parsed.ok) errors.push(`ui: ${parsed.error}`);
	}

	const settingsSchema = manifest.settings ?? {};
	const settings: PluginInspectSetting[] = [];
	for (const [key, schema] of Object.entries(settingsSchema)) {
		const settingType = settingTypeOf(schema);
		if (SETTING_TYPES[settingType] !== true) {
			errors.push(`setting "${key}": unknown type "${settingType}"`);
		} else if (schema.type === "enum" && schema.values.length === 0) {
			errors.push(`setting "${key}": enum has no values`);
		}
		settings.push(summarizeSetting(key, schema));
	}

	// Current values are read-only validation: bad values in the lockfile are a
	// real "why is this plugin misbehaving" answer, and validating them never
	// imports the plugin.
	const currentSettings = await manager.getPluginSettings(plugin.name);
	for (const [key, schema] of Object.entries(settingsSchema)) {
		const value = currentSettings[key];
		if (value === undefined || SETTING_TYPES[settingTypeOf(schema)] !== true) continue;
		const result = validateSetting(value, schema);
		if (!result.valid) errors.push(`setting "${key}" value: ${result.error ?? "invalid"}`);
	}

	const packageJson = await readPluginPackageJson(plugin, errors);

	const capabilities: PluginInspectCapabilities = {
		extensions: resolvedByKind("extensions"),
		tools: resolvedByKind("tools"),
		hooks: resolvedByKind("hooks"),
		commands: resolvedByKind("commands"),
		features: featureNames.length,
		settings: Object.keys(settingsSchema).length,
		locales: manifest.locales ? Object.keys(manifest.locales) : [],
		panels: manifest.ui?.panels?.length ?? 0,
	};

	return {
		name: plugin.name,
		version: plugin.version,
		source,
		path: plugin.path,
		enabled: plugin.enabled,
		enabledFeatures: plugin.enabledFeatures,
		identity: {
			name: manifest.name ?? plugin.name,
			version: plugin.version,
			description: manifest.description,
		},
		background: {
			enabled: plugin.enabled,
			source,
			path: plugin.path,
			enabledFeatures: plugin.enabledFeatures,
			hasUi: manifest.ui !== undefined,
		},
		features,
		capabilities,
		entry: Object.fromEntries(ENTRY_KINDS.map(kind => [kind, declaredEntries(manifest[kind])])),
		entries,
		dependencies: packageJson.dependencies,
		peerDependencies: packageJson.peerDependencies,
		settings,
		validation: { valid: errors.length === 0, errors },
	};
}

interface PluginPackageDependencies {
	dependencies: Record<string, string>;
	peerDependencies: Record<string, string>;
}

async function readPluginPackageJson(plugin: InstalledPlugin, errors: string[]): Promise<PluginPackageDependencies> {
	try {
		const pkg = (await Bun.file(path.join(plugin.path, "package.json")).json()) as {
			dependencies?: Record<string, string>;
			peerDependencies?: Record<string, string>;
		};
		return { dependencies: pkg.dependencies ?? {}, peerDependencies: pkg.peerDependencies ?? {} };
	} catch (err) {
		if (!isEnoent(err)) errors.push(`package.json: ${err instanceof Error ? err.message : String(err)}`);
		return { dependencies: {}, peerDependencies: {} };
	}
}

function formatInspection(details: PluginInspectDetails): string {
	const lines = [
		`# ${details.name}@${details.version}${details.enabled ? "" : " (disabled)"}`,
		`source: ${details.source}`,
		`path: ${details.path}`,
	];
	if (details.identity.description) lines.push(`description: ${details.identity.description}`);

	if (details.features.length > 0) {
		lines.push(
			`features: ${details.features
				.map(feature => `${feature.name}${feature.default ? " (default)" : ""}${feature.enabled ? " [on]" : ""}`)
				.join(", ")}`,
		);
	}
	lines.push(
		`capabilities: ${details.capabilities.extensions.length} ext, ${details.capabilities.tools.length} tools, ${details.capabilities.hooks.length} hooks, ${details.capabilities.commands.length} commands, ${details.capabilities.settings} settings, ${details.capabilities.panels} panels`,
	);
	for (const kind of ENTRY_KINDS) {
		const declared = details.entry[kind] ?? [];
		if (declared.length === 0) continue;
		const resolved = details.entries.filter(entry => entry.kind === kind);
		lines.push(
			`entry.${kind}: ${resolved.map(entry => `${entry.entry} -> ${entry.resolvedPath ?? "MISSING"}`).join(", ")}`,
		);
	}
	const dependencyNames = Object.keys(details.dependencies);
	if (dependencyNames.length > 0) lines.push(`dependencies: ${dependencyNames.join(", ")}`);
	if (details.settings.length > 0) {
		lines.push(
			`settings: ${details.settings
				.map(setting => `${setting.key}:${setting.type}${setting.secret ? " (secret)" : ""}`)
				.join(", ")}`,
		);
	}
	lines.push(details.validation.valid ? "validation: ok" : `validation: ${details.validation.errors.length} error(s)`);
	for (const error of details.validation.errors) lines.push(`- ${error}`);
	return lines.join("\n");
}

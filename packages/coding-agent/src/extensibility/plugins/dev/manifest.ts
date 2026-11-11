/**
 * Dev-plugin scaffold and validation.
 *
 * Validation is static: it reads `package.json` / `plugin.json`, checks every
 * declared entry is contained and present, scans extension imports without
 * evaluating the module, and validates the manifest panel block with the same
 * parser the native hosts use. It never runs the extension factory.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readCatalogue, readPanelDeclaration } from "../panels";
import { PLUGIN_MANIFEST_KEYS, readPluginManifest, type PluginManifest, type PluginPackageJson } from "../types";
import { isWithin, resolveDevPluginPath, sessionDevRoot } from "./paths";

/** Files a scaffold writes, relative to the plugin root. */
export const SCAFFOLD_FILES = ["package.json", "plugin.json", "index.ts"] as const;

export interface DevPluginValidation {
	readonly ok: boolean;
	readonly name: string;
	readonly root: string;
	readonly manifest?: PluginManifest;
	readonly entry?: string;
	readonly pages: readonly { readonly id: string; readonly entry: string }[];
	readonly errors: readonly string[];
	readonly warnings: readonly string[];
}

export interface ScaffoldOptions {
	readonly description?: string;
	/** Tool name the generated read-only example registers, default `<name>_hello`. */
	readonly toolName?: string;
}

/** A created scaffold and the validation that immediately follows it. */
export interface ScaffoldResult {
	readonly root: string;
	readonly files: readonly string[];
	readonly validation: DevPluginValidation;
}

function readJsonFile(file: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Resolve a manifest-relative entry and prove it stays inside the plugin root. */
function resolveContainedEntry(root: string, entry: string): string | undefined {
	if (entry.length === 0 || entry.includes("\0")) return undefined;
	let normalized = entry.trim().replaceAll("\\", "/");
	// Manifest entries conventionally start with "./"; strip only that prefix,
	// never an interior dot segment (`pages/./x` stays invalid).
	while (normalized.startsWith("./")) normalized = normalized.slice(2);
	if (normalized === "" || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return undefined;
	const segments = normalized.split("/");
	if (segments.some(segment => segment === "" || segment === "." || segment === "..")) return undefined;
	const candidate = path.resolve(root, ...segments);
	return isWithin(candidate, root) ? candidate : undefined;
}

function checkExistingEntry(root: string, entry: string, field: string, errors: string[]): string | undefined {
	const resolved = resolveContainedEntry(root, entry);
	if (!resolved) {
		errors.push(`${field} "${entry}" must be a relative path inside the plugin.`);
		return undefined;
	}
	let stat: fs.Stats;
	try {
		stat = fs.statSync(resolved);
	} catch {
		errors.push(`${field} "${entry}" does not exist.`);
		return undefined;
	}
	if (!stat.isFile()) {
		errors.push(`${field} "${entry}" is not a file.`);
		return undefined;
	}
	return resolved;
}

/**
 * Scan a module's imports without executing it. Relative specifiers must
 * resolve to a file or a directory index; bare specifiers are left to the
 * runtime because a plugin may legitimately rely on the host's package graph.
 */
function scanImports(file: string, errors: string[]): void {
	let source: string;
	try {
		source = fs.readFileSync(file, "utf8");
	} catch {
		errors.push(`Cannot read ${path.basename(file)}.`);
		return;
	}
	let imports: Bun.Import[] = [];
	try {
		const loader = file.endsWith(".ts") || file.endsWith(".tsx") ? "ts" : "js";
		imports = new Bun.Transpiler({ loader }).scanImports(source);
	} catch (error) {
		errors.push(`Cannot parse ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	const root = path.dirname(file);
	for (const item of imports) {
		const specifier = item.path;
		if (!specifier.startsWith(".")) continue;
		const resolved = path.resolve(root, specifier);
		const candidates = [
			resolved,
			`${resolved}.ts`,
			`${resolved}.tsx`,
			`${resolved}.js`,
			path.join(resolved, "index.ts"),
			path.join(resolved, "index.js"),
		];
		if (!candidates.some(candidate => fs.existsSync(candidate))) {
			errors.push(`Import "${specifier}" in ${path.basename(file)} does not resolve.`);
		}
	}
}

/** Validate a dev plugin directory. Read-only: no file is created or changed. */
export function validateDevPluginDirectory(agentDir: string, sessionId: string, name: string): DevPluginValidation {
	const root = resolveDevPluginPath(agentDir, sessionId, name);
	const errors: string[] = [];
	const warnings: string[] = [];
	const pages: { id: string; entry: string }[] = [];

	if (!fs.existsSync(root)) {
		return { ok: false, name, root, pages, errors: [`Plugin "${name}" does not exist.`], warnings };
	}

	const pkg = readJsonFile(path.join(root, "package.json"));
	if (!isPlainObject(pkg)) {
		return { ok: false, name, root, pages, errors: ["package.json is missing or is not a JSON object."], warnings };
	}
	const manifest = readPluginManifest<PluginManifest>(pkg as PluginPackageJson);
	if (!manifest) {
		return {
			ok: false,
			name,
			root,
			pages,
			errors: [`package.json needs a "${PLUGIN_MANIFEST_KEYS.join('" / "')}" manifest block.`],
			warnings,
		};
	}
	if (typeof manifest.version !== "string" || manifest.version.trim().length === 0) {
		errors.push("The manifest needs a non-empty version.");
	}

	const entries = [
		...(Array.isArray(manifest.extensions) ? manifest.extensions.map(entry => ["extensions", entry] as const) : []),
		...(typeof manifest.tools === "string" ? ([["tools", manifest.tools]] as const) : []),
		...(typeof manifest.hooks === "string" ? ([["hooks", manifest.hooks]] as const) : []),
	];
	if (entries.length === 0) errors.push("The manifest declares no extensions, tools, or hooks.");

	let firstEntry: string | undefined;
	for (const [field, entry] of entries) {
		if (typeof entry !== "string" || entry.length === 0) {
			errors.push(`${field} entries must be non-empty strings.`);
			continue;
		}
		const resolved = checkExistingEntry(root, entry, `manifest ${field}`, errors);
		if (resolved && field === "extensions") {
			firstEntry ??= resolved;
			scanImports(resolved, errors);
		}
	}

	// The catalogue file is optional, but when present its panels must parse.
	const pluginJsonPath = path.join(root, "plugin.json");
	if (fs.existsSync(pluginJsonPath)) {
		const declaration = readPanelDeclaration(root);
		if (!declaration.ok) errors.push(declaration.error);
		else if (declaration.ui?.panels) {
			for (const panel of declaration.ui.panels) {
				if (panel.kind !== "html") continue;
				const resolved = checkExistingEntry(root, panel.entry, `page "${panel.id}"`, errors);
				if (resolved) pages.push({ id: panel.id, entry: panel.entry });
			}
		}
		const catalogueId = readCatalogue(root).id;
		if (catalogueId !== name) warnings.push(`Catalogue id "${catalogueId}" differs from directory "${name}".`);
	}

	// Any other package paths (commands, locales) must still stay contained.
	for (const command of manifest.commands ?? []) {
		checkExistingEntry(root, command, "manifest command", errors);
	}
	for (const locale of Object.values(manifest.locales ?? {})) {
		if (typeof locale === "string") checkExistingEntry(root, locale, "manifest locale", errors);
	}

	return {
		ok: errors.length === 0,
		name,
		root,
		manifest,
		entry: firstEntry,
		pages,
		errors,
		warnings,
	};
}

function scaffoldPackageJson(name: string, description: string): string {
	return `${JSON.stringify(
		{
			name: `zeta-dev-${name}`,
			version: "0.0.0",
			private: true,
			type: "module",
			zeta: {
				name,
				version: "0.0.0",
				description,
				extensions: ["./index.ts"],
			},
		},
		null,
		"\t",
	)}\n`;
}

function scaffoldPluginJson(name: string): string {
	return `${JSON.stringify(
		{
			id: name,
			name,
			version: "0.0.0",
			ui: {
				panels: [],
			},
		},
		null,
		"\t",
	)}\n`;
}

function scaffoldIndex(name: string, toolName: string): string {
	return `import type { ExtensionAPI } from "@linxiraos/zeta";

/**
 * Agent-authored development plugin "${name}".
 *
 * The tool is read-only so the lifecycle can be exercised without giving the
 * session a new mutation path. Add commands or started/ended handlers the same
 * way; the session reloads this module at the end of a turn when the files
 * change.
 */
export default function ${camelCase(name)}(pi: ExtensionAPI): void {
	const Type = pi.typebox.Type;
	pi.registerTool({
		name: "${toolName}",
		label: "${name}",
		description: "Read-only development probe for ${name}.",
		approval: "read",
		parameters: Type.Object({}),
		async execute() {
			return { content: [{ type: "text" as const, text: "${name} dev plugin is loaded." }] };
		},
	});
}
`;
}

function camelCase(name: string): string {
	const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
	const joined = parts
		.map((part, index) => (index === 0 ? part.toLowerCase() : part[0]!.toUpperCase() + part.slice(1)))
		.join("");
	return /^[a-zA-Z_$]/.test(joined) ? joined : `plugin${joined}`;
}

/**
 * Create a minimal package inside this session's development directory.
 * Returns a refusal when the plugin already exists; the caller decides whether
 * a user-facing overwrite is acceptable (the agent lifecycle never overwrites).
 */
export function scaffoldDevPlugin(
	agentDir: string,
	sessionId: string,
	name: string,
	options: ScaffoldOptions = {},
): ScaffoldResult {
	const root = resolveDevPluginPath(agentDir, sessionId, name);
	if (fs.existsSync(root)) throw new Error(`Plugin "${name}" already exists in this session.`);
	const sessionRoot = sessionDevRoot(agentDir, sessionId);
	if (!isWithin(root, sessionRoot)) throw new Error("Plugin path escapes the session development directory.");
	fs.mkdirSync(root, { recursive: true });
	const description = options.description?.trim() || `Development plugin ${name}`;
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 58);
	const toolName = options.toolName?.trim() || `${/^[a-z]/.test(slug) ? slug : `plugin_${slug}`}_hello`;
	if (!/^[a-z][a-z0-9_]{1,63}$/.test(toolName)) {
		removeScaffold(root, sessionRoot);
		throw new Error(`Invalid tool name "${toolName}".`);
	}
	try {
		fs.writeFileSync(path.join(root, "package.json"), scaffoldPackageJson(name, description), "utf8");
		fs.writeFileSync(path.join(root, "plugin.json"), scaffoldPluginJson(name), "utf8");
		fs.writeFileSync(path.join(root, "index.ts"), scaffoldIndex(name, toolName), "utf8");
	} catch (error) {
		removeScaffold(root, sessionRoot);
		throw error;
	}
	return { root, files: SCAFFOLD_FILES, validation: validateDevPluginDirectory(agentDir, sessionId, name) };
}

function removeScaffold(root: string, sessionRoot: string): void {
	try {
		// Scaffold only creates three files; avoid importing the recursive remover here.
		for (const file of SCAFFOLD_FILES) fs.rmSync(path.join(root, file), { force: true });
		fs.rmdirSync(root);
	} catch {
		// A partial scaffold is reported by validation; never widen deletion.
	}
	void sessionRoot;
}

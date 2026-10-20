/**
 * Declarative plugin panels — the host side.
 *
 * A panel is declared in the plugin's manifests (`plugin.json` → `ui.panels`,
 * or a `package.json` `zeta.ui` block) and filled by **one tool call** the
 * plugin itself registers. This module is what a headless host needs to do
 * that: read and validate the declaration, find the plugin, load its
 * extensions, run the data tool, and hand back `details` as JSON.
 *
 * Why a tool call and not an HTTP route: the data producer is already a tool
 * registration (one publish surface, not two), and the desktop must be able to
 * draw a panel with `zetacode serve` down — the gateway is the browser's
 * adapter, not a prerequisite for native panels.
 *
 * The rendering side lives in Rust (`main/crates/zetawork-gui/src/plugin_panels.rs`);
 * both validators must reject the same shapes, which is why the error strings
 * here come from {@link parsePluginUi} rather than a second implementation.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "../../extensibility/extensions/types";
import { loadExtensions } from "../../extensibility/extensions/loader";
import { loadPluginLocaleCatalog } from "./locales";
import { parsePluginUi } from "./parser";
import {
	readPluginManifest,
	type PluginManifest,
	type PluginPackageJson,
	type PluginPanel,
	type PluginStorage,
	type PluginUi,
} from "./types";

/** The `plugin.json` catalogue fields a panel host needs. */
export interface PluginCatalogue {
	id: string;
	name?: string;
	version?: string;
}

/** A validated panel declaration, with the file it came from. */
export type PanelDeclaration =
	| { ok: true; ui: PluginUi; source?: string }
	| { ok: false; error: string; source?: string };

function readJson(file: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

function asCatalogue(value: unknown): PluginCatalogue | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string" || !record.id.trim()) return undefined;
	return {
		id: record.id.trim(),
		name: typeof record.name === "string" ? record.name : undefined,
		version: typeof record.version === "string" ? record.version : undefined,
	};
}

/**
 * The plugin's catalogue identity: `plugin.json` first (what the native host
 * and the web pages address the plugin by), then the package name's basename,
 * then the directory name — the same precedence `web-ui/lib/plugin-pages.ts`
 * uses, so one plugin has one id on every surface.
 */
export function readCatalogue(pluginRoot: string): PluginCatalogue {
	const catalogue = asCatalogue(readJson(path.join(pluginRoot, "plugin.json")));
	if (catalogue) return catalogue;
	const pkg = readPackageJson(path.join(pluginRoot, "package.json"));
	const name = pkg?.name;
	return { id: typeof name === "string" && name.trim() ? path.basename(name.trim()) : path.basename(pluginRoot) };
}

/**
 * A `package.json` as far as a panel host reads it: the npm name and the
 * zeta/omp/pi manifest block.
 *
 * This is the one JSON boundary in the module; everything below narrows on it
 * with `in`/`typeof` instead of re-asserting shapes.
 */
function readPackageJson(file: string): (PluginPackageJson & { name?: unknown }) | undefined {
	const parsed = readJson(file);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
	return parsed as PluginPackageJson & { name?: unknown };
}

/**
 * Read and validate a plugin's panel declaration.
 *
 * Resolution order: `plugin.json` `ui`, then the package manifest's `zeta.ui`.
 * A plugin that declares neither has no panels — not an error.
 */
export function readPanelDeclaration(pluginRoot: string): PanelDeclaration {
	const catalogueFile = path.join(pluginRoot, "plugin.json");
	const catalogue = readJson(catalogueFile);
	if (catalogue && typeof catalogue === "object" && "ui" in catalogue) {
		const parsed = parsePluginUi(catalogue.ui);
		return parsed.ok
			? { ok: true, ui: parsed.ui, source: catalogueFile }
			: { ok: false, error: parsed.error, source: catalogueFile };
	}
	const pkgFile = path.join(pluginRoot, "package.json");
	const manifest = readPluginManifest(readPackageJson(pkgFile));
	if (manifest && typeof manifest === "object" && "ui" in manifest) {
		const parsed = parsePluginUi(manifest.ui);
		return parsed.ok
			? { ok: true, ui: parsed.ui, source: pkgFile }
			: { ok: false, error: parsed.error, source: pkgFile };
	}
	return { ok: true, ui: {} };
}

/** One panel filled with its tool's data. */
export interface PluginPanelData {
	plugin: string;
	panel: string;
	kind: PluginPanel["kind"];
	/** The tool's `details`, exactly as the plugin returned it. */
	data: unknown;
}

/** The argv the GUI runs for one panel; pure, so a test can pin it. */
export function panelCommandArgs(pluginId: string, panelId: string): string[] {
	return ["plugins", "panel", pluginId, panelId, "--json"];
}

/**
 * Run one declarative panel's data tool and return its `details`.
 *
 * The context handed to the tool is deliberately narrow: a panel-data tool is
 * a read-only producer, and a headless call has no session UI, no model turn
 * and no session manager. What it does get is what a producer legitimately
 * uses — `cwd`, the plugin's own `t()`, `hasUI: false`, and the plugin's
 * storage roots when the caller knows them.
 */
export async function readPanelData(
	pluginRoot: string,
	panelId: string,
	options: { cwd?: string; storage?: PluginStorage } = {},
): Promise<PluginPanelData> {
	const root = path.resolve(pluginRoot);
	const pluginId = readCatalogue(root).id;
	const declaration = readPanelDeclaration(root);
	if (!declaration.ok) throw new Error(declaration.error);
	const panel = declaration.ui.panels?.find(candidate => candidate.id === panelId);
	if (!panel) {
		const ids = declaration.ui.panels?.map(candidate => candidate.id) ?? [];
		throw new Error(
			ids.length === 0
				? `plugin ${pluginId} declares no panels (${declaration.source ?? "no manifest"})`
				: `plugin ${pluginId} has no panel "${panelId}" (declared: ${ids.join(", ")})`,
		);
	}
	if (panel.kind === "html") {
		// Nothing to run: the host navigates to the page. Returning the entry
		// keeps one output shape for every kind.
		return { plugin: pluginId, panel: panel.id, kind: panel.kind, data: { entry: panel.entry } };
	}

	const manifest: PluginManifest = {
		version: "0.0.0",
		...readPluginManifest(readPackageJson(path.join(root, "package.json"))),
	};
	const entries = manifest.extensions ?? [];
	if (entries.length === 0) {
		throw new Error(`plugin ${pluginId} declares no extensions, so ${panel.source.tool} cannot be loaded`);
	}

	const { extensions, errors } = await loadExtensions(
		entries.map(entry => path.resolve(root, entry)),
		root,
	);
	const tool = extensions
		.map(extension => extension.tools.get(panel.source.tool)?.definition)
		.find(definition => definition !== undefined);
	if (!tool) {
		const detail = errors.length > 0 ? `: ${errors.map(error => error.error).join("; ")}` : "";
		throw new Error(`plugin ${pluginId} registers no tool "${panel.source.tool}"${detail}`);
	}

	const catalog = await loadPluginLocaleCatalog({ path: root, manifest });
	// One boundary assertion, named: a headless call has no session UI, model or
	// session manager, so the context is exactly the slice a read-only producer
	// uses — `cwd`, the plugin's `t()`, `hasUI: false`, the storage roots the
	// caller knows, and a no-op notify. A tool that needs more is not a panel
	// data tool.
	const context = {
		cwd: options.cwd ?? root,
		hasUI: false,
		t: catalog?.t ?? ((key: string, fallback?: string) => fallback ?? key),
		storage: options.storage,
		ui: { notify: () => {} },
	} as unknown as ExtensionContext;
	const result = await tool.execute(`panel-${panel.id}`, panel.source.args ?? {}, undefined, undefined, context);
	return { plugin: pluginId, panel: panel.id, kind: panel.kind, data: result.details ?? null };
}

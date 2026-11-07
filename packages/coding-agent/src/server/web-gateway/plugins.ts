/**
 * Web Gateway plugin handlers.
 *
 * Semantic port of `web-ui/app/api/plugins/route.ts`. The OMP web-ui modeled
 * packages as `settings.packages` (global + project, per-kind resource
 * entries); zeta's runtime stores extension configuration in
 * `settings.extensions` (a single configured-path list) plus
 * `settings.disabledExtensions`. The gateway maps the web-ui package view
 * onto that runtime-native surface, preserving the UI/DTO contract:
 *
 * - listed packages come from the configured extension paths (project-scoped
 *   when the resolved path lives inside `cwd`) plus runtime plugin packages
 *   discovered by `DefaultPackageManager.resolve()`;
 * - install/remove/update persist configuration via `Settings.set()`, the
 *   same channel the CLI uses — there is no extra installer; packages that
 *   are configured but not present on disk show as `missing` with a warning,
 *   exactly like the OMP web-ui behave
 * - disable/enable toggle `disabledExtensions` entries.
 *
 * All mutations use an isolated Settings instance so the gateway never
 * touches the process-global settings singleton owned by the CLI session.
 */

import { cfgDisabledExtensions, cfgExtensions } from "../../extensibility/settings";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getAgentDir, getPluginsDir } from "@linxiraos/pi-utils";
import { Settings } from "../../config/settings";
import { resolveActiveProjectRegistryPath, resolveOrDefaultProjectRegistryPath } from "../../discovery/helpers";
import { PluginManager } from "../../extensibility/plugins/manager";
import {
	getInstalledPluginsRegistryPath,
	getMarketplacesCacheDir,
	getMarketplacesRegistryPath,
	getPluginsCacheDir,
} from "../../extensibility/plugins/marketplace/registry";
import { MarketplaceManager } from "../../extensibility/plugins/marketplace/manager";
import { readCatalogue, readDeclaredPanels } from "../../extensibility/plugins/panels";
import { setInstalledPluginEnabled } from "../../extensibility/plugins/toggle";
import { readPluginManifest, type PluginManifest } from "../../extensibility/plugins/types";
import { listInstalledPlugins } from "../../extensibility/plugins/loader";
import {
	DefaultPackageManager,
	type ResolvedPaths,
	type ResolvedResource,
} from "../../extensibility/legacy-pi-coding-agent-shim";
import type {
	PluginDiagnostic,
	PluginPackageInfo,
	PluginResourceCounts,
	PluginResourceInfo,
	PluginResourceKind,
	PluginScope,
	PluginsResponse,
	ZetaPluginInfo,
	ZetaPluginPanelInfo,
	ZetaPluginSourceKind,
} from "./dto";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

function isDirectory(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function emptyCounts(): PluginResourceCounts {
	return { extensions: 0, skills: 0, prompts: 0, themes: 0 };
}

function toPluginScope(scope: string): PluginScope {
	return scope === "project" ? "project" : "global";
}

function keyFor(source: string, scope: PluginScope): string {
	return `${scope}\0${source}`;
}

function isWithin(path: string, root: string): boolean {
	const rel = relative(resolve(root), resolve(path));
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// ---------------------------------------------------------------------------
// Configured-package view over settings.extensions
// ---------------------------------------------------------------------------

interface ConfiguredPackage {
	/** The raw configured entry as stored in settings.extensions. */
	source: string;
	/** The configured entry resolved against `cwd`. */
	configuredPath: string;
	scope: PluginScope;
}

function listConfiguredPackages(settings: Settings, cwd: string): ConfiguredPackage[] {
	const configuredPaths = cfgExtensions.get(settings) ?? [];
	return configuredPaths.map(entry => {
		const configuredPath = isAbsolute(entry) ? entry : join(cwd, entry);
		const normalized = resolve(configuredPath);
		return {
			source: entry,
			configuredPath: normalized,
			scope: isWithin(normalized, cwd) ? "project" : "global",
		};
	});
}

function isDisabledSource(disabledIds: Set<string>, source: string): boolean {
	const fileName = source.includes("/") || source.includes("\\") ? basename(source.replace(/\\/g, "/")) : source;
	return disabledIds.has(`extension-module:${fileName}`) || disabledIds.has(fileName);
}

// ---------------------------------------------------------------------------
// Resource collection (semantic port of the web-ui route helpers)
// ---------------------------------------------------------------------------

function getResourceName(path: string, kind: PluginResourceKind): string {
	const file = basename(path);
	const ext = extname(file);
	if (kind === "skill" && file.toLowerCase() === "skill.md") return basename(dirname(path));
	if ((kind === "extension" || kind === "theme" || kind === "prompt") && ext) {
		if (kind === "extension" && /^index\.(ts|js)$/.test(file)) return basename(dirname(path));
		return file.slice(0, -ext.length);
	}
	return file;
}

function getRelativePath(resource: ResolvedResource): string {
	const baseDir = resource.metadata.baseDir;
	if (!baseDir) return resource.path;
	const rel = relative(baseDir, resource.path);
	return rel && !rel.startsWith("..") ? rel : resource.path;
}

function getConfiguredVersion(source: string): string | undefined {
	const npmSpec = source.startsWith("npm:") ? source.slice(4) : undefined;
	if (npmSpec) {
		const lastAt = npmSpec.lastIndexOf("@");
		const packageNameEnd = npmSpec.startsWith("@") ? npmSpec.indexOf("/", 1) : 0;
		if (lastAt > packageNameEnd) return npmSpec.slice(lastAt + 1) || undefined;
		return undefined;
	}

	if (source.startsWith("git:") || /^[a-z]+:\/\//.test(source)) {
		const lastAt = source.lastIndexOf("@");
		const lastSlash = source.lastIndexOf("/");
		const lastColon = source.lastIndexOf(":");
		if (lastAt > Math.max(lastSlash, lastColon)) return source.slice(lastAt + 1) || undefined;
	}
	return undefined;
}

function readPackageMetadata(installedPath?: string): { packageName?: string; version?: string } {
	if (!installedPath) return {};
	try {
		const stats = statSync(installedPath);
		const packageJsonPath = stats.isDirectory()
			? join(installedPath, "package.json")
			: join(dirname(installedPath), "package.json");
		if (!existsSync(packageJsonPath)) return {};
		const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
			name?: unknown;
			version?: unknown;
		};
		return {
			packageName: typeof parsed.name === "string" ? parsed.name : undefined,
			version: typeof parsed.version === "string" ? parsed.version : undefined,
		};
	} catch {
		return {};
	}
}

function collectResource(
	resource: ResolvedResource,
	kind: keyof PluginResourceCounts,
	pathToKey: Map<string, string>,
	countsByPackage: Map<string, PluginResourceCounts>,
	resourcesByPackage: Map<string, PluginResourceInfo[]>,
	totals: PluginResourceCounts,
): void {
	if (!resource.enabled) return;
	// Plugin packages key by their npm source; ambient/extensions entries key
	// by the configured path that produced them (metadata.source is "auto").
	const key =
		resource.metadata.origin === "package"
			? keyFor(resource.metadata.source, toPluginScope(resource.metadata.scope))
			: pathToKey.get(resolve(resource.path));
	if (!key) return;

	const counts = countsByPackage.get(key) ?? emptyCounts();
	addCount(counts, kind);
	addCount(totals, kind);
	countsByPackage.set(key, counts);

	const resources = resourcesByPackage.get(key) ?? [];
	const resourceKind =
		kind === "extensions" ? "extension" : kind === "skills" ? "skill" : kind === "prompts" ? "prompt" : "theme";
	resources.push({
		kind: resourceKind,
		name: getResourceName(resource.path, resourceKind),
		path: resource.path,
		relativePath: getRelativePath(resource),
	});
	resourcesByPackage.set(key, resources);
}

function addCount(counts: PluginResourceCounts, kind: keyof PluginResourceCounts): void {
	counts[kind] += 1;
}

function collectResources(
	paths: ResolvedPaths,
	pathToKey: Map<string, string>,
): {
	countsByPackage: Map<string, PluginResourceCounts>;
	resourcesByPackage: Map<string, PluginResourceInfo[]>;
	totals: PluginResourceCounts;
} {
	const countsByPackage = new Map<string, PluginResourceCounts>();
	const resourcesByPackage = new Map<string, PluginResourceInfo[]>();
	const totals = emptyCounts();
	const collect = (kind: keyof PluginResourceCounts, entries: ResolvedResource[]) => {
		for (const resource of entries) {
			collectResource(resource, kind, pathToKey, countsByPackage, resourcesByPackage, totals);
		}
	};
	collect("extensions", paths.extensions);
	collect("skills", paths.skills);
	collect("prompts", paths.prompts);
	collect("themes", paths.themes);
	return { countsByPackage, resourcesByPackage, totals };
}

// ---------------------------------------------------------------------------
// Zeta-native registry view (marketplace + npm/git/link)
// ---------------------------------------------------------------------------

/**
 * The `package.json` fields the registry view reads.
 *
 * `manifest` is the Zeta / legacy-upstream / Pi block, resolved through
 * `readPluginManifest` so listing and loading accept the same manifest keys.
 */
interface RegistryPackageJson {
	readonly name?: string;
	readonly version?: string;
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly manifest?: PluginManifest;
}

function asManifest(value: unknown): PluginManifest | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as PluginManifest) : undefined;
}

function stringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string") out[key] = entry;
	}
	return out;
}

function readRegistryPackageJson(root: string): RegistryPackageJson | undefined {
	try {
		const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as unknown;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		const record = parsed as Record<string, unknown>;
		return {
			name: typeof record.name === "string" ? record.name : undefined,
			version: typeof record.version === "string" ? record.version : undefined,
			dependencies: stringRecord(record.dependencies),
			manifest: readPluginManifest({
				zeta: asManifest(record.zeta),
				pi: asManifest(record.pi),
			}),
		};
	} catch {
		return undefined;
	}
}

/** A declared manifest entry as a display name: no directory, no extension. */
function declaredEntryName(entry: string): string {
	const normalized = entry.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
	const file = normalized.slice(normalized.lastIndexOf("/") + 1);
	const dot = file.lastIndexOf(".");
	const name = dot > 0 ? file.slice(0, dot) : file;
	return name || normalized;
}

/** Classify an installed package from its `package.json#dependencies` spec. */
function classifyRuntimeSource(spec: string | undefined): ZetaPluginSourceKind {
	if (spec === undefined) return "link";
	if (spec.startsWith("npm:")) return "npm";
	if (/^(?:git\+|git:|github:|ssh:\/\/|https?:\/\/)/i.test(spec) || /\.git(?:#.*)?$/i.test(spec)) return "git";
	if (spec.startsWith("file:") || spec.startsWith(".") || isAbsolute(spec)) return "link";
	return "npm";
}

function realPathKey(target: string): string | undefined {
	try {
		const real = resolve(realpathSync(target));
		return process.platform === "win32" ? real.toLowerCase() : real;
	} catch {
		return undefined;
	}
}

interface RegistryPluginInput {
	readonly id: string;
	readonly version?: string;
	readonly scope: "user" | "project";
	readonly enabled: boolean;
	readonly sourceKind: ZetaPluginSourceKind;
	readonly root: string;
}

/**
 * One registry row. Everything comes from the installed package: `plugin.json`
 * for identity and panels, `package.json` for version and declared entries.
 * A missing package is reported as an error row rather than dropped, so a
 * half-installed plugin is visible and can be re-enabled/uninstalled.
 */
function readRegistryPlugin(input: RegistryPluginInput): ZetaPluginInfo {
	const present = existsSync(input.root);
	const pkg = present ? readRegistryPackageJson(input.root) : undefined;
	const catalogue = present ? readCatalogue(input.root) : undefined;
	const declaration = present ? readDeclaredPanels(input.root) : { ok: true as const, ui: {} };
	const manifest = pkg?.manifest;
	const panels: ZetaPluginPanelInfo[] = declaration.ok
		? (declaration.ui.panels ?? []).map(panel => ({ id: panel.id, title: panel.title, kind: panel.kind }))
		: [];
	let error: string | undefined;
	if (!present) error = "Installed files are missing.";
	else if (pkg === undefined) error = "Package metadata could not be read.";
	else if (!declaration.ok) error = declaration.error;
	return {
		id: input.id,
		name: catalogue?.name ?? pkg?.name ?? input.id,
		version: pkg?.version ?? catalogue?.version ?? input.version ?? "",
		sourceKind: input.sourceKind,
		scope: input.scope,
		enabled: input.enabled,
		toolItems: manifest?.tools === undefined || manifest.tools === "" ? [] : [declaredEntryName(manifest.tools)],
		commandItems: (manifest?.commands ?? []).map(declaredEntryName),
		hookItems: manifest?.hooks === undefined || manifest.hooks === "" ? [] : [declaredEntryName(manifest.hooks)],
		panels,
		...(error === undefined ? {} : { error }),
	};
}

/** The CLI's marketplace manager, with the same paths but never seeding. */
async function createMarketplaceManager(cwd: string): Promise<MarketplaceManager> {
	return new MarketplaceManager({
		marketplacesRegistryPath: getMarketplacesRegistryPath(),
		installedRegistryPath: getInstalledPluginsRegistryPath(),
		projectInstalledRegistryPath: await resolveOrDefaultProjectRegistryPath(cwd),
		marketplacesCacheDir: getMarketplacesCacheDir(),
		pluginsCacheDir: getPluginsCacheDir(),
	});
}

/**
 * The Zeta-native registry: marketplace installs (both scopes) plus the
 * npm/git/link runtime lockfile, deduplicated by real path — a marketplace
 * plugin is linked into `node_modules`, so the two views describe one install.
 */
async function readRegistryPlugins(cwd: string, diagnostics: PluginDiagnostic[]): Promise<ZetaPluginInfo[]> {
	const plugins: ZetaPluginInfo[] = [];
	const marketplaceRoots = new Set<string>();

	try {
		const marketplace = await createMarketplaceManager(cwd);
		for (const summary of await marketplace.listInstalledPlugins()) {
			const entry = summary.entries[0];
			if (entry === undefined) continue;
			const real = realPathKey(entry.installPath);
			if (real !== undefined) marketplaceRoots.add(real);
			plugins.push(
				readRegistryPlugin({
					id: summary.id,
					version: entry.version,
					scope: summary.scope,
					enabled: entry.enabled !== false,
					sourceKind: "marketplace",
					root: entry.installPath,
				}),
			);
		}
	} catch {
		diagnostics.push({ type: "error", message: "Installed marketplace registry could not be read." });
	}

	try {
		const installed = await listInstalledPlugins(cwd);
		const userRoot = getPluginsDir();
		const projectRegistryPath = await resolveActiveProjectRegistryPath(cwd);
		const projectRoot = projectRegistryPath === null ? undefined : dirname(projectRegistryPath);
		const userDeps = readRegistryPackageJson(userRoot)?.dependencies ?? {};
		const projectDeps = projectRoot === undefined ? {} : (readRegistryPackageJson(projectRoot)?.dependencies ?? {});
		for (const plugin of installed) {
			const real = realPathKey(plugin.path);
			if (real !== undefined && marketplaceRoots.has(real)) continue;
			const deps = plugin.scope === "project" ? projectDeps : userDeps;
			plugins.push(
				readRegistryPlugin({
					id: plugin.name,
					version: plugin.version,
					scope: plugin.scope,
					enabled: plugin.enabled,
					sourceKind: classifyRuntimeSource(deps[plugin.name]),
					root: plugin.path,
				}),
			);
		}
	} catch {
		diagnostics.push({ type: "error", message: "Installed plugin registry could not be read." });
	}

	return plugins;
}

async function readPlugins(cwd: string): Promise<PluginsResponse> {
	const agentDir = getAgentDir();
	const settings = await Settings.loadIsolated({ cwd, agentDir });
	const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });

	const configuredPackages = listConfiguredPackages(settings, cwd);
	const pathToKey = new Map<string, string>();
	for (const pkg of configuredPackages) {
		pathToKey.set(pkg.configuredPath, keyFor(pkg.source, pkg.scope));
	}

	const disabledIds = new Set(cfgDisabledExtensions.get(settings) ?? []);
	const diagnostics: PluginDiagnostic[] = [];
	let countsByPackage = new Map<string, PluginResourceCounts>();
	let resourcesByPackage = new Map<string, PluginResourceInfo[]>();
	let totals = emptyCounts();

	try {
		const resolved = await packageManager.resolve(async source => {
			diagnostics.push({
				type: "warning",
				source,
				message: "Package is configured but not installed yet.",
			});
			return "skip";
		});
		({ countsByPackage, resourcesByPackage, totals } = collectResources(resolved, pathToKey));
	} catch (error) {
		diagnostics.push({
			type: "error",
			message: error instanceof Error ? error.message : String(error),
		});
	}

	const packages = configuredPackages.map((pkg): PluginPackageInfo => {
		const key = keyFor(pkg.source, pkg.scope);
		const disabled = isDisabledSource(disabledIds, pkg.source);
		const counts = countsByPackage.get(key) ?? emptyCounts();
		const resources = resourcesByPackage.get(key) ?? [];
		const resourceCount = counts.extensions + counts.skills + counts.prompts + counts.themes;
		const installedPath = existsSync(pkg.configuredPath) ? pkg.configuredPath : undefined;
		const packageMetadata = readPackageMetadata(installedPath);
		if (!installedPath) {
			diagnostics.push({
				type: "warning",
				source: pkg.source,
				message: "Configured package path was not found.",
			});
		}
		return {
			source: pkg.source,
			scope: pkg.scope,
			filtered: false,
			disabled,
			...(installedPath && { installedPath }),
			...(packageMetadata.packageName && { packageName: packageMetadata.packageName }),
			...(packageMetadata.version && { version: packageMetadata.version }),
			configuredVersion: getConfiguredVersion(pkg.source),
			counts,
			resources,
			status: disabled ? "disabled" : resourceCount > 0 ? "loaded" : installedPath ? "installed" : "missing",
		};
	});

	// Runtime plugin packages that have no configured entry surface as
	// read-only "loaded" packages so the web-ui shows what is active.
	for (const [key, resources] of resourcesByPackage) {
		if (packages.some(pkg => keyFor(pkg.source, pkg.scope) === key)) continue;
		const [scope, source] = key.split("\0") as [PluginScope, string];
		const counts = countsByPackage.get(key) ?? emptyCounts();
		const resourceCount = counts.extensions + counts.skills + counts.prompts + counts.themes;
		packages.push({
			source,
			scope,
			filtered: false,
			disabled: false,
			configuredVersion: getConfiguredVersion(source),
			counts,
			resources,
			status: resourceCount > 0 ? "loaded" : "installed",
		});
	}

	return { packages, installed: await readRegistryPlugins(cwd, diagnostics), totals, diagnostics };
}

function readScope(scope: unknown): PluginScope {
	return scope === "project" ? "project" : "global";
}

// GET /api/plugins?cwd=<path>
export async function handlePluginsGet(req: Request): Promise<Response> {
	const { searchParams } = new URL(req.url);
	const cwd = searchParams.get("cwd");
	if (!cwd) return json({ error: "cwd required" }, 400);
	if (!isDirectory(cwd)) return json({ error: "Access denied" }, 403);
	try {
		return json(await readPlugins(cwd));
	} catch (error) {
		return json({ error: String(error) }, 500);
	}
}

// POST /api/plugins  body: { action, id?, source?, scope?, cwd }
//
// `id` addresses the Zeta-native registry (marketplace `name@marketplace` or a
// package name) and goes through the same toggle the CLI uses. The legacy
// `source` form edits `settings.extensions`; it is kept for the extension
// package view (`packages` in the GET answer).
export async function handlePluginsPost(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as {
			action?: unknown;
			id?: unknown;
			source?: unknown;
			scope?: unknown;
			cwd?: unknown;
		};
		const cwd = typeof body.cwd === "string" ? body.cwd : "";
		const action = typeof body.action === "string" ? body.action : "";
		if (!cwd) return json({ error: "cwd required" }, 400);
		if (!action) return json({ error: "action required" }, 400);
		if (!isDirectory(cwd)) return json({ error: "Access denied" }, 403);

		const pluginId = typeof body.id === "string" ? body.id.trim() : "";
		if (pluginId !== "") {
			if (action !== "enable" && action !== "disable") {
				return json({ error: `Unsupported action: ${action}` }, 400);
			}
			const scope = body.scope === "project" ? "project" : body.scope === "user" ? "user" : undefined;
			const marketplace = await createMarketplaceManager(cwd);
			const marketplaceIds = new Set((await marketplace.listInstalledPlugins()).map(plugin => plugin.id));
			try {
				await setInstalledPluginEnabled(pluginId, {
					enabled: action === "enable",
					scope,
					marketplaceIds,
					marketplace,
					npm: new PluginManager(cwd),
				});
			} catch (error) {
				return json({ error: error instanceof Error ? error.message : String(error) }, 400);
			}
			return json(await readPlugins(cwd));
		}

		const agentDir = getAgentDir();
		const settings = await Settings.loadIsolated({ cwd, agentDir });
		const source = typeof body.source === "string" ? body.source.trim() : "";
		const local = readScope(body.scope) === "project";

		if (action === "install") {
			if (!source) return json({ error: "source required" }, 400);
			const entry = local && !isAbsolute(source) ? join(cwd, source) : source;
			const next = Array.from(new Set([...(cfgExtensions.get(settings) ?? []), entry]));
			settings.writeValue(cfgExtensions, next, "global");
		} else if (action === "remove") {
			if (!source) return json({ error: "source required" }, 400);
			const entry = local && !isAbsolute(source) ? join(cwd, source) : source;
			settings.writeValue(
				cfgExtensions,
				(cfgExtensions.get(settings) ?? []).filter(item => item !== entry && item !== source),
				"global",
			);
		} else if (action === "update") {
			// The configured entry is idempotently re-asserted; the actual
			// package content is refreshed by the CLI-side install tooling.
			if (!source) return json({ error: "source required" }, 400);
			const entry = local && !isAbsolute(source) ? join(cwd, source) : source;
			const next = Array.from(new Set([...(cfgExtensions.get(settings) ?? []), entry]));
			settings.writeValue(cfgExtensions, next, "global");
		} else if (action === "disable") {
			if (!source) return json({ error: "source required" }, 400);
			const fileName = source.includes("/") || source.includes("\\") ? basename(source.replace(/\\/g, "/")) : source;
			const id = `extension-module:${fileName}`;
			settings.writeValue(
				cfgDisabledExtensions,
				Array.from(new Set([...(cfgDisabledExtensions.get(settings) ?? []), id])),
				"global",
			);
		} else if (action === "enable") {
			if (!source) return json({ error: "source required" }, 400);
			const fileName = source.includes("/") || source.includes("\\") ? basename(source.replace(/\\/g, "/")) : source;
			const id = `extension-module:${fileName}`;
			settings.writeValue(
				cfgDisabledExtensions,
				(cfgDisabledExtensions.get(settings) ?? []).filter(item => item !== id),
				"global",
			);
		} else {
			return json({ error: `Unsupported action: ${action}` }, 400);
		}

		await settings.flush();
		return json(await readPlugins(cwd));
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}

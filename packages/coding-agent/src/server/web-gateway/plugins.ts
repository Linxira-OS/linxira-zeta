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

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@linxiraos/pi-utils/dirs";
import { Settings } from "../../config/settings";
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
	const configuredPaths = settings.get("extensions") ?? [];
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

async function readPlugins(cwd: string): Promise<PluginsResponse> {
	const agentDir = getAgentDir();
	const settings = await Settings.loadIsolated({ cwd, agentDir });
	const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });

	const configuredPackages = listConfiguredPackages(settings, cwd);
	const pathToKey = new Map<string, string>();
	for (const pkg of configuredPackages) {
		pathToKey.set(pkg.configuredPath, keyFor(pkg.source, pkg.scope));
	}

	const disabledIds = new Set(settings.get("disabledExtensions") ?? []);
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

	return { packages, totals, diagnostics };
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

// POST /api/plugins  body: { action, source?, scope?, cwd }
export async function handlePluginsPost(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as {
			action?: unknown;
			source?: unknown;
			scope?: unknown;
			cwd?: unknown;
		};
		const cwd = typeof body.cwd === "string" ? body.cwd : "";
		const action = typeof body.action === "string" ? body.action : "";
		if (!cwd) return json({ error: "cwd required" }, 400);
		if (!action) return json({ error: "action required" }, 400);
		if (!isDirectory(cwd)) return json({ error: "Access denied" }, 403);

		const agentDir = getAgentDir();
		const settings = await Settings.loadIsolated({ cwd, agentDir });
		const source = typeof body.source === "string" ? body.source.trim() : "";
		const local = readScope(body.scope) === "project";

		if (action === "install") {
			if (!source) return json({ error: "source required" }, 400);
			const entry = local && !isAbsolute(source) ? join(cwd, source) : source;
			const next = Array.from(new Set([...(settings.get("extensions") ?? []), entry]));
			settings.set("extensions", next);
		} else if (action === "remove") {
			if (!source) return json({ error: "source required" }, 400);
			const entry = local && !isAbsolute(source) ? join(cwd, source) : source;
			settings.set(
				"extensions",
				(settings.get("extensions") ?? []).filter(item => item !== entry && item !== source),
			);
		} else if (action === "update") {
			// The configured entry is idempotently re-asserted; the actual
			// package content is refreshed by the CLI-side install tooling.
			if (!source) return json({ error: "source required" }, 400);
			const entry = local && !isAbsolute(source) ? join(cwd, source) : source;
			const next = Array.from(new Set([...(settings.get("extensions") ?? []), entry]));
			settings.set("extensions", next);
		} else if (action === "disable") {
			if (!source) return json({ error: "source required" }, 400);
			const fileName = source.includes("/") || source.includes("\\") ? basename(source.replace(/\\/g, "/")) : source;
			const id = `extension-module:${fileName}`;
			settings.set("disabledExtensions", Array.from(new Set([...(settings.get("disabledExtensions") ?? []), id])));
		} else if (action === "enable") {
			if (!source) return json({ error: "source required" }, 400);
			const fileName = source.includes("/") || source.includes("\\") ? basename(source.replace(/\\/g, "/")) : source;
			const id = `extension-module:${fileName}`;
			settings.set(
				"disabledExtensions",
				(settings.get("disabledExtensions") ?? []).filter(item => item !== id),
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

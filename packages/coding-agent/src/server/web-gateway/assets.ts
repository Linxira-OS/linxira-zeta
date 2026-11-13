/**
 * Web Gateway plugin page host: package assets and manifest-declared pages.
 *
 * A plugin's `ui.panels` html entries and the files they reference are served
 * from the plugin package itself, never from the workspace. Two rules keep
 * that boundary tight:
 *
 * - a request is resolved to a plugin *root* first (installed registry,
 *   runtime lockfile, marketplace links, or a dropped-in package directory),
 *   and the requested path is decoded one segment at a time and confined to
 *   that root after `realpath` — no absolute paths, UNC shares, drive letters,
 *   `..`, encoded separators, or directory targets;
 * - only an allowlist of static asset extensions is answered, so a package
 *   cannot turn the gateway into an arbitrary-file or executable-content
 *   server.
 *
 * Pages are an inventory view: `readDeclaredPanels` reports what the package
 * manifest declares, independent of whether this terminal is a workbench
 * panel host. The list never carries an absolute path; a page is addressed by
 * its plugin id and package-relative entry.
 */
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getAgentDir, getPluginsDir } from "@linxiraos/pi-utils";
import { resolveActiveProjectRegistryPath, resolveOrDefaultProjectRegistryPath } from "../../discovery/helpers";
import { listInstalledPlugins } from "../../extensibility/plugins/loader";
import { PluginManager } from "../../extensibility/plugins/manager";
import { readCatalogue, readDeclaredPanels } from "../../extensibility/plugins/panels";
import { MarketplaceManager } from "../../extensibility/plugins/marketplace/manager";
import {
	getInstalledPluginsRegistryPath,
	getMarketplacesCacheDir,
	getMarketplacesRegistryPath,
	getPluginsCacheDir,
} from "../../extensibility/plugins/marketplace/registry";

/** One plugin package root as the page host addresses it. */
export interface ResolvedPluginRoot {
	/** Catalogue id: `plugin.json#id`, package basename, or directory basename. */
	readonly id: string;
	/** Display name for the pages manifest. */
	readonly name: string;
	/** Absolute package root. Never leaves the gateway. */
	readonly root: string;
}

/** One html panel entry as the renderer consumes it. */
export interface PluginPageEntry {
	readonly id: string;
	readonly title: string;
	/** Package-relative POSIX path of the html entry. */
	readonly entry: string;
	/** Gateway URL that serves the entry file. */
	readonly url: string;
}

/** A plugin with at least one declared html page. */
export interface PluginPageGroup {
	readonly id: string;
	readonly name: string;
	readonly pages: readonly PluginPageEntry[];
}

/** `GET /api/plugin-pages` response. */
export interface PluginPagesResponse {
	readonly plugins: readonly PluginPageGroup[];
}

/** The extensions a plugin package may serve through the asset route. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
};

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

/** Resolve the project root: explicit `cwd` query, then the UI header, then the process directory. */
function requestCwd(req: Request): string {
	const query = new URL(req.url).searchParams.get("cwd")?.trim();
	if (query) return resolve(query);
	const header = req.headers.get("x-zeta-cwd")?.trim();
	if (header) return resolve(header);
	return resolve(process.cwd());
}

function isDirectory(target: string): boolean {
	try {
		return statSync(target).isDirectory();
	} catch {
		return false;
	}
}

/** Case-canonical key for deduplicating roots (Windows paths are case-insensitive). */
function realPathKey(target: string): string {
	try {
		const real = resolve(realpathSync(target));
		return process.platform === "win32" ? real.toLowerCase() : real;
	} catch {
		const fallback = resolve(target);
		return process.platform === "win32" ? fallback.toLowerCase() : fallback;
	}
}

/** Directories under the given roots that look like a plugin package. */
function droppedInPluginDirs(roots: readonly string[]): string[] {
	const dirs: string[] = [];
	const push = (dir: string): void => {
		if (!isDirectory(dir)) return;
		if (existsSync(join(dir, "plugin.json")) || existsSync(join(dir, "package.json"))) dirs.push(dir);
	};
	for (const root of roots) {
		let entries;
		try {
			entries = readdirSync(root, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
			if (!entry.name.startsWith("@")) {
				push(join(root, entry.name));
				continue;
			}
			// A scope directory: `node_modules/@scope/<plugin>`.
			let scoped;
			try {
				scoped = readdirSync(join(root, entry.name), { withFileTypes: true });
			} catch {
				continue;
			}
			for (const inner of scoped) {
				if (inner.isDirectory()) push(join(root, entry.name, inner.name));
			}
		}
	}
	return dirs;
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

/** Every package root the plugin view can see, in precedence order. */
async function pluginRoots(cwd: string): Promise<string[]> {
	const roots: string[] = [];
	try {
		const marketplace = await createMarketplaceManager(cwd);
		for (const summary of await marketplace.listInstalledPlugins()) {
			for (const entry of summary.entries) roots.push(entry.installPath);
		}
	} catch {
		// A broken registry is the inventory view's diagnostic, not a page-host failure.
	}
	try {
		for (const plugin of await listInstalledPlugins(cwd)) roots.push(plugin.path);
	} catch {
		// Same: an unreadable lockfile leaves the other roots usable.
	}
	try {
		for (const plugin of await new PluginManager(cwd).list()) roots.push(plugin.path);
	} catch {
		// npm/git/link roots may be absent in a checkout.
	}
	const droppedRoots = [join(getAgentDir(), "plugins"), join(getPluginsDir(), "node_modules")];
	try {
		const projectRegistry = await resolveActiveProjectRegistryPath(cwd);
		if (projectRegistry !== null) {
			const projectPlugins = dirname(projectRegistry);
			droppedRoots.push(projectPlugins, join(projectPlugins, "node_modules"));
		}
	} catch {
		// No project anchor: the user roots still cover dropped-in packages.
	}
	roots.push(...droppedInPluginDirs(droppedRoots));
	return roots;
}

/**
 * Resolve one plugin id to its package root.
 *
 * Id precedence matches `readCatalogue` (and therefore the native host and
 * the plugins inventory): `plugin.json#id`, then the package name's basename,
 * then the directory name. The first root in registry order wins.
 */
export async function resolvePluginRoot(cwd: string, pluginId: string): Promise<ResolvedPluginRoot | undefined> {
	if (pluginId === "" || pluginId.includes("/") || pluginId.includes("\\") || pluginId.includes("\0")) {
		return undefined;
	}
	const seen = new Set<string>();
	for (const root of await pluginRoots(cwd)) {
		const key = realPathKey(root);
		if (seen.has(key)) continue;
		seen.add(key);
		if (!isDirectory(root)) continue;
		const catalogue = readCatalogue(root);
		if (catalogue.id !== pluginId) continue;
		return { id: catalogue.id, name: catalogue.name?.trim() || catalogue.id, root: resolve(root) };
	}
	return undefined;
}

/** Whether `candidate` resolves to a regular file inside `root` (realpath, case-aware). */
export function isPathInsidePluginRoot(candidate: string, root: string): boolean {
	try {
		const realRoot = resolve(realpathSync(root));
		const realCandidate = resolve(realpathSync(candidate));
		if (!isDirectory(realRoot) || !statSync(realCandidate).isFile()) return false;
		return isWithin(realRoot, realCandidate);
	} catch {
		return false;
	}
}

/** Real paths are canonical already; lower-case on Windows because comparison must not depend on case. */
function isWithin(realRoot: string, realTarget: string): boolean {
	const from = process.platform === "win32" ? realRoot.toLowerCase() : realRoot;
	const to = process.platform === "win32" ? realTarget.toLowerCase() : realTarget;
	const rel = relative(from, to);
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * A manifest html entry as a package-relative path, or `undefined` when it
 * cannot be addressed safely. Declarations are validated by `parsePluginUi`;
 * this second gate rejects entries that would escape the package or name a
 * non-html asset.
 */
function pageEntryPath(entry: string): string | undefined {
	const trimmed = entry.trim().replace(/\\/g, "/");
	if (trimmed === "" || trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) return undefined;
	if (trimmed.includes("\0") || trimmed.includes("?") || trimmed.includes("#")) return undefined;
	const segments = trimmed.split("/").filter(segment => segment !== "");
	if (segments.length === 0) return undefined;
	if (segments.some(segment => segment === "." || segment === ".." || segment.includes(":"))) return undefined;
	const normalized = segments.join("/");
	return /\.html?$/i.test(normalized) ? normalized : undefined;
}

/** A catalogue id is addressable only when it is one plain path segment. */
function isAddressablePluginId(id: string): boolean {
	return id !== "" && id !== "." && id !== ".." && !/[\\/:\0]/.test(id);
}

function pageUrl(pluginId: string, entry: string, cwd: string): string {
	const segments = entry.split("/").map(segment => encodeURIComponent(segment));
	const base = `/api/plugin-assets/${encodeURIComponent(pluginId)}/${segments.join("/")}`;
	// An iframe navigation cannot carry the Studio client's `x-zeta-cwd` header.
	// The project query keeps project-scoped plugin roots resolvable at asset time.
	return `${base}?cwd=${encodeURIComponent(cwd)}`;
}

function htmlPages(root: string, pluginId: string, cwd: string): PluginPageEntry[] {
	const declaration = readDeclaredPanels(root);
	if (!declaration.ok) return [];
	const pages: PluginPageEntry[] = [];
	for (const panel of declaration.ui.panels ?? []) {
		if (panel.kind !== "html") continue;
		const entry = pageEntryPath(panel.entry);
		if (entry === undefined) continue;
		pages.push({ id: panel.id, title: panel.title, entry, url: pageUrl(pluginId, entry, cwd) });
	}
	return pages;
}

/** Manifest-declared html pages for every installed/promoted plugin, plugins without pages omitted. */
export async function listPluginPages(cwd: string): Promise<PluginPageGroup[]> {
	const plugins: PluginPageGroup[] = [];
	const seenRoots = new Set<string>();
	const seenIds = new Set<string>();
	for (const root of await pluginRoots(cwd)) {
		const key = realPathKey(root);
		if (seenRoots.has(key)) continue;
		seenRoots.add(key);
		if (!isDirectory(root)) continue;
		const catalogue = readCatalogue(root);
		if (!isAddressablePluginId(catalogue.id)) continue;
		const pages = htmlPages(root, catalogue.id, cwd);
		if (pages.length === 0 || seenIds.has(catalogue.id)) continue;
		seenIds.add(catalogue.id);
		plugins.push({ id: catalogue.id, name: catalogue.name?.trim() || catalogue.id, pages });
	}
	return plugins.sort((a, b) => a.id.localeCompare(b.id));
}

/** `GET /api/plugin-pages?cwd=…` → `{ plugins: [{ id, name, pages }] }`. */
export async function handlePluginPagesGet(req: Request): Promise<Response> {
	return json({ plugins: await listPluginPages(requestCwd(req)) } satisfies PluginPagesResponse);
}

/** Decode one URL path segment exactly once; reject anything that could alter path structure. */
function decodeSegment(raw: string): string | undefined {
	let decoded: string;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return undefined;
	}
	if (decoded === "" || decoded === "." || decoded === "..") return undefined;
	if (decoded.includes("\0") || decoded.includes("/") || decoded.includes("\\") || decoded.includes(":")) {
		return undefined;
	}
	// eslint-disable-next-line no-control-regex
	return /[\u0000-\u001f]/.test(decoded) ? undefined : decoded;
}

/** Decode the asset tail one segment at a time; a bad segment rejects the whole path. */
function decodeAssetSegments(raw: string): string[] | undefined {
	const segments: string[] = [];
	for (const part of raw.split("/")) {
		const decoded = decodeSegment(part);
		if (decoded === undefined) return undefined;
		segments.push(decoded);
	}
	return segments.length === 0 ? undefined : segments;
}

function notFound(): Response {
	return json({ error: "Not found" }, 404);
}

/**
 * `GET|HEAD /api/plugin-assets/<pluginId>/<path>`.
 *
 * The path is decoded segment by segment and confined to the plugin root after
 * `realpath`; only regular files with an allowlisted static-asset extension
 * are returned. Every failure answers 404 so a probe cannot distinguish
 * "outside the package" from "absent".
 */
export async function handlePluginAssetGet(req: Request, pluginId: string, rawPath: string): Promise<Response> {
	const id = decodeSegment(pluginId);
	if (id === undefined) return json({ error: "Invalid plugin id" }, 400);
	const segments = decodeAssetSegments(rawPath);
	if (segments === undefined) return json({ error: "Invalid asset path" }, 400);

	const cwd = requestCwd(req);
	const plugin = await resolvePluginRoot(cwd, id);
	if (plugin === undefined) return notFound();

	const fileName = segments[segments.length - 1] ?? "";
	const contentType = CONTENT_TYPES[extname(fileName).toLowerCase()];
	if (contentType === undefined) return notFound();

	let target: string;
	let size: number;
	try {
		const realRoot = resolve(realpathSync(plugin.root));
		if (!isDirectory(realRoot)) return notFound();
		target = resolve(realpathSync(resolve(plugin.root, ...segments)));
		if (!isWithin(realRoot, target)) return notFound();
		const stats = statSync(target);
		if (!stats.isFile()) return notFound();
		size = stats.size;
	} catch {
		return notFound();
	}

	const headers: Record<string, string> = {
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
		"content-type": contentType,
	};
	if (req.method === "HEAD") {
		return new Response(null, { status: 200, headers: { ...headers, "content-length": String(size) } });
	}
	return new Response(Bun.file(target), { status: 200, headers });
}

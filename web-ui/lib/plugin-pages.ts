import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAgentDir } from "./file-paths";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";

/**
 * Web plugin pages.
 *
 * A web plugin ships its pages as static files inside its own package; web-ui
 * mounts one page per URL with the chrome-free panel surface, so a host (the
 * desktop's right sidebar, an iframe, a browser tab on the panel URL) can point
 * at `…/plugins/view/<plugin>/<page>`. The page talks to whatever `/api`
 * endpoints it needs from inside that frame — the mount is chat-independent.
 *
 * Registration today is "the file is in the plugin package": every
 * `.html`/`.htm` file under the package is a mountable page and its title is the
 * document `<title>`. Discovery is `GET /api/plugin-pages`. The Zeta-side
 * manifest v2 `pages` declaration
 * (`document/webui-desktop-overhaul-plan.md`, batch Z4) is not implemented, so
 * this scan is the interim read path — see `web-ui/AGENTS.md` ("Web plugin
 * pages") for the hand-off.
 */

/** Extra plugin package directories (one path per entry, `;`/`:` separated). */
export const PLUGIN_ROOTS_ENV = "ZETA_WEB_PLUGIN_ROOTS";
export const PLUGIN_PAGE_EXTENSIONS = [".html", ".htm"] as const;

const PACKAGE_MANIFEST_KEYS = ["zeta", "omp", "pi"] as const;
const SCAN_SKIP_DIRS: Record<string, true> = {
	node_modules: true,
	".git": true,
	".next": true,
	dist: true,
	build: true,
	coverage: true,
	tests: true,
	test: true,
	__tests__: true,
};
const MAX_PAGE_DEPTH = 4;
const TITLE_PREFIX_BYTES = 8192;
const PLUGIN_PAGES_TTL_MS = 5_000;

// Package listing cache (see `getInstalledWebPlugins`), kept on globalThis so it
// survives Next.js hot-reload.
declare global {
	var __zetaWebPluginPagesCache: { packages: PluginPackageInfo[]; expiresAt: number } | undefined;
}

export interface PluginPageEntry {
	/** Path relative to the plugin package root, POSIX separators. */
	path: string;
	/** `<title>` of the document, falling back to the file name. */
	title: string;
	/** Same-origin URL the frame mounts. */
	url: string;
}

export interface PluginPackageInfo {
	/** Short id used in URLs: `plugin.json` id, else the package basename. */
	id: string;
	/** Package name (`@linxiraos/pi-messenger` or unscoped). */
	name: string;
	version: string;
	pages: PluginPageEntry[];
}

export interface PluginAsset {
	/** Absolute path inside the plugin package. */
	file: string;
	/** Absolute plugin package root (the traversal guard root). */
	root: string;
	plugin: PluginPackageInfo;
}

export type PluginAssetFailure = { ok: false; status: 404 | 403; error: string };
export type PluginAssetResult = ({ ok: true } & PluginAsset) | PluginAssetFailure;

/** Plugin install roots: the agent-dir `plugins/` tree plus any env override. */
export function pluginRoots(env: NodeJS.ProcessEnv = process.env): string[] {
	const roots = [path.join(getAgentDir(), "plugins")];
	for (const entry of (env[PLUGIN_ROOTS_ENV] ?? "").split(/[;:]/)) {
		const trimmed = entry.trim();
		if (trimmed && !roots.includes(trimmed)) roots.push(trimmed);
	}
	return roots;
}

function readJsonObject(file: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/**
 * A directory is a plugin package when it carries `package.json` with a
 * `zeta`/`omp`/`pi` manifest block (the loader's own rule) or a `plugin.json`.
 * Keep this in sync with `readPluginManifest()` in
 * `packages/coding-agent/src/extensibility/plugins/types.ts`.
 */
function isPluginPackage(dir: string): boolean {
	const pkg = readJsonObject(path.join(dir, "package.json"));
	if (pkg && PACKAGE_MANIFEST_KEYS.some(key => pkg[key] && typeof pkg[key] === "object")) return true;
	return existsSync(path.join(dir, "plugin.json"));
}

/**
 * The id a plugin is addressed by in URLs: the `plugin.json` id when the
 * catalog declares one, else the package name without its scope
 * (`@linxiraos/pi-messenger` → `pi-messenger`), else the directory name.
 * `resolvePluginAsset` accepts the scoped name as an alias too.
 */
function pluginIdOf(dir: string, pkg: Record<string, unknown> | null): string {
	const pluginJson = readJsonObject(path.join(dir, "plugin.json"));
	if (typeof pluginJson?.id === "string" && pluginJson.id.trim()) return pluginJson.id.trim();
	if (typeof pkg?.name === "string" && pkg.name.trim()) return path.basename(pkg.name.trim());
	return path.basename(dir);
}

/** `<title>` of an HTML file, read from its first few KB. */
function documentTitle(file: string, fallback: string): string {
	try {
		const prefix = readFileSync(file, "utf8").slice(0, TITLE_PREFIX_BYTES);
		const match = prefix.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
		const title = match?.[1].replace(/\s+/g, " ").trim();
		return title ? title : fallback;
	} catch {
		return fallback;
	}
}

function collectPageFiles(root: string, dir: string, depth: number, out: string[]): void {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (depth >= MAX_PAGE_DEPTH || SCAN_SKIP_DIRS[entry.name]) continue;
			collectPageFiles(root, full, depth + 1, out);
			continue;
		}
		if (!entry.isFile()) continue;
		const ext = path.extname(entry.name).toLowerCase();
		if ((PLUGIN_PAGE_EXTENSIONS as readonly string[]).includes(ext)) out.push(path.relative(root, full));
	}
}

/** Same-origin URL of a plugin page or one of its assets. */
export function pluginAssetUrl(pluginId: string, relativePath: string): string {
	const segments = relativePath.split(/[\\/]/).filter(Boolean).map(encodeURIComponent);
	return `/api/plugin-assets/${encodeURIComponent(pluginId)}/${segments.join("/")}`;
}

function toPackageInfo(dir: string): PluginPackageInfo {
	const pkg = readJsonObject(path.join(dir, "package.json"));
	const id = pluginIdOf(dir, pkg);
	const files: string[] = [];
	collectPageFiles(dir, dir, 0, files);
	const pages = files
		.map(relative => relative.split(path.sep).join("/"))
		.filter(relative => !relative.startsWith(".."))
		.sort()
		.map(
			relative =>
				({
					path: relative,
					title: documentTitle(path.join(dir, relative), path.basename(relative)),
					url: pluginAssetUrl(id, relative),
				}) satisfies PluginPageEntry,
		);
	return {
		id,
		name: typeof pkg?.name === "string" ? pkg.name : id,
		version: typeof pkg?.version === "string" ? pkg.version : "0.0.0",
		pages,
	};
}

function readPackageDirs(root: string): string[] {
	const dirs: string[] = [];
	if (!existsSync(root)) return dirs;

	const push = (dir: string) => {
		let isDir = false;
		try {
			isDir = statSync(dir).isDirectory();
		} catch {
			return;
		}
		if (isDir && isPluginPackage(dir)) dirs.push(dir);
	};

	// The env override points straight at package directories; an install root
	// holds them one (or two, scoped) levels down under `node_modules`.
	if (isPluginPackage(root)) {
		dirs.push(root);
		return dirs;
	}
	const nodeModules = path.join(root, "node_modules");
	if (!existsSync(nodeModules)) return dirs;
	let entries;
	try {
		entries = readdirSync(nodeModules, { withFileTypes: true });
	} catch {
		return dirs;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		if (entry.name.startsWith("@")) {
			let scoped;
			try {
				scoped = readdirSync(path.join(nodeModules, entry.name), { withFileTypes: true });
			} catch {
				continue;
			}
			for (const inner of scoped) {
				if (inner.isDirectory()) push(path.join(nodeModules, entry.name, inner.name));
			}
			continue;
		}
		push(path.join(nodeModules, entry.name));
	}
	return dirs;
}

/** Every installed web plugin, with the pages it ships. */
export function readPluginPackages(roots: string[] = pluginRoots()): PluginPackageInfo[] {
	const seen = new Set<string>();
	const packages: PluginPackageInfo[] = [];
	for (const root of roots) {
		for (const dir of readPackageDirs(root)) {
			const info = toPackageInfo(dir);
			const key = info.id.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			packages.push(info);
		}
	}
	return packages.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * {@link readPluginPackages} behind a short TTL: the page host and the desktop
 * poll the list, and every read walks the plugin roots. 5s matches the
 * allowed-roots cache in `lib/file-access.ts`; kept on globalThis so it survives
 * Next.js hot-reload.
 */
export function getInstalledWebPlugins(): PluginPackageInfo[] {
	const now = Date.now();
	const cached = globalThis.__zetaWebPluginPagesCache;
	if (cached && cached.expiresAt > now) return cached.packages;
	const packages = readPluginPackages();
	globalThis.__zetaWebPluginPagesCache = { packages, expiresAt: now + PLUGIN_PAGES_TTL_MS };
	return packages;
}

function findPackage(pluginId: string, roots: string[]): { info: PluginPackageInfo; dir: string } | null {
	const wanted = pluginId.trim().toLowerCase();
	if (!wanted) return null;
	for (const root of roots) {
		for (const dir of readPackageDirs(root)) {
			const info = toPackageInfo(dir);
			const aliases = [info.id, info.name, path.basename(dir)].map(value => value.toLowerCase());
			if (aliases.includes(wanted) || aliases.includes(`@linxiraos/${wanted}`)) return { info, dir };
		}
	}
	return null;
}

/**
 * Resolve a request for a file inside a plugin package. `segments` is the
 * URL-decoded path; anything that escapes the package root is refused (403) and
 * anything missing is a 404 — the frame route and the asset route share this
 * so a page and its CSS/JS can never disagree about the guard.
 */
export function resolvePluginAsset(
	pluginId: string,
	segments: string[],
	roots: string[] = pluginRoots(),
): PluginAssetResult {
	const found = findPackage(pluginId, roots);
	if (!found) return { ok: false, status: 404, error: `Unknown plugin: ${pluginId}` };
	if (segments.some(segment => segment.includes("\0"))) {
		return { ok: false, status: 403, error: "Invalid path" };
	}

	const relative = segments.filter(segment => segment.length > 0 && segment !== ".").join(path.sep);
	const candidate = relative ? path.resolve(found.dir, relative) : found.dir;
	// `path.resolve` already collapses `..`; compare lexically first so a
	// traversal attempt is refused even when the target does not exist.
	if (!isPathWithinRoots(candidate, new Set([found.dir]))) {
		return { ok: false, status: 403, error: "Path escapes the plugin package" };
	}
	if (!existsSync(candidate) || !statSync(candidate).isFile()) {
		return { ok: false, status: 404, error: `Not found: ${segments.join("/")}` };
	}
	if (!isExistingPathWithinRoots(candidate, new Set([found.dir]))) {
		return { ok: false, status: 403, error: "Path escapes the plugin package" };
	}

	return { ok: true, file: candidate, root: found.dir, plugin: found.info };
}

/** The mountable pages of one plugin, or null when it is not installed. */
export function readPluginPages(pluginId: string, roots: string[] = pluginRoots()): PluginPackageInfo | null {
	return findPackage(pluginId, roots)?.info ?? null;
}

/** Home directory the install roots hang off — used by diagnostics only. */
export function pluginRootsSummary(roots: string[] = pluginRoots()): string {
	return roots.map(root => path.relative(homedir(), root) || root).join(", ");
}

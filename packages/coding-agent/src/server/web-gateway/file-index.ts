/**
 * Web Gateway — `/api/file-index` file listing for the @-mention menu.
 *
 * Port of `web-ui/app/api/file-index/route.ts`. Git repositories list through
 * `git ls-files` (so `.gitignore` decides what a user can @-mention, matching
 * the TUI's fd behaviour); anything else falls back to a bounded BFS walk.
 *
 *   GET ?cwd=/abs/path        → { files: string[], truncated: boolean }
 *   GET ?cwd=/abs/path&q=…    → { matches: { path, isDir }[] }
 *
 * The listing is cached per cwd for 10s (the menu re-opens and searches on
 * every keystroke), and the whole route is guarded by the same allowed-root
 * confinement as `/api/files`.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "./file-roots";

const execFileAsync = promisify(execFile);

// Same skip lists as /api/files — only used for the non-git readdir fallback.
// Git-tracked repos rely on .gitignore instead (matches the TUI's fd behavior).
const IGNORED_NAMES = new Set([
	"node_modules",
	".git",
	".next",
	"dist",
	"build",
	"__pycache__",
	".turbo",
	".cache",
	"coverage",
	".pytest_cache",
	".mypy_cache",
	"target",
	"vendor",
	".DS_Store",
]);

const IGNORED_SUFFIXES = [".pyc"];

/** Cap on the plain (no-query) response used as the client-side index */
const MAX_FILES = 5000;
/** Hard caps on the full in-memory listing that ?q= searches against */
const GIT_HARD_CAP = 200_000;
const WALK_HARD_CAP = 50_000;
const MAX_WALK_DEPTH = 8;
const MAX_QUERY_LENGTH = 500;
const CACHE_TTL_MS = 10_000;
const CACHE_MAX_ENTRIES = 20;

interface FileIndexEntry {
	/** Path relative to the session cwd, "/"-separated, no trailing slash */
	path: string;
	isDir: boolean;
}

interface FileListing {
	/** Full listing up to the hard cap (not the client cap) */
	files: string[];
	/** True when even the hard cap was exceeded */
	hardTruncated: boolean;
}

interface CacheEntry {
	listing: FileListing;
	/** Derived lazily on the first ?q= search against this listing */
	entries?: FileIndexEntry[];
	expiresAt: number;
}

const indexCache = new Map<string, CacheEntry>();

async function listWithGit(cwd: string): Promise<FileListing | null> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["-C", cwd, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
			{ timeout: 10_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
		);
		const all = stdout.split("\0").filter(Boolean);
		if (all.length > GIT_HARD_CAP) {
			return { files: all.slice(0, GIT_HARD_CAP), hardTruncated: true };
		}
		return { files: all, hardTruncated: false };
	} catch {
		// Not a git repo (or git unavailable) — caller falls back to readdir walk.
		return null;
	}
}

function listWithWalk(cwd: string): FileListing {
	const files: string[] = [];
	// BFS so shallow files win when the cap truncates the listing.
	const queue: Array<{ abs: string; rel: string; depth: number }> = [{ abs: cwd, rel: "", depth: 0 }];
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) break;
		const { abs, rel, depth } = current;
		let dirents: fs.Dirent[];
		try {
			dirents = fs.readdirSync(abs, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const d of dirents) {
			if (IGNORED_NAMES.has(d.name) || IGNORED_SUFFIXES.some(s => d.name.endsWith(s))) continue;
			const childRel = rel ? `${rel}/${d.name}` : d.name;
			if (d.isDirectory()) {
				if (depth + 1 <= MAX_WALK_DEPTH) {
					queue.push({ abs: path.join(abs, d.name), rel: childRel, depth: depth + 1 });
				}
			} else if (d.isFile()) {
				if (files.length >= WALK_HARD_CAP) {
					return { files, hardTruncated: true };
				}
				files.push(childRel);
			}
		}
	}
	return { files, hardTruncated: false };
}

function pathDepth(candidate: string): number {
	let depth = 0;
	for (let i = 0; i < candidate.length; i++) {
		if (candidate[i] === "/") depth++;
	}
	return depth;
}

/**
 * Build the entry list from the flat file list, deriving directory entries
 * from file paths (the index API only returns files). Base order is
 * shallow-first then alphabetical, which is what an empty @ query shows.
 */
function buildEntriesFromFiles(files: string[]): FileIndexEntry[] {
	const dirs = new Set<string>();
	for (const file of files) {
		let idx = file.indexOf("/");
		while (idx !== -1) {
			dirs.add(file.slice(0, idx));
			idx = file.indexOf("/", idx + 1);
		}
	}
	const entries: FileIndexEntry[] = [];
	for (const dir of dirs) entries.push({ path: dir, isDir: true });
	for (const file of files) {
		if (!file) continue;
		entries.push({ path: file, isDir: false });
	}
	entries.sort((a, b) => pathDepth(a.path) - pathDepth(b.path) || a.path.localeCompare(b.path));
	return entries;
}

function isSubsequence(needle: string, haystack: string): boolean {
	if (!needle) return true;
	let i = 0;
	for (let j = 0; j < haystack.length && i < needle.length; j++) {
		if (haystack[j] === needle[i]) i++;
	}
	return i === needle.length;
}

/**
 * TUI scoreEntry ladder (exact 100 / prefix 80 / substring 50 / path substring
 * 30, directories +10) plus a low-weight subsequence fallback so genuinely
 * fuzzy queries still find deep files.
 *
 * Queries containing "/" are ranked against the full relative path instead of
 * the basename — this is what makes drill-down work: after inserting "@src/",
 * the query "src/" prefix-matches every entry inside src/ (and excludes the
 * src directory itself, since "src" does not start with "src/").
 */
function scoreEntry(entry: FileIndexEntry, lowerQuery: string): number {
	const lowerPath = entry.path.toLowerCase();
	let score = 0;
	if (lowerQuery.includes("/")) {
		if (lowerPath === lowerQuery) score = 100;
		else if (lowerPath.startsWith(lowerQuery)) score = 80;
		else if (lowerPath.includes(lowerQuery)) score = 50;
		else if (isSubsequence(lowerQuery, lowerPath)) score = 10;
	} else {
		const slash = lowerPath.lastIndexOf("/");
		const lowerName = slash === -1 ? lowerPath : lowerPath.slice(slash + 1);
		if (lowerName === lowerQuery) score = 100;
		else if (lowerName.startsWith(lowerQuery)) score = 80;
		else if (lowerName.includes(lowerQuery)) score = 50;
		else if (lowerPath.includes(lowerQuery)) score = 30;
		else if (isSubsequence(lowerQuery, lowerPath)) score = 10;
	}
	if (entry.isDir && score > 0) score += 10;
	return score;
}

const AT_RESULT_LIMIT = 20;

function filterFileEntries(entries: FileIndexEntry[], query: string, limit = AT_RESULT_LIMIT): FileIndexEntry[] {
	const lowerQuery = query.toLowerCase();
	if (!lowerQuery) return entries.slice(0, limit);

	const scored: Array<{ entry: FileIndexEntry; score: number }> = [];
	for (const entry of entries) {
		const score = scoreEntry(entry, lowerQuery);
		if (score > 0) scored.push({ entry, score });
	}
	scored.sort(
		(a, b) =>
			b.score - a.score ||
			pathDepth(a.entry.path) - pathDepth(b.entry.path) ||
			a.entry.path.localeCompare(b.entry.path),
	);
	return scored.slice(0, limit).map(s => s.entry);
}

/** Drop cached listings (tests, and after a workspace switch). */
export function invalidateFileIndexCache(): void {
	indexCache.clear();
}

/** GET /api/file-index?cwd=/abs/path[&q=query] */
export async function handleFileIndexGet(req: Request): Promise<Response> {
	try {
		const searchParams = new URL(req.url).searchParams;
		const cwd = searchParams.get("cwd")?.trim() ?? "";
		if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
			return Response.json({ error: "cwd must be an absolute path" }, { status: 400 });
		}
		const query = searchParams.get("q")?.slice(0, MAX_QUERY_LENGTH) ?? "";

		const allowedRoots = await getAllowedFileRoots();
		if (!isFilePathAllowed(cwd, allowedRoots)) {
			return Response.json({ error: "Access denied" }, { status: 403 });
		}

		let cwdStat: fs.Stats;
		try {
			cwdStat = fs.statSync(cwd);
		} catch {
			return Response.json({ error: "Directory not found" }, { status: 404 });
		}
		if (!cwdStat.isDirectory()) {
			return Response.json({ error: "Not a directory" }, { status: 400 });
		}
		if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
			return Response.json({ error: "Access denied" }, { status: 403 });
		}

		const now = Date.now();
		let cached = indexCache.get(cwd);
		if (!cached || cached.expiresAt <= now) {
			const listing = (await listWithGit(cwd)) ?? listWithWalk(cwd);
			for (const [key, entry] of indexCache) {
				if (entry.expiresAt <= now) indexCache.delete(key);
			}
			if (indexCache.size >= CACHE_MAX_ENTRIES) indexCache.clear();
			cached = { listing, expiresAt: now + CACHE_TTL_MS };
			indexCache.set(cwd, cached);
		}

		if (query) {
			cached.entries ??= buildEntriesFromFiles(cached.listing.files);
			return Response.json({ matches: filterFileEntries(cached.entries, query) });
		}

		const { files, hardTruncated } = cached.listing;
		return Response.json({
			files: files.slice(0, MAX_FILES),
			truncated: hardTruncated || files.length > MAX_FILES,
		});
	} catch (error) {
		return Response.json({ error: String(error) }, { status: 500 });
	}
}

/**
 * Web Gateway — workspace/directory picker routes.
 *
 * Port of four Next routes that only ever needed filesystem access:
 *
 *   POST /api/default-cwd          → { cwd } (creates the stable workspace)
 *   GET  /api/cwd/browse?path=…    → { path, parentPath, directories }
 *   POST /api/cwd/validate         → { success, cwd }
 *   GET  /api/fs/directories?path= → { currentPath, parentPath, homeDir, drives, directories }
 *   POST /api/fs/directories       → { success, path } (new folder)
 *
 * `/api/cwd/browse` and `/api/fs/directories` are the OS directory picker: they
 * intentionally list any readable directory (that is how a user reaches a
 * project outside the current roots). Choosing a directory (`validate`, default
 * cwd, new folder) registers it in this process through `allowFileRoot`, which
 * is what makes `/api/files` and `/api/file-index` answer for it.
 */

import { existsSync, mkdirSync, readdirSync, statSync, type Stats } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { defaultCoordinatorWorkspace } from "../../default-workspace";
import { allowFileRoot } from "./file-roots";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

// ---------------------------------------------------------------------------
// Directory browser primitives
// ---------------------------------------------------------------------------

export interface BrowsableDirectory {
	name: string;
	path: string;
}

function getBrowseStartDirectory(directory?: string): string {
	return directory || os.homedir();
}

function normalizeDirectory(directory: string): string {
	if (directory === "~") return os.homedir();
	if (directory.startsWith("~/")) return path.resolve(os.homedir(), directory.slice(2));
	return path.resolve(directory);
}

function getParentDirectory(directory: string): string | null {
	// Pick the path family from the syntax, not from the platform: a POSIX
	// absolute path keeps POSIX parents even inside a Windows process.
	const pathApi =
		/^[a-zA-Z]:[\\/]/.test(directory) || directory.startsWith("\\\\")
			? path.win32
			: directory.startsWith("/")
				? path.posix
				: path;
	const normalized = pathApi.normalize(directory);
	const parent = pathApi.dirname(normalized);
	return parent === normalized ? null : parent;
}

async function resolveDirectory(directory: string): Promise<string> {
	return realpath(normalizeDirectory(directory));
}

async function listDirectories(directory: string): Promise<BrowsableDirectory[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	// Ignore broken, unreadable or non-directory symbolic links.
	const candidates = await Promise.all(
		entries.map(async entry => {
			if (entry.isDirectory()) {
				return { name: entry.name, path: path.join(directory, entry.name) };
			}
			if (!entry.isSymbolicLink()) return null;

			try {
				const entryPath = path.join(directory, entry.name);
				const realEntryPath = await realpath(entryPath);
				const entryStat = await stat(realEntryPath);
				if (!entryStat.isDirectory()) return null;
				return { name: entry.name, path: entryPath };
			} catch {
				return null;
			}
		}),
	);

	return candidates
		.filter((entry): entry is BrowsableDirectory => entry !== null)
		.sort((left, right) => left.name.localeCompare(right.name));
}

// ---------------------------------------------------------------------------
// /api/default-cwd
// ---------------------------------------------------------------------------

/** POST /api/default-cwd — create the stable default workspace and return it. */
export function handleDefaultCwdPost(): Response {
	try {
		const dir = defaultCoordinatorWorkspace();
		mkdirSync(dir, { recursive: true });
		allowFileRoot(dir);
		return json({ cwd: dir });
	} catch (error) {
		return json({ error: String(error) }, 500);
	}
}

// ---------------------------------------------------------------------------
// /api/cwd/browse
// ---------------------------------------------------------------------------

/** GET /api/cwd/browse?path=… — list the readable subdirectories. */
export async function handleCwdBrowseGet(req: Request): Promise<Response> {
	try {
		const requested = new URL(req.url).searchParams.get("path")?.trim();
		const candidate = getBrowseStartDirectory(requested);

		let resolved: string;
		try {
			resolved = await resolveDirectory(candidate);
		} catch {
			return json({ error: "Directory does not exist" }, 404);
		}

		const directoryStat = await stat(resolved);
		if (!directoryStat.isDirectory()) {
			return json({ error: "Path is not a directory" }, 400);
		}

		const directories = await listDirectories(resolved);

		return json({
			path: resolved,
			parentPath: getParentDirectory(resolved),
			directories,
		});
	} catch (error) {
		return json({ error: String(error) }, 500);
	}
}

// ---------------------------------------------------------------------------
// /api/cwd/validate
// ---------------------------------------------------------------------------

function normalizeCwd(cwd: string): string {
	if (cwd === "~") return os.homedir();
	if (cwd.startsWith("~/")) return path.resolve(os.homedir(), cwd.slice(2));
	return path.isAbsolute(cwd) ? cwd : path.resolve(cwd);
}

/** POST /api/cwd/validate `{ cwd }` — validate a candidate workspace. */
export async function handleCwdValidatePost(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { cwd?: unknown };
		const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";

		if (!cwd) {
			return json({ error: "Path is required" }, 400);
		}

		const normalizedCwd = normalizeCwd(cwd);
		let cwdStat: Stats;
		try {
			cwdStat = statSync(normalizedCwd);
		} catch {
			return json({ error: `Directory does not exist: ${cwd}` }, 400);
		}

		if (!cwdStat.isDirectory()) {
			return json({ error: `Path is not a directory: ${cwd}` }, 400);
		}

		allowFileRoot(normalizedCwd);
		return json({ success: true, cwd: normalizedCwd });
	} catch (error) {
		return json({ error: String(error) }, 500);
	}
}

// ---------------------------------------------------------------------------
// /api/fs/directories
// ---------------------------------------------------------------------------

function getWindowsDrives(): string[] {
	if (os.platform() !== "win32") return [];
	const drives: string[] = [];
	for (let i = 67; i <= 90; i++) {
		// C to Z
		const drive = `${String.fromCharCode(i)}:\\`;
		try {
			if (existsSync(drive)) drives.push(drive);
		} catch {
			// ignore unreadable drives
		}
	}
	return drives;
}

function normalizePath(inputPath?: string | null): string {
	if (!inputPath || !inputPath.trim()) return os.homedir();
	let candidate = inputPath.trim();
	if (candidate === "~" || candidate.startsWith("~/") || candidate.startsWith("~\\")) {
		candidate = path.join(os.homedir(), candidate.slice(1));
	}
	if (!path.isAbsolute(candidate)) candidate = path.resolve(candidate);
	return candidate;
}

/** GET /api/fs/directories?path=… — folders + drives for the OS directory picker. */
export async function handleFsDirectoriesGet(req: Request): Promise<Response> {
	try {
		const rawPath = new URL(req.url).searchParams.get("path");
		const targetPath = normalizePath(rawPath);

		if (!existsSync(targetPath)) {
			return json({ error: `Directory does not exist: ${targetPath}` }, 404);
		}

		const targetStat = statSync(targetPath);
		if (!targetStat.isDirectory()) {
			return json({ error: `Path is not a directory: ${targetPath}` }, 400);
		}

		const drives = getWindowsDrives();
		const parentPath = path.dirname(targetPath) !== targetPath ? path.dirname(targetPath) : null;

		const entries: Array<{ name: string; path: string; modified?: string }> = [];
		try {
			const dirents = readdirSync(targetPath, { withFileTypes: true });
			for (const dirent of dirents) {
				if (!dirent.isDirectory()) continue;
				const name = dirent.name;
				// Skip system/hidden system folders on Windows/Unix
				if (name === "$RECYCLE.BIN" || name === "System Volume Information" || name === "DumpStack.log.tmp") {
					continue;
				}

				const fullPath = path.join(targetPath, name);
				let modified: string | undefined;
				try {
					const subStat = statSync(fullPath);
					modified = subStat.mtime.toISOString();
				} catch {
					// ignore unreadable subfolders
				}
				entries.push({ name, path: fullPath, modified });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return json({ error: `Failed to read directory: ${message}` }, 403);
		}

		// Sort subdirectories alphabetically
		entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

		return json({
			currentPath: targetPath,
			parentPath,
			homeDir: os.homedir(),
			drives,
			directories: entries,
		});
	} catch (error) {
		return json({ error: String(error) }, 500);
	}
}

/** POST /api/fs/directories `{ parentPath, folderName }` — create a new folder. */
export async function handleFsDirectoriesPost(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { parentPath?: string; folderName?: string };
		const parentPath = normalizePath(body.parentPath);
		const folderName = body.folderName?.trim();

		if (!folderName) {
			return json({ error: "Folder name is required" }, 400);
		}

		const newPath = path.join(parentPath, folderName);
		if (existsSync(newPath)) {
			return json({ error: `Folder already exists: ${newPath}` }, 409);
		}

		mkdirSync(newPath, { recursive: true });
		allowFileRoot(newPath);

		return json({ success: true, path: newPath });
	} catch (error) {
		return json({ error: String(error) }, 500);
	}
}

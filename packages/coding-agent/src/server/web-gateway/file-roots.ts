/**
 * Web Gateway — browsable file roots and path confinement.
 *
 * Port of `web-ui/lib/allowed-roots.ts`, `file-access.ts` and
 * `path-security.ts`. The legacy Next server derived the set of readable
 * directories from the persisted sessions plus the stable default workspace;
 * every `/api/files*` and `/api/file-index` request is checked against it.
 *
 * The rules are reproduced verbatim:
 * - a path is allowed when it equals a root or sits below it (separator- and
 *   case-insensitive on Windows path syntax, independent of the host OS);
 * - an *existing* path is additionally checked after `realpath`, so a symlink
 *   inside an allowed root cannot redirect a read outside it;
 * - roots added at runtime (`allowFileRoot`) live in this process and are
 *   consulted for 5 seconds like the Next module-level cache.
 */

import { existsSync, readdirSync, realpathSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultCoordinatorWorkspace } from "../../default-workspace";
import { listAllSessionsWeb } from "./sessions";

const ALLOWED_ROOTS_TTL_MS = 5_000;
const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

/** Roots the user opened this process (validated cwds, created folders). */
const additionalRoots = new Set<string>();
let allowedRootsCache: { roots: Set<string>; expiresAt: number } | null = null;

export function normalizeSlashes(filePath: string): string {
	return filePath.replace(/\\/g, "/");
}

export function isWindowsAbsolutePath(filePath: string): boolean {
	return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

/**
 * Register a directory the user explicitly chose in this process. The Next
 * handlers called this after validating a cwd, creating the default workspace
 * or creating a folder, so the new root is readable before the next session
 * lands in it.
 */
export function allowFileRoot(root: string): void {
	if (!root) return;
	const normalizedRoot = normalizeSlashes(root);
	additionalRoots.add(normalizedRoot);
	allowedRootsCache?.roots.add(normalizedRoot);
}

/** Drop the 5s root cache (tests, and after a session list mutation). */
export function invalidateAllowedFileRoots(): void {
	allowedRootsCache = null;
}

export async function getAllowedFileRoots(): Promise<Set<string>> {
	const now = Date.now();
	const cached = allowedRootsCache;
	if (cached && cached.expiresAt > now) return cached.roots;

	const sessions = await listAllSessionsWeb();
	const roots = new Set<string>();
	for (const session of sessions) {
		if (session.cwd) roots.add(normalizeSlashes(session.cwd));
		// The project root (main repo shared by all worktrees) is browsable too —
		// the project dropdown lists it even when only worktrees have sessions.
		if (session.projectRoot) roots.add(normalizeSlashes(session.projectRoot));
	}

	const defaultWorkspace = defaultCoordinatorWorkspace();
	if (existsSync(defaultWorkspace)) roots.add(normalizeSlashes(defaultWorkspace));

	// Retain access to timestamped directories created by older default-cwd versions.
	try {
		for (const name of readdirSync(os.homedir())) {
			if (/^(omp|pi)-cwd-\d{8}$/.test(name)) {
				roots.add(normalizeSlashes(path.join(os.homedir(), name)));
			}
		}
	} catch {
		// Ignore an unreadable home directory.
	}

	for (const root of additionalRoots) roots.add(root);

	allowedRootsCache = { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS };
	return roots;
}

/**
 * Confinement check on the requested path itself. The path family follows the
 * syntax of the operands, not the host OS, so a POSIX path stays POSIX inside a
 * Windows process (the web UI can browse both).
 */
export function isFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
	for (const root of allowedRoots) {
		const useWindowsRules = isWindowsAbsolutePath(target) || isWindowsAbsolutePath(root);
		const resolver = useWindowsRules ? path.win32 : path;
		const sep = useWindowsRules ? "\\" : path.sep;
		const normalized = resolver.resolve(target);
		const normalizedRoot = resolver.resolve(root);
		const comparable = useWindowsRules ? normalized.toLowerCase() : normalized;
		const comparableRoot = useWindowsRules ? normalizedRoot.toLowerCase() : normalizedRoot;
		const rootWithSep = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
		if (comparable === comparableRoot || comparable.startsWith(rootWithSep)) {
			return true;
		}
	}
	return false;
}

/** Authorize an existing path after resolving symbolic links. */
export function isExistingFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
	let realTarget: string;
	try {
		realTarget = realpathSync(target);
	} catch {
		return false;
	}

	const realRoots = new Set<string>();
	for (const root of allowedRoots) {
		try {
			realRoots.add(realpathSync(root));
		} catch {
			// Ignore stale roots derived from removed sessions or worktrees.
		}
	}
	return isFilePathAllowed(realTarget, realRoots);
}

/**
 * Path containment for agent-authored development plugins.
 *
 * A dev plugin lives under `<agentDir>/plugins-dev/<sessionId>/<name>/` and is
 * the only place the lifecycle may create, replace, or delete files. Every
 * write path goes through {@link resolveDevPluginPath}; a caller never hands a
 * raw filesystem path to the lifecycle.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Root for session-scoped development plugins. */
export function devPluginsRoot(agentDir: string): string {
	return path.join(agentDir, "plugins-dev");
}

/** One session's development directory. */
export function sessionDevRoot(agentDir: string, sessionId: string): string {
	return path.join(devPluginsRoot(agentDir), safeSegment(sessionId, "session id"));
}

/** The production plugin directory a user promote writes to. */
export function promotedPluginsRoot(agentDir: string): string {
	return path.join(agentDir, "plugins");
}

/** Plugin names are package-directory-ish: no separators, no dot segments, no control bytes. */
export function isValidDevPluginName(name: string): boolean {
	return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name) && !name.includes("..") && !name.endsWith(".");
}

/** A single path segment that cannot escape its parent. */
export function safeSegment(value: string, field: string): string {
	if (
		value.length === 0 ||
		value.length > 128 ||
		value === "." ||
		value === ".." ||
		value.includes("\0") ||
		value.includes("/") ||
		value.includes("\\") ||
		// Windows drive/UNC prefixes only make sense when a caller passed a path.
		/^[a-zA-Z]:/.test(value)
	) {
		throw new Error(`Invalid ${field}.`);
	}
	return value;
}

/**
 * Resolve a plugin name under its session directory and prove the result stays
 * inside that directory after resolving the session root. `realpath` is used
 * for the root (which exists after scaffolding) and the lexical join for the
 * candidate, so a not-yet-created plugin is still checked.
 */
export function resolveDevPluginPath(agentDir: string, sessionId: string, name: string): string {
	if (!isValidDevPluginName(name)) throw new Error(`Invalid plugin name "${name}".`);
	const root = sessionDevRoot(agentDir, sessionId);
	const candidate = path.join(root, name);
	if (!isWithin(candidate, root)) throw new Error(`Plugin path escapes the session development directory.`);
	return candidate;
}

/** Whether `candidate` is the same as, or below, `root` (case-insensitive on Windows). */
export function isWithin(candidate: string, root: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(candidate));
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolve an existing file below `root` without following it outside. Returns
 * `undefined` for a missing path, a non-file, or a symlink that escapes.
 */
export function containedExistingFile(root: string, relativePath: string): string | undefined {
	if (relativePath.length === 0 || relativePath.includes("\0")) return undefined;
	const normalized = relativePath.replaceAll("\\", "/");
	if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return undefined;
	const segments = normalized.split("/");
	if (segments.some(segment => segment === "" || segment === "." || segment === "..")) return undefined;
	const candidate = path.join(root, ...segments);
	let stat: fs.Stats;
	try {
		stat = fs.statSync(candidate);
	} catch {
		return undefined;
	}
	if (!stat.isFile()) return undefined;
	try {
		const real = fs.realpathSync(candidate);
		const realRoot = fs.realpathSync(root);
		return isWithin(real, realRoot) ? real : undefined;
	} catch {
		return undefined;
	}
}

/** A directory listing of plugin names, ignoring hidden entries and files. */
export function listDevPluginNames(agentDir: string, sessionId: string): string[] {
	const root = sessionDevRoot(agentDir, sessionId);
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && isValidDevPluginName(entry.name))
		.map(entry => entry.name)
		.sort();
}

/**
 * Remove a tree without following links. `fs.rm(recursive)` follows junctions
 * on Windows in ways that can reach outside the tree; the development root is
 * user data, so unlink links as files and recurse only into real directories.
 */
export function removeTreeSafely(target: string, guardRoot: string): void {
	if (!isWithin(target, guardRoot) || path.resolve(target) === path.resolve(guardRoot)) {
		throw new Error("Refusing to remove a path outside its guard root.");
	}
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(target);
	} catch {
		return;
	}
	if (stat.isSymbolicLink() || stat.isFile()) {
		fs.unlinkSync(target);
		return;
	}
	if (!stat.isDirectory()) {
		fs.unlinkSync(target);
		return;
	}
	for (const entry of fs.readdirSync(target)) {
		removeTreeSafely(path.join(target, entry), guardRoot);
	}
	fs.rmdirSync(target);
}

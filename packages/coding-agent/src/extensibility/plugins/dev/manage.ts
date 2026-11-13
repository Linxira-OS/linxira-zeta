/**
 * User-only promotion and export of development plugins.
 *
 * These functions are called by the CLI (`zetacode plugin promote|export`),
 * never by the agent tool. Promotion copies a validated plugin into
 * `<agentDir>/plugins/<name>`, the same dropped-in root the native hosts read;
 * the next session loads it. Export copies it to a caller-chosen directory.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { validateDevPluginDirectory } from "./manifest";
import { isValidDevPluginName, isWithin, promotedPluginsRoot, removeTreeSafely, sessionDevRoot } from "./paths";

export interface PromoteOptions {
	readonly agentDir: string;
	readonly sessionId: string;
	readonly name: string;
	/** User explicitly chose to replace an existing promoted copy. */
	readonly overwrite?: boolean;
}

export interface ExportedDevPlugin {
	readonly source: string;
	readonly destination: string;
	readonly files: number;
}

function copyTree(source: string, destination: string): number {
	let files = 0;
	const visit = (from: string, to: string): void => {
		const stat = fs.lstatSync(from);
		if (stat.isSymbolicLink()) {
			// Preserve the link itself: dereferencing could copy a host package or
			// a directory outside the plugin into the promoted tree.
			fs.symlinkSync(fs.readlinkSync(from), to);
			return;
		}
		if (stat.isDirectory()) {
			fs.mkdirSync(to, { recursive: true });
			for (const entry of fs.readdirSync(from)) {
				if (entry === ".git") continue;
				visit(path.join(from, entry), path.join(to, entry));
			}
			return;
		}
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.copyFileSync(from, to);
		files += 1;
	};
	visit(source, destination);
	return files;
}

function validatedSource(agentDir: string, sessionId: string, name: string): string {
	const validation = validateDevPluginDirectory(agentDir, sessionId, name);
	if (!validation.ok) throw new Error(validation.errors.join("\n"));
	return validation.root;
}

/**
 * Copy a validated dev plugin into the promoted plugin root. The copy lands in
 * a sibling staging directory first, so an interrupted copy never looks like a
 * loadable plugin; the rename is the commit.
 */
export function promoteDevPlugin(options: PromoteOptions): { path: string; files: number } {
	if (!isValidDevPluginName(options.name)) throw new Error(`Invalid plugin name "${options.name}".`);
	const source = validatedSource(options.agentDir, options.sessionId, options.name);
	const root = promotedPluginsRoot(options.agentDir);
	const target = path.join(root, options.name);
	if (!isWithin(target, root)) throw new Error("Promoted path escapes the plugin root.");
	if (fs.existsSync(target)) {
		if (!options.overwrite) {
			throw new Error(`Plugin "${options.name}" already exists at ${target}. Re-run with --force to replace it.`);
		}
		removeTreeSafely(target, root);
	}
	fs.mkdirSync(root, { recursive: true });
	const staging = path.join(root, `.${options.name}.promote-${process.pid}-${Date.now()}`);
	try {
		const files = copyTree(source, staging);
		fs.renameSync(staging, target);
		return { path: target, files };
	} catch (error) {
		removeTreeSafely(staging, root);
		throw error;
	}
}

/**
 * Copy a validated dev plugin to a user-chosen directory. The destination may
 * be any directory the user can write; it may not be inside the session's dev
 * root (that would be a second copy the lifecycle would later reload).
 */
export function exportDevPlugin(options: {
	agentDir: string;
	sessionId: string;
	name: string;
	destination: string;
	overwrite?: boolean;
}): ExportedDevPlugin {
	const source = validatedSource(options.agentDir, options.sessionId, options.name);
	const destination = path.resolve(options.destination);
	const devRoot = sessionDevRoot(options.agentDir, options.sessionId);
	if (isWithin(destination, devRoot)) {
		throw new Error("Export destination must be outside the session development directory.");
	}
	if (fs.existsSync(destination)) {
		if (!options.overwrite)
			throw new Error(`Export destination ${destination} already exists. Use --force to replace it.`);
		removeTreeSafely(destination, path.dirname(destination));
	}
	const files = copyTree(source, destination);
	return { source, destination, files };
}

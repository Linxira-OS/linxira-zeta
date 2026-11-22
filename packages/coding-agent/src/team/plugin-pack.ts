/**
 * Persona-scoped development plugin packs. A persona's pack is data under the
 * Team's `.zeta/personas` root; promoting it is an explicit user-chosen copy,
 * never an automatic install or a global plugin mutation.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TeamPersonaPack } from "./persona-pack";

export interface PersonaPluginSource {
	readonly root: string;
	readonly files: readonly string[];
	readonly hash: string;
}

function contained(root: string, target: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(target));
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function walk(root: string, current = root, out: string[] = []): Promise<string[]> {
	for (const entry of await fs.readdir(current, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		const target = path.join(current, entry.name);
		if (entry.isDirectory()) await walk(root, target, out);
		else if (entry.isFile()) out.push(path.relative(root, target).split(path.sep).join("/"));
	}
	return out.sort();
}

export async function readPersonaPluginSource(teamRoot: string, pack: TeamPersonaPack): Promise<PersonaPluginSource> {
	if (!pack.pluginPack) throw new Error(`Persona ${pack.id} has no plugin pack`);
	const personasRoot = path.join(teamRoot, ".zeta", "personas");
	const root = path.resolve(teamRoot, ".zeta", "personas", pack.pluginPack.root);
	if (!contained(personasRoot, root)) throw new Error("Persona plugin pack escapes the Team persona root");
	const stat = await fs.stat(root);
	if (!stat.isDirectory()) throw new Error("Persona plugin pack is not a directory");
	const files = await walk(root);
	const hash = createHash("sha256");
	for (const file of files) {
		hash.update(file);
		hash.update("\0");
		hash.update(await fs.readFile(path.join(root, file)));
	}
	return { root, files, hash: hash.digest("hex") };
}

/** Copy a persona pack to a user-chosen target. Refuses a non-empty target. */
export async function promotePersonaPluginPack(
	teamRoot: string,
	pack: TeamPersonaPack,
	target: string,
): Promise<{ readonly target: string; readonly files: readonly string[] }> {
	const source = await readPersonaPluginSource(teamRoot, pack);
	const destination = path.resolve(target);
	if (contained(source.root, destination)) throw new Error("Promotion target must be outside the persona pack");
	try {
		const entries = await fs.readdir(destination);
		if (entries.length > 0) throw new Error(`Promotion target is not empty: ${destination}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	await fs.mkdir(destination, { recursive: true });
	for (const file of source.files) {
		const to = path.join(destination, ...file.split("/"));
		await fs.mkdir(path.dirname(to), { recursive: true });
		await fs.copyFile(path.join(source.root, ...file.split("/")), to);
	}
	return { target: destination, files: source.files };
}

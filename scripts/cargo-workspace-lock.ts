/**
 * Cargo.lock rewriting for a workspace whose members ride the release line.
 *
 * `release-v2.ts` bumps `[workspace.package] version` in `Cargo.toml` and
 * `main/Cargo.toml`; the lock file keeps one `version` per `[[package]]` entry,
 * and a stale one makes every `--locked` build fail with
 * "the lock file needs to be updated". The root workspace used to be patched
 * with a `pi-*` name regex, which silently missed the workbench: `main/` has
 * four members (`zeta-main`, `zetawork-gui`, `sysmon`, `workbench-projects`)
 * and only `zeta-main` was rewritten, so `cargo build --locked` in `main/`
 * failed on the three siblings after a bump.
 *
 * Members come from the workspace manifest (`members = ["crates/*"]`), then
 * each member's own `[package] name` — never a name pattern, so vendored path
 * dependencies that deliberately keep their upstream version are left alone.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface CargoWorkspaceMember {
	/** Crate name as Cargo writes it (`name = "<name>"` in the lock entry). */
	name: string;
	/** Repo-relative manifest path, e.g. `main/crates/sysmon/Cargo.toml`. */
	manifest: string;
}

const repoRoot = path.resolve(import.meta.dir, "..");

/** Expand a workspace `members` glob (`crates/*`) into repo-relative crate manifests. */
export function workspaceMemberManifests(workspaceManifest: string, manifestDir: string): string[] {
	const members = /^\s*members\s*=\s*\[([^\]]*)\]/m.exec(workspaceManifest)?.[1];
	if (members === undefined) return [];
	const manifests: string[] = [];
	for (const raw of members.split(",")) {
		const member = raw.trim().replace(/^"|"$/g, "");
		if (!member) continue;
		if (!member.includes("*")) {
			manifests.push(path.posix.join(manifestDir, member, "Cargo.toml"));
			continue;
		}
		const [prefix, suffix] = member.split("*");
		const parent = path.posix.join(manifestDir, prefix);
		const entries = fs.existsSync(path.join(repoRoot, parent)) ? fs.readdirSync(path.join(repoRoot, parent)) : [];
		for (const entry of entries.sort()) {
			const candidate = `${parent}${entry}${suffix}`;
			if (fs.existsSync(path.join(repoRoot, candidate, "Cargo.toml"))) {
				manifests.push(`${candidate}/Cargo.toml`);
			}
		}
	}
	return manifests;
}

/** Workspace members of `main/`, in manifest order. */
export function mainWorkspaceMembers(): CargoWorkspaceMember[] {
	const workspaceManifest = fs.readFileSync(path.join(repoRoot, "main", "Cargo.toml"), "utf8");
	return workspaceMemberManifests(workspaceManifest, "main").flatMap(manifest => {
		const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(repoRoot, manifest), "utf8"))?.[1];
		return name ? [{ name, manifest }] : [];
	});
}

/** `[[package]] version` for each named crate, or undefined when absent. */
export function pinnedWorkspaceVersions(lock: string, names: readonly string[]): Map<string, string> {
	const lines = lock.split(/\r?\n/);
	const pinned = new Map<string, string>();
	for (const name of names) {
		const index = lines.findIndex(line => line === `name = "${name}"`);
		const version = index === -1 ? undefined : /^version = "([^"]+)"$/.exec(lines[index + 1] ?? "")?.[1];
		if (version !== undefined) pinned.set(name, version);
	}
	return pinned;
}

/**
 * Rewrite every named crate's lock `version`. Returns the new lock and the
 * names it actually found — a member absent from the lock is a bug in the
 * caller's member list, so this throws instead of skipping it.
 */
export function rewriteWorkspaceVersions(
	lock: string,
	names: readonly string[],
	version: string,
): { lock: string; rewritten: string[] } {
	const lines = lock.split(/\r?\n/);
	const rewritten: string[] = [];
	for (const name of names) {
		const index = lines.findIndex(line => line === `name = "${name}"`);
		const pinned = /^version = "([^"]+)"$/.exec(lines[index + 1] ?? "");
		if (index === -1 || !pinned)
			throw new Error(`Cargo.lock has no [[package]] entry for workspace member "${name}"`);
		lines[index + 1] = `version = "${version}"`;
		rewritten.push(name);
	}
	return { lock: lines.join("\n"), rewritten };
}

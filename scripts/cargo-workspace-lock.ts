/**
 * Expand a Cargo workspace's `members` list into repo-relative crate manifests.
 *
 * The root workspace is the only active Rust workspace after the Zetawork
 * retirement. The retired workbench is intentionally excluded from active
 * release-version checks; do not reintroduce a `main/Cargo.toml` dependency
 * here without a new ADR.
 */
import * as fs from "node:fs";
import * as path from "node:path";

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

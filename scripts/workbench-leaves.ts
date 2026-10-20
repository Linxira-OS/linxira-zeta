/**
 * The workbench platform leaves' committed binaries and their freshness stamp.
 *
 * The manifests (`main/npm/main-<platform>`, `termide/npm/ide-<platform>`) ride
 * the release version line, but the binaries beside them are built out of
 * band and committed. Nothing in CI rebuilds them, so "exists" was the only
 * thing anyone checked: a leaf published under a bumped version still shipped
 * the previous release's workbench.
 *
 * `bun scripts/stamp-workbench-leaves.ts` writes `bin/<binary>.stamp.json`
 * (`{ version, sha256 }`) after a rebuild, and `scripts/check-workbench-bundles.ts`
 * fails when the stamp is missing, names another version, or hashes different
 * bytes. Both import this table so the leaf list cannot drift.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { compareVersions } from "../packages/utils/src/version";

/** Written next to a leaf binary: `bin/zeta.exe.stamp.json`. */
export const STAMP_SUFFIX = ".stamp.json";

export interface WorkbenchLeaf {
	/** Repo-relative leaf directory. */
	dir: string;
	/** Binary filename inside `<dir>/bin/`. */
	binary: string;
}

/** Every workbench platform leaf, both platforms of both launchers. */
export const WORKBENCH_LEAVES: readonly WorkbenchLeaf[] = [
	{ dir: "main/npm/main-windows-x64", binary: "zeta.exe" },
	{ dir: "main/npm/main-linux-x64", binary: "zeta-linux-x64" },
	{ dir: "termide/npm/ide-windows-x64", binary: "termide.exe" },
	{ dir: "termide/npm/ide-linux-x64", binary: "termide-linux-x64" },
];

export interface LeafStamp {
	version: string;
	sha256: string;
}

/** Stamp one leaf binary for `version`; returns the written stamp. */
export function writeLeafStamp(root: string, leaf: WorkbenchLeaf, version: string): LeafStamp {
	const binaryPath = path.join(root, leaf.dir, "bin", leaf.binary);
	const sha256 = new Bun.CryptoHasher("sha256").update(fs.readFileSync(binaryPath)).digest("hex");
	const stamp: LeafStamp = { version, sha256 };
	fs.writeFileSync(`${binaryPath}${STAMP_SUFFIX}`, `${JSON.stringify(stamp, null, "\t")}\n`);
	return stamp;
}

/**
 * Why a leaf payload is stale, or undefined when it is current.
 *
 * The stamp is a *floor*, not an equality: a binary may be rebuilt ahead of the
 * manifest (the release ritual rebuilds leaves before the bump commit lifts the
 * version), but a stamp older than the manifest means the published leaf would
 * carry the previous release's workbench. The hash pins the payload either way.
 */
export function leafStampProblem(
	stamp: LeafStamp | undefined,
	manifestVersion: string,
	actualSha256: string,
): string | undefined {
	if (!stamp) return "no stamp — rebuild the binary and run bun scripts/stamp-workbench-leaves.ts";
	if (stamp.version === undefined || compareVersions(stamp.version, manifestVersion) < 0) {
		return `stamped at ${stamp.version ?? "<missing>"}, manifest says ${manifestVersion} — the binary was not rebuilt for this release`;
	}
	if (stamp.sha256 !== actualSha256) {
		return "sha256 does not match the stamp — re-run bun scripts/stamp-workbench-leaves.ts after rebuilding";
	}
	return undefined;
}

#!/usr/bin/env bun
/**
 * Stamp the workbench platform leaves.
 *
 * `main/npm/main-<platform>/bin/` and `termide/npm/ide-<platform>/bin/` hold
 * committed release binaries: nothing regenerates them from source in CI, and
 * the manifest version moves with every release bump. Without a stamp, a leaf
 * whose binary was never rebuilt still publishes under the new version and
 * every install of that platform gets the previous release's workbench — the
 * "only checked for existence" half of the release-surface audit.
 *
 * After rebuilding a leaf binary, run this (the release ritual commits the
 * binary and its stamp together):
 *
 *   bun scripts/stamp-workbench-leaves.ts            # all leaves
 *   bun scripts/stamp-workbench-leaves.ts main      # one distribution
 *
 * It writes `bin/<binary>.stamp.json` with the leaf manifest's version and the
 * binary's sha256. `scripts/check-workbench-bundles.ts` fails when the stamp is
 * missing, names another version, or hashes a different byte stream.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { WORKBENCH_LEAVES, writeLeafStamp } from "./workbench-leaves";

const ROOT = path.resolve(import.meta.dir, "..");

const filter = process.argv[2];
const stamped: string[] = [];

for (const leaf of WORKBENCH_LEAVES) {
	if (filter && !leaf.dir.includes(filter)) continue;
	const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, leaf.dir, "package.json"), "utf8")) as {
		version?: string;
	};
	if (!manifest.version) throw new Error(`${leaf.dir}/package.json has no version`);
	const binaryPath = path.join(ROOT, leaf.dir, "bin", leaf.binary);
	if (!fs.existsSync(binaryPath)) throw new Error(`${leaf.dir}/bin/${leaf.binary}: missing — rebuild the leaf first`);
	writeLeafStamp(ROOT, leaf, manifest.version);
	stamped.push(`${leaf.dir}/bin/${leaf.binary} (${manifest.version})`);
}

console.log(`Stamped ${stamped.length} workbench leaf binar${stamped.length === 1 ? "y" : "ies"}:`);
for (const line of stamped) console.log(`  ${line}`);

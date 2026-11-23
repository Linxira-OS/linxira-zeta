#!/usr/bin/env bun
/**
 * Committed browser-relay extension asset freshness guard.
 *
 * `extension.generated.json` is the bundle `zetacode browser-relay install`
 * serves out of the compiled binary. It is derived from
 * `packages/browser-relay/extension/` by the same builder the release uses, so
 * a source change that leaves the checked-in copy stale is a red check on the
 * PR that caused it.
 *
 * The builder runs through the package script so it resolves modules from the
 * same workspace root as a release build.
 *
 * Usage: bun run check:relay-assets   (gate mode; exit 0/1)
 * Fix:   bun run gen:relay-assets     (regenerates the committed copy)
 */

import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const relayDir = path.join(repoRoot, "packages/browser-relay");
const embeddedFile = path.join(repoRoot, "packages/coding-agent/src/tools/browser/relay/extension.generated.json");

async function main(): Promise<void> {
	const committed = await Bun.file(embeddedFile)
		.text()
		.catch(() => undefined);
	const build = Bun.spawnSync(["bun", "run", "gen:embedded"], {
		cwd: relayDir,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (build.exitCode !== 0) {
		console.error("extension asset freshness FAILED: the asset build could not run");
		console.error(build.stderr.toString().trim());
		process.exit(1);
	}
	const generated = await Bun.file(embeddedFile).text();
	if (committed === undefined) {
		console.error(`extension asset freshness FAILED: ${path.relative(repoRoot, embeddedFile)} is missing`);
		process.exit(1);
	}
	if (committed !== generated) {
		// Leave the checkout as we found it; the fix is a deliberate regeneration.
		await Bun.write(embeddedFile, committed);
		console.error(
			`extension asset freshness FAILED: ${path.relative(repoRoot, embeddedFile)} is stale\n` +
				"Fix: bun run gen:relay-assets",
		);
		process.exit(1);
	}
	console.log(`browser-relay extension assets are fresh: ${generated.length} bytes`);
}

if (import.meta.main) await main();

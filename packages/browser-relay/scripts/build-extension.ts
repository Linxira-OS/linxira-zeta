/**
 * Builds the browser relay extension and its distribution artifacts:
 * - `dist/extension/` — unpacked extension (load via chrome://extensions)
 * - `dist/zeta-browser-relay-extension.zip` — packaged extension for GH releases
 * - `../coding-agent/src/tools/browser/relay/extension-assets/*.txt` —
 *   generated text assets embedded into the omp CLI so `zetacode browser-relay
 *   install` works from the compiled binary (same committed-generated-output
 *   pattern as tool-views.generated.js). Re-run this script after touching
 *   anything under `extension/` and commit the regenerated assets.
 *
 * Dependency-free on purpose: CI runs this without `bun install`. The asset
 * half is exported because `scripts/check-extension-assets-freshness.ts` and
 * the `--assets-only` path regenerate the committed embeds without the `zip`
 * binary the packaging half needs.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { $ } from "bun";

const root = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(root, "../..");
const extensionDir = path.join(root, "extension");
const dist = path.join(root, "dist");
const distExtension = path.join(dist, "extension");

/** The committed CLI embeds, read back by `zetacode browser-relay install`. */
export const EMBEDDED_ASSETS_DIR = path.resolve(root, "../coding-agent/src/tools/browser/relay/extension-assets");

/**
 * Staged build file → committed asset, in copy order, with the derivation the
 * failure report names. Every derived artifact is a byte-for-byte copy of a
 * staged build file, so the committed set is exactly reproducible from
 * `extension/` + the root license files.
 */
export const EMBEDDED_ASSETS: ReadonlyArray<{ staged: string; asset: string; from: string }> = [
	{
		staged: "background.js",
		asset: "background.js.txt",
		from: "bundled from packages/browser-relay/extension/background.ts",
	},
	...(["manifest.json", "options.html", "options.js"] as const).map(file => ({
		staged: file,
		asset: `${file}.txt`,
		from: `copied from packages/browser-relay/extension/${file}`,
	})),
	...(
		[
			["LICENSE", "LICENSE.txt"],
			["THIRD-PARTY-NOTICES.txt", "THIRD-PARTY-NOTICES.txt"],
		] as const
	).map(([staged, asset]) => ({ staged, asset, from: `copied from the repo-root ${staged}` })),
];

/** Bundle `extension/background.ts` into `outDir` and stage the verbatim files beside it. */
export async function buildUnpackedExtension(outDir: string): Promise<void> {
	// Bun labels each bundled module with its path relative to the process cwd
	// (`// extension/background.ts`), and those labels are committed verbatim in
	// `background.js.txt`. Pin the cwd to the package root so the same sources
	// generate the same bytes no matter which directory the caller ran from.
	const cwd = process.cwd();
	process.chdir(root);
	try {
		const bundle = await Bun.build({
			entrypoints: [path.join(extensionDir, "background.ts")],
			outdir: outDir,
			target: "browser",
			sourcemap: "none",
		});
		if (!bundle.success) {
			for (const log of bundle.logs) console.error(log);
			throw new Error("background.ts bundle failed");
		}
		for (const file of ["manifest.json", "options.html", "options.js"]) {
			await Bun.write(path.join(outDir, file), Bun.file(path.join(extensionDir, file)));
		}
		for (const file of ["LICENSE", "THIRD-PARTY-NOTICES.txt"]) {
			await Bun.write(path.join(outDir, file), Bun.file(path.join(repoRoot, file)));
		}
	} finally {
		process.chdir(cwd);
	}
}

/** Byte-copy every `EMBEDDED_ASSETS` pair from a staged build into `destinationDir`. */
export async function copyEmbeddedAssets(fromDir: string, destinationDir: string): Promise<void> {
	for (const { staged, asset } of EMBEDDED_ASSETS) {
		await Bun.write(path.join(destinationDir, asset), Bun.file(path.join(fromDir, staged)));
	}
}

/** Replace the committed asset directory with the staged build output. */
export async function writeEmbeddedAssets(fromDir: string): Promise<void> {
	await fs.rm(EMBEDDED_ASSETS_DIR, { recursive: true, force: true });
	await copyEmbeddedAssets(fromDir, EMBEDDED_ASSETS_DIR);
}

async function main(): Promise<void> {
	// `--assets-only` refreshes the committed embeds without packaging: the zip
	// half needs the `zip` binary, the embed half does not.
	const assetsOnly = process.argv.includes("--assets-only");
	await fs.rm(dist, { recursive: true, force: true });
	await fs.mkdir(distExtension, { recursive: true });
	await buildUnpackedExtension(distExtension);

	if (!assetsOnly) {
		const zip = await $`zip -qr ../zeta-browser-relay-extension.zip .`.cwd(distExtension).nothrow();
		if (zip.exitCode !== 0) {
			console.error("zip failed:", zip.stderr.toString());
			process.exit(1);
		}
	}

	await writeEmbeddedAssets(distExtension);

	console.log("built:");
	if (!assetsOnly) {
		console.log(`  ${distExtension}`);
		console.log(`  ${path.join(dist, "zeta-browser-relay-extension.zip")}`);
	}
	console.log(`  ${EMBEDDED_ASSETS_DIR} (embedded CLI assets — commit these)`);
}

if (import.meta.main) await main();

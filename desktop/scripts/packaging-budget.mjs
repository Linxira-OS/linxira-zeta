/**
 * Installed-size invariants for a packaged desktop app.
 *
 * Two packaging mistakes silently add hundreds of megabytes to every install:
 *
 *  - Native addons staged beside the kernel binary. The standalone kernel
 *    (`zeta`/`zeta.exe`) embeds the target's addon as zstd frames
 *    (`packages/natives/scripts/embed-native.ts`) and extracts them into the
 *    user cache on first run, so an adjacent `.node` copy is only a fallback
 *    that duplicated 124 MiB (45.8 MiB compressed) in the 1.5.1 Windows build.
 *  - Electron's full locale set. electron-builder copies all ~56 `.pak` files
 *    (~42 MiB) unless `electronLanguages` narrows them down.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Chromium locale packs the product actually ships. */
export const SHIPPED_ELECTRON_LOCALES = Object.freeze(["en-US.pak", "zh-CN.pak"]);

/** Resource directory holding `app.asar`, `zeta/`, `bin/` and `locales/`. */
export function appResourceDir(root, platform = process.platform) {
	return platform === "darwin" ? path.join(root, "Contents", "Resources") : path.join(root, "resources");
}

function fileSizes(dir, names) {
	let bytes = 0;
	for (const name of names) bytes += fs.statSync(path.join(dir, name)).size;
	return bytes;
}

/**
 * Reject a packaged app tree that regressed past the size budget.
 *
 * @param {string} root Unpacked app directory (`win-unpacked`, `linux-unpacked`
 *   or the `.app` bundle on darwin).
 * @param {string} [platform] Platform id, defaults to the host.
 * @throws when native addons were staged beside the kernel or unlisted locales ship.
 */
export function assertLeanAppTree(root, platform = process.platform) {
	const problems = [];
	const resourceDir = appResourceDir(root, platform);

	const zetaDir = path.join(resourceDir, "zeta");
	const addons = fs.existsSync(zetaDir) ? fs.readdirSync(zetaDir).filter(name => name.endsWith(".node")) : [];
	if (addons.length > 0) {
		const mib = (fileSizes(zetaDir, addons) / 2 ** 20).toFixed(1);
		problems.push(
			`native addons staged beside the kernel (${addons.join(", ")}, ${mib} MiB): ` +
				"the compiled kernel embeds its addon and extracts it on first run, so these only duplicate it in every install",
		);
	}

	// Chromium's locale packs sit next to `resources/` on Windows and Linux;
	// macOS ships localized .lproj bundles inside the framework instead.
	if (platform !== "darwin") {
		const localesDir = path.join(root, "locales");
		const locales = fs.existsSync(localesDir) ? fs.readdirSync(localesDir).filter(name => name.endsWith(".pak")) : [];
		const unexpected = locales.filter(name => !SHIPPED_ELECTRON_LOCALES.includes(name));
		if (unexpected.length > 0) {
			problems.push(
				`${unexpected.length} locale pack(s) outside electronLanguages: ${unexpected.join(", ")}; ` +
					`set electronLanguages in electron-builder.yml to ${SHIPPED_ELECTRON_LOCALES.join(", ")}`,
			);
		}
	}

	if (problems.length > 0) {
		throw new Error(`desktop package is larger than the shipped size budget:\n- ${problems.join("\n- ")}`);
	}
}

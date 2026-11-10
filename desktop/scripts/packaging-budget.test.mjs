import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { appResourceDir, assertLeanAppTree, SHIPPED_ELECTRON_LOCALES } from "./packaging-budget.mjs";

function appTree(platform, build) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-packaging-budget-"));
	const resourceDir = appResourceDir(root, platform);
	fs.mkdirSync(path.join(resourceDir, "zeta"), { recursive: true });
	if (platform !== "darwin") fs.mkdirSync(path.join(root, "locales"), { recursive: true });
	build(root, resourceDir);
	return root;
}

function withLocales(root, names) {
	for (const name of names) fs.writeFileSync(path.join(root, "locales", name), "pak");
}

test("accepts a tree with the kernel binary and only the shipped locales", () => {
	for (const platform of ["win32", "linux"]) {
		const root = appTree(platform, (treeRoot, resourceDir) => {
			fs.writeFileSync(path.join(resourceDir, "zeta", platform === "win32" ? "zeta.exe" : "zeta"), "bin");
			withLocales(treeRoot, SHIPPED_ELECTRON_LOCALES);
		});
		assert.doesNotThrow(() => assertLeanAppTree(root, platform));
	}
});

test("rejects native addons staged beside the kernel", () => {
	const root = appTree("win32", (treeRoot, resourceDir) => {
		fs.writeFileSync(path.join(resourceDir, "zeta", "pi_natives.win32-x64-baseline.node"), Buffer.alloc(2 * 2 ** 20));
		withLocales(treeRoot, SHIPPED_ELECTRON_LOCALES);
	});
	assert.throws(() => assertLeanAppTree(root, "win32"), /native addons staged beside the kernel.*2\.0 MiB/su);
});

test("rejects locale packs outside electronLanguages", () => {
	const root = appTree("linux", (treeRoot, resourceDir) => {
		fs.writeFileSync(path.join(resourceDir, "zeta", "zeta"), "bin");
		withLocales(treeRoot, [...SHIPPED_ELECTRON_LOCALES, "de.pak", "fr.pak"]);
	});
	assert.throws(() => assertLeanAppTree(root, "linux"), /2 locale pack\(s\) outside electronLanguages: de\.pak, fr\.pak/su);
});

test("checks the macOS Contents/Resources layout", () => {
	const root = appTree("darwin", (_, resourceDir) => {
		fs.writeFileSync(path.join(resourceDir, "zeta", "zeta"), "bin");
	});
	assert.doesNotThrow(() => assertLeanAppTree(root, "darwin"));

	fs.writeFileSync(path.join(root, "Contents", "Resources", "zeta", "pi_natives.darwin-arm64.node"), "addon");
	assert.throws(() => assertLeanAppTree(root, "darwin"), /native addons staged beside the kernel/su);
});

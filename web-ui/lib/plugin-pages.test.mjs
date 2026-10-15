import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// jiti (like the component tests) resolves the extensionless `@/lib/*` imports
// this module uses; bare `node --test` type-stripping cannot.
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { pluginAssetUrl, readPluginPages, readPluginPackages, resolvePluginAsset } = await jiti.import(
	"./plugin-pages.ts"
);

/** A real plugin package on disk: package.json + manifest + pages. */
function makePlugin(root, dir, { name, files, manifestKey = "zeta" }) {
	const packageDir = path.join(root, dir);
	mkdirSync(packageDir, { recursive: true });
	writeFileSync(
		path.join(packageDir, "package.json"),
		JSON.stringify({ name, version: "9.9.9", [manifestKey]: { extensions: ["./index.ts"] } }, null, 2),
	);
	writeFileSync(path.join(packageDir, "index.ts"), "export {};\n");
	for (const [relative, body] of Object.entries(files)) {
		const target = path.join(packageDir, relative);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, body);
	}
	return packageDir;
}

function withFixture(run) {
	const root = mkdtempSync(path.join(tmpdir(), "zeta-web-plugin-"));
	try {
		return run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("reads pages, titles and asset urls out of plugin packages", () => {
	withFixture(root => {
		makePlugin(root, "node_modules/@linxiraos/pi-messenger", {
			name: "@linxiraos/pi-messenger",
			files: {
				"ui/board.html": "<html><head><title>Task Board</title></head><body>board</body></html>",
				"ui/roster.htm": "<html><head><title>Roster</title></head></html>",
				"ui/board.js": "console.log(1);",
				"ui/nested/notes.txt": "not a page",
				"node_modules/ignored/dep.html": "<title>dependency</title>",
				"tests/fixture.html": "<title>test fixture</title>",
			},
		});
		makePlugin(root, "node_modules/not-a-plugin", {
			name: "not-a-plugin",
			files: { "page.html": "<title>nope</title>" },
		});
		// Strip the manifest so the package is not a plugin.
		writeFileSync(
			path.join(root, "node_modules/not-a-plugin/package.json"),
			JSON.stringify({ name: "not-a-plugin", version: "1.0.0" }),
		);

		const packages = readPluginPackages([root]);
		assert.equal(packages.length, 1);
		const [messenger] = packages;
		assert.equal(messenger.id, "pi-messenger");
		assert.equal(messenger.name, "@linxiraos/pi-messenger");
		assert.deepEqual(
			messenger.pages.map(page => page.path),
			["ui/board.html", "ui/roster.htm"],
		);
		assert.deepEqual(
			messenger.pages.map(page => page.title),
			["Task Board", "Roster"],
		);
		assert.equal(messenger.pages[0].url, "/api/plugin-assets/pi-messenger/ui/board.html");
		assert.equal(pluginAssetUrl("pi-messenger", "ui/a b.html"), "/api/plugin-assets/pi-messenger/ui/a%20b.html");
	});
});

test("resolves a plugin by id, package name or package basename", () => {
	withFixture(root => {
		makePlugin(root, "node_modules/@linxiraos/pi-messenger", {
			name: "@linxiraos/pi-messenger",
			files: { "index.html": "<title>Index</title>" },
		});

		for (const alias of ["pi-messenger", "@linxiraos/pi-messenger", "PI-MESSENGER"]) {
			const found = readPluginPages(alias, [root]);
			assert.ok(found, `expected ${alias} to resolve`);
			assert.equal(found.id, "pi-messenger");
		}
		assert.equal(readPluginPages("unknown-plugin", [root]), null);
	});
});

test("serves any file inside the package and refuses anything outside it", () => {
	withFixture(root => {
		const packageDir = makePlugin(root, "node_modules/pi-messenger", {
			name: "pi-messenger",
			files: { "ui/board.html": "<title>Board</title>", "ui/board.css": "body{}" },
		});
		writeFileSync(path.join(root, "secret.txt"), "top secret");

		const asset = resolvePluginAsset("pi-messenger", ["ui", "board.css"], [root]);
		assert.ok(asset.ok);
		assert.equal(asset.file, path.join(packageDir, "ui", "board.css"));
		assert.equal(asset.root, packageDir);

		const traversal = resolvePluginAsset("pi-messenger", ["..", "..", "secret.txt"], [root]);
		assert.equal(traversal.ok, false);
		assert.equal(traversal.status, 403);

		const nested = resolvePluginAsset("pi-messenger", ["ui", "..", "..", "secret.txt"], [root]);
		assert.equal(nested.ok, false);
		assert.equal(nested.status, 403);

		const missing = resolvePluginAsset("pi-messenger", ["ui", "nope.html"], [root]);
		assert.equal(missing.ok, false);
		assert.equal(missing.status, 404);

		assert.equal(resolvePluginAsset("unknown-plugin", ["ui/board.html"], [root]).status, 404);
	});
});

test("refuses a symlink that escapes the plugin package", () => {
	withFixture(root => {
		const packageDir = makePlugin(root, "node_modules/pi-messenger", {
			name: "pi-messenger",
			files: { "ui/board.html": "<title>Board</title>" },
		});
		writeFileSync(path.join(root, "outside.html"), "<title>outside</title>");
		try {
			symlinkSync(path.join(root, "outside.html"), path.join(packageDir, "ui", "link.html"));
		} catch {
			return; // Windows without the symlink privilege — covered by the traversal cases.
		}

		const escaped = resolvePluginAsset("pi-messenger", ["ui", "link.html"], [root]);
		assert.equal(escaped.ok, false);
		assert.equal(escaped.status, 403);
	});
});

test("accepts the upstream manifest keys and plugin.json packages", () => {
	withFixture(root => {
		makePlugin(root, "node_modules/upstream", {
			name: "upstream",
			manifestKey: "pi",
			files: { "index.html": "<title>Upstream</title>" },
		});
		const plain = path.join(root, "node_modules", "catalog-only");
		mkdirSync(plain, { recursive: true });
		writeFileSync(path.join(plain, "package.json"), JSON.stringify({ name: "catalog-only", version: "1.0.0" }));
		writeFileSync(path.join(plain, "plugin.json"), JSON.stringify({ id: "catalog-only", category: "official" }));
		writeFileSync(path.join(plain, "view.html"), "<title>Catalog</title>");

		const ids = readPluginPackages([root]).map(pkg => pkg.id);
		assert.deepEqual(ids, ["catalog-only", "upstream"]);
	});
});

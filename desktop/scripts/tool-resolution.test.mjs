import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { resolveToolIn } from "../src/tool-resolution.ts";

function makeDeps(overrides = {}) {
	return {
		isPackaged: false,
		platform: process.platform,
		resourcesPath: "/resources",
		env: {},
		exists: () => false,
		readTextFile: () => null,
		dirname: path.join("/repo", "desktop", "dist"),
		cwd: "/repo",
		probePath: () => null,
		serviceBinaryName: process.platform === "win32" ? "zeta.exe" : "zeta",
		webRuntimeName: process.platform === "win32" ? "node.exe" : "node",
		...overrides,
	};
}

test("rejects unknown tool ids and unknown tools resolve to null", () => {
	assert.equal(resolveToolIn("emacs", makeDeps()), null);
	assert.equal(resolveToolIn(undefined, makeDeps()), null);
});

test("ZETA_BIN_DIR wins over PATH", () => {
	const hit = path.join("/bins", process.platform === "win32" ? "zetacode.exe" : "zetacode");
	const deps = makeDeps({
		env: { ZETA_BIN_DIR: "/bins" },
		exists: candidate => candidate === hit,
		probePath: () => "/usr/local/bin/zetacode",
	});
	assert.deepEqual(resolveToolIn("zetacode", deps), { file: hit, args: [], needsShell: false });
});

test("PATH probe is used when no explicit dir matches", () => {
	const deps = makeDeps({
		probePath: name => (name === "zetaide" ? "/usr/local/bin/zetaide" : null),
	});
	assert.deepEqual(resolveToolIn("zetaide", deps), { file: "/usr/local/bin/zetaide", args: [], needsShell: false });
});

test("cmd shims from PATH require a shell", () => {
	if (process.platform !== "win32") return;
	const deps = makeDeps({ probePath: () => "C:\\npm\\zetacode.cmd" });
	assert.equal(resolveToolIn("zetacode", deps).needsShell, true);
});

test("falls back to the dev repo platform leaf binary", () => {
	const tag = process.platform === "win32" ? "windows" : "linux";
	const leafName = process.platform === "win32" ? "ttt.exe" : "ttt-linux-x64";
	const expected = path.join("/repo", "editor", "npm", `editor-${tag}-x64`, "bin", leafName);
	const repoPkg = path.join("/repo", "package.json");
	const deps = makeDeps({
		exists: candidate => candidate === expected || candidate === repoPkg,
		readTextFile: candidate => (candidate === repoPkg ? '{"workspaces":[]}' : null),
	});
	const resolved = resolveToolIn("zetaeditor", deps);
	assert.equal(resolved?.file, expected);
	assert.equal(resolved?.needsShell, false);
});

// --- zetawork (the framework workbench, @linxiraos/main) ---

test("zetawork resolves from PATH like every other tool", () => {
	const deps = makeDeps({
		probePath: name => (name === "zetawork" ? "/usr/local/bin/zetawork" : null),
	});
	assert.deepEqual(resolveToolIn("zetawork", deps), {
		file: "/usr/local/bin/zetawork",
		args: [],
		needsShell: false,
	});
});

test("zetawork accepts the npm bin aliases behind the canonical name", () => {
	const deps = makeDeps({
		probePath: name => (name === "zeta-work" ? "/usr/local/bin/zeta-work" : null),
	});
	assert.equal(resolveToolIn("zetawork", deps)?.file, "/usr/local/bin/zeta-work");
	const bare = makeDeps({ probePath: name => (name === "zeta" ? "/usr/local/bin/zeta" : null) });
	assert.equal(resolveToolIn("zetawork", bare)?.file, "/usr/local/bin/zeta");
});

test("a Windows zetawork.cmd shim is spawned through a shell", () => {
	if (process.platform !== "win32") return;
	// #148's ruling: the npm launcher is a .cmd, which needs a shell to exec.
	const deps = makeDeps({ probePath: () => "C:\\npm\\zetawork.cmd" });
	const resolved = resolveToolIn("zetawork", deps);
	assert.equal(resolved?.file, "C:\\npm\\zetawork.cmd");
	assert.equal(resolved?.needsShell, true);
});

test("zetawork falls back to the checkout leaf and then the cargo output", () => {
	const tag = process.platform === "win32" ? "windows" : "linux";
	const leafName = process.platform === "win32" ? "zeta.exe" : "zeta-linux-x64";
	const leaf = path.join("/repo", "main", "npm", `main-${tag}-x64`, "bin", leafName);
	const repoPkg = path.join("/repo", "package.json");
	const deps = makeDeps({
		exists: candidate => candidate === leaf || candidate === repoPkg,
		readTextFile: candidate => (candidate === repoPkg ? '{"workspaces":[]}' : null),
	});
	assert.equal(resolveToolIn("zetawork", deps)?.file, leaf);

	const cargo = path.join("/repo", "main", "target", "release", process.platform === "win32" ? "zeta.exe" : "zeta");
	const cargoDeps = makeDeps({
		exists: candidate => candidate === cargo || candidate === repoPkg,
		readTextFile: candidate => (candidate === repoPkg ? '{"workspaces":[]}' : null),
	});
	assert.equal(resolveToolIn("zetawork", cargoDeps)?.file, cargo);
});

test("ZETA_BIN_DIR still wins for zetawork", () => {
	const hit = path.join("/bins", process.platform === "win32" ? "zetawork.cmd" : "zetawork");
	const deps = makeDeps({
		env: { ZETA_BIN_DIR: "/bins" },
		exists: candidate => candidate === hit,
		probePath: () => "/usr/local/bin/zetawork",
	});
	const resolved = resolveToolIn("zetawork", deps);
	assert.equal(resolved?.file, hit);
});

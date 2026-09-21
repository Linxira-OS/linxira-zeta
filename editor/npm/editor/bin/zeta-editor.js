#!/usr/bin/env node
// @linxiraos/editor launcher: resolves the platform binary installed via
// optionalDependencies and execs it with all arguments forwarded.
"use strict";
const { existsSync } = require("node:fs");
const path = require("node:path");

// npm package names use "windows"; Node's process.platform is "win32".
const PKG_PLATFORM = process.platform === "win32" ? "windows" : process.platform;
const EXE = process.platform === "win32" ? "ttt.exe" : "ttt-linux-x64";
const PKG = `@linxiraos/editor-${PKG_PLATFORM}-${process.arch}`;

// Resolve through Node's own algorithm: optionalDependencies may land flat in
// node_modules/@linxiraos/ or nested under our package's node_modules
// depending on the surrounding dependency tree.
let found;
try {
	const pkgDir = path.dirname(require.resolve(`${PKG}/package.json`, { paths: [__dirname, ...module.paths] }));
	const candidate = path.join(pkgDir, "bin", EXE);
	if (existsSync(candidate)) found = candidate;
} catch {
	// fall through to the legacy flat-layout probe below
}
if (!found) {
	const flat = path.join(__dirname, "..", "..", PKG, "bin", EXE);
	if (existsSync(flat)) found = flat;
}
if (!found) {
	console.error(`@linxiraos/editor: no binary for ${process.platform}-${process.arch}. Install the matching @linxiraos/editor-* package.`);
	process.exit(1);
}
const { spawn } = require("node:child_process");
const child = spawn(found, process.argv.slice(2), { stdio: "inherit" });
child.on("exit", code => process.exit(code ?? 0));

#!/usr/bin/env node
// @linxiraos/editor launcher: resolves the platform binary installed via
// optionalDependencies and execs it with all arguments forwarded.
"use strict";
const { existsSync } = require("node:fs");
const path = require("node:path");

// npm package names use "windows"; Node's process.platform is "win32".
const PKG_PLATFORM = process.platform === "win32" ? "windows" : process.platform;
const EXE = process.platform === "win32" ? "ttt.exe" : "ttt-linux-x64";
const candidates = [
  path.join(__dirname, "..", "..", `editor-${PKG_PLATFORM}-${process.arch}`, "bin", EXE),
];
let found;
for (const c of candidates) {
  if (existsSync(c)) { found = c; break; }
}
if (!found) {
  console.error(`@linxiraos/editor: no binary for ${process.platform}-${process.arch}. Install the matching @linxiraos/editor-* package.`);
  process.exit(1);
}
const { spawnSync } = require("node:child_process");
const r = spawnSync(found, process.argv.slice(2), { stdio: "inherit" });
if (r.error) throw r.error;
process.exit(r.status ?? 0);

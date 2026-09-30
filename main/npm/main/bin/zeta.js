#!/usr/bin/env node
// zeta launcher — resolves the workspace binary from optionalDependencies
// leaves (same pattern as the zeta-ide / zeta-editor launchers). Node-only,
// no Bun needed.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

// npm package names use "windows"; Node's process.platform is "win32".
const PKG_PLATFORM = process.platform === "win32" ? "windows" : process.platform;
const PKG_PREFIX = "@linxiraos/main-";
const EXE = process.platform === "win32" ? "zeta.exe" : "zeta-linux-x64";

function die(msg) {
  process.stderr.write(`zeta: ${msg}\n`);
  process.exit(1);
}

let bin = null;
try {
  bin = require.resolve(`${PKG_PREFIX}${PKG_PLATFORM}-${process.arch}/bin/${EXE}`);
} catch {
  // Fall back to a repo-layout location (dev / source checkout):
  // <repo>/main/target/release/<exe> next to this package.
  const local = path.join(__dirname, "..", "..", "..", "target", "release", EXE);
  if (fs.existsSync(local)) bin = local;
}

if (!bin) {
  die(
    `no binary for ${process.platform}-${process.arch}; ` +
      `install @linxiraos/main (supported: windows-x64, linux-x64) ` +
      `or build from source with \`cargo build --release\` in the main/ workspace`,
  );
}

const child = spawn(bin, process.argv.slice(2), { stdio: "inherit" });
child.on("error", (err) => die(String(err)));
child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

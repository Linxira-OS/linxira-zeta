#!/usr/bin/env node
// zeta-work launcher — resolves the platform binary from optionalDependencies
// leaves (same pattern as the zeta-editor launcher). Node-only, no Bun needed.

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PKG_PREFIX = "@linxiraos/work-";
const EXE = process.platform === "win32" ? "termide.exe" : "termide-linux-x64";

function die(msg) {
  process.stderr.write(`zeta-work: ${msg}\n`);
  process.exit(1);
}

let bin = null;
try {
  bin = require.resolve(`${PKG_PREFIX}${process.platform}-${process.arch}/bin/${EXE}`);
} catch {
  // Fall back to a repo-layout location (dev / source checkout):
  // <repo>/termide/target/release/<exe> next to this package.
  const local = path.join(__dirname, "..", "..", "..", "target", "release", EXE);
  if (fs.existsSync(local)) bin = local;
}

if (!bin) {
  die(
    `no binary for ${process.platform}-${process.arch}; ` +
      `install @linxiraos/work (supported: win32-x64, linux-x64) ` +
      `or build from source with \`cargo build --release\` in the termide/ workspace`,
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

#!/usr/bin/env node
// zeta launcher — unified binary discovery, npm-form face:
//   ① explicit env  — ZETA_BIN_DIR (delimiter-separated dirs, probed first)
//   ② PATH          — a *native* zetawork/zeta binary (distro pacman install
//                     or a real .exe); PATH hits are used as-is, with no
//                     cross-component version validation
//   ③ npm vendored  — the platform-leaf binary shipped as
//                     @linxiraos/main-<platform>-<arch> (same pattern as the
//                     zeta-ide / zeta-editor launchers), then the repo
//                     target/release location for source checkouts
// Node-only, no Bun needed.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

// npm package names use "windows"; Node's process.platform is "win32".
const PKG_PLATFORM = process.platform === "win32" ? "windows" : process.platform;
const PKG_PREFIX = "@linxiraos/main-";
const EXE = process.platform === "win32" ? "zeta.exe" : "zeta-linux-x64";
const NATIVE_BINS = ["zetawork", "zeta", "zeta-work"];

function die(msg) {
  process.stderr.write(`zeta: ${msg}\n`);
  process.exit(1);
}

/** Native-executable test so PATH probes never pick up another JS shim
 * (npm's .cmd/.ps1/sh launchers for this very package live on PATH —
 * re-executing them would recurse into this script). POSIX also demands
 * the exec bit: a non-executable ELF (broken extract, cache artifact)
 * would only die later with a raw spawn EACCES. */
function isNativeBinary(candidate) {
  let stat;
  try {
    stat = fs.statSync(candidate);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  if (process.platform === "win32") {
    return candidate.toLowerCase().endsWith(".exe");
  }
  if (!isExecutable(candidate)) return false;
  let head;
  try {
    const fd = fs.openSync(candidate, "r");
    const buf = Buffer.alloc(4);
    const read = fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    head = read === 4 ? buf : null;
  } catch {
    return false;
  }
  return head !== null && head.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])); // \x7fELF
}

/** POSIX exec-bit probe; Windows access(X_OK) always succeeds, which is
 * fine there — a named .exe is the platform's native form. */
function isExecutable(candidate) {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Native executable candidates for one bin name per directory entry:
 * `name.exe` on Windows, the bare ELF name elsewhere. */
function nativeCandidates(dir, name) {
  return process.platform === "win32" ? [path.join(dir, `${name}.exe`)] : [path.join(dir, name)];
}

/** First native hit for the workbench bins inside `dirs`, or null. */
function findNativeIn(dirs) {
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of NATIVE_BINS) {
      for (const candidate of nativeCandidates(dir, name)) {
        if (isNativeBinary(candidate)) return candidate;
      }
    }
  }
  return null;
}

function explicitDirs() {
  const raw = process.env.ZETA_BIN_DIR;
  if (!raw) return [];
  return raw.split(path.delimiter).map((dir) => dir.trim()).filter((dir) => dir.length > 0);
}

/** Windows env blocks carry `Path`, POSIX `PATH` — accept either spelling. */
function pathDirs() {
  const raw = process.env.PATH ?? process.env.Path;
  return (raw || "").split(path.delimiter);
}

// ① explicit env → ② PATH (native binaries only)
const fromNative = findNativeIn([...explicitDirs(), ...pathDirs()]);

let bin = fromNative;
if (!bin) {
  // ③ npm vendored platform leaf. A resolved but non-executable leaf
  // (broken extract, cache artifact) must fall through to the install
  // hint instead of dying later with a raw spawn EACCES.
  try {
    const leaf = require.resolve(`${PKG_PREFIX}${PKG_PLATFORM}-${process.arch}/bin/${EXE}`);
    if (process.platform === "win32" || isExecutable(leaf)) bin = leaf;
  } catch {
    // Fall back to a repo-layout location (dev / source checkout):
    // <repo>/main/target/release/<exe> next to this package.
    const local = path.join(__dirname, "..", "..", "..", "target", "release", EXE);
    if (fs.existsSync(local) && (process.platform === "win32" || isExecutable(local))) bin = local;
  }
}

if (!bin) {
  die(
    `no native zetawork/zeta on PATH and no binary for ${process.platform}-${process.arch}; ` +
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

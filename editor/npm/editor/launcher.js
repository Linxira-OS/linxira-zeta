#!/usr/bin/env node
// @linxiraos/editor launcher — resolves the platform payload from the
// optionalDependencies leaves and runs it with the arguments it was given.
//
// The package deliberately has no `bin`: @linxiraos/editor is not a
// user-visible command. It is the built-in editor's payload, spawned by path
// by other programs (the pi-messenger `/editor` command, `$EDITOR` from git /
// crontab / visudo, and the workbench's own integrations), so consumers
// resolve the platform leaf's executable and hand it the editor's
// `FILE[:line[:col]]` positional protocol. This file is the one place that
// knows the leaf naming, for a consumer that would rather run
// `node launcher.js notes.md:12:3` than reimplement the resolution.
//
// `require("@linxiraos/editor/launcher.js")` exposes `resolveEditor()` for
// callers that spawn the payload themselves. Node-only: no Bun needed.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

/** npm package names use "windows"; Node's `process.platform` is "win32". */
const PKG_PLATFORM = process.platform === "win32" ? "windows" : process.platform;

/** The platform leaf that carries the executable. */
const LEAF_PACKAGE = `@linxiraos/editor-${PKG_PLATFORM}-${process.arch}`;

/** The executable's file name inside the leaf package. */
const LEAF_EXE = process.platform === "win32" ? "termide-editor.exe" : "termide-editor-linux-x64";

function die(msg) {
  process.stderr.write(`editor: ${msg}\n`);
  process.exit(1);
}

/**
 * Absolute path to the platform editor executable, or null when the package
 * is not installed for this platform. Resolution goes through Node's own
 * algorithm from this package's directory, so the leaf is found whether it
 * sits beside the launcher (the normal install shape) or nested; `extraRoots`
 * lets a caller that already knows where it looked add its own roots.
 */
function resolveEditor(extraRoots = []) {
  try {
    const resolved = require.resolve(`${LEAF_PACKAGE}/bin/${LEAF_EXE}`, {
      paths: [__dirname, ...extraRoots],
    });
    fs.accessSync(resolved, fs.constants.X_OK);
    return resolved;
  } catch {
    return null;
  }
}

module.exports = { resolveEditor, LEAF_PACKAGE, LEAF_EXE };

if (require.main === module) {
  const binary = resolveEditor();
  if (!binary) {
    die(
      `no binary for ${process.platform}-${process.arch}; ` +
        `install @linxiraos/editor (supported: windows-x64, linux-x64)`,
    );
  }
  // Inherit stdio and forward the exit code: the editor takes over the
  // terminal and the launcher blocks, exactly like the payload it runs.
  const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });
  child.on("error", err => die(String(err)));
  child.on("close", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

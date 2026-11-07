#!/usr/bin/env bun
/**
 * Work Studio "browser" edition — the desktop app without a bundled browser
 * engine.
 *
 * The Electron edition (`desktop/`) embeds Chromium, which costs ~200 MB per
 * installer and a renderer update every Electron bump. This edition ships the
 * same staged runtime (our compiled `zeta` binary, native addons and the Work
 * Studio renderer) plus a launcher that starts `zetacode serve` on the user's
 * own browser. It carries no Chromium/WebView dependency at all.
 *
 * Usage (CI and local):
 *
 *   bun scripts/package-workstudio-browser.ts \
 *     --version 1.4.12 --platform win32 --runtime temp/desktop/staging/zeta --out dist
 *
 * `--runtime` is the directory `desktop/scripts/prepare-runtime.mjs` stages:
 * `zeta[.exe]`, the native addons and `web-app/`. Outputs:
 *
 *   win32  linxira-zeta-<version>-workstudio-browser-windows-x64.zip
 *   linux  linxira-zeta-<version>-workstudio-browser-linux-x64.tar.gz
 */
import * as fs from "node:fs";
import * as path from "node:path";

interface Args {
	version: string;
	platform: "win32" | "linux";
	runtime: string;
	out: string;
}

function parseArgs(argv: string[]): Args {
	const value = (flag: string): string | undefined => {
		const index = argv.indexOf(flag);
		return index >= 0 ? argv[index + 1] : undefined;
	};
	const version = value("--version");
	const platform = value("--platform");
	const runtime = value("--runtime");
	const out = value("--out");
	if (!version || (platform !== "win32" && platform !== "linux") || !runtime || !out) {
		throw new Error(
			"usage: bun scripts/package-workstudio-browser.ts --version <v> --platform win32|linux --runtime <dir> --out <dir>",
		);
	}
	return { version, platform, runtime: path.resolve(runtime), out: path.resolve(out) };
}

function run(file: string, args: string[], cwd: string): void {
	const result = Bun.spawnSync([file, ...args], { cwd, stdout: "inherit", stderr: "inherit" });
	if (result.exitCode !== 0) throw new Error(`${file} ${args.join(" ")} failed`);
}

const args = parseArgs(process.argv.slice(2));
const service = args.platform === "win32" ? "zeta.exe" : "zeta";
if (!fs.existsSync(path.join(args.runtime, service))) {
	throw new Error(
		`${path.join(args.runtime, service)} is missing; stage the runtime first (desktop/scripts/prepare-runtime.mjs)`,
	);
}
if (!fs.existsSync(path.join(args.runtime, "web-app", "index.html"))) {
	throw new Error("the staged runtime has no web-app/index.html (Work Studio renderer)");
}

const suffix = args.platform === "win32" ? "windows-x64" : "linux-x64";
const archiveBase = `linxira-zeta-${args.version}-workstudio-browser-${suffix}`;
const staging = path.join(args.out, `.${archiveBase}`);
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });
fs.cpSync(args.runtime, path.join(staging, "zeta"), { recursive: true });

if (args.platform === "win32") {
	const launcher = `@echo off\r
cd /d "%~dp0"\r
echo Starting Work Studio (your default browser will open)...\r
"%~dp0zeta\\zeta.exe" serve\r
`;
	fs.writeFileSync(path.join(staging, "Work Studio.cmd"), launcher);
	// bsdtar ships with Windows runners and GNU tar with Git for Windows.
	run("tar", ["-a", "-c", "-f", path.join(args.out, `${archiveBase}.zip`), "-C", staging, "."], args.out);
} else {
	const launcher = `#!/bin/sh
set -eu
cd "$(dirname "$0")"
exec ./zeta/zeta serve
`;
	const launcherPath = path.join(staging, "work-studio");
	fs.writeFileSync(launcherPath, launcher);
	fs.chmodSync(launcherPath, 0o755);
	run("tar", ["-czf", path.join(args.out, `${archiveBase}.tar.gz`), "-C", staging, "."], args.out);
}

fs.rmSync(staging, { recursive: true, force: true });
console.log(
	`workstudio-browser: ${path.join(args.out, args.platform === "win32" ? `${archiveBase}.zip` : `${archiveBase}.tar.gz`)}`,
);

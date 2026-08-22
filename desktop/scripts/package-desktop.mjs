/**
 * Isolation packaging for electron-builder.
 *
 * electron-builder treats this repo's root (bun.lock + packageManager=bun) as
 * the project workspace root and walks the entire zeta dependency tree while
 * collecting node_modules, which fails on missing optional deps. Building
 * from an isolated directory under the repo's ignored temp/ tree sidesteps
 * that: no workspaces are detected and the empty node_modules collection is
 * fine (the desktop app has zero runtime npm deps — everything is Electron
 * builtins).
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { desktopPlatformInfo } from "./platform.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "..");
const tempDesktopDir = path.join(repoRoot, "temp", "desktop");
const tempRoot = path.join(tempDesktopDir, "electron-builder");
const require = createRequire(import.meta.url);
const manifest = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"));
const platformInfo = desktopPlatformInfo(process.platform, process.arch);

fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });

for (const entry of ["package.json", "electron-builder.yml", "tsconfig.json"]) {
	fs.cpSync(path.join(desktopDir, entry), path.join(tempRoot, entry), { recursive: true });
}
// electron-builder otherwise walks up to the Bun workspace root and tries to
// collect every Zeta dependency. This empty workspace boundary is build-only.
const packageForBuildPath = path.join(tempRoot, "package.json");
const packageForBuild = JSON.parse(fs.readFileSync(packageForBuildPath, "utf8"));
packageForBuild.packageManager = "npm@12.0.1";
packageForBuild.workspaces = [];
fs.writeFileSync(packageForBuildPath, `${JSON.stringify(packageForBuild, null, 2)}\n`);
fs.cpSync(path.join(desktopDir, "dist"), path.join(tempRoot, "dist"), { recursive: true });
fs.cpSync(path.join(tempDesktopDir, "build"), path.join(tempRoot, "build"), { recursive: true });
// Static build resources (NSIS include, zeta-d shims, PATH helper) live in the
// project's own build/ dir; merge them over the generated icons so the staged
// buildResources dir carries both.
fs.cpSync(path.join(desktopDir, "build"), path.join(tempRoot, "build"), { recursive: true });
fs.cpSync(path.join(tempDesktopDir, "staging"), path.join(tempRoot, "staging"), { recursive: true });

// The darwin build matrix runs one job per arch (macos-15-intel / macos-14).
// electron-builder ignores CLI --x64/--arm64 when the config lists explicit
// `arch:` entries and would build BOTH arches on each runner (doubling time
// and cross-downloading the other Electron). Pin every arch list in the copied
// config to the current runner arch. win/linux jobs run on x64 runners, so
// their arch lists are unchanged; darwin runners each build their own arch.
if (process.platform === "darwin") {
	const builderConfigPath = path.join(tempRoot, "electron-builder.yml");
	const builderConfig = fs
		.readFileSync(builderConfigPath, "utf8")
		.replace(/arch:\n(?:\s+- \w+\n)+/g, `arch:\n        - ${process.arch}\n`);
	fs.writeFileSync(builderConfigPath, builderConfig);
}

const builderCli = require.resolve("electron-builder/out/cli/cli.js");
if (!fs.existsSync(builderCli)) {
	console.error("electron-builder not installed in desktop/node_modules");
	process.exit(1);
}

const env = {
	...process.env,
};
if (!process.env.CI) {
	env.ELECTRON_MIRROR ??= "https://npmmirror.com/mirrors/electron/";
	env.ELECTRON_BUILDER_BINARIES_MIRROR ??= "https://npmmirror.com/mirrors/electron-builder-binaries/";
}

const archFlag = process.arch === "arm64" ? "--arm64" : "--x64";
const result = spawnSync(process.execPath, [builderCli, platformInfo.builderTarget, archFlag, "--publish", "never", "--config", path.join(tempRoot, "electron-builder.yml")], {
	cwd: tempRoot,
	env,
	stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) {
	console.error(`electron-builder exited with ${result.status}`);
	process.exit(result.status ?? 1);
}

const releaseOut = path.join(tempDesktopDir, "release");
fs.mkdirSync(releaseOut, { recursive: true });
const tempRelease = path.join(tempRoot, "release");
for (const entry of fs.readdirSync(tempRelease, { withFileTypes: true })) {
	if (entry.isFile()) {
		fs.copyFileSync(path.join(tempRelease, entry.name), path.join(releaseOut, entry.name));
	}
}
// electron-builder mac dir target emits the bundle as `release/mac/Zeta.app`
// (per-arch: `release/mac-arm64/...`, `release/mac-x64/...`), not a
// `mac-unpacked` dir like win/linux. Locate the `.app` bundle dynamically so
// the smoke test gets `zeta-desktop-<version>-mac-<arch>/Zeta.app/...`.
let unpackedSource = path.join(tempRelease, platformInfo.unpackedDirectory);
if (process.platform === "darwin") {
	const appBundleDir = fs
		.readdirSync(tempRelease, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => path.join(tempRelease, entry.name))
		.find(dir => {
			try {
				return fs.readdirSync(dir).some(name => name.endsWith(".app"));
			} catch {
				return false;
			}
		});
	if (!appBundleDir) throw new Error(`No .app bundle found under ${tempRelease}`);
	unpackedSource = appBundleDir;
}
const unpackedOut = path.join(releaseOut, `zeta-desktop-${manifest.version}-${platformInfo.platformId}-${process.arch}`);
fs.rmSync(unpackedOut, { recursive: true, force: true });
fs.cpSync(unpackedSource, unpackedOut, { recursive: true });
fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("packaged artifacts in", releaseOut);

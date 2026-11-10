/**
 * Assemble the runtime copied into the current platform's Electron package.
 *
 * The desktop app starts `zeta serve` from this directory. The renderer is the
 * packaged Work Studio build (`web-app/dist`), served by the same binary, so a
 * target machine needs neither Bun, Node, nor a browser runtime.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { desktopPlatformInfo } from "./platform.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "..");
const agentDir = path.join(repoRoot, "packages", "coding-agent");

const stagingDir = path.join(repoRoot, "temp", "desktop", "staging", "zeta");
const platformInfo = desktopPlatformInfo(process.platform, process.arch);
const desktopVersion = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8")).version;

function run(file, args, cwd, env = process.env) {
	const result = spawnSync(file, args, { cwd, env, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

// CI reuses the release-built CLI artifact instead of compiling the Rust/Bun
// binary again; local builds compile it here.
const zetaBinary = path.join(agentDir, "dist", platformInfo.zetaBinaryName);
const providedBinary = process.env.ZETA_SERVICE_BINARY;
if (providedBinary) {
	fs.mkdirSync(path.dirname(zetaBinary), { recursive: true });
	fs.copyFileSync(providedBinary, zetaBinary);
} else {
	run("bun", ["run", "build"], agentDir);
}
// Stages `dist/web-app` (npm ci + vite build + precompressed sidecars) inside
// the package; the same script `npm pack` runs, so the shell and npm ship one
// renderer.
run("bun", ["run", "gen:web-app"], agentDir);

const webAppDist = path.join(agentDir, "dist", "web-app");
if (!fs.existsSync(zetaBinary) || !fs.existsSync(path.join(webAppDist, "index.html"))) {
	throw new Error("Expected the Zeta executable and the staged Work Studio renderer were not produced.");
}

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
const stagedZeta = path.join(stagingDir, platformInfo.zetaBinaryName);
fs.copyFileSync(zetaBinary, stagedZeta);
if (process.platform !== "win32") fs.chmodSync(stagedZeta, 0o755);

// Native addons are not staged beside the kernel: the standalone binary embeds
// the target's addon(s) as zstd frames (packages/natives/scripts/embed-native.ts)
// and extracts them into the user cache on first run. Copying the `.node` files
// too only duplicated the addon: 124 MiB of the 744 MiB installed by 1.5.1.
fs.cpSync(webAppDist, path.join(stagingDir, "web-app"), { recursive: true });


console.log(`desktop runtime staged at ${stagingDir}`);

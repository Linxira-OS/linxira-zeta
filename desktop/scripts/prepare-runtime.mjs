/**
 * Assemble the runtime copied into the current platform's Electron package.
 *
 * The desktop app starts `zeta serve` from this directory. Its compiled
 * launcher discovers the adjacent standalone Web UI and uses the bundled Node
 * executable, so a target machine needs neither Bun nor Node installed.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { desktopPlatformInfo } from "./platform.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "..");
const agentDir = path.join(repoRoot, "packages", "coding-agent");
const webUiDir = path.join(repoRoot, "web-ui");
const webUiNextDir = path.join(repoRoot, "web-ui-next");
const stagingDir = path.join(repoRoot, "temp", "desktop", "staging", "zeta");
const platformInfo = desktopPlatformInfo(process.platform, process.arch);
const desktopVersion = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8")).version;

function run(file, args, cwd, env = process.env) {
	const result = spawnSync(file, args, { cwd, env, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

run("bun", ["run", "build"], agentDir);
const npmCli = process.env.npm_execpath;
if (!npmCli) {
	throw new Error("npm CLI path is unavailable; run this script through npm.");
}
run(process.execPath, [npmCli, "run", "build"], webUiDir, {
	...process.env,
	NEXT_OUTPUT_STANDALONE: "1",
	ZETA_APP_VERSION: desktopVersion,
});
run(process.execPath, [npmCli, "run", "build"], webUiNextDir, {
	...process.env,
});

const zetaBinary = path.join(agentDir, "dist", platformInfo.zetaBinaryName);
const standalone = path.join(webUiDir, ".next", "standalone");
const staticFiles = path.join(webUiDir, ".next", "static");
const publicFiles = path.join(webUiDir, "public");
const standaloneRoot = fs.existsSync(path.join(standalone, "server.js")) ? standalone : path.join(standalone, "web-ui");
const webUiNextDist = path.join(webUiNextDir, "dist");
if (!fs.existsSync(zetaBinary) || !fs.existsSync(path.join(standaloneRoot, "server.js"))) {
	throw new Error("Expected Zeta executable or standalone Web UI output was not produced.");
}
if (!fs.existsSync(path.join(webUiNextDist, "index.html"))) {
	throw new Error("Expected web-ui-next build output (dist/index.html) was not produced.");
}

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
const stagedZeta = path.join(stagingDir, platformInfo.zetaBinaryName);
const stagedNode = path.join(stagingDir, platformInfo.nodeBinaryName);
fs.copyFileSync(zetaBinary, stagedZeta);
fs.copyFileSync(process.execPath, stagedNode);
if (process.platform !== "win32") {
	fs.chmodSync(stagedZeta, 0o755);
	fs.chmodSync(stagedNode, 0o755);
}

const stagedWebUi = path.join(stagingDir, "web-ui");
const stagedStandalone = path.join(stagedWebUi, ".next", "standalone");
fs.cpSync(standaloneRoot, stagedStandalone, { recursive: true });
fs.cpSync(staticFiles, path.join(stagedStandalone, ".next", "static"), { recursive: true });
if (fs.existsSync(publicFiles)) {
	fs.cpSync(publicFiles, path.join(stagedStandalone, "public"), { recursive: true });
}

// web-ui-next (Vite) static bundle, served by zeta serve under /next.
const stagedWebUiNext = path.join(stagingDir, "web-ui-next");
fs.cpSync(webUiNextDist, stagedWebUiNext, { recursive: true });

console.log(`desktop runtime staged at ${stagingDir}`);

#!/usr/bin/env bun
/**
 * Stage the Studio renderer inside the publishable package.
 *
 * `prepack` runs this (`gen:web-app`), so `npm pack` and the release publish
 * always ship `dist/web-app/index.html`. A plain `bun install` in a checkout
 * never runs it: `zeta serve` resolves `<repo>/web-app/dist` directly, and the
 * packaged copy is only the fallback for npm-installed users.
 *
 * Build-time only: `web-app` is its own npm project (not a Bun workspace
 * member), so dependencies and the Vite build are driven through `npm`.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

const packageDir = path.join(import.meta.dir, "..");
const repoRoot = path.join(packageDir, "..", "..");
const webAppDir = path.join(repoRoot, "web-app");
const webAppBuild = path.join(webAppDir, "dist");
const stagedDir = path.join(packageDir, "dist", "web-app");
const lockfile = path.join(webAppDir, "package-lock.json");
const installedLockfile = path.join(webAppDir, "node_modules", ".package-lock.json");

async function exists(target: string): Promise<boolean> {
	try {
		await fs.stat(target);
		return true;
	} catch {
		return false;
	}
}

async function run(command: string[], cwd: string): Promise<void> {
	console.log(`$ ${command.join(" ")}  (cwd: ${path.relative(repoRoot, cwd) || "."})`);
	const proc = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`);
	}
}

/** `npm ci` only when the installed tree cannot satisfy the committed lockfile. */
async function dependenciesAreCurrent(): Promise<boolean> {
	if (!(await exists(installedLockfile))) return false;
	const [lock, installed] = await Promise.all([fs.stat(lockfile), fs.stat(installedLockfile)]);
	return installed.mtimeMs >= lock.mtimeMs;
}

async function countFiles(dir: string): Promise<{ files: number; bytes: number }> {
	const entries = await fs.readdir(dir, { recursive: true });
	let files = 0;
	let bytes = 0;
	for (const entry of entries) {
		const stat = await fs.stat(path.join(dir, entry));
		if (!stat.isFile()) continue;
		files += 1;
		bytes += stat.size;
	}
	return { files, bytes };
}

async function main(): Promise<void> {
	if (!(await exists(path.join(webAppDir, "package.json")))) {
		throw new Error(
			`Cannot build the Studio renderer: ${webAppDir} is missing. ` +
				`This step needs a repository checkout (web-app/); published tarballs already contain dist/web-app.`,
		);
	}

	if (await dependenciesAreCurrent()) {
		console.log("web-app dependencies are current; skipping npm ci");
	} else {
		await run(["npm", "ci"], webAppDir);
	}
	await run(["npm", "run", "build"], webAppDir);

	const entry = path.join(webAppBuild, "index.html");
	if (!(await exists(entry))) {
		throw new Error(`web-app build finished without ${entry}`);
	}

	await fs.rm(stagedDir, { recursive: true, force: true });
	await fs.cp(webAppBuild, stagedDir, { recursive: true });
	const { files, bytes } = await countFiles(stagedDir);
	console.log(
		`Staged Studio renderer: ${path.relative(repoRoot, stagedDir)} ` +
			`(${files} files, ${(bytes / 1024).toFixed(1)} KiB)`,
	);
}

await main();

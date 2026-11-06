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
import { constants, brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";

const packageDir = path.join(import.meta.dir, "..");
const repoRoot = path.join(packageDir, "..", "..");
const webAppDir = path.join(repoRoot, "web-app");
const webAppBuild = path.join(webAppDir, "dist");
const stagedDir = path.join(packageDir, "dist", "web-app");
const lockfile = path.join(webAppDir, "package-lock.json");
const installedLockfile = path.join(webAppDir, "node_modules", ".package-lock.json");

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** Text assets worth precompressing; already-compressed formats are skipped by omission. */
const COMPRESSIBLE_EXTENSIONS: Readonly<Record<string, true>> = {
	".js": true,
	".mjs": true,
	".css": true,
	".html": true,
	".json": true,
	".svg": true,
	".txt": true,
	".map": true,
};

/** Below this size the framing overhead of a compressed sidecar is not worth it. */
const COMPRESSION_THRESHOLD_BYTES = 1024;

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

/**
 * Write `.br` (quality 11) and `.gz` (level 9) sidecars next to every
 * compressible text asset in `dir`. The serving code in `studio-web-app.ts`
 * negotiates on `Accept-Encoding` and streams these files, so a request never
 * pays compression CPU and never copies the whole chunk into the JS heap.
 * Sidecars are ordinary build outputs, so the `fs.cp` staging below carries
 * them into `dist/web-app` without knowing about them.
 */
async function precompressAssets(
	dir: string,
): Promise<{ files: number; rawBytes: number; brBytes: number; gzBytes: number }> {
	const entries = await fs.readdir(dir, { recursive: true });
	let files = 0;
	let rawBytes = 0;
	let brBytes = 0;
	let gzBytes = 0;
	for (const entry of entries) {
		const file = path.join(dir, entry);
		const stat = await fs.stat(file);
		if (!stat.isFile()) continue;
		if (stat.size < COMPRESSION_THRESHOLD_BYTES) continue;
		if (!COMPRESSIBLE_EXTENSIONS[path.extname(file).toLowerCase()]) continue;
		const source = await fs.readFile(file);
		const [br, gz] = await Promise.all([
			brotli(source, {
				params: {
					[constants.BROTLI_PARAM_QUALITY]: 11,
					[constants.BROTLI_PARAM_SIZE_HINT]: source.byteLength,
				},
			}),
			gzipAsync(source, { level: 9 }),
		]);
		await Promise.all([fs.writeFile(`${file}.br`, br), fs.writeFile(`${file}.gz`, gz)]);
		files += 1;
		rawBytes += source.byteLength;
		brBytes += br.byteLength;
		gzBytes += gz.byteLength;
	}
	return { files, rawBytes, brBytes, gzBytes };
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

	const compression = await precompressAssets(webAppBuild);
	console.log(
		`Precompressed ${compression.files} renderer assets: ` +
			`${(compression.rawBytes / 1024).toFixed(1)} KiB raw, ` +
			`${(compression.gzBytes / 1024).toFixed(1)} KiB gzip, ` +
			`${(compression.brBytes / 1024).toFixed(1)} KiB brotli`,
	);

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

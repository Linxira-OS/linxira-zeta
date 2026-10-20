#!/usr/bin/env bun
/**
 * Build the distributable example-plugin environment.
 *
 * Output: `plugins/dist/zeta-plugin-example-<version>.zip` (or `--out <dir>`),
 * containing one top-level directory, `example-panel/`, which is a **complete
 * environment** on its own:
 *
 * ```
 * example-panel/
 * ├── .git/            # initialised, one commit — `git log` works after unzip
 * ├── plugin.json      # catalogue + the declarative panels
 * ├── package.json     # @linxiraos/example-panel + locales
 * ├── index.ts data/ locales/ pages/ test/
 * ├── README.md AGENTS.md
 * ```
 *
 * A user unzips it, reads it, `git log`s it, and drops the directory into
 * `~/.zeta/agent/plugins` to install it.
 *
 * Two determinism rules make a rebuild byte-identical (and therefore
 * checksummable, and diffable in CI):
 *
 *   1. the file list is the package directory walked in sorted order — no
 *      timestamps in the zip metadata;
 *   2. the commit is authored and committed at one pinned instant
 *      (`SOURCE_DATE_EPOCH`, default {@link DEFAULT_COMMIT_DATE}), so the git
 *      object ids — and the `.git` bytes — are the same every run.
 *
 * Usage: bun scripts/build-example-plugin-zip.ts [--out <dir>] [--json]
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { writeZip, type ZipEntry } from "./packaging/zip";

const repoRoot = path.join(import.meta.dir, "..");

/** The plugin this asset distributes (a repo directory, id and asset name stem). */
export const PLUGIN_ID = "example-panel";
export const PLUGIN_DIR = path.join(repoRoot, "plugins", "official", PLUGIN_ID);
export const ASSET_STEM = "zeta-plugin-example";

/** Where the asset is written by default (git-ignored build output). */
export const DEFAULT_OUT_DIR = path.join(repoRoot, "plugins", "dist");

/**
 * The commit instant used when `SOURCE_DATE_EPOCH` is not set. Pinned rather
 * than "now" so rebuilding the same tree produces the same zip: the commit date
 * is part of the git object the archive ships.
 */
export const DEFAULT_COMMIT_DATE = "2026-10-20T00:00:00Z";

/** Directories copied into the staging tree never include build output or VCS state. */
const SKIP_COPY_DIRS: Record<string, true> = { node_modules: true, ".git": true, dist: true };

/**
 * The archive walk skips build output only: the `.git` directory the staging
 * step creates *is* part of the deliverable (a checked-out environment).
 */
const SKIP_LIST_DIRS: Record<string, true> = { node_modules: true, dist: true };

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	if (index >= 0) return process.argv[index + 1];
	const inline = process.argv.find(value => value.startsWith(`--${name}=`));
	return inline?.slice(name.length + 3);
}

/** Every file under `dir`, as paths relative to it with POSIX separators. */
export async function listFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	async function walk(current: string, prefix: string): Promise<void> {
		const entries = await fs.readdir(current, { withFileTypes: true });
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (SKIP_LIST_DIRS[entry.name]) continue;
				await walk(path.join(current, entry.name), relative);
				continue;
			}
			if (entry.isFile()) out.push(relative);
		}
	}
	await walk(dir, "");
	return out;
}

async function git(cwd: string, args: string[], date: string): Promise<void> {
	const child = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			GIT_AUTHOR_DATE: date,
			GIT_COMMITTER_DATE: date,
			// A release runner has no global identity and must not need one.
			GIT_AUTHOR_NAME: "Zeta Release",
			GIT_AUTHOR_EMAIL: "release@zeta.local",
			GIT_COMMITTER_NAME: "Zeta Release",
			GIT_COMMITTER_EMAIL: "release@zeta.local",
			// Never let a runner's standing config leak into the shipped history:
			// pointing at a file that does not exist is how git is told "no config"
			// on both platforms (`/dev/null` and `NUL` are not interchangeable here).
			GIT_CONFIG_GLOBAL: path.join(cwd, ".gitconfig-none"),
			GIT_CONFIG_NOSYSTEM: "1",
		},
	});
	const stderr = await new Response(child.stderr).text();
	const code = await child.exited;
	if (code !== 0) throw new Error(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
}

/** The plugin's version — the number the asset name carries. */
export async function pluginVersion(dir: string = PLUGIN_DIR): Promise<string> {
	const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as { version?: unknown };
	if (typeof pkg.version !== "string" || !pkg.version.trim()) {
		throw new Error(`${path.join(dir, "package.json")} declares no version`);
	}
	return pkg.version.trim();
}

export interface BuiltPluginZip {
	/** Absolute path of the written zip. */
	path: string;
	/** Archive-relative entry names, in written order. */
	entries: string[];
	version: string;
}

/**
 * Stage `PLUGIN_DIR` in a temp directory, `git init` + one commit, and zip the
 * staged directory. Returns the archive path, its entry names and the version.
 */
export async function buildExamplePluginZip(
	options: { outDir?: string; sourceDir?: string } = {},
): Promise<BuiltPluginZip> {
	const source = options.sourceDir ?? PLUGIN_DIR;
	const outDir = options.outDir ?? DEFAULT_OUT_DIR;
	const version = await pluginVersion(source);
	const date = process.env.SOURCE_DATE_EPOCH
		? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
		: DEFAULT_COMMIT_DATE;

	const staging = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-plugin-zip-"));
	try {
		const staged = path.join(staging, PLUGIN_ID);
		await fs.cp(source, staged, {
			recursive: true,
			filter: from => !SKIP_COPY_DIRS[path.basename(from)],
		});

		await git(staged, ["init", "-q", "-b", "main"], date);
		await git(staged, ["add", "-A"], date);
		await git(staged, ["commit", "-q", "-m", `example-panel ${version}`], date);

		const files = await listFiles(staged);
		const entries: ZipEntry[] = files.map(relative => ({
			name: `${PLUGIN_ID}/${relative}`,
			file: path.join(staged, relative),
		}));

		await fs.mkdir(outDir, { recursive: true });
		const target = path.join(outDir, `${ASSET_STEM}-${version}.zip`);
		await writeZip(entries, target);
		return { path: target, entries: entries.map(entry => entry.name), version };
	} finally {
		await fs.rm(staging, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	try {
		const built = await buildExamplePluginZip({ outDir: arg("out") ? path.resolve(arg("out")!) : undefined });
		const size = (await fs.stat(built.path)).size;
		if (process.argv.includes("--json")) {
			console.log(
				JSON.stringify({ path: built.path, version: built.version, entries: built.entries, size }, null, 2),
			);
		} else {
			console.log(`wrote ${path.relative(repoRoot, built.path)} (${built.entries.length} entries, ${size} bytes)`);
			for (const entry of built.entries) console.log(`  ${entry}`);
		}
	} catch (error) {
		console.error(`plugin zip failed: ${(error as Error).message}`);
		process.exit(1);
	}
}

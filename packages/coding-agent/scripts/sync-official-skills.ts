import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Materialize the repo-root `skills/` tree inside the package directory so the
 * npm tarball can ship it via the `files: ["skills"]` entry. npm resolves
 * `files` entries relative to the package root and silently drops entries that
 * do not exist there, so the repo-root copy is invisible to packing without
 * this step. Wired into `prepack` (packed tarballs run it); `postpack` cleans
 * the copy up again.
 *
 * Run with `--clean` to remove the materialized copy. The copy path is
 * gitignored, so a lingering dir never reaches git.
 */

const packageDir = path.resolve(import.meta.dir, "..");
const sourceDir = path.resolve(packageDir, "..", "..", "skills");
const targetDir = path.join(packageDir, "skills");

if (process.argv.includes("--clean")) {
	rmSync(targetDir, { recursive: true, force: true });
} else {
	if (!existsSync(sourceDir)) {
		console.error(`official skills source not found: ${sourceDir}`);
		process.exit(1);
	}
	// Mirror semantics: remove the previous copy first so stale files from an
	// older skills tree can never leak into a tarball.
	rmSync(targetDir, { recursive: true, force: true });
	cpSync(sourceDir, targetDir, { recursive: true });
}

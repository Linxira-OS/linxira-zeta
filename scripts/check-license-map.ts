#!/usr/bin/env bun
/**
 * The repository is MIT, and vendored trees carry their own licences. That map
 * is easy to lose silently — a merge rewrites a manifest, a new crate copies
 * the wrong line, a vendored directory arrives without its LICENSE. Each of
 * those makes the published licence claim false while every test still passes.
 *
 * This script asserts the map:
 *   - first-party MIT surfaces still say MIT;
 *   - vendored trees still carry their own LICENSE;
 *   - the root LICENSE still states the licence and points at NOTICE.
 *
 * Exit 0 when the map holds, 1 with one line per violation otherwise.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const failures: Array<{ where: string; what: string }> = [];

/** Files tracked by git — binaries and node_modules are out by construction. */
function tracked(): string[] {
	const result = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		console.error("check-license-map: `git ls-files` failed");
		process.exit(1);
	}
	return result.stdout.toString().split("\n").filter(Boolean);
}

function jsonLicence(relative: string): string | undefined {
	try {
		return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8")).license;
	} catch {
		failures.push({ where: relative, what: "is not valid JSON or is missing" });
		return undefined;
	}
}

function cargoLicence(relative: string): string | undefined {
	const match = fs.readFileSync(path.join(ROOT, relative), "utf8").match(/^license\s*=\s*"([^"]+)"/m);
	return match?.[1];
}

const files = tracked();

// 1. First-party MIT surfaces still say MIT.
if (cargoLicence("Cargo.toml") !== "MIT")
	failures.push({ where: "Cargo.toml", what: "workspace licence must stay MIT" });
for (const manifest of files.filter(file => /^packages\/[^/]+\/package\.json$/.test(file))) {
	const licence = jsonLicence(manifest);
	if (licence !== "MIT") failures.push({ where: manifest, what: `declares ${licence ?? "nothing"}, expected MIT` });
}
for (const manifest of files.filter(file => /^(termide|editor)\/npm\/[^/]+\/package\.json$/.test(file))) {
	const licence = jsonLicence(manifest);
	if (licence !== "MIT") failures.push({ where: manifest, what: `declares ${licence ?? "nothing"}, expected MIT` });
}

// 2. Vendored trees keep their own licence file.
const vendoredRoots = [
	"termide",
	...new Set(
		files.filter(file => /^crates\/vendor\/[^/]+\//.test(file)).map(file => `crates/vendor/${file.split("/")[2]}`),
	),
];
for (const vendored of vendoredRoots) {
	// Vendored crates use several canonical spellings: LICENSE, LICENSE.md,
	// LICENSE-MIT, and UNLICENSE (public-domain texts).
	const hasLicence = files.some(file => file === `${vendored}/UNLICENSE` || file.startsWith(`${vendored}/LICENSE`));
	if (!hasLicence) failures.push({ where: vendored, what: "vendored tree has no LICENSE file" });
}

// 3. The root states the licence and points at the attribution.
const rootLicence = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");
for (const required of ["MIT License", "NOTICE"]) {
	if (!rootLicence.includes(required)) failures.push({ where: "LICENSE", what: `no longer mentions ${required}` });
}

// 4. The attribution that makes the fork claim truthful stays present.
try {
	const notice = fs.readFileSync(path.join(ROOT, "NOTICE"), "utf8");
	for (const required of ["https://github.com/can1357/oh-my-pi", "Zeta modifications", "MIT"])
		if (!notice.includes(required)) failures.push({ where: "NOTICE", what: `no longer mentions ${required}` });
} catch {
	failures.push({ where: "NOTICE", what: "is missing" });
}

if (failures.length > 0) {
	for (const { where, what } of failures) console.error(`check-license-map: ${where}: ${what}`);
	console.error(`check-license-map: ${failures.length} violation(s)`);
	process.exit(1);
}
console.log(`check-license-map: ok (MIT surfaces, ${vendoredRoots.length} vendored trees)`);

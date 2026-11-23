#!/usr/bin/env bun
/**
 * The repository carries two licences, and the split is by path: retired/zetawork
 * (the historical zetawork workbench, our own code) is AGPL-3.0-only, everything
 * else is MIT because it derives from or vendors MIT projects. That split is easy
 * to lose silently — a merge rewrites a manifest, a new crate copies the wrong line,
 * a vendored directory arrives without a LICENSE. Each of those makes the
 * published licence claim false while every test still passes.
 *
 * This script asserts the map:
 *   - retired/zetawork manifests and every Rust file carry AGPL-3.0-only;
 *   - first-party MIT surfaces still say MIT;
 *   - vendored trees still carry their own LICENSE;
 *   - the root LICENSE still states the split, and retired/zetawork/LICENSE is AGPL.
 *
 * Exit 0 when the map holds, 1 with one line per violation otherwise.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const AGPL = "AGPL-3.0-only";
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

// 1. The retired workbench remains AGPL, end to end.
if (cargoLicence("retired/zetawork/Cargo.toml") !== AGPL)
	failures.push({ where: "retired/zetawork/Cargo.toml", what: `license must be ${AGPL}` });
for (const manifest of files.filter(file => /^retired\/zetawork\/crates\/[^/]+\/Cargo\.toml$/.test(file))) {
	const inline = cargoLicence(manifest);
	const inherits = /license\.workspace\s*=\s*true/.test(fs.readFileSync(path.join(ROOT, manifest), "utf8"));
	if (inline !== undefined && inline !== AGPL)
		failures.push({ where: manifest, what: `declares ${inline}, expected ${AGPL}` });
	if (inline === undefined && !inherits)
		failures.push({ where: manifest, what: `neither declares ${AGPL} nor inherits the workspace licence` });
}
for (const manifest of files.filter(file => /^retired\/zetawork\/npm\/[^/]+\/package\.json$/.test(file))) {
	const licence = jsonLicence(manifest);
	if (licence !== AGPL) failures.push({ where: manifest, what: `declares ${licence ?? "nothing"}, expected ${AGPL}` });
}
const workbenchSources = files.filter(file => /^retired\/zetawork\/.*\.rs$/.test(file));
if (workbenchSources.length === 0)
	failures.push({
		where: "retired/zetawork/",
		what: "no Rust sources found — the licence check would pass vacuously",
	});
for (const source of workbenchSources) {
	const head = fs.readFileSync(path.join(ROOT, source), "utf8").split("\n", 3).join("\n");
	if (!head.includes(`SPDX-License-Identifier: ${AGPL}`))
		failures.push({ where: source, what: `missing SPDX ${AGPL} header` });
}

// 2. First-party MIT surfaces still say MIT.
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

// 3. Vendored trees keep their own licence file.
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

// 4. The root documents the split and points at the workbench text.
const rootLicence = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");
for (const required of ["retired/zetawork/", AGPL, "MIT License", "retired/zetawork/LICENSE"]) {
	if (!rootLicence.includes(required)) failures.push({ where: "LICENSE", what: `no longer mentions ${required}` });
}
if (!fs.readFileSync(path.join(ROOT, "retired/zetawork/LICENSE"), "utf8").includes("GNU AFFERO GENERAL PUBLIC LICENSE"))
	failures.push({ where: "retired/zetawork/LICENSE", what: "does not contain the AGPL text" });

// 5. The attribution that makes the fork claim truthful stays present.
try {
	const notice = fs.readFileSync(path.join(ROOT, "NOTICE"), "utf8");
	for (const required of ["https://github.com/Linxira-OS/linxira-zeta", "Zeta modifications", "MIT"])
		if (!notice.includes(required)) failures.push({ where: "NOTICE", what: `no longer mentions ${required}` });
	if (!rootLicence.includes("NOTICE")) failures.push({ where: "LICENSE", what: "no longer points at NOTICE" });
} catch {
	failures.push({ where: "NOTICE", what: "is missing" });
}

if (failures.length > 0) {
	for (const { where, what } of failures) console.error(`check-license-map: ${where}: ${what}`);
	console.error(`check-license-map: ${failures.length} violation(s)`);
	process.exit(1);
}
console.log(
	`check-license-map: ok (${workbenchSources.length} workbench sources AGPL, ${vendoredRoots.length} vendored trees)`,
);

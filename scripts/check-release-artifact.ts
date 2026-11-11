#!/usr/bin/env bun
/**
 * Prove a built CLI artifact is the one this release is about (REQ-036).
 *
 * `dist/cli.js` used to answer `--smoke-test` with a bare `ok`, so a stale
 * local bundle could look like a fixed build. The bundler/compiler now embeds
 * the source commit and the smoke response prints it; this check executes the
 * artifact (never the source tree), reads that line back, and compares it with
 * the expected commit.
 *
 * Unknown commits are allowed for ordinary installs (`--allow-unknown`), so a
 * git-less npm install keeps working. Release checks pass `--expect-commit`
 * and therefore fail closed.
 *
 * Usage:
 *   bun scripts/check-release-artifact.ts --staged
 *   bun scripts/check-release-artifact.ts --path packages/coding-agent/binaries/zeta-cli-linux-x64 --expect-commit "$GITHUB_SHA"
 *   bun scripts/check-release-artifact.ts --staged --if-exists
 */
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const STAGED_DIST = "packages/coding-agent/dist/cli.js";

function argValue(args: string[], flag: string): string | null {
	const index = args.indexOf(flag);
	return index === -1 ? null : (args[index + 1] ?? null);
}

async function headCommit(): Promise<string | null> {
	const result = await $`git rev-parse HEAD`.quiet().nothrow();
	const sha = result.stdout.toString().trim();
	return result.exitCode === 0 && /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null;
}

function parseSmokeOutput(stdout: string): { ok: boolean; buildCommit: string | null } {
	const lines = stdout.split(/\r?\n/).map(line => line.trim());
	const ok = lines.includes("smoke-test: ok");
	const commitLine = lines.find(line => line.startsWith("build-commit:"));
	const buildCommit = commitLine ? commitLine.slice("build-commit:".length).trim() : null;
	return { ok, buildCommit };
}

const args = process.argv.slice(2);
const staged = args.includes("--staged");
const ifExists = args.includes("--if-exists");
const allowUnknown = args.includes("--allow-unknown");
const path = staged ? (argValue(args, "--path") ?? STAGED_DIST) : argValue(args, "--path");

if (!path) {
	console.error(
		"usage: bun scripts/check-release-artifact.ts --path <artifact> [--expect-commit SHA] [--allow-unknown]",
	);
	process.exit(2);
}
if (!existsSync(path)) {
	if (ifExists) {
		console.log(`check-release-artifact: ${path} absent; nothing staged to verify.`);
		process.exit(0);
	}
	console.error(`check-release-artifact: ${path} does not exist.`);
	process.exit(1);
}

const expected = argValue(args, "--expect-commit") ?? process.env.GITHUB_SHA ?? (await headCommit());
if (!expected && !allowUnknown) {
	console.error("check-release-artifact: no expected commit (pass --expect-commit, set GITHUB_SHA, or run in git).");
	process.exit(1);
}

const command = path.endsWith(".js") ? ["bun", path, "--smoke-test"] : [path, "--smoke-test"];
const runtimeDir = mkdtempSync(join(tmpdir(), "zeta-artifact-"));
const home = join(runtimeDir, "home");
const xdg = join(runtimeDir, "xdg");
mkdirSync(home, { recursive: true });
mkdirSync(xdg, { recursive: true });
const result = Bun.spawnSync(command, {
	cwd: process.cwd(),
	env: {
		...process.env,
		HOME: home,
		XDG_DATA_HOME: xdg,
		TMPDIR: tmpdir(),
	},
	stdout: "pipe",
	stderr: "pipe",
});

const stdout = result.stdout.toString();
const stderr = result.stderr.toString();
const { ok, buildCommit } = parseSmokeOutput(stdout);

if (result.exitCode !== 0) {
	console.error(`check-release-artifact: ${path} --smoke-test exited ${result.exitCode}.`);
	console.error(stderr.trim() || stdout.trim());
	process.exit(1);
}
if (!ok) {
	console.error(`check-release-artifact: ${path} did not answer "smoke-test: ok".`);
	console.error(stdout.trim() || "(empty stdout)");
	process.exit(1);
}
if (!buildCommit || buildCommit === "unknown") {
	if (allowUnknown && !expected) {
		console.log(`check-release-artifact: ${path} reports an unknown build commit (allowed outside releases).`);
		process.exit(0);
	}
	console.error(
		`check-release-artifact: ${path} reports build-commit ${buildCommit ?? "(missing)"}; ` +
			"a release artifact must name its source commit (REQ-036).",
	);
	process.exit(1);
}
if (expected && buildCommit.toLowerCase() !== expected.toLowerCase()) {
	console.error(
		`check-release-artifact: ${path} was built from ${buildCommit}, expected ${expected}. ` +
			"Rebuild instead of shipping a stale artifact (REQ-036).",
	);
	process.exit(1);
}
console.log(`check-release-artifact: ${path} build-commit ${buildCommit} matches ${expected}.`);

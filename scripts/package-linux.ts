#!/usr/bin/env bun
/**
 * Build all Linux packages (deb, rpm, AUR PKGBUILD) for x86_64.
 *
 * Usage:
 *   bun run scripts/package-linux.ts --version 1.0.0 [--binary path/to/zeta-cli-linux-x64]
 *
 * Prerequisites:
 *   - Linux host with dpkg-deb, rpmbuild, and makepkg available
 *   - Binary must already be built (via ci-release-build-binaries.ts)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const packagingDir = path.join(repoRoot, "scripts", "packaging");
const defaultBinary = path.join(repoRoot, "packages", "coding-agent", "binaries", "zeta-cli-linux-x64");

function parseArgs(): { version: string; binary: string } {
	const args = process.argv.slice(2);
	let version = "";
	let binary = defaultBinary;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--version" && i + 1 < args.length) {
			version = args[++i];
		} else if (args[i].startsWith("--version=")) {
			version = args[i].split("=", 2)[1];
		} else if (args[i] === "--binary" && i + 1 < args.length) {
			binary = args[++i];
		} else if (args[i].startsWith("--binary=")) {
			binary = args[i].split("=", 2)[1];
		}
	}

	if (!version) {
		// Try to read from package.json
		const pkgJson = JSON.parse(Bun.file(path.join(repoRoot, "package.json")).textSync());
		version = pkgJson.version ?? "";
	}

	if (!version) {
		console.error("Usage: bun run scripts/package-linux.ts --version <version> [--binary <path>]");
		process.exit(1);
	}

	return { version, binary };
}

async function runCommand(command: string[], cwd: string): Promise<void> {
	console.log(`  $ ${command.join(" ")}`);
	const proc = Bun.spawn(command, {
		cwd,
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`);
	}
}

async function main(): Promise<void> {
	const { version, binary } = parseArgs();

	// Check binary exists
	try {
		await fs.access(binary);
	} catch {
		console.error(`Binary not found: ${binary}`);
		console.error("Build it first: bun run scripts/ci-release-build-binaries.ts --targets=linux-x64");
		process.exit(1);
	}

	console.log(`\n=== Zeta Linux Packaging ${version} (x86_64) ===`);
	console.log(`Binary: ${binary}\n`);

	// Build .deb
	try {
		console.log("[1/3] Building .deb package...");
		await runCommand(["bash", path.join(packagingDir, "deb", "build-deb.sh"), version, binary], repoRoot);
		console.log("  .deb package built successfully.\n");
	} catch (err) {
		console.warn(`  .deb build skipped (dpkg-deb not available?): ${(err as Error).message}\n`);
	}

	// Build .rpm
	try {
		console.log("[2/3] Building .rpm package...");
		await runCommand(["bash", path.join(packagingDir, "rpm", "build-rpm.sh"), version, binary], repoRoot);
		console.log("  .rpm package built successfully.\n");
	} catch (err) {
		console.warn(`  .rpm build skipped (rpmbuild not available?): ${(err as Error).message}\n`);
	}

	// AUR PKGBUILD — just copy the template (no build needed, it's source-only)
	console.log("[3/3] AUR PKGBUILD ready.");
	console.log(`  PKGBUILD: ${path.join(packagingDir, "aur", "PKGBUILD")}`);
	console.log(`  .install:  ${path.join(packagingDir, "aur", "zeta.install")}`);
	console.log("  Use 'makepkg -si' in the aur/ directory to build and install.\n");

	console.log("=== Packaging complete ===");
	const outDir = path.join(repoRoot, "packages", "coding-agent", "binaries");
	try {
		const files = await fs.readdir(outDir);
		const pkgs = files.filter(f => f.endsWith(".deb") || f.endsWith(".rpm"));
		if (pkgs.length > 0) {
			console.log("Output packages:");
			for (const pkg of pkgs) {
				console.log(`  ${path.join(outDir, pkg)}`);
			}
		}
	} catch {
		// Directory may not exist
	}
}

await main();

#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { COMPILED_EXTERNAL_DEPENDENCIES, compileCodingAgent } from "../packages/coding-agent/scripts/compile-binary";

interface CliBinaryTarget {
	kind: "cli";
	id: string;
	platform: string;
	arch: string;
	target: Bun.Build.CompileTarget;
	outfile: string;
}

/**
 * Bare native binaries of the non-CLI products, published as release assets
 * for distribution repackaging (Linxira pacman repo): the asset file name is
 * the target id, fetched verbatim via
 * `releases/download/v<pkgver>/<asset>` (PE assets carry a `.exe` suffix on
 * top of the id).
 */
interface ProductBinaryTarget {
	kind: "product";
	/** Release asset name — hyphenated product + platform, no extra suffix. */
	id: string;
	product: "work" | "ide" | "editor";
	platform: "linux" | "win32";
}

type ReleaseTarget = CliBinaryTarget | ProductBinaryTarget;

const repoRoot = path.join(import.meta.dir, "..");
const binariesDir = path.join(repoRoot, "packages", "coding-agent", "binaries");
const entrypoint = path.join(repoRoot, "packages", "coding-agent", "src", "cli.ts");
const transformersManifest: unknown = createRequire(import.meta.url)("@huggingface/transformers/package.json");
if (
	typeof transformersManifest !== "object" ||
	transformersManifest === null ||
	!("version" in transformersManifest) ||
	typeof transformersManifest.version !== "string"
) {
	throw new Error("@huggingface/transformers package manifest has no string version");
}
const transformersVersion = transformersManifest.version;
// Worker threads re-enter the binary's single CLI host entry.
const isDryRun = process.argv.includes("--dry-run");
const targets: ReleaseTarget[] = [
	{
		kind: "cli",
		id: "darwin-arm64",
		platform: "darwin",
		arch: "arm64",
		target: "bun-darwin-arm64",
		outfile: "packages/coding-agent/binaries/zeta-cli-darwin-arm64",
	},
	{
		kind: "cli",
		id: "darwin-x64",
		platform: "darwin",
		arch: "x64",
		target: "bun-darwin-x64",
		outfile: "packages/coding-agent/binaries/zeta-cli-darwin-x64",
	},
	{
		kind: "cli",
		id: "linux-x64",
		platform: "linux",
		arch: "x64",
		target: "bun-linux-x64-baseline",
		outfile: "packages/coding-agent/binaries/zeta-cli-linux-x64",
	},
	{
		kind: "cli",
		id: "linux-arm64",
		platform: "linux",
		arch: "arm64",
		target: "bun-linux-arm64",
		outfile: "packages/coding-agent/binaries/zeta-cli-linux-arm64",
	},
	{
		kind: "cli",
		id: "linux-musl-x64",
		platform: "linux",
		arch: "x64",
		target: "bun-linux-x64-musl-baseline",
		outfile: "packages/coding-agent/binaries/zeta-cli-linux-musl-x64",
	},
	{
		kind: "cli",
		id: "linux-musl-arm64",
		platform: "linux",
		arch: "arm64",
		target: "bun-linux-arm64-musl",
		outfile: "packages/coding-agent/binaries/zeta-cli-linux-musl-arm64",
	},
	{
		kind: "cli",
		id: "win32-x64",
		platform: "win32",
		arch: "x64",
		target: "bun-windows-x64-baseline",
		outfile: "packages/coding-agent/binaries/zeta-cli-windows-x64.exe",
	},
	{
		kind: "cli",
		id: "win32-arm64",
		platform: "win32",
		arch: "arm64",
		target: "bun-windows-arm64",
		outfile: "packages/coding-agent/binaries/zeta-cli-windows-arm64.exe",
	},
	// Bare product binaries. work/ide are Cargo workspace builds (toolchain
	// pinned by each workspace's rust-toolchain.toml, 1.91.1 — the same pin
	// the main_tests/termide_tests jobs compile under); editor is the vendored
	// TTT Go module. win32 assets cross-build on the Linux runner: cargo via
	// the GNU target, editor via GOOS=windows.
	{
		kind: "product",
		id: "zeta-work-linux-x64",
		product: "work",
		platform: "linux",
	},
	{
		kind: "product",
		id: "zeta-work-win-x64",
		product: "work",
		platform: "win32",
	},
	{
		kind: "product",
		id: "zeta-ide-linux-x64",
		product: "ide",
		platform: "linux",
	},
	{
		kind: "product",
		id: "zeta-editor-linux-x64",
		product: "editor",
		platform: "linux",
	},
	{
		kind: "product",
		id: "zeta-editor-win-x64",
		product: "editor",
		platform: "win32",
	},
];

/** Cargo workspace roots per Rust product: package to build, produced bin. */
const CARGO_PRODUCTS: Record<
	Exclude<ProductBinaryTarget["product"], "editor">,
	{ dir: string; pkg: string; bin: string }
> = {
	work: { dir: "main", pkg: "zeta-main", bin: "zeta" },
	ide: { dir: "termide", pkg: "termide", bin: "termide" },
};

function parseRequestedTargets(): Set<string> | null {
	const flagIndex = process.argv.indexOf("--targets");
	const flagValue =
		flagIndex >= 0
			? process.argv[flagIndex + 1]
			: (process.argv.find(arg => arg.startsWith("--targets="))?.split("=", 2)[1] ?? Bun.env.RELEASE_TARGETS);

	if (!flagValue) {
		return null;
	}

	return new Set(
		flagValue
			.split(",")
			.map(value => value.trim())
			.filter(Boolean),
	);
}

function shouldAdhocSignDarwinBinary(target: CliBinaryTarget): boolean {
	return target.platform === "darwin" && process.platform === "darwin";
}

async function runCommand(command: string[], cwd: string): Promise<void> {
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

async function buildCliBinary(target: CliBinaryTarget): Promise<void> {
	console.log(`Building ${target.outfile}...`);
	if (isDryRun) {
		console.log(
			`DRY RUN Bun.build target=${target.target} outfile=${target.outfile} external=${COMPILED_EXTERNAL_DEPENDENCIES.join(",")}`,
		);
		return;
	}

	await compileCodingAgent({
		repoRoot,
		entrypoint,
		outfile: path.join(repoRoot, target.outfile),
		transformersVersion,
		native: target,
		target: target.target,
		minifyIdentifiers: true,
		skipBuiltinCodesign: shouldAdhocSignDarwinBinary(target),
	});
	// Bun 1.3.12 emits a truncated Mach-O signature on darwin builds.
	if (shouldAdhocSignDarwinBinary(target)) {
		await runCommand(
			[
				"codesign",
				"--force",
				"--sign",
				"-",
				"--entitlements",
				path.join(repoRoot, "scripts", "macos-entitlements.plist"),
				path.join(repoRoot, target.outfile),
			],
			repoRoot,
		);
	}
}

async function buildCargoProduct(target: ProductBinaryTarget & { product: "work" | "ide" }): Promise<void> {
	const product = CARGO_PRODUCTS[target.product];
	const workspaceDir = path.join(repoRoot, product.dir);
	// Windows assets cross-compile from the Linux runner with the GNU
	// toolchain (the same "Win GNU target" method the committed npm leaf
	// binaries are rebuilt with); the linker comes from
	// CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER in the release job.
	const triple = target.platform === "win32" ? "x86_64-pc-windows-gnu" : undefined;
	if (isDryRun) {
		console.log(`DRY RUN cargo build --release --locked -p ${product.pkg} [cwd ${product.dir}]`);
		return;
	}
	await runCommand(
		["cargo", "build", "--release", "--locked", "-p", product.pkg, ...(triple ? ["--target", triple] : [])],
		workspaceDir,
	);
	// Resolve the built bin the way cargo does: CARGO_TARGET_DIR redirects the
	// output tree (local verification uses it); CI leaves it unset and builds
	// in the workspace's own target/. Cross builds live under
	// <target-dir>/<triple>/release/.
	const targetDir = Bun.env.CARGO_TARGET_DIR
		? path.resolve(Bun.env.CARGO_TARGET_DIR)
		: path.join(workspaceDir, "target");
	const builtBin = path.join(
		targetDir,
		...(triple ? [triple] : []),
		"release",
		product.bin + (target.platform === "win32" ? ".exe" : ""),
	);
	await fs.copyFile(builtBin, path.join(binariesDir, target.id + (target.platform === "win32" ? ".exe" : "")));
}

async function buildGoProduct(target: ProductBinaryTarget): Promise<void> {
	if (isDryRun) {
		console.log(`DRY RUN go build ./cmd/ttt -> ${target.id}`);
		return;
	}
	// PE assets carry the .exe suffix (same convention as the cargo win
	// build); the id itself stays the bare asset name.
	const artifactName = target.platform === "win32" ? `${target.id}.exe` : target.id;
	const outArtifact = path.join(binariesDir, artifactName);
	const env: NodeJS.ProcessEnv = {
		...Bun.env,
		// Pin the arch so an arm64 release host cannot silently emit the wrong
		// asset; the win32 asset is a first-class GOOS cross build.
		GOARCH: "amd64",
		GOOS: target.platform === "win32" ? "windows" : (Bun.env.GOOS ?? "linux"),
	};
	// Stamp the release version the committed npm leaf binaries carry
	// (`ttt <version>` via --version); builds without the env stay at the
	// source default.
	const ldflags = ["-s", "-w"];
	if (Bun.env.RELEASE_PRODUCT_VERSION) {
		ldflags.push(`-X main.version=${Bun.env.RELEASE_PRODUCT_VERSION}`);
	}
	await runCommand(
		["go", "build", `-ldflags=${ldflags.join(" ")}`, "-o", outArtifact, "./cmd/ttt"],
		path.join(repoRoot, "editor"),
		env,
	);
}

async function buildProductBinary(target: ProductBinaryTarget): Promise<void> {
	console.log(`Building ${target.id}...`);
	if (target.product === "editor") {
		await buildGoProduct(target);
		return;
	}
	// The dispatch above excluded "editor"; the remaining products are the
	// two Cargo workspaces.
	const cargoTarget: ProductBinaryTarget & { product: "work" | "ide" } = { ...target, product: target.product };
	await buildCargoProduct(cargoTarget);
}

async function generateBundle(): Promise<void> {
	if (isDryRun) {
		console.log("DRY RUN bun run gen:stats");
		console.log("DRY RUN bun --cwd=packages/collab-web run gen:tool-views");
		return;
	}
	await runCommand(["bun", "run", "gen:stats"], repoRoot);
	await runCommand(["bun", "--cwd=packages/collab-web", "run", "gen:tool-views"], repoRoot);
}

async function resetArtifacts(): Promise<void> {
	if (isDryRun) {
		console.log("DRY RUN bun run gen:stats:reset");
		return;
	}
	await runCommand(["bun", "run", "gen:stats:reset"], repoRoot);
}

async function main(): Promise<void> {
	const requestedTargets = parseRequestedTargets();
	const selectedTargets = requestedTargets ? targets.filter(target => requestedTargets.has(target.id)) : targets;

	if (requestedTargets) {
		const unknownTargets = [...requestedTargets].filter(
			requestedTarget => !targets.some(target => target.id === requestedTarget),
		);
		if (unknownTargets.length > 0) {
			throw new Error(`Unknown release target(s): ${unknownTargets.join(", ")}`);
		}
	}

	if (selectedTargets.length === 0) {
		throw new Error("No release targets selected.");
	}

	const cliTargets = selectedTargets.filter((target): target is CliBinaryTarget => target.kind === "cli");
	const productTargets = selectedTargets.filter((target): target is ProductBinaryTarget => target.kind === "product");

	await fs.mkdir(binariesDir, { recursive: true });
	// CLI builds generate into the checked-in placeholder tree and reset it in
	// the finally; product builds touch no generated state, so a product-only
	// selection (the cargo/go release legs) skips the bundle round-trip.
	try {
		if (cliTargets.length > 0) {
			await generateBundle();
			for (const target of cliTargets) {
				await buildCliBinary(target);
			}
		}
		for (const target of productTargets) {
			await buildProductBinary(target);
		}
	} finally {
		if (cliTargets.length > 0) {
			await resetArtifacts();
		}
	}
}

await main();

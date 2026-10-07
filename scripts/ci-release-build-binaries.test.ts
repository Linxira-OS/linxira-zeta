import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { TempDir } from "@linxiraos/pi-utils/temp";
import { $ } from "bun";
import { resolveCrossBuild } from "../packages/coding-agent/scripts/build-binary";
import { compileCodingAgent } from "../packages/coding-agent/scripts/compile-binary";

const repoRoot = path.join(import.meta.dir, "..");

describe("Windows release binary target", () => {
	it("builds both Windows architecture release assets with their native runtimes", async () => {
		const result = await $`bun scripts/ci-release-build-binaries.ts --dry-run --targets win32-x64,win32-arm64`
			.cwd(repoRoot)
			.quiet()
			.nothrow();
		expect(result.exitCode).toBe(0);
		const output = result.text();

		expect(output).toContain("Building packages/coding-agent/binaries/zeta-cli-windows-x64.exe...");
		expect(output).toContain(
			"DRY RUN Bun.build target=bun-windows-x64-baseline outfile=packages/coding-agent/binaries/zeta-cli-windows-x64.exe",
		);
		expect(output).toContain("Building packages/coding-agent/binaries/zeta-cli-windows-arm64.exe...");
		expect(output).toContain(
			"DRY RUN Bun.build target=bun-windows-arm64 outfile=packages/coding-agent/binaries/zeta-cli-windows-arm64.exe",
		);
		expect(output).toContain("external=fastembed,onnxruntime-node");
		expect(output).not.toContain("bun-windows-x64-modern");
	});

	it("builds the bare zeta-work/zeta-ide/zeta-editor release assets and skips the CLI bundle round-trip", async () => {
		const result =
			await $`bun scripts/ci-release-build-binaries.ts --dry-run --targets zeta-work-linux-x64,zeta-work-win-x64,zeta-ide-linux-x64,zeta-editor-linux-x64,zeta-editor-win-x64`
				.cwd(repoRoot)
				.quiet()
				.nothrow();
		expect(result.exitCode).toBe(0);
		const output = result.text();

		expect(output).toContain("DRY RUN cargo build --release --locked -p zeta-main [cwd main]");
		expect(output).toContain("DRY RUN cargo build --release --locked -p termide [cwd termide]");
		expect(output).toContain("DRY RUN go build ./cmd/ttt -> zeta-editor-linux-x64");
		expect(output).toContain("DRY RUN go build ./cmd/ttt -> zeta-editor-win-x64");
		// Product-only selections touch no generated state: no gen:stats /
		// gen:native round-trip (the cargo/go release legs run without it).
		expect(output).not.toContain("DRY RUN bun run gen:stats");
		expect(output).not.toContain("DRY RUN bun run gen:native");
	});

	it("resolves local Windows cross-build aliases for both architectures", () => {
		expect(resolveCrossBuild("win32-x64")).toEqual({
			id: "win32-x64",
			platform: "win32",
			arch: "x64",
			target: "bun-windows-x64-baseline",
		});
		expect(resolveCrossBuild("windows-x64")).toEqual({
			id: "windows-x64",
			platform: "win32",
			arch: "x64",
			target: "bun-windows-x64-baseline",
		});
		expect(resolveCrossBuild("win32-arm64")).toEqual({
			id: "win32-arm64",
			platform: "win32",
			arch: "arm64",
			target: "bun-windows-arm64",
		});
		expect(resolveCrossBuild("windows-arm64")).toEqual({
			id: "windows-arm64",
			platform: "win32",
			arch: "arm64",
			target: "bun-windows-arm64",
		});
	});
});

it("runs compiled bytecode containing dependency import.meta.resolve calls", async () => {
	using temp = TempDir.createSync("@omp-bytecode-");
	const entrypoint = temp.join("entry.ts");
	const outfile = temp.join(process.platform === "win32" ? "probe.exe" : "probe");
	await Bun.write(entrypoint, 'console.log(import.meta.resolve("node:fs"));\n');
	await compileCodingAgent({
		repoRoot: temp.path(),
		entrypoint,
		outfile,
		transformersVersion: "unused",
		native: null,
	});
	const result = await $`${outfile}`.quiet().nothrow();
	expect(result.exitCode).toBe(0);
	expect(result.text().trim()).toBe("node:fs");
}, 30_000);
describe("macOS release binary entitlements", () => {
	it("allows Xcode MCP automation through Apple Events", async () => {
		const entitlements = await Bun.file(path.join(repoRoot, "scripts/macos-entitlements.plist")).text();

		expect(entitlements).toContain("<key>com.apple.security.automation.apple-events</key>\n\t<true/>");
	});
});

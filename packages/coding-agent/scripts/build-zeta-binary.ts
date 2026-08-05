/**
 * 构建 Zeta 二进制文件。
 *
 * 流程:
 *   1. 构建 stats/collab-web/natives 等依赖
 *   2. 编译 coding-agent 为单文件可执行二进制
 *
 * Web UI 不嵌入到二进制中，而是作为独立目录分发（与二进制放在同一目录下）。
 * 运行时会自动查找同目录下的 web-ui/ 目录。
 *
 * 用法:
 *   bun run scripts/build-zeta-binary.ts                  # 本地平台
 *   bun run scripts/build-zeta-binary.ts --target win32-x64  # 交叉编译
 */

import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { buildDocsIndexPayload } from "./generate-docs-index";
import { createLegacyPiVirtualModulePlugin } from "./legacy-pi-virtual-module";

const repoRoot = path.join(import.meta.dir, "..", "..");
const packageDir = path.join(import.meta.dir, "..");

export interface CrossBuild {
	readonly id: string;
	readonly target: Bun.Build.CompileTarget;
}

function resolveCrossBuild(value: string | undefined): CrossBuild | null {
	switch (value) {
		case undefined:
		case "":
			return null;
		case "win32-x64":
		case "windows-x64":
			return { id: "win32-x64", target: "bun-windows-x64-baseline" };
		case "linux-x64":
			return { id: "linux-x64", target: "bun-linux-x64-baseline" };
		case "linux-arm64":
			return { id: "linux-arm64", target: "bun-linux-arm64" };
		case "darwin-x64":
			return { id: "darwin-x64", target: "bun-darwin-x64" };
		case "darwin-arm64":
			return { id: "darwin-arm64", target: "bun-darwin-arm64" };
		default:
			throw new Error(`Unsupported target: ${value}`);
	}
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

async function main(): Promise<void> {
	const targetArg =
		process.argv.find(a => a.startsWith("--target="))?.split("=")[1] ??
		process.argv[process.argv.indexOf("--target") + 1];
	const crossBuild = resolveCrossBuild(targetArg);

	const outName = crossBuild ? `zeta-${crossBuild.id}` : "zeta";
	const outExt = crossBuild?.id.startsWith("win32") ? ".exe" : "";
	const outputPath = path.join(packageDir, "binaries", outName + outExt);

	await fs.mkdir(path.join(packageDir, "binaries"), { recursive: true });

	try {
		// Build stats client archive
		await runCommand(["bun", "--cwd=../stats", "run", "gen:stats"], packageDir);

		// Build collab-web tool views
		await runCommand(["bun", "--cwd=../collab-web", "run", "gen:tool-views"], packageDir);

		// Build natives
		await runCommand(["bun", "--cwd=../natives", "run", "gen:native"], packageDir);

		await runCommand(["bun", "run", "gen:mupdf"], packageDir);

		const docsIndexPayload = await buildDocsIndexPayload();

		try {
			const output = await Bun.build({
				entrypoints: [path.join(packageDir, "src", "cli.ts")],
				root: repoRoot,
				external: ["fastembed", "onnxruntime-node"],
				define: {
					"process.env.PI_COMPILED": JSON.stringify("true"),
					"process.env.PI_TINY_TRANSFORMERS_VERSION": JSON.stringify(transformersVersion),
					"process.env.PI_DOCS_EMBED": JSON.stringify(docsIndexPayload.payload),
				},
				minify: {
					identifiers: false,
					keepNames: true,
				},
				plugins: [await createLegacyPiVirtualModulePlugin()],
				compile: {
					...(crossBuild?.target ? { target: crossBuild.target } : {}),
					outfile: outputPath,
					autoloadBunfig: false,
					autoloadDotenv: false,
					autoloadTsconfig: false,
					autoloadPackageJson: false,
				},
				throw: false,
			});

			if (!output.success) {
				throw new Error(`Binary build failed:\n${output.logs.map(l => l.message).join("\n")}`);
			}

			console.log(`\n  Binary built: ${outputPath}`);
		} finally {
			await runCommand(["bun", "run", "gen:mupdf:reset"], packageDir);
			await runCommand(["bun", "--cwd=../natives", "run", "gen:native:reset"], packageDir);
		}
	} finally {
		await runCommand(["bun", "--cwd=../stats", "run", "gen:stats:reset"], packageDir);
	}
}

if (import.meta.main) await main();

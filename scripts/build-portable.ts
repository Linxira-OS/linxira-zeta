#!/usr/bin/env bun

/**
 * 绿色版（便携版）构建脚本
 *
 * 构建包含 CLI 二进制 + Web UI 的自包含分发包。
 * 解压后运行 start.bat 即可启动。
 *
 * 用法：
 *   bun run scripts/build-portable.ts                    # 构建当前平台
 *   bun run scripts/build-portable.ts --platform win32   # 指定平台
 *
 * 输出：temp/zeta-portable-{platform}-{arch}.zip
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

const REPO_ROOT = path.join(import.meta.dir, "..");
const CODING_AGENT_DIR = path.join(REPO_ROOT, "packages", "coding-agent");
const WEB_UI_DIR = path.join(REPO_ROOT, "web-ui");
const OUTPUT_DIR = path.join(REPO_ROOT, "temp", "portable");

interface BuildConfig {
	platform: string;
	arch: string;
	exeExt: string;
	crossTarget: string;
}

function getBuildConfig(): BuildConfig {
	const args = Bun.argv.slice(2);
	const platformFlag = args.find(a => a.startsWith("--platform="))?.split("=")[1];

	const platform = platformFlag ?? process.platform;
	const arch = process.arch === "arm64" ? "arm64" : "x64";

	const platformId = platform === "win32" ? "windows-x64" : platform === "linux" ? "linux-x64" : `darwin-${arch}`;

	switch (platform) {
		case "win32":
			return { platform: "win32", arch: "x64", exeExt: ".exe", crossTarget: platformId };
		case "linux":
			return { platform: "linux", arch: "x64", exeExt: "", crossTarget: platformId };
		case "darwin":
			return { platform: "darwin", arch, exeExt: "", crossTarget: platformId };
		default:
			throw new Error(`Unsupported platform: ${platform}`);
	}
}

// ---------------------------------------------------------------------------
// 构建步骤
// ---------------------------------------------------------------------------

async function runStep(name: string, fn: () => Promise<void>): Promise<void> {
	console.log(`\n  [${name}]...`);
	await fn();
	console.log(`  [${name}] OK`);
}

async function copyCliBinary(config: BuildConfig, outDir: string): Promise<void> {
	const isCrossCompile = config.platform !== process.platform;
	const cliOutName = isCrossCompile ? `zeta-${config.crossTarget}${config.exeExt}` : `zeta${config.exeExt}`;
	const cliOutPath = path.join(CODING_AGENT_DIR, "dist", cliOutName);

	if (!fs.existsSync(cliOutPath)) {
		// Build if not found
		await runStep("构建 CLI 二进制", async () => {
			const env: Record<string, string> = { ...Bun.env };
			if (isCrossCompile) {
				env.CROSS_TARGET = config.crossTarget;
			}
			await $`bun run build`.cwd(CODING_AGENT_DIR).env(env);
		});
	}

	if (!fs.existsSync(cliOutPath)) {
		throw new Error(`CLI binary not found at ${cliOutPath}`);
	}

	await runStep("复制 CLI 二进制", async () => {
		fs.copyFileSync(cliOutPath, path.join(outDir, `zeta${config.exeExt}`));
	});
}

async function copyWebUi(_config: BuildConfig, outDir: string): Promise<void> {
	const nextDir = path.join(WEB_UI_DIR, ".next");
	if (!fs.existsSync(path.join(nextDir, "BUILD_ID"))) {
		throw new Error("Web UI not built. Run 'cd web-ui && npm run build' first.");
	}

	const webUiOutDir = path.join(outDir, "web-ui");
	await runStep("复制 Web UI 到分发包", async () => {
		// Copy .next/ directory
		copyDir(nextDir, path.join(webUiOutDir, ".next"));
		// Copy package.json and next.config
		fs.copyFileSync(path.join(WEB_UI_DIR, "package.json"), path.join(webUiOutDir, "package.json"));
		fs.copyFileSync(path.join(WEB_UI_DIR, "next.config.ts"), path.join(webUiOutDir, "next.config.ts"));
		// Copy node_modules (only runtime deps; skip dev deps to save space)
		copyNodeModules(webUiOutDir);
	});
}

function copyNodeModules(webUiOutDir: string): void {
	// Read package.json to determine what to copy
	const pkg = JSON.parse(fs.readFileSync(path.join(WEB_UI_DIR, "package.json"), "utf-8"));
	const deps = { ...pkg.dependencies };

	// Copy each dependency
	const srcNm = path.join(WEB_UI_DIR, "node_modules");
	const destNm = path.join(webUiOutDir, "node_modules");

	if (!fs.existsSync(destNm)) {
		fs.mkdirSync(destNm, { recursive: true });
	}

	for (const dep of Object.keys(deps)) {
		const srcPath = path.join(srcNm, dep);
		const destPath = path.join(destNm, dep);
		if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
			copyDir(srcPath, destPath);
		}
	}

	// Also copy .bin directory for next scripts
	const binSrc = path.join(srcNm, ".bin");
	const binDest = path.join(destNm, ".bin");
	if (fs.existsSync(binSrc) && !fs.existsSync(binDest)) {
		copyDir(binSrc, binDest);
	}
}

async function createLauncher(config: BuildConfig, outDir: string): Promise<void> {
	if (config.platform === "win32") {
		// VBS 无窗口启动器 — 双击后不显示终端窗口，直接打开浏览器
		const vbsContent = `CreateObject("WScript.Shell").Run ".\\zeta.exe serve", 0, False
`;
		await Bun.write(path.join(outDir, "start.vbs"), vbsContent);

		// BAT 备用启动器（调试用）
		const batContent = `@echo off
title Zeta
echo Starting Zeta...
echo.
".\\zeta.exe" serve
pause
`;
		await Bun.write(path.join(outDir, "start.bat"), batContent);

		// 自述文件
		const readmeContent = `Zeta 绿色版

双击 start.vbs 启动（无窗口，自动打开浏览器）
如遇问题，双击 start.bat 查看终端输出
`;
		await Bun.write(path.join(outDir, "README.txt"), readmeContent);
	}
}

async function createZip(config: BuildConfig, outDir: string): Promise<void> {
	const zipName = `zeta-portable-${config.platform}-${config.arch}.zip`;
	const zipPath = path.join(REPO_ROOT, "temp", zipName);

	await runStep(`创建 ${zipName}`, async () => {
		if (fs.existsSync(zipPath)) {
			fs.unlinkSync(zipPath);
		}

		if (config.platform === "win32") {
			await $`powershell -Command "Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force"`.cwd(
				REPO_ROOT,
			);
		} else {
			await $`zip -r ${zipPath} .`.cwd(outDir);
		}
	});

	console.log(`\n  ${zipPath}`);
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function copyDir(src: string, dest: string): void {
	if (!fs.existsSync(dest)) {
		fs.mkdirSync(dest, { recursive: true });
	}
	const entries = fs.readdirSync(src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDir(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const config = getBuildConfig();

	console.log(`\n  Zeta 绿色版构建`);
	console.log(`  平台: ${config.platform}-${config.arch}`);
	console.log(`  输出: temp/zeta-portable-${config.platform}-${config.arch}.zip\n`);

	const outDir = path.join(OUTPUT_DIR, `zeta-portable-${config.platform}-${config.arch}`);
	if (fs.existsSync(outDir)) {
		fs.rmSync(outDir, { recursive: true });
	}
	fs.mkdirSync(outDir, { recursive: true });

	await copyCliBinary(config, outDir);
	await copyWebUi(config, outDir);
	await createLauncher(config, outDir);
	await createZip(config, outDir);

	console.log(`\n  绿色版构建完成!\n`);
}

if (import.meta.main) {
	await main();
}

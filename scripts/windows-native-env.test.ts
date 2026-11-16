import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const scratchDirs: string[] = [];
const arch = process.arch === "arm64" ? "arm64" : process.arch === "ia32" ? "x86" : "x64";

afterEach(() => {
	for (const dir of scratchDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture() {
	const scratchRoot = path.join(repoRoot, "temp");
	fs.mkdirSync(scratchRoot, { recursive: true });
	const root = fs.mkdtempSync(path.join(scratchRoot, "windows-native-env-"));
	scratchDirs.push(root);
	const vsRoot = path.join(root, "VS tools & fixtures");
	const vcTools = path.join(vsRoot, "VC", "Tools", "MSVC", "fixture");
	const compilerDir = path.join(vcTools, "bin", `Host${arch}`, arch);
	const sdkRoot = path.join(root, "Windows SDK");
	const sdkVersion = "10.0.22621.0";
	const cmakeDir = path.join(vsRoot, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "CMake", "bin");
	const ninjaDir = path.join(vsRoot, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "Ninja");
	const files = [
		path.join(compilerDir, "cl.exe"),
		path.join(compilerDir, "link.exe"),
		path.join(sdkRoot, "Include", sdkVersion, "um", "Windows.h"),
		path.join(sdkRoot, "Include", sdkVersion, "ucrt", "stdio.h"),
		path.join(sdkRoot, "Lib", sdkVersion, "um", arch, "kernel32.lib"),
		path.join(sdkRoot, "Lib", sdkVersion, "ucrt", arch, "ucrt.lib"),
		path.join(cmakeDir, "cmake.exe"),
		path.join(ninjaDir, "ninja.exe"),
	];
	for (const file of files) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "");
	}
	const devCmd = path.join(vsRoot, "Common7", "Tools", "VsDevCmd.bat");
	fs.mkdirSync(path.dirname(devCmd), { recursive: true });
	fs.writeFileSync(
		devCmd,
		[
			"@echo off",
			`set "VSINSTALLDIR=${vsRoot}"`,
			`set "VCToolsInstallDir=${vcTools}"`,
			`set "VSCMD_ARG_HOST_ARCH=${arch}"`,
			`set "VSCMD_ARG_TGT_ARCH=${arch}"`,
			`set "WindowsSdkDir=${sdkRoot}"`,
			`set "WindowsSDKVersion=${sdkVersion}\\"`,
			`set "INCLUDE=${path.join(sdkRoot, "Include")}"`,
			`set "LIB=${path.join(sdkRoot, "Lib")}"`,
			'set "ZETA_NATIVE_ENV_SENTINEL=fixture=value"',
			"exit /b 0",
			"",
		].join("\r\n"),
	);
	const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
	const env = {
		...inheritedEnv,
		VSINSTALLDIR: vsRoot,
		VCToolsInstallDir: "",
		VSCMD_ARG_TGT_ARCH: "",
		WindowsSdkDir: "",
		WindowsSDKVersion: "",
		INCLUDE: "",
		LIB: "",
		PATH: path.dirname(process.execPath),
	};
	return { env, compilerDir, sdkRoot, sdkVersion, cmakeDir, ninjaDir };
}

function configure(env: Record<string, string | undefined>) {
	const source = `
		import { configureWindowsNativeEnvironment } from ${JSON.stringify(path.join(import.meta.dir, "windows-native-env.ts"))};
		configureWindowsNativeEnvironment();
		console.log(JSON.stringify({
			path: process.env.PATH,
			include: process.env.INCLUDE,
			lib: process.env.LIB,
			sentinel: process.env.ZETA_NATIVE_ENV_SENTINEL,
		}));
	`;
	return Bun.spawnSync([process.execPath, "-e", source], { cwd: repoRoot, env, stdout: "pipe", stderr: "pipe" });
}

describe.skipIf(process.platform !== "win32")("Windows native tool selection", () => {
	test("imports a VS environment from a path with spaces and & and prioritizes its linker", () => {
		const { env, compilerDir, sdkRoot, cmakeDir, ninjaDir } = fixture();
		const result = configure(env);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
		const configured = JSON.parse(result.stdout.toString());
		expect(configured.path.split(path.delimiter)).toEqual([compilerDir, env.PATH, cmakeDir, ninjaDir]);
		expect(configured.include).toBe(path.join(sdkRoot, "Include"));
		expect(configured.lib).toBe(path.join(sdkRoot, "Lib"));
		expect(configured.sentinel).toBe("fixture=value");
	});

	test("prioritizes the matching MSVC linker in an initialized developer environment", () => {
		const { env, compilerDir, sdkRoot, sdkVersion, cmakeDir, ninjaDir } = fixture();
		const configured = configure({
			...env,
			VSINSTALLDIR: "",
			VCToolsInstallDir: path.dirname(path.dirname(path.dirname(compilerDir))),
			VSCMD_ARG_HOST_ARCH: arch,
			VSCMD_ARG_TGT_ARCH: arch,
			WindowsSdkDir: sdkRoot,
			WindowsSDKVersion: sdkVersion,
			INCLUDE: path.join(sdkRoot, "Include"),
			LIB: path.join(sdkRoot, "Lib"),
			PATH: [env.PATH, cmakeDir, ninjaDir].join(path.delimiter),
		});
		expect(configured.stderr.toString()).toBe("");
		expect(configured.exitCode).toBe(0);
		expect(JSON.parse(configured.stdout.toString()).path.split(path.delimiter)[0]).toBe(compilerDir);
	});

	test("requires the selected SDK's actual import libraries", () => {
		const { env, sdkRoot, sdkVersion } = fixture();
		fs.unlinkSync(path.join(sdkRoot, "Lib", sdkVersion, "um", arch, "kernel32.lib"));
		const result = configure(env);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("Windows SDK headers/import libraries are missing");
		expect(result.stdout.toString()).toBe("");
	});
});

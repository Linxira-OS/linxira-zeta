import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const VC_TOOLS_COMPONENT = "Microsoft.VisualStudio.Component.VC.Tools.x86.x64";
const WINDOWS_SDK_COMPONENT = "Microsoft.VisualStudio.Component.Windows11SDK.22621";
const CMAKE_COMPONENT = "Microsoft.VisualStudio.Component.VC.CMake.Project";

/**
 * Use the installed MSVC environment before Cargo probes a compiler or linker.
 * Merely finding `link.exe` on PATH is insufficient: Git for Windows ships an
 * unrelated GNU executable under that name. VsDevCmd also supplies the SDK's
 * INCLUDE/LIB paths, which selecting the real linker alone would not provide.
 */
export function configureWindowsNativeEnvironment(): void {
	if (process.platform !== "win32") return;
	const arch = process.arch === "arm64" ? "arm64" : process.arch === "ia32" ? "x86" : "x64";
	const toolsComponent = arch === "arm64" ? "Microsoft.VisualStudio.Component.VC.Tools.ARM64" : VC_TOOLS_COMPONENT;
	let vsRoot = process.env.VSINSTALLDIR;

	// A matching Developer Command Prompt already has the correct SDK and CRT.
	if (
		!process.env.VCToolsInstallDir ||
		process.env.VSCMD_ARG_TGT_ARCH !== arch ||
		!process.env.WindowsSdkDir ||
		!process.env.WindowsSDKVersion ||
		!process.env.INCLUDE ||
		!process.env.LIB
	) {
		let devCmd = vsRoot ? path.join(vsRoot, "Common7", "Tools", "VsDevCmd.bat") : "";
		if (!devCmd || !fs.existsSync(devCmd)) {
			const vswhere =
				Bun.which("vswhere.exe") ??
				path.join(
					process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
					"Microsoft Visual Studio",
					"Installer",
					"vswhere.exe",
				);
			if (!fs.existsSync(vswhere)) {
				throw new Error(
					`Windows native builds need Visual Studio Build Tools (${toolsComponent}) and a Windows SDK ` +
						`(for example ${WINDOWS_SDK_COMPONENT}); vswhere.exe was not found at ${vswhere}. ` +
						"Install Desktop development with C++, or run from its matching Developer Command Prompt.",
				);
			}
			const probe = Bun.spawnSync(
				[vswhere, "-utf8", "-latest", "-products", "*", "-requires", toolsComponent, "-property", "installationPath"],
				{ stdout: "pipe", stderr: "pipe" },
			);
			vsRoot = probe.exitCode === 0 ? probe.stdout.toString("utf8").trim() : "";
			if (!vsRoot) {
				throw new Error(
					`No Visual Studio installation provides ${toolsComponent}. Install Desktop development with C++ ` +
						`and a Windows SDK (${WINDOWS_SDK_COMPONENT}). ${probe.stderr.toString("utf8").trim()}`,
				);
			}
			devCmd = path.join(vsRoot, "Common7", "Tools", "VsDevCmd.bat");
		}

		// cmd's SET is UTF-16 with /u. Verbatim arguments keep cmd's quotes
		// intact; passing the path through an env var also handles spaces and &.
		const setup = spawnSync(
			process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
			[
				"/d",
				"/u",
				"/s",
				"/c",
				`"call "%ZETA_NATIVE_VSDEVCMD%" -no_logo -arch=${arch} -host_arch=${arch} >nul && set"`,
			],
			{
				env: { ...process.env, ZETA_NATIVE_VSDEVCMD: devCmd, VSCMD_SKIP_SENDTELEMETRY: "1" },
				encoding: "utf16le",
				windowsVerbatimArguments: true,
				windowsHide: true,
			},
		);
		if (setup.error || setup.status !== 0) {
			throw new Error(`Cannot initialize ${devCmd}: ${setup.error?.message ?? setup.stderr?.trim() ?? setup.status}`);
		}
		for (const line of (setup.stdout ?? "").split(/\r?\n/u)) {
			const separator = line.indexOf("=");
			// Ignore cmd's hidden per-drive variables (=C:=...) and our helper.
			if (separator <= 0 || line.slice(0, separator) === "ZETA_NATIVE_VSDEVCMD") continue;
			process.env[line.slice(0, separator)] = line.slice(separator + 1);
		}
		vsRoot = process.env.VSINSTALLDIR ?? vsRoot;
	}

	const hostArch = process.env.VSCMD_ARG_HOST_ARCH ?? arch;
	const compilerDir = path.join(process.env.VCToolsInstallDir ?? "", "bin", `Host${hostArch}`, arch);
	if (!["cl.exe", "link.exe"].every(file => fs.existsSync(path.join(compilerDir, file)))) {
		throw new Error(`MSVC compiler/linker missing from ${compilerDir}; install ${toolsComponent}.`);
	}
	const sdkVersion = process.env.WindowsSDKVersion?.replace(/[\\/]+$/u, "");
	const sdkRoot = process.env.WindowsSdkDir;
	if (
		!sdkRoot ||
		!sdkVersion ||
		![
			["Include", sdkVersion, "um", "Windows.h"],
			["Include", sdkVersion, "ucrt", "stdio.h"],
			["Lib", sdkVersion, "um", arch, "kernel32.lib"],
			["Lib", sdkVersion, "ucrt", arch, "ucrt.lib"],
		].every(parts => fs.existsSync(path.join(sdkRoot, ...parts)))
	) {
		throw new Error(`Windows SDK headers/import libraries are missing; install ${WINDOWS_SDK_COMPONENT}.`);
	}

	// Put the matching compiler/linker ahead of GNU link.exe even when the
	// caller's PATH was changed after entering a Developer Command Prompt.
	process.env.PATH = [compilerDir, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter);
	if (vsRoot && (!Bun.which("cmake", { PATH: process.env.PATH }) || !Bun.which("ninja", { PATH: process.env.PATH }))) {
		const cmakeExt = path.join(vsRoot, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake");
		const extraDirs = [path.join(cmakeExt, "CMake", "bin"), path.join(cmakeExt, "Ninja")].filter(dir =>
			fs.existsSync(dir),
		);
		process.env.PATH = [process.env.PATH ?? "", ...extraDirs].filter(Boolean).join(path.delimiter);
	}
	if (!Bun.which("cmake", { PATH: process.env.PATH }) || !Bun.which("ninja", { PATH: process.env.PATH })) {
		throw new Error(`Windows native builds need cmake and ninja on PATH; install ${CMAKE_COMPONENT}.`);
	}
}

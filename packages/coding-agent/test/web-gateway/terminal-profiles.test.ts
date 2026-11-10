/**
 * Shell profile discovery: Windows detection order, Git Bash vs the WSL
 * launcher in System32, UTF-16 `wsl.exe -l -q` parsing, POSIX `$SHELL`
 * ordering, custom profiles, and the no-fake-shell rule.
 *
 * The probe context is injected, so these tests never touch the host PATH,
 * never spawn a shell, and read no machine-specific path.
 */

import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import {
	CUSTOM_PROFILES_ENV,
	decodeWslOutput,
	discoverShellProfiles,
	parseCustomProfiles,
	parseWslDistros,
	type ShellProbeContext,
} from "../../src/server/web-gateway/terminal-profiles";

interface ProbeOptions {
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	files: string[];
	wsl?: string[] | string | Buffer;
	wslOk?: boolean;
}

function probe({ platform, env, files, wsl, wslOk = true }: ProbeOptions): ShellProbeContext {
	const impl = platform === "win32" ? path.win32 : path.posix;
	const existing = new Set(files.map(file => impl.normalize(file)));
	return {
		platform,
		env,
		exists: candidate => existing.has(impl.normalize(candidate)),
		now: () => 1_700_000_000_000,
		run: (command, args) => {
			if (!/(^|[\\/])wsl(\.exe)?$/i.test(command) || args.join(" ") !== "-l -q") {
				return { ok: false, stdout: Buffer.alloc(0) };
			}
			if (!wslOk) return { ok: false, stdout: Buffer.alloc(0) };
			const raw =
				typeof wsl === "string"
					? Buffer.from(wsl, "utf8")
					: Buffer.isBuffer(wsl)
						? wsl
						: Buffer.from((wsl ?? []).join("\r\n") + "\r\n", "utf8");
			return { ok: true, stdout: raw };
		},
	};
}

const WINDOWS_ENV: NodeJS.ProcessEnv = {
	PATH: [
		"C:\\Windows\\System32",
		"C:\\Program Files\\PowerShell\\7",
		"C:\\Users\\me\\AppData\\Local\\Programs\\nu\\bin",
	].join(";"),
	PATHEXT: ".COM;.EXE;.BAT;.CMD",
	SystemRoot: "C:\\Windows",
	ProgramFiles: "C:\\Program Files",
	LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
};

const WINDOWS_FILES = [
	"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
	"C:\\Windows\\System32\\cmd.exe",
	"C:\\Program Files\\PowerShell\\7\\pwsh.exe",
	"C:\\Program Files\\Git\\cmd\\git.exe",
	"C:\\Program Files\\Git\\bin\\bash.exe",
	"C:\\Users\\me\\AppData\\Local\\Programs\\nu\\bin\\nu.exe",
	"C:\\Windows\\System32\\wsl.exe",
	"C:\\Windows\\System32\\bash.exe",
];

describe("Windows profile discovery", () => {
	test("finds PowerShell, cmd, Git Bash, Nushell and WSL in stable order", () => {
		const catalog = discoverShellProfiles(
			probe({ platform: "win32", env: WINDOWS_ENV, files: WINDOWS_FILES, wsl: ["Ubuntu-22.04", "Debian"] }),
		);
		expect(catalog.profiles.map(profile => profile.id)).toEqual([
			"pwsh",
			"powershell",
			"cmd",
			"git-bash",
			"nu",
			"wsl:ubuntu-22-04",
			"wsl:debian",
		]);
		expect(catalog.defaultProfileId).toBe("pwsh");
		expect(catalog.platform).toBe("win32");

		const gitBash = catalog.profiles.find(profile => profile.id === "git-bash")!;
		expect(gitBash.command).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
		expect(gitBash.args).toEqual(["-l", "-i"]);
		// The System32 `bash.exe` is the WSL launcher, never Git Bash.
		expect(
			catalog.profiles.filter(profile => profile.command.toLowerCase().endsWith("system32\\bash.exe")),
		).toHaveLength(0);

		const wsl = catalog.profiles.find(profile => profile.id === "wsl:ubuntu-22-04")!;
		expect(wsl.args).toEqual(["-d", "Ubuntu-22.04"]);
		expect(wsl.kind).toBe("wsl");
		expect(wsl.detail).toBe("WSL");
	});

	test("omits absent shells instead of faking them", () => {
		const catalog = discoverShellProfiles(
			probe({
				platform: "win32",
				env: { ...WINDOWS_ENV, PATH: "C:\\Windows\\System32", ComSpec: "C:\\Windows\\System32\\cmd.exe" },
				files: ["C:\\Windows\\System32\\cmd.exe"],
			}),
		);
		expect(catalog.profiles.map(profile => profile.id)).toEqual(["cmd"]);
		expect(catalog.defaultProfileId).toBe("cmd");
	});

	test("WSL probing failures and empty lists add no distro profiles", () => {
		const failed = discoverShellProfiles(
			probe({ platform: "win32", env: WINDOWS_ENV, files: WINDOWS_FILES, wslOk: false }),
		);
		expect(failed.profiles.some(profile => profile.kind === "wsl")).toBe(false);
		const empty = discoverShellProfiles(
			probe({ platform: "win32", env: WINDOWS_ENV, files: WINDOWS_FILES, wsl: "" }),
		);
		expect(empty.profiles.some(profile => profile.kind === "wsl")).toBe(false);
	});
});

describe("WSL output parsing", () => {
	test("decodes UTF-16LE piped output and strips NULs/BOM", () => {
		const text = "\uFEFFUbuntu-22.04\r\nDebian\r\n";
		const raw = Buffer.from(text, "utf16le");
		expect(decodeWslOutput(raw)).toContain("Ubuntu-22.04");
		expect(parseWslDistros(raw)).toEqual(["Ubuntu-22.04", "Debian"]);
	});

	test("drops localized warning lines and duplicates", () => {
		const raw = [
			"Windows Subsystem for Linux has no installed distributions.",
			"适用于 Linux 的 Windows 子系统没有已安装的分发版。",
			"Ubuntu-22.04",
			"ubuntu-22.04",
			"",
			"wsl: A new WSL version is available",
			"Debian",
		].join("\r\n");
		expect(parseWslDistros(raw)).toEqual(["Ubuntu-22.04", "Debian"]);
	});

	test("stays deterministic when distro names slug down to the same id", () => {
		const catalog = discoverShellProfiles(
			probe({
				platform: "win32",
				env: WINDOWS_ENV,
				files: WINDOWS_FILES,
				wsl: ["Ubuntu 22.04", "Ubuntu-22.04", "Ubuntu_22.04"],
			}),
		);
		const ids = catalog.profiles.filter(profile => profile.kind === "wsl").map(profile => profile.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids[0]).toBe("wsl:ubuntu-22-04");
		expect(ids.slice(1).every(id => id.startsWith("wsl:ubuntu-22-04-"))).toBe(true);
	});
});

describe("POSIX profile discovery", () => {
	test("puts $SHELL first, then bash/zsh/fish/nu, without duplicates", () => {
		const files = ["/usr/bin/zsh", "/bin/bash", "/usr/bin/fish", "/usr/bin/nu"];
		const catalog = discoverShellProfiles(
			probe({
				platform: "linux",
				env: { PATH: "/usr/bin:/bin", SHELL: "/usr/bin/zsh", HOME: "/home/me" },
				files,
			}),
		);
		expect(catalog.profiles.map(profile => profile.id)).toEqual(["zsh", "bash", "fish", "nu"]);
		expect(catalog.profiles[0]!.detail).toBe("$SHELL");
		expect(catalog.defaultProfileId).toBe("zsh");
		expect(catalog.profiles.some(profile => profile.kind === "wsl")).toBe(false);
	});

	test("an unknown $SHELL still yields a usable shell entry", () => {
		const catalog = discoverShellProfiles(
			probe({ platform: "linux", env: { PATH: "/bin", SHELL: "/opt/custom/ksh" }, files: ["/opt/custom/ksh"] }),
		);
		expect(catalog.profiles[0]).toMatchObject({ id: "shell", kind: "sh", command: "/opt/custom/ksh" });
	});
});

describe("custom profiles", () => {
	const exists = (candidate: string): boolean => candidate === "/usr/bin/az" || candidate === "/usr/bin/tool";

	test("an explicitly configured remote-shell client is listed, nothing more", () => {
		const { profiles, warnings } = parseCustomProfiles(
			JSON.stringify([
				{
					id: "azure",
					label: "Azure Cloud Shell",
					command: "/usr/bin/az",
					args: ["cloud-shell", "ssh"],
					icon: "terminal",
				},
			]),
			exists,
		);
		expect(warnings).toEqual([]);
		expect(profiles).toEqual([
			{
				id: "custom:azure",
				label: "Azure Cloud Shell",
				kind: "custom",
				command: "/usr/bin/az",
				args: ["cloud-shell", "ssh"],
				source: "custom",
				icon: "terminal",
			},
		]);
	});

	test("invalid entries become warnings, never a different command", () => {
		const { profiles, warnings } = parseCustomProfiles(
			JSON.stringify([
				{ id: "Bad Id", label: "x", command: "/usr/bin/az" },
				{ id: "missing", label: "Missing", command: "/nope" },
				{ id: "novalue", label: "", command: "/usr/bin/tool" },
				{ id: "ok", label: "OK", command: "/usr/bin/tool", env: { K: "V" } },
				{ id: "ok", label: "Dup", command: "/usr/bin/tool" },
			]),
			exists,
		);
		expect(profiles.map(profile => profile.id)).toEqual(["custom:ok"]);
		expect(profiles[0]!.env).toEqual({ K: "V" });
		expect(warnings.length).toBe(4);
	});

	test("malformed JSON is a warning, not an empty silent catalog", () => {
		expect(parseCustomProfiles("{", exists).warnings[0]).toContain("not valid JSON");
		expect(parseCustomProfiles("{}", exists).warnings[0]).toContain("must be a JSON array");
	});

	test("custom profiles participate in the catalog after detected shells", () => {
		const catalog = discoverShellProfiles(
			probe({
				platform: "linux",
				env: {
					PATH: "/bin",
					SHELL: "/bin/bash",
					[CUSTOM_PROFILES_ENV]: JSON.stringify([{ id: "az", label: "Azure", command: "/usr/bin/az" }]),
				},
				files: ["/bin/bash", "/usr/bin/az"],
			}),
		);
		expect(catalog.profiles.map(profile => profile.id)).toEqual(["bash", "custom:az"]);
		expect(catalog.warnings).toEqual([]);
	});
});

/**
 * Installer platform contract — both installers may offer a prebuilt binary
 * only where a release publishes one, and must say so plainly everywhere else.
 *
 * Releases carry exactly the `release_binary` matrix's legs (linux-x64,
 * linux-musl-x64, windows-x64.exe), pinned by `scripts/check-release-asset-names.ts`
 * to the CLI outfiles and the updater's `releaseCliAssetName` names. Both
 * installers used to accept every host they knew how to name — macOS and ARM
 * included — and let the download 404, so a user there read "download failed"
 * instead of "not published for this platform".
 *
 * The behavioural runs stub `uname`/`sysctl`/`ldd` on PATH and execute the real
 * installers. They are POSIX-only: MSYS `sh` prepends its own `/usr/bin`, so a
 * PATH stub never wins on Windows (the PowerShell guard is exercised there
 * instead).
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const SHELL_INSTALLER = path.join("scripts", "install.sh");
const POWERSHELL_INSTALLER = path.join("scripts", "install.ps1");
const isWindows = process.platform === "win32";

const shellSource = fs.readFileSync(path.join(repoRoot, SHELL_INSTALLER), "utf8");
const psSource = fs.readFileSync(path.join(repoRoot, POWERSHELL_INSTALLER), "utf8");
const PACKAGE_NAME = /^PACKAGE="([^"]+)"/m.exec(shellSource)?.[1] ?? "";
const PS_PACKAGE_NAME = /^\$Package = "([^"]+)"/m.exec(psSource)?.[1] ?? "";

// What a release publishes: the `release_binary` job's `binary_path` entries,
// named the way the installers name a host (`linux-x64`, `windows-x64`, …).
const workflowLines = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8").split(/\r?\n/);
const releaseJobStart = workflowLines.indexOf("   release_binary:");
const releaseJobEnd = workflowLines.findIndex(
	(line, index) => index > releaseJobStart && releaseJobStart !== -1 && /^ {3}[a-z_][a-z0-9_-]*:\s*$/.test(line),
);
const shippedTokens = workflowLines
	.slice(releaseJobStart + 1, releaseJobEnd === -1 ? workflowLines.length : releaseJobEnd)
	.map(line => /binary_path:\s*([^\s,]+)/.exec(line)?.[1])
	.filter((binaryPath): binaryPath is string => binaryPath !== undefined)
	.map(binaryPath =>
		path
			.basename(binaryPath)
			.replace(/^zeta-cli-/, "")
			.replace(/\.exe$/, ""),
	)
	.sort();

/** Answers the release API with a test tag and writes a failing binary body. */
const CURL_STUB = `#!/bin/sh
for arg in "$@"; do
	case "$arg" in
		*api.github.com*) printf '{"tag_name":"v0.0.0-test"}\\n'; exit 0 ;;
	esac
done
previous=""
for arg in "$@"; do
	if [ "$previous" = "-o" ]; then printf 'exit 3\\n' > "$arg"; fi
	previous="$arg"
done
exit 0
`;

function stub(dir: string, name: string, body: string): void {
	fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
}

/** A PATH of host-reporting stubs plus the install dir the run writes into. */
function makeHarness(): Record<string, string | undefined> {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-installer-"));
	const bin = path.join(root, "bin");
	const install = path.join(root, "install");
	fs.mkdirSync(bin);
	fs.mkdirSync(install);
	stub(
		bin,
		"uname",
		`#!/bin/sh
case "$1" in
	-s) echo "$FAKE_UNAME_S" ;;
	-m) echo "$FAKE_UNAME_M" ;;
	*) echo "$FAKE_UNAME_S" ;;
esac
`,
	);
	stub(
		bin,
		"sysctl",
		`#!/bin/sh
echo "\${FAKE_SYSCTL_ARM64:-0}"
`,
	);
	stub(
		bin,
		"ldd",
		`#!/bin/sh
echo "\${FAKE_LDD:-glibc}"
`,
	);
	stub(bin, "curl", CURL_STUB);
	return {
		...process.env,
		PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
		PI_INSTALL_DIR: install,
	};
}

async function runShellInstaller(host: Record<string, string>): Promise<{ exitCode: number; output: string }> {
	const proc = Bun.spawn(["/bin/sh", SHELL_INSTALLER, "--binary"], {
		cwd: repoRoot,
		env: { ...makeHarness(), ...host },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { exitCode, output: stdout + stderr };
}

/** The `case "${PLATFORM}-${ARCH}"` alternatives install.sh lets through. */
function shellSupportedTokens(): string[] {
	const caseAt = shellSource.search(/case "\$\{PLATFORM\}-\$\{ARCH\}" in/);
	const body = shellSource.slice(caseAt, shellSource.indexOf("esac", caseAt));
	return body
		.split("\n")
		.map(line => /^([a-z0-9|*-]+)\)\s*;;$/.exec(line.trim())?.[1])
		.filter((alternatives): alternatives is string => alternatives !== undefined)
		.flatMap(alternatives => alternatives.split("|"))
		.filter(token => token !== "*")
		.sort();
}

describe("install.sh binary installs", () => {
	const unsupported = [
		{ host: "glibc Linux arm64", fake: { FAKE_UNAME_S: "Linux", FAKE_UNAME_M: "aarch64" }, token: "linux-arm64" },
		{
			host: "musl Linux arm64",
			fake: { FAKE_UNAME_S: "Linux", FAKE_UNAME_M: "aarch64", FAKE_LDD: "musl" },
			token: "linux-musl-arm64",
		},
		{ host: "macOS x64", fake: { FAKE_UNAME_S: "Darwin", FAKE_UNAME_M: "x86_64" }, token: "darwin-x64" },
		{
			host: "macOS arm64",
			fake: { FAKE_UNAME_S: "Darwin", FAKE_UNAME_M: "arm64", FAKE_SYSCTL_ARM64: "1" },
			token: "darwin-arm64",
		},
	];

	for (const { host, fake, token } of unsupported) {
		test.skipIf(isWindows)(`refuses ${host} with the published set and the package install`, async () => {
			const result = await runShellInstaller(fake);
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain(`No prebuilt binary for ${token}.`);
			expect(result.output).toContain(`npm install -g ${PACKAGE_NAME}`);
			expect(result.output).toContain("--source");
			expect(result.output).not.toContain("Downloading");
		});
	}

	test.skipIf(isWindows)("still downloads the published linux-x64 asset", async () => {
		const result = await runShellInstaller({ FAKE_UNAME_S: "Linux", FAKE_UNAME_M: "x86_64" });
		expect(result.output).toContain("Downloading zeta-cli-linux-x64...");
		expect(result.output).not.toContain("No prebuilt binary");
		// The stub's body exits 3, so the run ends in the smoke check, not here.
		expect(result.output).toContain("cannot start");
	});
});

describe("installer platform lists", () => {
	test("the release matrix parse found the published assets", () => {
		expect(shippedTokens.length).toBeGreaterThan(0);
		expect(shippedTokens).toContain("linux-x64");
	});

	test("install.sh accepts exactly the POSIX assets a release publishes", () => {
		const posix = shippedTokens.filter(token => token.startsWith("linux-") || token.startsWith("darwin-"));
		expect(shellSupportedTokens()).toEqual(posix);
		expect(PACKAGE_NAME).toBe("@linxiraos/zeta");
	});

	test("install.sh gates the binary path only, so --source keeps working anywhere", () => {
		const guardAt = shellSource.search(/No prebuilt binary for \$\{PLATFORM\}-\$\{ARCH\}/);
		expect(guardAt).toBeGreaterThan(shellSource.indexOf("install_binary() {"));
		expect(guardAt).toBeLessThan(shellSource.indexOf("# Main logic"));
	});

	test("install.ps1 refuses the Windows architectures with no published asset", () => {
		const architectures = shippedTokens
			.filter(token => token.startsWith("windows-"))
			.map(token => token.replace(/^windows-/, ""));
		// One Windows asset today; the guard negates it and nothing else.
		expect(architectures).toEqual(["x64"]);
		expect(psSource).toContain(`if ($NativeArchitecture -ne "${architectures[0]}") {`);
		expect(psSource).toContain("No prebuilt binary for windows-$NativeArchitecture");
		expect(PS_PACKAGE_NAME).toBe("@linxiraos/zeta");
	});

	test("install.ps1 gates the binary path only, so -Source keeps working anywhere", () => {
		const guardAt = psSource.indexOf('if ($NativeArchitecture -ne "x64") {');
		expect(guardAt).toBeGreaterThan(psSource.indexOf("function Install-Binary {"));
		expect(guardAt).toBeLessThan(psSource.indexOf("# Main logic"));
	});

	test.skipIf(!isWindows)(
		"install.ps1 on an ARM64 host refuses instead of downloading",
		async () => {
			const proc = Bun.spawn(
				[
					"powershell.exe",
					"-NoProfile",
					"-Command",
					// PROCESSOR_ARCHITEW6432 wins when set (32-bit host on 64-bit
					// Windows), so clear it to pose as a native ARM64 host.
					`Remove-Item Env:PROCESSOR_ARCHITEW6432 -ErrorAction SilentlyContinue; ` +
						`$env:PROCESSOR_ARCHITECTURE = 'ARM64'; & '${path.join(repoRoot, POWERSHELL_INSTALLER)}' -Binary`,
				],
				{ cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
			);
			const [exitCode, stdout, stderr] = await Promise.all([
				proc.exited,
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
			]);
			const output = stdout + stderr;
			expect(exitCode).not.toBe(0);
			expect(output).toContain("No prebuilt binary for windows-arm64.");
			expect(output).toContain(`npm install -g ${PS_PACKAGE_NAME}`);
			expect(output).toContain("-Source");
		},
		// Windows PowerShell cold start on a cold CI/dev box, not the assertion.
		30_000,
	);
});

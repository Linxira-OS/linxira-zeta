import * as fs from "node:fs";
import * as path from "node:path";
import * as utils from "@linxiraos/pi-utils";
import { CLI_BIN_NAME, VERSION } from "@linxiraos/pi-utils/dirs";
import { afterEach, describe, expect, it, vi } from "bun:test";
import {
	resolveCliEntryCmd,
	resolveExecutablePath,
	resolveRestartCmd,
	resolveWorkerSpawnCmd,
} from "../src/subprocess/worker-client";

describe("executable fallback on unlinked binary", () => {
	const originalExecPathDesc = Object.getOwnPropertyDescriptor(process, "execPath");
	const originalArgv0Desc = Object.getOwnPropertyDescriptor(process, "argv0");

	afterEach(() => {
		vi.restoreAllMocks();
		if (originalExecPathDesc) {
			Object.defineProperty(process, "execPath", originalExecPathDesc);
		}
		if (originalArgv0Desc) {
			Object.defineProperty(process, "argv0", originalArgv0Desc);
		}
	});

	function setProcessProp(prop: "execPath" | "argv0", value: string): void {
		Object.defineProperty(process, prop, {
			value,
			writable: true,
			enumerable: true,
			configurable: true,
		});
	}

	it("launches the healthy compiled binary without invoking fallback lookups", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		vi.spyOn(utils, "isExecutable").mockReturnValue(true);
		const whichSpy = vi.spyOn(utils, "$which");

		expect(resolveCliEntryCmd()).toEqual([process.execPath]);
		expect(resolveWorkerSpawnCmd("__zeta_worker_test")).toEqual({
			cmd: [process.execPath, "__zeta_worker_test"],
		});
		expect(whichSpy).not.toHaveBeenCalled();
	});

	it("prefers original absolute launcher path over generic PATH match when executable", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		// The launcher must be fully qualified on the host platform: on Windows a rooted path
		// without a drive letter is drive-relative and intentionally not trusted.
		const root = process.platform === "win32" ? "C:" : "";
		const missingPath = `${root}/opt/homebrew/Cellar/zeta/${VERSION}/bin/${CLI_BIN_NAME}`;
		const originalLauncher = `${root}/opt/homebrew/bin/${CLI_BIN_NAME}`;
		const otherCliInPath = `${root}/usr/local/bin/${CLI_BIN_NAME}`;

		setProcessProp("execPath", missingPath);
		setProcessProp("argv0", originalLauncher);

		vi.spyOn(utils, "$which").mockImplementation((cmd: string) => {
			if (cmd === CLI_BIN_NAME) return otherCliInPath;
			return null;
		});
		vi.spyOn(utils, "isExecutable").mockImplementation((p: string) => {
			return p === originalLauncher || p === otherCliInPath;
		});

		expect(resolveCliEntryCmd()).toEqual([originalLauncher]);
		expect(resolveWorkerSpawnCmd("__zeta_worker_test")).toEqual({
			cmd: [originalLauncher, "__zeta_worker_test"],
		});
	});

	it("falls back to PATH when original absolute launcher exists but is not executable", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const missingPath = `/opt/homebrew/Cellar/zeta/${VERSION}/bin/${CLI_BIN_NAME}`;
		const originalLauncher = `/opt/homebrew/bin/${CLI_BIN_NAME}`;
		const otherCliInPath = `/usr/local/bin/${CLI_BIN_NAME}`;

		setProcessProp("execPath", missingPath);
		setProcessProp("argv0", originalLauncher);

		vi.spyOn(utils, "$which").mockImplementation((cmd: string) => {
			if (cmd === CLI_BIN_NAME) return otherCliInPath;
			return null;
		});
		vi.spyOn(utils, "isExecutable").mockImplementation((p: string) => {
			// Launcher is not executable (e.g. root-owned, mode 0644, or directory)
			return p === otherCliInPath;
		});

		expect(resolveCliEntryCmd()).toEqual([otherCliInPath]);
		expect(resolveWorkerSpawnCmd("__zeta_worker_test")).toEqual({
			cmd: [otherCliInPath, "__zeta_worker_test"],
		});
	});

	it("does not resolve relative argv0 against the working tree", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const missingPath = `/opt/homebrew/Cellar/zeta/${VERSION}/bin/${CLI_BIN_NAME}`;
		setProcessProp("execPath", missingPath);
		setProcessProp("argv0", `./${CLI_BIN_NAME}`);

		const cwdRogueBinary = path.resolve(`./${CLI_BIN_NAME}`);
		vi.spyOn(utils, "$which").mockReturnValue(null);
		vi.spyOn(utils, "isExecutable").mockImplementation((p: string) => {
			return p === cwdRogueBinary;
		});

		// Relative argv0 must never resolve against cwd; falls back to missingPath gracefully
		expect(resolveExecutablePath()).toBe(missingPath);
	});

	it("does not treat Windows drive-relative paths as bare commands", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const missingPath = "C:\\Tools\\zetacode.exe";
		setProcessProp("execPath", missingPath);
		setProcessProp("argv0", `C:${CLI_BIN_NAME}`);

		let whichCalledWith: string | undefined;
		vi.spyOn(utils, "$which").mockImplementation((cmd: string) => {
			whichCalledWith = cmd;
			return null;
		});
		vi.spyOn(utils, "isExecutable").mockReturnValue(false);

		resolveExecutablePath();

		// The drive-relative argv0 is not a bare name, so only the generic CLI lookup runs.
		expect(whichCalledWith).toBe(CLI_BIN_NAME);
	});

	it("falls back to the CLI on PATH when original execPath was unlinked and argv0 has no path", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const missingPath = `/opt/homebrew/Cellar/zeta/${VERSION}/bin/${CLI_BIN_NAME}`;
		setProcessProp("execPath", missingPath);
		setProcessProp("argv0", CLI_BIN_NAME);

		const mockUpgradedPath = `/opt/homebrew/bin/${CLI_BIN_NAME}`;
		vi.spyOn(utils, "$which").mockImplementation((cmd: string) => {
			if (cmd === CLI_BIN_NAME) return mockUpgradedPath;
			return null;
		});
		vi.spyOn(utils, "isExecutable").mockImplementation((p: string) => {
			return p === mockUpgradedPath;
		});

		expect(resolveCliEntryCmd()).toEqual([mockUpgradedPath]);
		expect(resolveWorkerSpawnCmd("__zeta_worker_test")).toEqual({
			cmd: [mockUpgradedPath, "__zeta_worker_test"],
		});
	});

	it("falls back to process.argv0 when the generic CLI lookup is unavailable", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const missingPath = `/custom/install/bin/${CLI_BIN_NAME}`;
		setProcessProp("execPath", missingPath);
		setProcessProp("argv0", `my-${CLI_BIN_NAME}`);

		const mockCustomPath = `/usr/local/bin/my-${CLI_BIN_NAME}`;
		vi.spyOn(utils, "$which").mockImplementation((cmd: string) => {
			if (cmd === `my-${CLI_BIN_NAME}`) return mockCustomPath;
			return null;
		});
		vi.spyOn(utils, "isExecutable").mockImplementation((p: string) => {
			return p === mockCustomPath;
		});

		expect(resolveExecutablePath()).toBe(mockCustomPath);
	});

	it("does not perform fallback lookup when isCompiledBinary is false", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(false);
		const missingPath = `/opt/homebrew/Cellar/zeta/${VERSION}/bin/${CLI_BIN_NAME}`;
		setProcessProp("execPath", missingPath);

		const whichSpy = vi.spyOn(utils, "$which");
		vi.spyOn(utils, "isExecutable").mockReturnValue(false);

		const resolved = resolveExecutablePath();
		expect(whichSpy).not.toHaveBeenCalled();
		expect(resolved).toBe(missingPath);
	});

	it("returns original execPath gracefully if no fallback candidate exists", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const missingPath = `/nonexistent/${CLI_BIN_NAME}`;
		setProcessProp("execPath", missingPath);
		vi.spyOn(utils, "$which").mockReturnValue(null);
		vi.spyOn(utils, "isExecutable").mockReturnValue(false);

		expect(resolveExecutablePath()).toBe(missingPath);
	});

	it.skipIf(process.platform !== "linux")(
		"spawns a sameBuild worker from the running build, not the one renamed over the binary",
		() => {
			using dir = utils.TempDir.createSync("@omp-worker-running-build-");
			const omp = path.join(dir.path(), "omp");
			const upgrade = path.join(dir.path(), "zeta.new");
			// A private copy of this runtime stands in for the running compiled omp.
			fs.copyFileSync(process.execPath, omp);
			fs.writeFileSync(upgrade, "#!/bin/sh\necho installed build\n", { mode: 0o755 });
			const probe = `import { resolveWorkerSpawnCmd } from ${JSON.stringify(path.join(import.meta.dir, "../src/subprocess/worker-client"))};
const [intact] = resolveWorkerSpawnCmd("__zeta_worker_probe", { sameBuild: true }).cmd;
console.log("intact:" + (intact === process.execPath));
require("node:fs").renameSync(${JSON.stringify(upgrade)}, ${JSON.stringify(omp)});
const [exe] = resolveWorkerSpawnCmd("__zeta_worker_probe", { sameBuild: true }).cmd;
process.stdout.write(Bun.spawnSync([exe, "-e", "console.log('running build')"]).stdout);`;
			const result = Bun.spawnSync([omp, "-e", probe], { env: { ...Bun.env, PI_COMPILED: "1" } });
			expect(result.stdout.toString().trim().split("\n")).toEqual(["intact:true", "running build"]);
		},
		30_000,
	);

	it.skipIf(process.platform === "win32")(
		"restarts through the upgraded launcher when the old keg is still installed",
		() => {
			vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
			const oldKeg = "/opt/homebrew/Cellar/omp/18.1.8/bin/omp";
			const launcher = "/opt/homebrew/bin/omp";

			setProcessProp("execPath", oldKeg);
			setProcessProp("argv0", "omp");

			vi.spyOn(utils, "$which").mockImplementation((cmd: string) => (cmd === "omp" ? launcher : null));
			vi.spyOn(utils, "isExecutable").mockReturnValue(true);

			expect(resolveRestartCmd()).toEqual([launcher]);
			// The shared entry resolver and workers stay pinned to the running build.
			expect(resolveCliEntryCmd()).toEqual([oldKeg]);
			expect(resolveWorkerSpawnCmd("__omp_worker_test")).toEqual({
				cmd: [oldKeg, "__omp_worker_test"],
			});
		},
	);

	it("restarts a build started by path as itself, not as another omp on PATH", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const root = process.platform === "win32" ? "C:" : "";
		const devBuild = `${root}/work/omp/dist/omp`;

		setProcessProp("execPath", devBuild);
		setProcessProp("argv0", devBuild);

		vi.spyOn(utils, "$which").mockImplementation((cmd: string) =>
			cmd === "omp" ? `${root}/opt/homebrew/bin/omp` : null,
		);
		vi.spyOn(utils, "isExecutable").mockReturnValue(true);

		expect(resolveRestartCmd()).toEqual([devBuild]);
	});

	// cmd.exe runs `omp` from the current directory before PATH and passes argv0 as typed, so on
	// Windows a bare argv0 cannot say which copy is running.
	it.skipIf(process.platform !== "win32")("restarts a bare-named Windows launch as itself", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const local = "C:\\work\\omp\\dist\\omp.exe";

		setProcessProp("execPath", local);
		setProcessProp("argv0", "omp");

		vi.spyOn(utils, "$which").mockImplementation((cmd: string) =>
			cmd === "omp" ? "C:\\Users\\me\\.omp\\bin\\omp.exe" : null,
		);
		vi.spyOn(utils, "isExecutable").mockReturnValue(true);

		expect(resolveRestartCmd()).toEqual([local]);
	});
});

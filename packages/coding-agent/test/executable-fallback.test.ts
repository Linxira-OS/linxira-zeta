import * as path from "node:path";
import * as utils from "@linxiraos/pi-utils";
import { afterEach, describe, expect, it, vi } from "bun:test";
import { resolveCliEntryCmd, resolveExecutablePath, resolveWorkerSpawnCmd } from "../src/subprocess/worker-client";

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

	// POSIX-style fixtures are not fully qualified on win32 (isFullyQualifiedPath
	// requires a drive letter / UNC), so launcher tests qualify them per platform.
	const launcherFixture = (posix: string, win32: string): string =>
		process.platform === "win32" ? win32 : posix;

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
		const missingPath = launcherFixture("/opt/homebrew/Cellar/zeta/18.1.8/bin/zeta", "C:\\opt\\homebrew\\Cellar\\zeta\\18.1.8\\bin\\zeta.exe");
		const originalLauncher = launcherFixture("/opt/homebrew/bin/zeta", "C:\\opt\\homebrew\\bin\\zeta.exe");
		const otherZetaInPath = launcherFixture("/usr/local/bin/zeta", "C:\\usr\\local\\bin\\zeta.exe");

		setProcessProp("execPath", missingPath);
		setProcessProp("argv0", originalLauncher);

		vi.spyOn(utils, "$which").mockImplementation((cmd: string) => {
			if (cmd === "zeta") return otherZetaInPath;
			return null;
		});
		vi.spyOn(utils, "isExecutable").mockImplementation((p: string) => {
			return p === originalLauncher || p === otherZetaInPath;
		});

		expect(resolveCliEntryCmd()).toEqual([originalLauncher]);
		expect(resolveWorkerSpawnCmd("__zeta_worker_test")).toEqual({
			cmd: [originalLauncher, "__zeta_worker_test"],
		});
	});

	it("falls back to PATH when original absolute launcher exists but is not executable", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const missingPath = launcherFixture("/opt/homebrew/Cellar/zeta/18.1.8/bin/zeta", "C:\\opt\\homebrew\\Cellar\\zeta\\18.1.8\\bin\\zeta.exe");
		const originalLauncher = launcherFixture("/opt/homebrew/bin/zeta", "C:\\opt\\homebrew\\bin\\zeta.exe");
		const otherZetaInPath = launcherFixture("/usr/local/bin/zeta", "C:\\usr\\local\\bin\\zeta.exe");

		setProcessProp("execPath", missingPath);
		setProcessProp("argv0", originalLauncher);

		vi.spyOn(utils, "$which").mockImplementation((cmd: string) => {
			if (cmd === "zeta") return otherZetaInPath;
			return null;
		});
		vi.spyOn(utils, "isExecutable").mockImplementation((p: string) => {
			// Launcher is not executable (e.g. root-owned, mode 0644, or directory)
			return p === otherZetaInPath;
		});

		expect(resolveCliEntryCmd()).toEqual([otherZetaInPath]);
		expect(resolveWorkerSpawnCmd("__zeta_worker_test")).toEqual({
			cmd: [otherZetaInPath, "__zeta_worker_test"],
		});
	});

	it("does not resolve relative argv0 against the working tree", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const missingPath = "/opt/homebrew/Cellar/zeta/18.1.8/bin/zeta";
		setProcessProp("execPath", missingPath);
		setProcessProp("argv0", "./zeta");

		const cwdRogueBinary = path.resolve("./zeta");
		vi.spyOn(utils, "$which").mockReturnValue(null);
		vi.spyOn(utils, "isExecutable").mockImplementation((p: string) => {
			return p === cwdRogueBinary;
		});

		// Relative argv0 must never resolve against cwd; falls back to missingPath gracefully
		expect(resolveExecutablePath()).toBe(missingPath);
	});

	it("does not treat Windows drive-relative paths (e.g. C:zeta) as bare commands", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const missingPath = "C:\\Tools\\zeta.exe";
		setProcessProp("execPath", missingPath);
		setProcessProp("argv0", "C:zeta");

		let whichCalledWith: string | undefined;
		vi.spyOn(utils, "$which").mockImplementation((cmd: string) => {
			whichCalledWith = cmd;
			return null;
		});
		vi.spyOn(utils, "isExecutable").mockReturnValue(false);

		resolveExecutablePath();

		// Should not pass "C:zeta" to which as a bare name; only "zeta" generic fallback is queried
		expect(whichCalledWith).toBe("zeta");
	});

	it("falls back to $which('zeta') when original execPath was unlinked and argv0 has no path", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const missingPath = "/opt/homebrew/Cellar/zeta/18.1.8/bin/zeta";
		setProcessProp("execPath", missingPath);
		setProcessProp("argv0", "zeta");

		const mockUpgradedPath = "/opt/homebrew/bin/zeta";
		vi.spyOn(utils, "$which").mockImplementation((cmd: string) => {
			if (cmd === "zeta") return mockUpgradedPath;
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

	it("falls back to process.argv0 when $which('zeta') is unavailable", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const missingPath = "/custom/install/bin/zeta";
		setProcessProp("execPath", missingPath);
		setProcessProp("argv0", "my-zeta");

		const mockCustomPath = "/usr/local/bin/my-zeta";
		vi.spyOn(utils, "$which").mockImplementation((cmd: string) => {
			if (cmd === "my-zeta") return mockCustomPath;
			return null;
		});
		vi.spyOn(utils, "isExecutable").mockImplementation((p: string) => {
			return p === mockCustomPath;
		});

		expect(resolveExecutablePath()).toBe(mockCustomPath);
	});

	it("does not perform fallback lookup when isCompiledBinary is false", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(false);
		const missingPath = "/opt/homebrew/Cellar/zeta/18.1.8/bin/zeta";
		setProcessProp("execPath", missingPath);

		const whichSpy = vi.spyOn(utils, "$which");
		vi.spyOn(utils, "isExecutable").mockReturnValue(false);

		const resolved = resolveExecutablePath();
		expect(whichSpy).not.toHaveBeenCalled();
		expect(resolved).toBe(missingPath);
	});

	it("returns original execPath gracefully if no fallback candidate exists", () => {
		vi.spyOn(utils, "isCompiledBinary").mockReturnValue(true);
		const missingPath = "/nonexistent/zeta";
		setProcessProp("execPath", missingPath);
		vi.spyOn(utils, "$which").mockReturnValue(null);
		vi.spyOn(utils, "isExecutable").mockReturnValue(false);

		expect(resolveExecutablePath()).toBe(missingPath);
	});
});

import * as path from "node:path";
import * as utils from "@linxiraos/pi-utils";
import { CLI_BIN_NAME, VERSION } from "@linxiraos/pi-utils/dirs";
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
});

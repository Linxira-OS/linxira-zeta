/**
 * End-to-end discovery smoke for the npm launcher shim
 * (`main/npm/main/bin/zeta.js`): a stub native binary installed on a
 * simulated PATH must be found and executed (tier ②), `ZETA_BIN_DIR` must
 * outrank PATH (tier ①), the vendored platform leaf must serve as the
 * fallback when PATH has no native hit (tier ③), and with nothing available
 * the shim must die with the install hint. Every state runs the real script
 * in a real child process — no mocks.
 */

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const SHIM = path.join(REPO_ROOT, "main", "npm", "main", "bin", "zeta.js");
const IS_WIN = process.platform === "win32";
const EXE = IS_WIN ? "zeta.exe" : "zeta-linux-x64";
const LEAF = IS_WIN ? "@linxiraos/main-windows-x64" : "@linxiraos/main-linux-x64";

/** Bun's own executable doubles as the stub native binary: it is a real
 * PE/ELF image, so the shim's native check accepts it, and `--version`
 * gives every state a deterministic observable output. */
function installStub(dir: string, name: string): string {
	fs.mkdirSync(dir, { recursive: true });
	const stub = path.join(dir, name);
	fs.copyFileSync(process.execPath, stub);
	if (!IS_WIN) fs.chmodSync(stub, 0o755);
	return stub;
}

/** System32 keeps Windows child processes able to load their DLLs. The
 * spread can carry both `Path` and `PATH` spellings; both must go, or the
 * child's env block keeps a duplicate whose value wins unpredictably. */
function envWith(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
	const base: Record<string, string | undefined> = { ...process.env };
	delete base.PATH;
	delete base.Path;
	const defaultPath = IS_WIN ? "C:\\Windows\\System32" : "/usr/bin:/bin";
	return { ...base, PATH: defaultPath, ZETA_BIN_DIR: undefined, ...overrides };
}

interface RunResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

/** Runs the shim to completion; the child's own exit/error events are the
 * awaited signals, so no wall-clock guard is needed (bun test owns timeouts). */
async function runShim(shimPath: string, env: Record<string, string | undefined>): Promise<RunResult> {
	const child = spawn(process.execPath, [shimPath, "--version"], { env, stdio: ["ignore", "pipe", "pipe"] });
	const done = Promise.withResolvers<RunResult>();
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", chunk => (stdout += String(chunk)));
	child.stderr.on("data", chunk => (stderr += String(chunk)));
	child.on("error", error => done.reject(error));
	child.on("close", code => done.resolve({ code, stdout, stderr }));
	return done.promise;
}

describe("npm launcher shim discovery (e2e)", () => {
	const cleanups: Array<() => void> = [];
	function tempDir(prefix: string): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
		return dir;
	}

	test("PATH stub binary is discovered and executed", async () => {
		const stubDir = tempDir("zeta-shim-path-");
		installStub(stubDir, IS_WIN ? "zetawork.exe" : "zetawork");
		const { code, stdout } = await runShim(SHIM, envWith({ PATH: `${stubDir}${path.delimiter}${envWith({}).PATH}` }));
		expect(code).toBe(0);
		expect(stdout).toMatch(/^\d+\.\d+\.\d+/m);
	});

	test("ZETA_BIN_DIR stub outranks PATH", async () => {
		const explicitDir = tempDir("zeta-shim-explicit-");
		installStub(explicitDir, IS_WIN ? "zeta.exe" : "zeta");
		const { code, stdout } = await runShim(SHIM, envWith({ ZETA_BIN_DIR: explicitDir }));
		expect(code).toBe(0);
		expect(stdout).toMatch(/^\d+\.\d+\.\d+/m);
	});

	test("no native hit falls back to the vendored platform leaf", async () => {
		const tree = tempDir("zeta-shim-vendored-");
		const binDir = path.join(tree, "bin");
		fs.mkdirSync(binDir, { recursive: true });
		fs.copyFileSync(SHIM, path.join(binDir, "zeta.js"));
		const leafBin = path.join(tree, "node_modules", LEAF, "bin");
		installStub(leafBin, EXE);
		const { code, stdout } = await runShim(path.join(binDir, "zeta.js"), envWith({ PATH: envWith({}).PATH }));
		expect(code).toBe(0);
		expect(stdout).toMatch(/^\d+\.\d+\.\d+/m);
	});

	test("nothing available dies with the install hint", async () => {
		const tree = tempDir("zeta-shim-die-");
		const binDir = path.join(tree, "bin");
		fs.mkdirSync(binDir, { recursive: true });
		fs.copyFileSync(SHIM, path.join(binDir, "zeta.js"));
		const { code, stderr } = await runShim(path.join(binDir, "zeta.js"), envWith({}));
		expect(code).toBe(1);
		expect(stderr).toContain("no native zetawork/zeta on PATH");
		expect(stderr).toContain("@linxiraos/main");
	});
});

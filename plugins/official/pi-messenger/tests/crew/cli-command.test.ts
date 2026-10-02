import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLI_BIN_NAME } from "@linxiraos/pi-utils/dirs";
import { getCliSpawnCommand, resetCliCommandCache } from "../../crew/agents.ts";

const roots = new Set<string>();

function createTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-cli-test-"));
	roots.add(dir);
	return dir;
}

/** Write an executable-looking CLI candidate into a temp PATH directory. */
function writeCliCandidate(dir: string, name: string): string {
	const file = path.join(dir, process.platform === "win32" ? `${name}.exe` : name);
	fs.writeFileSync(file, "");
	fs.chmodSync(file, 0o755);
	return file;
}

describe("crew CLI spawn command resolution", () => {
	const originalEnv = { ...process.env };
	let execPath: string;
	let argv: string[];

	beforeEach(() => {
		resetCliCommandCache();
		execPath = process.execPath;
		argv = process.argv;
	});

	afterEach(() => {
		process.execPath = execPath;
		process.argv = argv;
		process.env.PI_SUBPROCESS_CMD = originalEnv.PI_SUBPROCESS_CMD;
		process.env.PATH = originalEnv.PATH;
		resetCliCommandCache();
		for (const root of roots) {
			try {
				fs.rmSync(root, { recursive: true, force: true });
			} catch {}
		}
		roots.clear();
	});

	it("prefers the PI_SUBPROCESS_CMD override", () => {
		process.env.PI_SUBPROCESS_CMD = "/custom/zeta-build";
		const resolved = getCliSpawnCommand();
		expect(resolved).toEqual({ cmd: "/custom/zeta-build", args: [] });
	});

	it("spawns the runtime with the CLI entry in source mode", () => {
		process.env.PI_SUBPROCESS_CMD = "";
		// Vitest itself is a JS runtime running a .ts entry — mirror that shape
		// explicitly so the test does not depend on the runner's own argv.
		process.execPath = path.join("runtimes", "bun");
		process.argv = ["bun", path.resolve("/proj/packages/coding-agent/src/cli.ts")];

		const resolved = getCliSpawnCommand();
		expect(resolved.cmd).toBe(process.execPath);
		expect(resolved.args).toEqual([process.argv[1]]);
	});

	it("treats a non-JS-runtime execPath as the compiled CLI binary", () => {
		process.env.PI_SUBPROCESS_CMD = "";
		process.execPath = path.join("install", "zeta-c.exe");
		process.argv = ["zeta-c.exe", "--mode", "json"];

		const resolved = getCliSpawnCommand();
		expect(resolved).toEqual({ cmd: process.execPath, args: [] });
	});

	it("resolves the primary CLI name from PATH when only a runtime is running", () => {
		process.env.PI_SUBPROCESS_CMD = "";
		// JS runtime without a script entry: no source-mode launch, fall back
		// to a PATH lookup.
		process.execPath = path.join("runtimes", "bun");
		process.argv = ["bun", "some-interactive-session"];

		const binDir = createTempDir();
		const candidate = writeCliCandidate(binDir, CLI_BIN_NAME);
		writeCliCandidate(binDir, "zetacode");
		process.env.PATH = binDir;

		const resolved = getCliSpawnCommand();
		expect(resolved.cmd).toBe(candidate);
		expect(resolved.args).toEqual([]);
	});

	it("falls back to the primary CLI name when nothing resolves on PATH", () => {
		process.env.PI_SUBPROCESS_CMD = "";
		process.execPath = path.join("runtimes", "bun");
		process.argv = ["bun", "some-interactive-session"];
		process.env.PATH = createTempDir();

		const resolved = getCliSpawnCommand();
		expect(resolved).toEqual({ cmd: CLI_BIN_NAME, args: [] });
	});

	it("never resolves the upstream pi binary or the bare workspace name", () => {
		process.env.PI_SUBPROCESS_CMD = "";
		process.execPath = path.join("runtimes", "bun");
		process.argv = ["bun", "some-interactive-session"];

		// Only the upstream shim names exist on PATH — none may be selected.
		const binDir = createTempDir();
		writeCliCandidate(binDir, "pi");
		writeCliCandidate(binDir, "zeta");
		process.env.PATH = binDir;

		const resolved = getCliSpawnCommand();
		const base = path.basename(resolved.cmd).replace(/\.exe$/i, "");
		expect(base).not.toBe("pi");
		expect(base).not.toBe("zeta");
	});
});

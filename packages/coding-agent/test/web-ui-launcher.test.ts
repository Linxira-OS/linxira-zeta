import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	buildWebUiLaunchArgs,
	parseNpmViewVersion,
	resolveWebUiLaunchTarget,
	resolveWebUiRuntime,
	WEB_UI_BIN,
	WEB_UI_INSTALL_HINT,
	WEB_UI_NPX_HINT,
	WEB_UI_NPX_SPECIFIER,
	WEB_UI_PACKAGE,
	type WebUiLaunchTarget,
} from "@linxiraos/zeta/commands/web-ui-launcher";

describe("Web UI runtime resolution", () => {
	it("uses the bundled runtime when the desktop shell provides one", () => {
		expect(resolveWebUiRuntime({ ZETA_WEB_RUNTIME: "C:\\Zeta\\resources\\zeta\\node.exe" })).toBe(
			"C:\\Zeta\\resources\\zeta\\node.exe",
		);
	});

	it("falls back to node for CLI and source installs", () => {
		expect(resolveWebUiRuntime({})).toBe("node");
	});
});

/**
 * The v1.2.1 failure: the npm fallback fed the *bin* name (`zeta-web`) to `npx`,
 * which resolves a *package* — the published package is scoped, so every launch
 * died with `npm error 404 Not Found - GET .../zeta-web` and served a Web UI
 * that never came up. These assertions pin the name roles apart.
 */
describe("Web UI npm fallback names the scoped package", () => {
	it("declares the scoped package as the install target, never the bin name", () => {
		expect(WEB_UI_PACKAGE).toBe("@linxiraos/zeta-web");
		expect(WEB_UI_INSTALL_HINT).toBe("npm install -g @linxiraos/zeta-web");
		expect(WEB_UI_INSTALL_HINT).not.toContain("install -g zeta-web");
	});

	it("builds the npx specifier from the package, pinned to @latest", () => {
		expect(WEB_UI_NPX_SPECIFIER).toBe("@linxiraos/zeta-web@latest");
		// web-ui rides its own version line (1.1.5 while the CLI is 1.2.1), so a
		// CLI-version pin would 404; @latest is the only resolvable specifier.
		expect(WEB_UI_NPX_SPECIFIER).not.toBe(WEB_UI_BIN);
		expect(WEB_UI_NPX_HINT).toBe("npx @linxiraos/zeta-web@latest");
		expect(WEB_UI_BIN).toBe("zeta-web");
	});

	it("keeps a resolved bin path and an npx specifier in separate argv slots", () => {
		const bin: WebUiLaunchTarget = { kind: "bin", file: "/opt/zeta/bin/zeta-web" };
		const binArgs = buildWebUiLaunchArgs(bin, 30141);
		expect(binArgs).toEqual(["/opt/zeta/bin/zeta-web", "--port", "30141", "--hostname", "127.0.0.1"]);

		const npx: WebUiLaunchTarget = { kind: "npx", specifier: WEB_UI_NPX_SPECIFIER };
		const npxArgs = buildWebUiLaunchArgs(npx, 30141);
		expect(npxArgs).toEqual([
			"npx",
			"--yes",
			"@linxiraos/zeta-web@latest",
			"--port",
			"30141",
			"--hostname",
			"127.0.0.1",
		]);
		// The bin name must never appear as the package npx is asked for.
		expect(npxArgs).not.toContain(WEB_UI_BIN);
	});
});

describe("Web UI fallback target resolution", () => {
	const withPath = async (dirs: string[], run: () => Promise<void>): Promise<void> => {
		const saved = process.env.PATH;
		process.env.PATH = dirs.join(path.delimiter);
		try {
			await run();
		} finally {
			process.env.PATH = saved;
		}
	};

	const makeShim = (dir: string, name: string): string => {
		const file = path.join(dir, process.platform === "win32" ? `${name}.cmd` : name);
		fs.writeFileSync(file, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n");
		if (process.platform !== "win32") fs.chmodSync(file, 0o755);
		return file;
	};

	it("is null when neither the bin nor npx is installed", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-web-none-"));
		try {
			await withPath([dir], async () => {
				expect(await resolveWebUiLaunchTarget()).toBeNull();
			});
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === "win32")("resolves the zeta-web bin when it is on PATH", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-web-bin-"));
		try {
			const shim = makeShim(dir, WEB_UI_BIN);
			await withPath([dir], async () => {
				expect(await resolveWebUiLaunchTarget()).toEqual({ kind: "bin", file: shim });
			});
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === "win32")("falls back to the scoped npx specifier when only npx exists", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-web-npx-"));
		try {
			makeShim(dir, "npx");
			await withPath([dir], async () => {
				expect(await resolveWebUiLaunchTarget()).toEqual({ kind: "npx", specifier: WEB_UI_NPX_SPECIFIER });
			});
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("npm view version parsing", () => {
	it("accepts a bare or v-prefixed version and rejects anything else", () => {
		expect(parseNpmViewVersion("1.1.5\n")).toBe("1.1.5");
		expect(parseNpmViewVersion("v1.1.5")).toBe("1.1.5");
		expect(parseNpmViewVersion("")).toBeNull();
		expect(parseNpmViewVersion("npm error 404 Not Found")).toBeNull();
	});
});

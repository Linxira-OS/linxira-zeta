import { afterEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { dispatchDesktopEntry } from "@linxiraos/zeta/cli/desktop-entry";

const ORIGINAL_ENV = process.env.ZETA_DESKTOP_ENTRY;

afterEach(() => {
	if (ORIGINAL_ENV === undefined) delete process.env.ZETA_DESKTOP_ENTRY;
	else process.env.ZETA_DESKTOP_ENTRY = ORIGINAL_ENV;
	process.exitCode = 0;
});

describe("zeta-d desktop entry dispatch", () => {
	it("ignores normal CLI argv regardless of entry mode", async () => {
		delete process.env.ZETA_DESKTOP_ENTRY;
		expect(await dispatchDesktopEntry(["--continue"])).toBe(false);
		expect(await dispatchDesktopEntry(["--help"])).toBe(false);

		process.env.ZETA_DESKTOP_ENTRY = "1";
		// Entry mode without -d/--desktop falls through to the bundled TUI.
		expect(await dispatchDesktopEntry(["--continue"])).toBe(false);
	});

	it("spawns the resolved GUI detached with a --cwd flag for -d", async () => {
		process.env.ZETA_DESKTOP_ENTRY = "1";
		const spawned: Array<[string, string]> = [];
		const handled = await dispatchDesktopEntry(["-d"], {
			resolve: () => "C:/fake/Zeta.exe",
			spawn: (gui, cwdFlag) => spawned.push([gui, cwdFlag]),
		});
		expect(handled).toBe(true);
		expect(spawned).toEqual([["C:/fake/Zeta.exe", `--cwd=${process.cwd()}`]]);
		expect(process.exitCode).toBe(0);
	});

	it("reports the probe list and exits 1 when no GUI install exists", async () => {
		process.env.ZETA_DESKTOP_ENTRY = "1";
		const spawned: Array<[string, string]> = [];
		const handled = await dispatchDesktopEntry(["--desktop"], {
			resolve: () => undefined,
			spawn: (gui, cwdFlag) => spawned.push([gui, cwdFlag]),
		});
		expect(handled).toBe(true);
		expect(spawned).toEqual([]);
		expect(process.exitCode).toBe(1);
	});

	it("honors an explicit cwd after --desktop", async () => {
		delete process.env.ZETA_DESKTOP_ENTRY;
		const spawned: Array<[string, string]> = [];
		await dispatchDesktopEntry(["--desktop", "/tmp/some-dir"], {
			resolve: () => "C:/fake/Zeta.exe",
			spawn: (gui, cwdFlag) => spawned.push([gui, cwdFlag]),
		});
		expect(spawned[0]?.[1]).toBe(`--cwd=${path.resolve("/tmp/some-dir")}`);
	});
});

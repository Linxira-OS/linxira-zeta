/**
 * Unit contract for the shared discovery helper: tier order (①
 * ZETA_BIN_DIR ② PATH ③ npm-form dirs), alias-major within a tier, and the
 * per-platform dir derivation. The gateway/CLI faces exercise the same
 * function end to end in web-gateway/open.test.ts and update-cli.test.ts.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	ZETA_BIN_DIR_ENV,
	discoverBin,
	explicitBinDirs,
	npmFormBinDirs,
	whichCommand,
} from "../../src/utils/bin-discovery";

const IS_WIN = process.platform === "win32";
const EXT = IS_WIN ? ".cmd" : "";

function tree(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "zeta-bin-disc-"));
}

describe("bin-discovery", () => {
	test("explicitBinDirs splits the delimiter list and drops empties", () => {
		const sep = IS_WIN ? ";" : ":";
		expect(explicitBinDirs({ [ZETA_BIN_DIR_ENV]: ` a${sep}${sep}b ` }, IS_WIN ? "win32" : "linux")).toEqual([
			"a",
			"b",
		]);
		expect(explicitBinDirs({}, "linux")).toEqual([]);
		expect(explicitBinDirs({ [ZETA_BIN_DIR_ENV]: "  " }, "linux")).toEqual([]);
	});

	test("npmFormBinDirs mirrors the Rust augmented set", () => {
		expect(npmFormBinDirs({ APPDATA: "A", LOCALAPPDATA: "L", USERPROFILE: "U" }, "win32")).toEqual([
			path.win32.join("A", "npm"),
			path.win32.join("L", "pnpm"),
			path.win32.join("U", ".bun", "bin"),
		]);
		expect(npmFormBinDirs({ HOME: "H" }, "linux")).toEqual([path.posix.join("H", ".bun", "bin")]);
		expect(npmFormBinDirs({}, "linux")).toEqual([]);
	});

	test("tier order: explicit beats PATH beats npm-form; alias-major within a tier", () => {
		const root = tree();
		try {
			const mk = (dir: string, file: string) => {
				const full = path.join(root, dir);
				fs.mkdirSync(full, { recursive: true });
				fs.writeFileSync(path.join(full, file), "");
				return path.join(full, file);
			};
			// Fixtures use the real published bins — each product ships exactly one
			// name (`zetacode`/`zetawork`/`zetaide`); provenance order is what the
			// candidate list models, not legacy hyphenated aliases.
			const explicitHit = mk("explicit", `zetacode${EXT}`);
			const pathHit = mk("path", `zetacode${EXT}`);
			const aliasHit = mk("path", `zetawork${EXT}`);

			const env = {
				PATH: path.join(root, "path"),
				[ZETA_BIN_DIR_ENV]: path.join(root, "explicit"),
				APPDATA: root,
				HOME: root,
			};
			expect(discoverBin(["zetacode", "zetawork"], { env, exists: c => fs.existsSync(c) })).toBe(explicitHit);

			// Tier ① empty → PATH; first alias in the same tier wins.
			expect(
				discoverBin(["zetacode", "zetawork"], {
					env: { ...env, [ZETA_BIN_DIR_ENV]: "" },
					exists: c => fs.existsSync(c),
				}),
			).toBe(pathHit);
			expect(
				discoverBin(["zetawork", "zetacode"], {
					env: { ...env, [ZETA_BIN_DIR_ENV]: "" },
					exists: c => fs.existsSync(c),
				}),
			).toBe(aliasHit);

			// Tier ② empty → npm-form dirs. The stub must live in the
			// platform-derived dir (win: %APPDATA%\npm, posix: ~/.bun/bin).
			const npmDir = path.join(root, IS_WIN ? "npm" : path.join(".bun", "bin"));
			const npmHit = path.join(npmDir, `zetacode${EXT}`);
			fs.mkdirSync(npmDir, { recursive: true });
			fs.writeFileSync(npmHit, "");
			expect(discoverBin(["zetacode"], { env: { APPDATA: root, HOME: root }, exists: c => fs.existsSync(c) })).toBe(
				npmHit,
			);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test("no tier has the binary → null", () => {
		expect(discoverBin(["zetacode"], { env: { PATH: "" }, exists: () => false })).toBeNull();
	});

	test("windows: the executable extension wins over a same-directory bare POSIX shim", () => {
		// npm/pnpm install BOTH `zetacode` (a POSIX sh script) and
		// `zetacode.cmd` (the launcher) into one bin dir. Windows cannot run the
		// script, so probing the bare name first made `zetacode update` spawn a
		// file that never reports a version and refuse to replace itself
		// (v1.1.27). Synthetic candidates so the fixture is host-independent.
		const binDir = "C:\\Program Files\\nodejs";
		const present = [path.win32.join(binDir, "zetacode"), path.win32.join(binDir, "zetacode.cmd")];
		expect(
			whichCommand("zetacode", {
				platform: "win32",
				env: { PATH: binDir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
				exists: candidate => present.includes(candidate),
				now: () => Date.now(),
			}),
		).toBe(path.win32.join(binDir, "zetacode.cmd"));
	});

	test("posix: the bare name is the only candidate", () => {
		const binDir = "/usr/local/bin";
		const present = [`${binDir}/zetacode`, `${binDir}/zetacode.cmd`];
		expect(
			whichCommand("zetacode", {
				platform: "linux",
				env: { PATH: binDir },
				exists: candidate => present.includes(candidate),
				now: () => Date.now(),
			}),
		).toBe(`${binDir}/zetacode`);
	});
});

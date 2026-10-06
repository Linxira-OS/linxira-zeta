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
import { ZETA_BIN_DIR_ENV, discoverBin, explicitBinDirs, npmFormBinDirs } from "../../src/utils/bin-discovery";

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
			const explicitHit = mk("explicit", `zeta-ide${EXT}`);
			const pathHit = mk("path", `zeta-ide${EXT}`);
			const aliasHit = mk("path", `zetaide${EXT}`);

			const env = {
				PATH: path.join(root, "path"),
				[ZETA_BIN_DIR_ENV]: path.join(root, "explicit"),
				APPDATA: root,
				HOME: root,
			};
			expect(discoverBin(["zeta-ide", "zetaide"], { env, exists: c => fs.existsSync(c) })).toBe(explicitHit);

			// Tier ① empty → PATH; first alias in the same tier wins.
			expect(
				discoverBin(["zeta-ide", "zetaide"], {
					env: { ...env, [ZETA_BIN_DIR_ENV]: "" },
					exists: c => fs.existsSync(c),
				}),
			).toBe(pathHit);
			expect(
				discoverBin(["zetaide", "zeta-ide"], {
					env: { ...env, [ZETA_BIN_DIR_ENV]: "" },
					exists: c => fs.existsSync(c),
				}),
			).toBe(aliasHit);

			// Tier ② empty → npm-form dirs. The stub must live in the
			// platform-derived dir (win: %APPDATA%\npm, posix: ~/.bun/bin).
			const npmDir = path.join(root, IS_WIN ? "npm" : path.join(".bun", "bin"));
			const npmHit = path.join(npmDir, `zeta-ide${EXT}`);
			fs.mkdirSync(npmDir, { recursive: true });
			fs.writeFileSync(npmHit, "");
			expect(discoverBin(["zeta-ide"], { env: { APPDATA: root, HOME: root }, exists: c => fs.existsSync(c) })).toBe(
				npmHit,
			);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test("no tier has the binary → null", () => {
		expect(discoverBin(["zeta-ide"], { env: { PATH: "" }, exists: () => false })).toBeNull();
	});
});

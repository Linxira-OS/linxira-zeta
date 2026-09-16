import { describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { decodeProjectFolderCwd, isTempProjectFolder } from "@linxiraos/pi-stats/parser";

/** Mirror of the coding agent's temp-scope folder encoding: `-tmp<relative>`. */
function tmpScopeSlug(relative: string): string {
	return relative ? `-tmp-${relative.replace(/[/\\:]/g, "-")}` : "-tmp";
}

/** Mirror of the legacy absolute folder encoding: `--<absolute>--`. */
function legacyAbsSlug(cwd: string): string {
	return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/** Mirror of the home-scope folder encoding: `-<home-relative>`. */
function homeScopeSlug(relative: string): string {
	return `-${relative.replace(/[/\\:]/g, "-")}`;
}

describe("isTempProjectFolder", () => {
	it("skips the current temp-scope folder names", () => {
		expect(isTempProjectFolder("-tmp")).toBe(true);
		expect(isTempProjectFolder(tmpScopeSlug("pi-probe-123"))).toBe(true);
	});

	it("skips legacy absolute folders whose cwd decodes into the OS temp dir", () => {
		expect(isTempProjectFolder(legacyAbsSlug(os.tmpdir()))).toBe(true);
		expect(isTempProjectFolder(legacyAbsSlug(path.join(os.tmpdir(), "probe", "dir")))).toBe(true);
	});

	it("skips home-scope folders that resolve under the OS temp dir", () => {
		const tempRelative = path.relative(os.homedir(), os.tmpdir());
		if (tempRelative.startsWith("..")) return; // temp dir not under home on this platform
		expect(isTempProjectFolder(homeScopeSlug(tempRelative))).toBe(true);
		expect(isTempProjectFolder(homeScopeSlug(path.join(tempRelative, "pi-advisor-toggle-abc")))).toBe(true);
	});

	it("keeps real project folders", () => {
		expect(isTempProjectFolder(homeScopeSlug("Documents-GITHUB-zeta"))).toBe(false);
		expect(isTempProjectFolder(legacyAbsSlug(path.join(os.homedir(), "work", "proj")))).toBe(false);
		expect(isTempProjectFolder("-")).toBe(false); // cwd === home
		expect(isTempProjectFolder("C-Users-dev-project")).toBe(false); // pre-encoder layout
	});
});

describe("decodeProjectFolderCwd", () => {
	it("maps the temp scope straight at the OS temp dir", () => {
		expect(decodeProjectFolderCwd("-tmp")).toBe(os.tmpdir());
		expect(path.resolve(decodeProjectFolderCwd(tmpScopeSlug("pi-probe-123"))!)).toBe(path.resolve(os.tmpdir()));
	});

	it("decodes legacy absolute folders, lossily collapsing dashes", () => {
		const probe = path.join(os.tmpdir(), "probe", "dir");
		expect(path.resolve(decodeProjectFolderCwd(legacyAbsSlug(probe))!)).toBe(path.resolve(probe));
	});

	it("returns null for folders without a decodable cwd marker", () => {
		expect(decodeProjectFolderCwd("C-Users-dev-project")).toBeNull();
	});
});

import * as path from "node:path";
import { describe, expect, it } from "vitest";

// The protocol module has no host imports on purpose, so the plugin's
// standalone vitest tree can exercise it without the published @linxiraos/zeta
// package or a mocked settings handle.
import { editorArgs } from "../editor-target.ts";

// Expectations are built with the same `path` calls the module uses, so the
// suite asserts the protocol on every platform rather than one separator.
const CWD = path.resolve("work", "repo");

describe("editor command line", () => {
	it("passes the workspace directory as the project root when nothing else is asked for", () => {
		expect(editorArgs("", CWD)).toEqual([CWD]);
		expect(editorArgs("   ", CWD)).toEqual([CWD]);
	});

	it("resolves a FILE[:line[:col]] target against the workspace and keeps its position", () => {
		// The suffix survives resolution: the editor parses `path:line:col`
		// itself, so the plugin must not hand it a resolved path only.
		expect(editorArgs("src/a.rs:12:3", CWD)).toEqual([path.join(CWD, "src", "a.rs") + ":12:3", CWD]);
		expect(editorArgs("src/a.rs:12", CWD)).toEqual([path.join(CWD, "src", "a.rs") + ":12", CWD]);
		expect(editorArgs("src/a.rs", CWD)).toEqual([path.join(CWD, "src", "a.rs"), CWD]);
	});

	it("keeps an absolute target absolute and takes several in order", () => {
		const absolute = path.resolve("elsewhere", "b.rs");
		expect(editorArgs(`${absolute}:7 src/c.rs`, CWD)).toEqual([
			absolute + ":7",
			path.join(CWD, "src", "c.rs"),
			CWD,
		]);
	});

	it("never splits a Windows drive letter as a position", () => {
		// `C:\src\a.rs:42` — the drive colon belongs to the path, so the only
		// position the command line carries is the trailing `:42`.
		const drivePath = String.raw`C:\src\a.rs`;
		const resolved = editorArgs(`${drivePath}:42`, String.raw`C:\work`);

		expect(resolved[0]).toBe(path.resolve(String.raw`C:\work`, drivePath) + ":42");
		expect(resolved[1]).toBe(String.raw`C:\work`);
	});
});

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { defaultWorkspacePath, defaultWorkspaceFirst, isSameWorkspacePath, withDefaultWorkspace } from "./default-workspace.ts";

test("uses a stable Zeta-owned default workspace under the user home", () => {
  assert.equal(defaultWorkspacePath("/home/ada"), path.join("/home/ada", ".zeta", "workspace"));
});

test("withDefaultWorkspace prepends the default workspace when missing", () => {
  assert.deepEqual(withDefaultWorkspace(["/repos/a", "/repos/b"], "/home/u/.zeta/workspace"), [
    "/home/u/.zeta/workspace",
    "/repos/a",
    "/repos/b",
  ]);
});

test("withDefaultWorkspace keeps a fresh list when no default is known yet", () => {
  assert.deepEqual(withDefaultWorkspace(["/repos/a"], null), ["/repos/a"]);
  assert.deepEqual(withDefaultWorkspace([], null), []);
});

test("withDefaultWorkspace never duplicates an entry already in the list (separator variants)", () => {
  assert.deepEqual(withDefaultWorkspace(["/repos/a", "/home/u/.zeta/workspace/"], "/home/u/.zeta/workspace"), [
    "/repos/a",
    "/home/u/.zeta/workspace/",
  ]);
  assert.deepEqual(
    withDefaultWorkspace(["C:\\repos\\a", "C:\\Users\\u\\.zeta\\workspace"], "C:/Users/u/.zeta/workspace"),
    ["C:\\repos\\a", "C:\\Users\\u\\.zeta\\workspace"],
  );
});

test("isSameWorkspacePath ignores separators and trailing slashes, not case", () => {
  assert.equal(isSameWorkspacePath("/home/u/.zeta/workspace", "/home/u/.zeta/workspace/"), true);
  assert.equal(isSameWorkspacePath("C:\\Users\\u\\.zeta\\workspace", "C:/Users/u/.zeta/workspace/"), true);
  assert.equal(isSameWorkspacePath("/home/u/.zeta/workspace", "/Home/U/.zeta/workspace"), false);
});

test("defaultWorkspaceFirst pins the default workspace ahead of any manual order", () => {
  assert.deepEqual(defaultWorkspaceFirst(["/repos/b", "/home/u/.zeta/workspace", "/repos/a"], "/home/u/.zeta/workspace"), [
    "/home/u/.zeta/workspace",
    "/repos/b",
    "/repos/a",
  ]);
  // Separator/trailing-slash variants are the same entry, never duplicated.
  assert.deepEqual(defaultWorkspaceFirst(["/repos/a", "C:\\Users\\u\\.zeta\\workspace"], "C:/Users/u/.zeta/workspace"), [
    "C:/Users/u/.zeta/workspace",
    "/repos/a",
  ]);
  // Absent/missing default: order is preserved (as a copy).
  const input = ["/repos/a", "/repos/b"];
  const out = defaultWorkspaceFirst(input, "/home/u/.zeta/workspace");
  assert.deepEqual(out, ["/home/u/.zeta/workspace", "/repos/a", "/repos/b"]);
  assert.notEqual(out, input);
  assert.deepEqual(defaultWorkspaceFirst(["/repos/a"], null), ["/repos/a"]);
});

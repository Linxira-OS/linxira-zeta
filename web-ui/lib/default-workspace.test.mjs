import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { defaultWorkspacePath } from "./default-workspace.ts";

test("uses a stable Zeta-owned default workspace under the user home", () => {
  assert.equal(defaultWorkspacePath("/home/ada"), path.join("/home/ada", ".zeta", "workspace"));
});

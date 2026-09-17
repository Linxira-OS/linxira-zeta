import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
  createGatewayOpenToken,
  listHostOpenTargets,
  validateGatewayOpenTarget,
} from "../src/open-bridge.ts";

function makeWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-desktop-open-"));
  const project = path.join(workspace, "project");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-desktop-outside-"));
  fs.mkdirSync(project);
  return { workspace, project, outside };
}

function removeWorkspace(paths) {
  fs.rmSync(paths.workspace, { recursive: true, force: true });
  fs.rmSync(paths.outside, { recursive: true, force: true });
}

test("accepts a gateway-authorized path for a host-provided editor target", () => {
  const paths = makeWorkspace();
  const secret = "desktop-open-test-secret";
  try {
    const targets = listHostOpenTargets("win32", (command) => command === "code");
    assert.deepEqual(targets, [
      { id: "file-manager", label: "File manager" },
      { id: "editor:vscode", label: "VS Code" },
    ]);

    const request = {
      path: paths.project,
      token: createGatewayOpenToken(paths.project, secret),
    };
    assert.deepEqual(validateGatewayOpenTarget("editor:vscode", request, paths.workspace, secret), {
      targetId: "editor:vscode",
      path: fs.realpathSync.native(paths.project),
    });
  } finally {
    removeWorkspace(paths);
  }
});

test("rejects forged tokens, unknown target IDs, and paths outside the workspace", () => {
  const paths = makeWorkspace();
  const secret = "desktop-open-test-secret";
  try {
    const authorized = {
      path: paths.project,
      token: createGatewayOpenToken(paths.project, secret),
    };
    assert.equal(validateGatewayOpenTarget("editor:not-installed", authorized, paths.workspace, secret), null);
    assert.equal(validateGatewayOpenTarget("editor:vscode", { ...authorized, token: "forged" }, paths.workspace, secret), null);

    const outside = {
      path: paths.outside,
      token: createGatewayOpenToken(paths.outside, secret),
    };
    assert.equal(validateGatewayOpenTarget("file-manager", outside, paths.workspace, secret), null);
  } finally {
    removeWorkspace(paths);
  }
});

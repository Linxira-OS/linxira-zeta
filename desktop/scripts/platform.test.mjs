import assert from "node:assert/strict";
import test from "node:test";

import { desktopPlatformInfo } from "./platform.mjs";

test("maps Windows desktop artifacts to executable resource names", () => {
  assert.deepEqual(desktopPlatformInfo("win32", "x64"), {
    platformId: "win",
    builderTarget: "--win",
    unpackedDirectory: "win-unpacked",
    zetaBinaryName: "zeta.exe",
    nodeBinaryName: "node.exe",
  });
});

test("maps Linux desktop artifacts to extensionless resource names", () => {
  assert.deepEqual(desktopPlatformInfo("linux", "x64"), {
    platformId: "linux",
    builderTarget: "--linux",
    unpackedDirectory: "linux-unpacked",
    zetaBinaryName: "zeta",
    nodeBinaryName: "node",
  });
});

test("maps macOS desktop artifacts to extensionless resource names", () => {
  assert.deepEqual(desktopPlatformInfo("darwin", "x64"), {
    platformId: "mac",
    builderTarget: "--mac",
    unpackedDirectory: "mac-unpacked",
    zetaBinaryName: "zeta",
    nodeBinaryName: "node",
  });
  assert.deepEqual(desktopPlatformInfo("darwin", "arm64"), {
    platformId: "mac",
    builderTarget: "--mac",
    unpackedDirectory: "mac-unpacked",
    zetaBinaryName: "zeta",
    nodeBinaryName: "node",
  });
});

test("rejects unsupported desktop targets", () => {
  assert.throws(() => desktopPlatformInfo("freebsd", "x64"), /unsupported desktop package platform/i);
  assert.throws(() => desktopPlatformInfo("linux", "arm64"), /unsupported desktop architecture/i);
});

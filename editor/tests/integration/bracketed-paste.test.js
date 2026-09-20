import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as tui from "./tui.js";
import { createTempDir, createTempFile, cleanupDir } from "./helpers.js";

let dir;

afterEach(() => {
  tui.kill();
  if (dir) cleanupDir(dir);
});

function sendRaw(text) {
  execFileSync("tui-use", ["type", text], {
    encoding: "utf8",
    timeout: 10000,
  });
}

describe("bracketed paste", () => {
  it("should handle small bracketed paste", () => {
    dir = createTempDir();
    const file = createTempFile(dir, "paste.txt", "before");

    tui.start(file);
    tui.waitFor("before");

    tui.press("end");

    // Send bracketed paste: \e[200~ ... \e[201~
    sendRaw("\x1b[200~hello\x1b[201~");
    tui.waitStable(500);

    const snap = tui.snapshot();
    expect(snap).toContain("beforehello");
  });

  it("should handle multiline bracketed paste", () => {
    dir = createTempDir();
    const file = createTempFile(dir, "paste-multi.txt", "start");

    tui.start(file);
    tui.waitFor("start");

    tui.press("end");

    // Paste "line1\nline2\nline3"
    sendRaw("\x1b[200~line1\nline2\nline3\x1b[201~");
    tui.waitStable(500);

    const snap = tui.snapshot();
    expect(snap).toContain("line1");
    expect(snap).toContain("line2");
    expect(snap).toContain("line3");
  });

  it("should handle large bracketed paste without hanging", () => {
    dir = createTempDir();
    const file = createTempFile(dir, "paste-large.txt", "");

    tui.start(file);
    tui.waitStable();

    // Test with multi-byte UTF-8 (box-drawing chars are 3 bytes each)
    const content = "┌──────────────────┐\n│  Layout  (File)  │\n└──────────────────┘\n".repeat(100);
    sendRaw("\x1b[200~" + content + "\x1b[201~");
    tui.waitStable(10000);

    const snap = tui.snapshot();
    expect(snap).toContain("Layout");
  });

  it("should allow normal typing after paste", () => {
    dir = createTempDir();
    const file = createTempFile(dir, "paste-after.txt", "");

    tui.start(file);
    tui.waitStable();

    sendRaw("\x1b[200~pasted\x1b[201~");
    tui.waitStable(500);

    tui.type("typed");
    tui.waitStable();

    const snap = tui.snapshot();
    expect(snap).toContain("pastedtyped");
  });
});

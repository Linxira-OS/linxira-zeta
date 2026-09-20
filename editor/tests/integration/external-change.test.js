import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import * as tui from "./tui.js";
import { createTempDir, createTempFile, cleanupDir } from "./helpers.js";

let dir;

afterEach(() => {
  tui.kill();
  if (dir) cleanupDir(dir);
});

describe("external file change detection", () => {
  it("auto-reloads a clean buffer when the file changes on disk", () => {
    dir = createTempDir();
    const file = createTempFile(dir, "reload.txt", "BEFORE_EXTERNAL_EDIT");

    tui.start(file);
    tui.waitFor("BEFORE_EXTERNAL_EDIT");

    const before = tui.snapshot();
    expect(before).toContain("BEFORE_EXTERNAL_EDIT");

    // Modify the file from outside the editor, as another tool would.
    writeFileSync(file, "AFTER_EXTERNAL_EDIT", "utf8");

    // The editor should pick up the change on its own.
    tui.waitFor("AFTER_EXTERNAL_EDIT");

    const after = tui.snapshot();
    expect(after).toContain("AFTER_EXTERNAL_EDIT");
    expect(after).not.toContain("BEFORE_EXTERNAL_EDIT");
  });

  it("keeps unsaved edits when the file changes on disk", () => {
    dir = createTempDir();
    const file = createTempFile(dir, "dirty.txt", "DISK_ORIGINAL");

    tui.start(file);
    tui.waitFor("DISK_ORIGINAL");

    // Make an unsaved edit so the buffer is dirty.
    tui.press("escape");
    tui.press("end");
    tui.type(" EDITED_IN_EDITOR");
    tui.waitFor("DISK_ORIGINAL EDITED_IN_EDITOR");

    // An external change must NOT clobber the user's unsaved work.
    writeFileSync(file, "DISK_CHANGED_EXTERNALLY", "utf8");
    tui.waitStable(400);

    const snap = tui.snapshot();
    expect(snap).toContain("EDITED_IN_EDITOR");
    expect(snap).not.toContain("DISK_CHANGED_EXTERNALLY");
  });
});

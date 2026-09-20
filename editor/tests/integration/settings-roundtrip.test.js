import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdirSync, copyFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as tui from "./tui.js";
import { createTempDir, createTempFile, cleanupDir } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const REFERENCE = resolve(ROOT, "config/settings.json");
const BIN_CONFIG = resolve(ROOT, "bin/config");
const BIN_SETTINGS = resolve(BIN_CONFIG, "settings.json");

let dir;

beforeEach(() => {
  // Seed bin/config/settings.json so ttt reads/writes there instead of ~/.config/ttt
  mkdirSync(BIN_CONFIG, { recursive: true });
  copyFileSync(REFERENCE, BIN_SETTINGS);
});

afterEach(() => {
  tui.kill();
  if (dir) cleanupDir(dir);
  if (existsSync(BIN_SETTINGS)) rmSync(BIN_SETTINGS);
});

describe("settings roundtrip", () => {
  it("switching to monokai then back to default-dark produces identical settings.json", () => {
    dir = createTempDir();
    const file = createTempFile(dir, "test.txt", "hello world");

    tui.start(file);
    tui.waitFor("test.txt");

    // Switch to monokai
    tui.exec("Switch Theme");
    tui.waitStable();
    tui.type("monokai");
    tui.waitFor("monokai");
    tui.press("enter");
    tui.waitStable();

    // Switch back to default-dark
    tui.exec("Switch Theme");
    tui.waitStable();
    tui.type("default-dark");
    tui.waitFor("default-dark");
    tui.press("enter");
    tui.waitStable();

    const saved = readFileSync(BIN_SETTINGS, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");
    expect(saved).toBe(reference);
  });
});

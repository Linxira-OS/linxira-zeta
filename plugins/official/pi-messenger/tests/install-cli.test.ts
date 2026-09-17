import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const roots = new Set<string>();

function createTempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-cli-install-"));
  roots.add(home);
  return home;
}

afterEach(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  roots.clear();
});

describe("install.mjs", () => {
  it("refuses to create a legacy extension copy when native package install is configured", () => {
    const home = createTempHome();
    const settingsPath = path.join(home, ".pi", "agent", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ packages: ["npm:pi-messenger"] }));

    let output = "";
    try {
      execFileSync(process.execPath, ["install.mjs"], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: home },
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      output = String((error as { stdout?: string }).stdout ?? "");
    }

    expect(output).toContain("already installed via pi's native package flow");
    expect(fs.existsSync(path.join(home, ".pi", "agent", "extensions", "pi-messenger"))).toBe(false);
  });
});

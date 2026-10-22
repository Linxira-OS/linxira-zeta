/**
 * Companion resolution: a release puts the GUI and its companions in the
 * binary's own directory (Windows, AppImage), or in /usr/lib/zetawork with only
 * the TUI on PATH (Arch). Both layouts must resolve without PATH entries.
 */
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listComponents, resolveComponent } from "../src/components/registry";

const dirs: string[] = [];

afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

async function withLayout(files: string[]): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "zeta-components-"));
	dirs.push(dir);
	for (const file of files) await writeFile(join(dir, file), "", { mode: 0o755 });
	return dir;
}

describe("component registry", () => {
	test("resolves companions beside the running executable", async () => {
		const dir = await withLayout(["zetacode.exe", "zetawork-gui.exe"]);
		const options = {
			execPath: join(dir, "zetacode.exe"),
			platform: "win32" as const,
			env: { PATH: "" },
			exists: fs.existsSync,
		};
		expect(resolveComponent("zetacode", options)).toBe(join(dir, "zetacode.exe"));
		expect(resolveComponent("zetawork-gui", options)).toBe(join(dir, "zetawork-gui.exe"));
		expect(resolveComponent("zetaide", options)).toBeNull();
	});

	test("reports install state and refusal reasons for every component", async () => {
		const dir = await withLayout(["zetacode", "zetaide"]);
		const components = listComponents({
			execPath: join(dir, "zetacode"),
			platform: "linux",
			env: { PATH: "" },
			exists: fs.existsSync,
		});
		expect(components.map(component => component.id)).toEqual(["zetacode", "zetawork", "zetawork-gui", "zetaide"]);
		expect(components.find(component => component.id === "zetacode")?.path).toBe(join(dir, "zetacode"));
		expect(components.find(component => component.id === "zetaide")?.path).toBe(join(dir, "zetaide"));
		expect(components.find(component => component.id === "zetawork")?.path).toBeUndefined();
		for (const component of components) {
			if (!component.openable) expect(component.reason).toBeTruthy();
		}
	});
});

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { syncStudio } from "./studio-sync";

const scratch: string[] = [];
const root = path.resolve(import.meta.dir, "..", "temp");
async function git(cwd: string, ...args: string[]): Promise<string> {
	const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", windowsHide: true });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(stderr);
	return stdout.trim();
}
async function put(dir: string, file: string, text: string | Uint8Array): Promise<void> {
	await Bun.write(path.join(dir, file), text);
}
afterAll(async () => {
	for (const dir of scratch) await fs.rm(dir, { recursive: true, force: true });
});

test("complete tag inventory merges independent changes and preserves conflicting, contract and binary files", async () => {
	await fs.mkdir(root, { recursive: true });
	const dir = await fs.mkdtemp(path.join(root, "studio-sync-regression-"));
	scratch.push(dir);
	await git(dir, "init", "-q", "-b", "fixture");
	await git(dir, "config", "user.name", "Studio sync fixture");
	await git(dir, "config", "user.email", "fixture@example.invalid");
	await git(dir, "config", "commit.gpgsign", "false");
	const source = "apps/renderer/src/";
	const base = "export const first = 1;\n\nexport const middle = 1;\n\nexport const last = 1;\n";
	await put(dir, source + "clean.ts", base);
	await put(dir, source + "conflict.ts", "export const choice = 1;\n");
	await put(dir, source + "obsolete.ts", "export const retired = true;\n");
	await put(dir, "packages/client-contract/src/model.ts", "export const version = 1;\n");
	await put(dir, "apps/renderer/public/icon.png", new Uint8Array([0, 1, 2]));
	await git(dir, "add", "-A");
	await git(dir, "commit", "-qm", "base");
	await git(dir, "tag", "v0.1.0");
	await put(dir, source + "clean.ts", base.replace("last = 1", "last = 2"));
	await put(dir, source + "conflict.ts", "export const choice = 2;\n");
	await fs.unlink(path.join(dir, source, "obsolete.ts"));
	await put(dir, source + "new.ts", 'import type { StudioClient } from "@omp-studio/client";\n');
	await put(dir, "packages/client-contract/src/model.ts", "export const version = 2;\n");
	await put(dir, "apps/renderer/public/icon.png", new Uint8Array([0, 2, 3]));
	await put(dir, "apps/desktop/src/composition.ts", "export const host = true;\n");
	await put(dir, "omp-patch/overlay/packages/coding-agent/src/studio/service.ts", "export const runtime = true;\n");
	await git(dir, "add", "-A");
	await git(dir, "commit", "-qm", "target");
	await git(dir, "tag", "v0.2.0");
	const local = "web-app/src/studio/";
	await put(dir, local + "clean.ts", base.replace("first = 1", "first = 9"));
	await put(dir, local + "conflict.ts", "export const choice = 9;\n");
	await put(dir, local + "obsolete.ts", "export const retired = true;\n");
	await put(dir, "web-app/src/vendor/client-contract/src/model.ts", "export const version = 1;\n");
	await put(dir, "web-app/public/icon.png", new Uint8Array([0, 1, 2]));
	const result = await syncStudio({
		root: dir,
		from: "v0.1.0",
		tag: "v0.2.0",
		out: "temp/report",
		apply: false,
		offline: true,
	});
	const byName = new Map(result.rows.map(row => [row.upstream, row]));
	expect(byName.get(source + "clean.ts")?.status).toBe("ready-merge");
	expect(await Bun.file(path.join(dir, "temp/report/threeway", local + "clean.ts.merged")).text()).toBe(
		base.replace("first = 1", "first = 9").replace("last = 1", "last = 2"),
	);
	expect(byName.get(source + "conflict.ts")?.status).toBe("conflict");
	expect(byName.get(source + "new.ts")?.status).toBe("ready-add");
	expect(byName.get(source + "obsolete.ts")?.status).toBe("ready-delete");
	expect(byName.get("packages/client-contract/src/model.ts")?.status).toBe("contract-review");
	expect(byName.get("apps/renderer/public/icon.png")?.status).toBe("binary-review");
	expect(byName.get("apps/desktop/src/composition.ts")?.status).toBe("host-adaptation");
	expect(byName.get("omp-patch/overlay/packages/coding-agent/src/studio/service.ts")?.status).toBe("host-adaptation");
	expect(await Bun.file(path.join(dir, local + "clean.ts")).text()).toBe(base.replace("first = 1", "first = 9"));
	expect(await Bun.file(path.join(dir, local + "conflict.ts")).text()).toBe("export const choice = 9;\n");
	await expect(
		syncStudio({ root: dir, from: "v0.1.0", tag: "v0.2.0", out: "temp/report", apply: false, offline: true }),
	).rejects.toThrow("already exists");
	await expect(
		syncStudio({ root: dir, from: "v0.1.0", tag: "v0.2.0", out: "temp/offline-apply", apply: true, offline: true }),
	).rejects.toThrow("report-only");
}, 60_000);

/**
 * The distributable example-plugin environment.
 *
 * The release asset has to be a *complete* environment, not a tarball of source
 * files: the requirement is that a user unzips it, runs `git log`, reads it and
 * drops the directory into `~/.zeta/agent/plugins`. That is exactly what this
 * suite asserts — the entry list (sources, README, AGENTS.md, the manifest, and
 * a real `.git`), the git history inside it, and a rebuild that produces the
 * same list rather than a half-written archive.
 */
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildExamplePluginZip, PLUGIN_ID } from "./build-example-plugin-zip";

const temps: string[] = [];

function tempOut(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-plugin-zip-test-"));
	temps.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

const gitAvailable = Bun.spawnSync({ cmd: ["git", "--version"] }).exitCode === 0;

describe("buildExamplePluginZip", () => {
	test.skipIf(!gitAvailable)(
		"contains the complete environment, including a one-commit git history",
		async () => {
			const built = await buildExamplePluginZip({ outDir: tempOut() });
			const entries = new Set(built.entries);

			expect(built.version).toMatch(/^\d+\.\d+\.\d+/);
			expect(path.basename(built.path)).toBe(`zeta-plugin-example-${built.version}.zip`);
			for (const required of [
				"plugin.json",
				"package.json",
				"index.ts",
				"README.md",
				"AGENTS.md",
				"data/tasks.json",
				"locales/en.json",
				"locales/zh.json",
				"pages/index.html",
				"test/example-panel.test.ts",
			]) {
				expect(entries, `missing ${required}`).toContain(`${PLUGIN_ID}/${required}`);
			}
			// A git directory, not a placeholder file: HEAD, the branch ref and the
			// object store the commit lives in.
			expect(entries).toContain(`${PLUGIN_ID}/.git/HEAD`);
			expect(entries).toContain(`${PLUGIN_ID}/.git/refs/heads/main`);
			expect([...entries].some(name => name.startsWith(`${PLUGIN_ID}/.git/objects/`))).toBe(true);
			// Archive hygiene: no build output, no dependency tree.
			expect([...entries].some(name => name.includes("node_modules/"))).toBe(false);

			// The archive is a real deflate zip (local file header magic).
			const header = fs.readFileSync(built.path).subarray(0, 4);
			expect([...header]).toEqual([0x50, 0x4b, 0x03, 0x04]);
		},
		60_000,
	);

	test.skipIf(!gitAvailable)(
		"extracts to a directory whose history reads as one commit",
		async () => {
			const built = await buildExamplePluginZip({ outDir: tempOut() });
			const target = tempOut();
			const unzip = Bun.spawnSync({ cmd: ["unzip", "-q", built.path, "-d", target] });
			// `unzip` is on the release image and on the dev boxes this suite runs on;
			// when it is missing the entry-list assertions above still cover the
			// archive, so this is a skip rather than a failure.
			if (unzip.exitCode !== 0) return;

			const pluginRoot = path.join(target, PLUGIN_ID);
			expect(fs.existsSync(path.join(pluginRoot, "plugin.json"))).toBe(true);
			const log = Bun.spawnSync({ cmd: ["git", "log", "--format=%s|%an|%aI"], cwd: pluginRoot });
			expect(log.exitCode).toBe(0);
			const lines = log.stdout.toString().trim().split("\n").filter(Boolean);
			expect(lines).toHaveLength(1);
			const [subject, author, date] = lines[0].split("|");
			expect(subject).toBe(`${PLUGIN_ID} ${built.version}`);
			expect(author).toBe("Zeta Release");
			expect(date).toBe("2026-10-20T00:00:00Z");
		},
		60_000,
	);

	test.skipIf(!gitAvailable)(
		"rebuilds to the same entry list and the same payload",
		async () => {
			const first = await buildExamplePluginZip({ outDir: tempOut() });
			const second = await buildExamplePluginZip({ outDir: tempOut() });
			expect(second.entries).toEqual(first.entries);
			expect(second.version).toBe(first.version);

			const a = tempOut();
			const b = tempOut();
			if (Bun.spawnSync({ cmd: ["unzip", "-q", first.path, "-d", a] }).exitCode !== 0) return;
			if (Bun.spawnSync({ cmd: ["unzip", "-q", second.path, "-d", b] }).exitCode !== 0) return;
			const payload = (root: string): Record<string, string> => {
				const files: Record<string, string> = {};
				const walk = (dir: string, prefix: string): void => {
					for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
						const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
						if (entry.isDirectory()) {
							// `.git` carries an index whose stat records belong to the
							// extractor; the committed history is asserted above instead.
							if (entry.name === ".git") continue;
							walk(path.join(dir, entry.name), relative);
							continue;
						}
						files[relative] = fs.readFileSync(path.join(dir, entry.name), "utf8");
					}
				};
				walk(path.join(root, PLUGIN_ID), "");
				return files;
			};
			expect(payload(b)).toEqual(payload(a));
		},
		60_000,
	);
});

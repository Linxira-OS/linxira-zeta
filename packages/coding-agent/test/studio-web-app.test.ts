/**
 * `zeta serve` resolves the Studio renderer from three places, in order:
 * `ZETA_WEB_APP_DIR`, the packaged `<package-root>/dist/web-app`, then the
 * repository's `web-app/dist`. The packaged copy is what an npm install has.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveStudioWebAppDirFrom } from "../src/server/studio-web-app";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-studio-web-app-"));
	roots.push(root);
	return root;
}

/** Create `<root>/<relative>` holding an `index.html`, the marker the probe needs. */
async function makeBuild(root: string, relative: string): Promise<string> {
	const dir = path.join(root, relative);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, "index.html"), "<!doctype html><title>studio</title>");
	return path.resolve(dir);
}

afterEach(async () => {
	while (roots.length > 0) await fs.rm(roots.pop()!, { recursive: true, force: true });
});

describe("Studio renderer resolution", () => {
	it("finds the packaged build beside a bundled dist/cli.js", async () => {
		const root = await tempRoot();
		const build = await makeBuild(root, "dist/web-app");
		expect(resolveStudioWebAppDirFrom(pathToFileURL(path.join(root, "dist", "cli.js")).href, undefined)).toBe(build);
	});

	it("finds the packaged build beside a source server module", async () => {
		const root = await tempRoot();
		const build = await makeBuild(root, "dist/web-app");
		const source = pathToFileURL(path.join(root, "src", "server", "studio-web-app.ts")).href;
		expect(resolveStudioWebAppDirFrom(source, undefined)).toBe(build);
	});

	it("falls back to the repository build in a checkout", async () => {
		const root = await tempRoot();
		const build = await makeBuild(root, "web-app/dist");
		const source = pathToFileURL(
			path.join(root, "packages", "coding-agent", "src", "server", "studio-web-app.ts"),
		).href;
		expect(resolveStudioWebAppDirFrom(source, undefined)).toBe(build);
	});

	it("prefers the packaged build over the repository build", async () => {
		const root = await tempRoot();
		const packaged = await makeBuild(root, "packages/coding-agent/dist/web-app");
		await makeBuild(root, "web-app/dist");
		const source = pathToFileURL(
			path.join(root, "packages", "coding-agent", "src", "server", "studio-web-app.ts"),
		).href;
		expect(resolveStudioWebAppDirFrom(source, undefined)).toBe(packaged);
	});

	it("treats ZETA_WEB_APP_DIR as authoritative", async () => {
		const root = await tempRoot();
		const custom = await makeBuild(root, "custom-build");
		await makeBuild(root, "dist/web-app");
		const bundled = pathToFileURL(path.join(root, "dist", "cli.js")).href;
		expect(resolveStudioWebAppDirFrom(bundled, custom)).toBe(custom);
		expect(resolveStudioWebAppDirFrom(bundled, path.join(root, "missing"))).toBeNull();
	});

	it("returns null when no build exists, keeping the placeholder path", async () => {
		const root = await tempRoot();
		const bundled = pathToFileURL(path.join(root, "dist", "cli.js")).href;
		expect(resolveStudioWebAppDirFrom(bundled, undefined)).toBeNull();
	});
});

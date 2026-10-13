import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Subprocess } from "bun";

/**
 * `startServer` stamps the host language (`StartServerOptions.language`) into
 * the served shell so the client boots in the same language as the CLI that
 * launched it. These tests exercise the real option path over HTTP: the shell
 * HTML comes from a fixture embedded archive (the same preload override
 * `server-embedded-client.test.ts` uses), so the assertion holds without a
 * built `dist/client`.
 */

const tempDirs: string[] = [];
const children: Array<Subprocess<"ignore", "pipe", "pipe">> = [];

const SHELL_HTML = '<!doctype html><html lang="en"><head><title>zeta stats</title></head><body></body></html>';

async function startDashboard(language?: string): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-stats-locale-"));
	tempDirs.push(root);
	const tmpDir = path.join(root, "tmp");
	await fs.mkdir(tmpDir);
	const archive = Buffer.from(Bun.gzipSync(await new Bun.Archive({ "index.html": SHELL_HTML }).bytes())).toString(
		"base64",
	);
	const preload = path.join(root, "preload.ts");
	const entrypoint = path.join(root, "server.ts");
	await Bun.write(
		preload,
		`Bun.plugin({
	name: "embedded-stats-client-locale-fixture",
	setup(build) {
		build.onLoad({ filter: /embedded-client\\.generated\\.txt$/ }, () => ({
			exports: { default: ${JSON.stringify(archive)} }, loader: "object",
		}));
	},
});`,
	);
	const options = language === undefined ? "{}" : `{ language: ${JSON.stringify(language)} }`;
	await Bun.write(
		entrypoint,
		`import { startServer } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/server.ts"))};
const server = await startServer(0, undefined, ${options});
process.stdout.write(JSON.stringify({ url: "http://" + server.hostname + ":" + server.port }));`,
	);
	const child = Bun.spawn([process.execPath, "--preload", preload, entrypoint], {
		cwd: root,
		env: {
			...process.env,
			HOME: root,
			USERPROFILE: root,
			TMPDIR: tmpDir,
			TMP: tmpDir,
			TEMP: tmpDir,
			PI_CONFIG_DIR: ".zeta",
			ZETA_CODING_AGENT_DIR: path.join(root, ".zeta", "agent"),
			OMP_PROFILE: "",
			PI_PROFILE: "",
			XDG_DATA_HOME: path.join(root, "data"),
			XDG_STATE_HOME: path.join(root, "state"),
			XDG_CACHE_HOME: path.join(root, "cache"),
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	children.push(child);
	const reader = child.stdout.getReader();
	const ready = await reader.read();
	reader.releaseLock();
	if (ready.done) throw new Error(`Dashboard failed to start: ${await new Response(child.stderr).text()}`);
	const { url }: { url: string } = JSON.parse(new TextDecoder().decode(ready.value));
	return url;
}

afterEach(async () => {
	for (const child of children.splice(0)) {
		child.kill();
		await child.exited;
	}
	await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("startServer locale stamping", () => {
	test("stamps the host language into the served shell", async () => {
		const url = await startDashboard("zh");
		const html = await (await fetch(url)).text();
		expect(html).toContain('window.__ZETA_STATS_LOCALE__="zh-CN"');
		expect(html).toContain('<html lang="zh-CN"');
	});

	test("stamps English for an English host", async () => {
		const url = await startDashboard("en");
		const html = await (await fetch(url)).text();
		expect(html).toContain('window.__ZETA_STATS_LOCALE__="en"');
		expect(html).toContain('<html lang="en"');
	});

	test("falls back to English when the host language is unrecognized", async () => {
		const url = await startDashboard("tr-TR");
		expect(await (await fetch(url)).text()).toContain('window.__ZETA_STATS_LOCALE__="en"');
	});
});

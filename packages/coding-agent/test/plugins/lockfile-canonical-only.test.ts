import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { getPluginsDir, getPluginsLockfile, PLUGINS_LOCKFILE_CANONICAL } from "@linxiraos/pi-utils";
import { getPluginSettings } from "@linxiraos/zeta/extensibility/plugins/loader";
import {
	readPluginRuntimeConfig,
	writePluginRuntimeConfig,
} from "@linxiraos/zeta/extensibility/plugins/runtime-config";

/**
 * Plugin runtime state lives in one file, and only its canonical Zeta name is
 * read or written.
 *
 * The pre-rename lockfile is intentionally ignored: upstream plugin
 * compatibility was dropped, so an old install's plugin state does not carry
 * forward. These cases pin that policy — the reader reports no state, the
 * loader does not migrate or resurrect the old file, and a write targets the
 * Zeta name only.
 */

const LEGACY = "omp-plugins.lock.json";
const CANONICAL = PLUGINS_LOCKFILE_CANONICAL;

let home: string;
let projectDir: string;

function pluginsDir(): string {
	return getPluginsDir(home);
}

function writeLock(name: string, body: unknown): void {
	fs.mkdirSync(pluginsDir(), { recursive: true });
	fs.writeFileSync(path.join(pluginsDir(), name), `${JSON.stringify(body, null, "\t")}\n`);
}

function lockExists(name: string): boolean {
	return fs.existsSync(path.join(pluginsDir(), name));
}

beforeEach(() => {
	home = fs.mkdtempSync(path.join(process.env.TEMP ?? ".", "zeta-lockfile-canonical-"));
	projectDir = fs.mkdtempSync(path.join(process.env.TEMP ?? ".", "zeta-lockfile-canonical-project-"));
});

afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
	fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("plugin lockfile is canonical-only", () => {
	it("ignores a pre-rename lockfile instead of loading it", async () => {
		writeLock(LEGACY, { plugins: { "my-ext": { enabled: false } }, settings: { "my-ext": { mode: "legacy" } } });

		const settings = await getPluginSettings("my-ext", projectDir, home);

		expect(settings).toEqual({});
		expect(lockExists(CANONICAL)).toBe(false);
	});

	it("does not migrate or delete the pre-rename lockfile on load", async () => {
		writeLock(LEGACY, { plugins: { "my-ext": { enabled: false } }, settings: {} });
		const before = fs.readFileSync(path.join(pluginsDir(), LEGACY), "utf8");

		await getPluginSettings("my-ext", projectDir, home);

		expect(lockExists(LEGACY)).toBe(true);
		expect(fs.readFileSync(path.join(pluginsDir(), LEGACY), "utf8")).toBe(before);
	});

	it("reads the canonical lockfile and ignores a sibling legacy file", async () => {
		writeLock(LEGACY, { plugins: { "my-ext": { enabled: false } }, settings: { "my-ext": { mode: "legacy" } } });
		writeLock(CANONICAL, { plugins: { "my-ext": { enabled: true } }, settings: { "my-ext": { mode: "zeta" } } });

		const settings = await getPluginSettings("my-ext", projectDir, home);

		expect(settings).toEqual({ mode: "zeta" });
	});

	it("writes the canonical lockfile only", async () => {
		await writePluginRuntimeConfig(getPluginsLockfile(home), {
			plugins: { "my-ext": { version: "1.0.0", enabledFeatures: null, enabled: false } },
			settings: {},
		});

		expect(lockExists(CANONICAL)).toBe(true);
		expect(lockExists(LEGACY)).toBe(false);
	});

	it("reports empty when only the pre-rename lockfile exists", async () => {
		writeLock(LEGACY, { plugins: {}, settings: {} });

		const read = await readPluginRuntimeConfig(getPluginsLockfile(home));

		expect(read.status).toBe("empty");
	});
});

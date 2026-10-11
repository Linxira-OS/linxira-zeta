import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Upgrade contract for the plugin lockfile rename.
 *
 * The lockfile holds per-plugin runtime state (enabled flag, version), so an
 * in-place upgrade must carry it forward rather than orphan it. These cases pin
 * the read-old/write-new migration: one-shot, idempotent, non-fatal, and the
 * canonical file always wins when both exist.
 */

const LEGACY = "omp-plugins.lock.json";
const CANONICAL = "zeta-plugins.lock.json";

let home: string;

function pluginsDir(): string {
	return path.join(home, ".zeta", "plugins");
}

function writeLock(name: string, body: unknown): void {
	fs.mkdirSync(pluginsDir(), { recursive: true });
	fs.writeFileSync(path.join(pluginsDir(), name), `${JSON.stringify(body, null, "\t")}\n`);
}

function lockExists(name: string): boolean {
	return fs.existsSync(path.join(pluginsDir(), name));
}

function readCanonical(): { plugins: Record<string, { enabled: boolean }> } {
	return JSON.parse(fs.readFileSync(path.join(pluginsDir(), CANONICAL), "utf8"));
}

/**
 * Drive the migration through the loader's public entry point. `home` is passed
 * explicitly so the test never depends on process-global agent-dir state.
 */
async function loadViaLoader(): Promise<void> {
	const { getPluginSettings } = await import("@linxiraos/zeta/extensibility/plugins/loader");
	await getPluginSettings("my-ext", home, home);
}

beforeEach(() => {
	home = fs.mkdtempSync(path.join(process.env.TEMP ?? ".", "zeta-lockfile-migrate-"));
});

afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
});

describe("plugin lockfile migration", () => {
	it("migrates the pre-rename lockfile and removes the old file", async () => {
		writeLock(LEGACY, { plugins: { "my-ext": { enabled: false } }, settings: {} });

		await loadViaLoader();

		expect(lockExists(CANONICAL)).toBe(true);
		expect(lockExists(LEGACY)).toBe(false);
		// The per-plugin state the user configured is carried forward.
		expect(readCanonical().plugins["my-ext"]?.enabled).toBe(false);
	});

	it("is idempotent — a second load changes nothing", async () => {
		writeLock(LEGACY, { plugins: { a: { enabled: false }, b: { enabled: true } }, settings: {} });
		await loadViaLoader();
		const afterFirst = fs.readFileSync(path.join(pluginsDir(), CANONICAL), "utf8");

		await loadViaLoader();

		expect(fs.readFileSync(path.join(pluginsDir(), CANONICAL), "utf8")).toBe(afterFirst);
	});

	it("prefers the canonical lockfile and leaves the legacy one untouched", async () => {
		writeLock(LEGACY, { plugins: { stale: { enabled: false } }, settings: {} });
		writeLock(CANONICAL, { plugins: { current: { enabled: true } }, settings: {} });

		await loadViaLoader();

		expect(readCanonical().plugins.current?.enabled).toBe(true);
		expect(readCanonical().plugins.stale).toBeUndefined();
		expect(lockExists(LEGACY)).toBe(true);
	});

	it("does not throw when there is no lockfile at all", async () => {
		await loadViaLoader();
		expect(lockExists(CANONICAL)).toBe(false);
		expect(lockExists(LEGACY)).toBe(false);
	});

	it("still loads the legacy state when the migration cannot write", async () => {
		// Make the canonical path a directory so the write fails for a reason that
		// holds on every platform — POSIX mode bits are ignored on Windows, so
		// chmod cannot make this deterministic. The read must still succeed:
		// losing the user's plugin state is worse than a stale filename.
		writeLock(LEGACY, { plugins: { x: { enabled: false } }, settings: {} });
		fs.mkdirSync(path.join(pluginsDir(), CANONICAL), { recursive: true });

		const { getPluginSettings } = await import("@linxiraos/zeta/extensibility/plugins/loader");
		const settings = await getPluginSettings("x", home, home);

		expect(settings).toEqual({});
		expect(lockExists(LEGACY)).toBe(true);
	});
});

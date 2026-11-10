/**
 * Device registry: issuance, resolution, revocation, tombstones, damage control.
 *
 * The registry is the credential layer under remote access — one revocable
 * token per paired device instead of one machine-wide secret. These tests pin
 * the properties the HTTP surface and the access gate depend on, without going
 * through either.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DeviceRegistry,
	MAX_REVOKED_DEVICES,
	TOUCH_INTERVAL_MS,
	generateDeviceToken,
	hashDeviceToken,
	inferPlatform,
	looksLikeDeviceToken,
	normalizeLabel,
	normalizePlatform,
} from "../../src/server/auth/device-registry";

const cleanups: Array<() => Promise<void>> = [];

async function registry(): Promise<{ registry: DeviceRegistry; filePath: string; dir: string }> {
	const dir = await mkdtemp(join(tmpdir(), "zeta-devices-"));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	const filePath = join(dir, "auth", "devices.json");
	return { registry: new DeviceRegistry(filePath), filePath, dir };
}

afterEach(async () => {
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

describe("token shapes", () => {
	test("a minted token is prefixed, long, and unlike the legacy machine token", () => {
		const token = generateDeviceToken();
		expect(token.startsWith("zdt_")).toBe(true);
		// zdt_ + 43 base64url chars from 32 bytes.
		expect(token.length).toBe(47);
		expect(looksLikeDeviceToken(token)).toBe(true);
		// The legacy token is a bare 43-char base64url value.
		expect(looksLikeDeviceToken("a".repeat(43))).toBe(false);
	});

	test("hashing is stable and distinct per token", () => {
		const token = generateDeviceToken();
		expect(hashDeviceToken(token)).toBe(hashDeviceToken(token));
		expect(hashDeviceToken(token)).toMatch(/^[0-9a-f]{64}$/u);
		expect(hashDeviceToken(token)).not.toBe(hashDeviceToken(generateDeviceToken()));
	});

	test("platform and label normalization is defensive", () => {
		expect(normalizePlatform("Android")).toBe("android");
		expect(normalizePlatform("nonsense")).toBe("unknown");
		expect(normalizePlatform(undefined)).toBe("unknown");
		expect(inferPlatform("Mozilla/5.0 (Linux; Android 15)")).toBe("android");
		expect(inferPlatform("Mozilla/5.0 Electron/33")).toBe("desktop");
		expect(inferPlatform(null)).toBe("unknown");
		expect(normalizeLabel("  Pixel\n8\u0007 ", "android")).toBe("Pixel 8");
		expect(normalizeLabel("", "android")).toBe("Android device");
		expect(normalizeLabel("x".repeat(200), "web").length).toBe(64);
	});
});

describe("DeviceRegistry", () => {
	test("issuing records the hash, never the token", async () => {
		const { registry: store, filePath } = await registry();
		const issued = await store.issue({ label: "Pixel 8", platform: "android" });

		expect(issued.device.id.startsWith("dev_")).toBe(true);
		expect(issued.device.scopes).toEqual(["read", "write"]);
		expect(issued.device.revokedAt).toBeNull();
		expect(JSON.stringify(issued.device)).not.toContain(issued.token);

		const file = await readFile(filePath, "utf8");
		expect(file).not.toContain(issued.token);
		expect(file).toContain(hashDeviceToken(issued.token));
	});

	test("the file is owner-only on POSIX", async () => {
		if (process.platform === "win32") return;
		const { registry: store, filePath } = await registry();
		await store.issue({ platform: "web" });
		expect((await stat(filePath)).mode & 0o777).toBe(0o600);
	});

	test("resolution finds the device and refuses anything else", async () => {
		const { registry: store } = await registry();
		const first = await store.issue({ platform: "web" });
		const second = await store.issue({ platform: "android" });

		expect((await store.findByToken(first.token))?.id).toBe(first.device.id);
		expect((await store.findByToken(`Bearer ${second.token}`))?.id).toBe(second.device.id);
		expect(await store.findByToken("zdt_not-a-real-token")).toBeUndefined();
		expect(await store.findByToken("a".repeat(43))).toBeUndefined();
		expect(await store.findByToken("")).toBeUndefined();
	});

	test("lastSeenAt is refreshed at most once per interval", async () => {
		const { registry: store, filePath } = await registry();
		const issued = await store.issue({ platform: "web" });
		const created = issued.device.lastSeenAt;
		expect(created).not.toBeNull();

		// Inside the throttle window the record keeps its stored timestamp.
		const soon = new Date(Date.parse(created!) + TOUCH_INTERVAL_MS / 2);
		await store.resolve(issued.token, soon);
		expect((await store.get(issued.device.id))?.lastSeenAt).toBe(created);

		// Past the window the touch is persisted.
		const later = new Date(Date.parse(created!) + TOUCH_INTERVAL_MS + 1_000);
		const touched = await store.resolve(issued.token, later);
		expect(touched?.lastSeenAt).toBe(later.toISOString());
		const onDisk = JSON.parse(await readFile(filePath, "utf8")) as { devices: { lastSeenAt: string }[] };
		expect(onDisk.devices[0]?.lastSeenAt).toBe(later.toISOString());
	});

	test("revocation is immediate, idempotent, and keeps a tombstone", async () => {
		const { registry: store } = await registry();
		const issued = await store.issue({ platform: "android" });

		const first = await store.revoke(issued.device.id);
		expect(first).toMatchObject({ found: true, revoked: true });
		expect(await store.findByToken(issued.token)).toBeUndefined();
		expect(await store.resolve(issued.token)).toBeUndefined();

		const again = await store.revoke(issued.device.id);
		expect(again).toMatchObject({ found: true, revoked: false });

		expect(await store.activeCount()).toBe(0);
		const listed = await store.list();
		expect(listed).toHaveLength(1);
		expect(listed[0]?.revokedAt).not.toBeNull();
		// A revoked row still never exposes the hash.
		expect(JSON.stringify(listed)).not.toContain("tokenHash");
	});

	test("an unknown id is not a revocation", async () => {
		const { registry: store } = await registry();
		expect(await store.revoke("dev_missing")).toMatchObject({ found: false, revoked: false });
		expect(await store.list()).toHaveLength(0);
	});

	test("revokeAll spares the caller's own device when asked", async () => {
		const { registry: store } = await registry();
		const keeper = await store.issue({ label: "keep", platform: "web" });
		const other = await store.issue({ label: "other", platform: "android" });

		const result = await store.revokeAll({ keepId: keeper.device.id });
		expect(result.revoked).toBe(1);
		expect(result.ids).toEqual([other.device.id]);
		expect(await store.findByToken(keeper.token)).toBeDefined();
		expect(await store.findByToken(other.token)).toBeUndefined();

		// Without keepId everything active goes.
		await store.revokeAll();
		expect(await store.findByToken(keeper.token)).toBeUndefined();
		expect(await store.activeCount()).toBe(0);
	});

	test("tombstones are capped so the file cannot grow without bound", async () => {
		const { registry: store } = await registry();
		const total = MAX_REVOKED_DEVICES + 3;
		for (let index = 0; index < total; index += 1) {
			const issued = await store.issue({ label: `d${index}`, platform: "web" });
			await store.revoke(issued.device.id);
		}
		const listed = await store.list();
		expect(listed).toHaveLength(MAX_REVOKED_DEVICES);
	});

	test("a missing file is an empty registry, not an error", async () => {
		const { registry: store, dir } = await registry();
		expect(await store.list()).toEqual([]);
		expect(await store.activeCount()).toBe(0);
		const issued = await store.issue({ platform: "tui" });
		expect((await store.findByToken(issued.token))?.id).toBe(issued.device.id);
		expect(dir.length).toBeGreaterThan(0);
	});

	// The first warning for a damaged file initializes the logger's error path;
	// on a Windows checkout with an out-of-sync native addon that can take
	// seconds, so this one gets a wider budget than the default 5 s.
	test("a corrupt file fails closed for device tokens but stays operable", async () => {
		const { registry: store, filePath, dir } = await registry();
		await mkdir(join(dir, "auth"), { recursive: true });
		await writeFile(filePath, "{{{not json", "utf8");

		expect(await store.list()).toEqual([]);
		expect(await store.findByToken(generateDeviceToken())).toBeUndefined();
		// Re-pairing repairs the file instead of staying broken forever.
		const issued = await store.issue({ platform: "web" });
		expect((await store.findByToken(issued.token))?.id).toBe(issued.device.id);
	}, 30_000);

	test("malformed rows drop out instead of disabling healthy ones", async () => {
		const { registry: store, filePath } = await registry();
		const healthy = await store.issue({ platform: "web" });
		const raw = JSON.parse(await readFile(filePath, "utf8")) as { version: number; devices: unknown[] };
		await writeFile(
			filePath,
			JSON.stringify({
				version: 1,
				devices: [...raw.devices, { id: "", tokenHash: "nope" }, { id: "dev_x" }, 42],
			}),
			"utf8",
		);

		const listed = await store.list();
		expect(listed).toHaveLength(1);
		expect(listed[0]?.id).toBe(healthy.device.id);
		expect(await store.findByToken(healthy.token)).toBeDefined();
	});
});

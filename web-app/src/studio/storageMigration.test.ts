import { describe, expect, test } from "bun:test";
import { migrateLegacyStorageKeys, type StorageLike } from "./storageMigration";

function fakeStorage(entries: Record<string, string> = {}): StorageLike & { entries: Map<string, string> } {
	const map = new Map(Object.entries(entries));
	return {
		entries: map,
		get length() {
			return map.size;
		},
		getItem: key => map.get(key) ?? null,
		setItem: (key, value) => void map.set(key, value),
		removeItem: key => void map.delete(key),
		key: index => [...map.keys()][index] ?? null,
	};
}

describe("migrateLegacyStorageKeys", () => {
	test("moves omp.* keys to zeta.* and drops the legacy copies", () => {
		const storage = fakeStorage({ "omp.appSettings": "{\"language\":\"zh\"}", "omp.lastRoute": "home" });
		expect(migrateLegacyStorageKeys(storage)).toBe(2);
		expect(storage.getItem("zeta.appSettings")).toBe("{\"language\":\"zh\"}");
		expect(storage.getItem("zeta.lastRoute")).toBe("home");
		expect(storage.getItem("omp.appSettings")).toBeNull();
	});

	test("never overwrites a zeta.* value that already exists", () => {
		const storage = fakeStorage({ "omp.appSettings": "legacy", "zeta.appSettings": "current" });
		expect(migrateLegacyStorageKeys(storage)).toBe(0);
		expect(storage.getItem("zeta.appSettings")).toBe("current");
		expect(storage.getItem("omp.appSettings")).toBeNull();
	});

	test("leaves unrelated keys alone and is idempotent", () => {
		const storage = fakeStorage({ theme: "dark", "zeta.perf.motion": "off" });
		expect(migrateLegacyStorageKeys(storage)).toBe(0);
		expect(storage.getItem("theme")).toBe("dark");
		expect(migrateLegacyStorageKeys(storage)).toBe(0);
	});

	test("survives absent storage", () => {
		expect(migrateLegacyStorageKeys(undefined)).toBe(0);
	});
});

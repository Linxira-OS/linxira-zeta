/**
 * Browser-storage keys.
 *
 * Every renderer preference lives under `zeta.*` (the product namespace). The
 * previous namespace was `omp.*`; `migrateLegacyStorageKeys()` copies those
 * forward once at boot so an existing install keeps its layout, language and
 * theme instead of silently resetting.
 */

const LEGACY_PREFIX = "omp.";
export const STORAGE_PREFIX = "zeta.";

/** Minimal surface of `localStorage`, so the migration is testable without a DOM. */
export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
	key(index: number): string | null;
	readonly length: number;
}

/**
 * Copy `omp.*` entries to their `zeta.*` names and drop the legacy copies.
 * A `zeta.*` value always wins, so a partially-migrated profile is not
 * overwritten by stale data. Returns the number of keys moved.
 */
export function migrateLegacyStorageKeys(storage: StorageLike | undefined = globalThis.localStorage): number {
	if (storage === undefined) return 0;
	const legacy: string[] = [];
	for (let index = 0; index < storage.length; index += 1) {
		const key = storage.key(index);
		if (key !== null && key.startsWith(LEGACY_PREFIX)) legacy.push(key);
	}
	let moved = 0;
	for (const key of legacy) {
		const target = STORAGE_PREFIX + key.slice(LEGACY_PREFIX.length);
		const value = storage.getItem(key);
		try {
			if (value !== null && storage.getItem(target) === null) {
				storage.setItem(target, value);
				moved += 1;
			}
			storage.removeItem(key);
		} catch {
			// Storage disabled or over quota: leave the legacy key in place.
		}
	}
	return moved;
}

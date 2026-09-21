#!/usr/bin/env bun
/**
 * One-off consistency check for the i18n catalogues:
 * - messages.ts interface keys == en.ts keys == zh.ts keys (set equality)
 * - zh values are non-empty
 * Usage: bun scripts/check-i18n-consistency.ts
 */
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const dir = path.join(repoRoot, "packages/coding-agent/src/i18n");

async function readLines(file: string): Promise<string[]> {
	return (await Bun.file(file).text()).split("\n");
}

/** Interface keys: `\tname: string;` (optionally with a trailing comment). */
async function extractInterfaceKeys(file: string): Promise<Set<string>> {
	const keys = new Set<string>();
	for (const line of await readLines(file)) {
		const match = /^\t([A-Za-z][A-Za-z0-9]*): string;/.exec(line);
		if (match) keys.add(match[1]);
	}
	return keys;
}

/** Catalogue keys: `\tname: "value",` (single/double/template literal value). */
async function extractCatalogueKeys(file: string): Promise<Map<string, string>> {
	const keys = new Map<string, string>();
	for (const line of await readLines(file)) {
		const match = /^\t([A-Za-z][A-Za-z0-9]*): ["'`](.*)["'`],?$/.exec(line);
		if (match) keys.set(match[1], match[2]);
	}
	return keys;
}

const iface = await extractInterfaceKeys(path.join(dir, "messages.ts"));
const en = await extractCatalogueKeys(path.join(dir, "en.ts"));
const zh = await extractCatalogueKeys(path.join(dir, "zh.ts"));

let failed = 0;
const report = (message: string): void => {
	console.error(message);
	failed++;
};
for (const key of iface) {
	if (!en.has(key)) report(`messages-only (missing en): ${key}`);
	if (!zh.has(key)) report(`messages-only (missing zh): ${key}`);
}
for (const [key] of en) {
	if (!iface.has(key)) report(`en-only (missing in messages interface): ${key}`);
}
for (const [key] of zh) {
	if (!iface.has(key)) report(`zh-only (missing in messages interface): ${key}`);
}
for (const [key, value] of zh) {
	if (value.trim() === "") report(`zh empty value: ${key}`);
}
console.log(`interface: ${iface.size}, en: ${en.size}, zh: ${zh.size}, failures: ${failed}`);
process.exit(failed === 0 ? 0 : 1);

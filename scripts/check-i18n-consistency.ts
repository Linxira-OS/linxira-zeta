#!/usr/bin/env bun
/**
 * Gate: the three i18n catalogue files agree.
 *
 *  - `messages.ts` interface keys == `en.ts` keys == `zh.ts` keys (set equality)
 *  - no `zh` value is empty
 *  - a scan that finds zero keys is a failure, not a green no-op: a moved or
 *    renamed catalogue file would otherwise report `failures: 0` forever
 *
 * The extractors and the report are pure functions (`check-i18n-consistency.test.ts`
 * drives them against a synthetic catalogue directory); `main()` is the CLI
 * wrapper, so the exit code and the stdout summary are decided in one place.
 *
 * Usage: bun scripts/check-i18n-consistency.ts
 */
import * as path from "node:path";

/** What a gate run reports: the summary line, the diagnostics, the exit code. */
export interface GateOutcome {
	summary: string;
	errors: string[];
	exitCode: number;
}

/** The three key sets a catalogue check compares. */
export interface CatalogueCheck {
	iface: Set<string>;
	en: Map<string, string>;
	zh: Map<string, string>;
}

/** Interface keys: `\tname: <type>;` — any member shape (string, function, …). */
export function extractInterfaceKeys(source: string): Set<string> {
	const keys = new Set<string>();
	for (const line of source.split("\n")) {
		const match = /^\t([A-Za-z][A-Za-z0-9]*):/.exec(line);
		if (match) keys.add(match[1]);
	}
	return keys;
}

/** Catalogue keys: `\tname: <value>` — any value shape (string literal, function,
 *  multiline continuation). Presence is what set equality cares about; the
 *  same-line remainder (plus the next line for continuations) backs the
 *  zh-emptiness check. */
export function extractCatalogueKeys(source: string): Map<string, string> {
	const keys = new Map<string, string>();
	const lines = source.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const match = /^\t([A-Za-z][A-Za-z0-9]*):\s?(.*)$/.exec(lines[i]);
		if (!match) continue;
		let value = match[2];
		if (value.trim() === "" && i + 1 < lines.length) value = lines[i + 1].trim();
		keys.set(match[1], value);
	}
	return keys;
}

/** Compare the three key sets and report every disagreement. */
export function checkCatalogue(catalogue: CatalogueCheck): GateOutcome {
	const { iface, en, zh } = catalogue;
	const errors: string[] = [];
	for (const key of iface) {
		if (!en.has(key)) errors.push(`messages-only (missing en): ${key}`);
		if (!zh.has(key)) errors.push(`messages-only (missing zh): ${key}`);
	}
	for (const [key] of en) {
		if (!iface.has(key)) errors.push(`en-only (missing in messages interface): ${key}`);
	}
	for (const [key] of zh) {
		if (!iface.has(key)) errors.push(`zh-only (missing in messages interface): ${key}`);
	}
	for (const [key, value] of zh) {
		if (value.trim() === "") errors.push(`zh empty value: ${key}`);
	}
	// Zero keys in all three files means the extractors (or the paths they are
	// pointed at) stopped working — never "the catalogues are consistent".
	if (iface.size === 0 && en.size === 0 && zh.size === 0) {
		errors.push("no catalogue keys found — scan scope is broken");
	}
	return {
		summary: `interface: ${iface.size}, en: ${en.size}, zh: ${zh.size}, failures: ${errors.length}`,
		errors,
		exitCode: errors.length === 0 ? 0 : 1,
	};
}

/** Read `messages.ts`/`en.ts`/`zh.ts` from `directory` and check them. */
export async function checkCatalogueDirectory(directory: string): Promise<GateOutcome> {
	const read = async (file: string): Promise<string> => Bun.file(path.join(directory, file)).text();
	const [messages, en, zh] = await Promise.all([read("messages.ts"), read("en.ts"), read("zh.ts")]);
	return checkCatalogue({
		iface: extractInterfaceKeys(messages),
		en: extractCatalogueKeys(en),
		zh: extractCatalogueKeys(zh),
	});
}

async function main(): Promise<void> {
	const directory = path.join(path.resolve(import.meta.dir, ".."), "packages/coding-agent/src/i18n");
	const outcome = await checkCatalogueDirectory(directory);
	for (const error of outcome.errors) console.error(error);
	console.log(outcome.summary);
	process.exit(outcome.exitCode);
}

if (import.meta.main) await main();

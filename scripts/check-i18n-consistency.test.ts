import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	type GateOutcome,
	checkCatalogueDirectory,
	extractCatalogueKeys,
	extractInterfaceKeys,
} from "./check-i18n-consistency";

/**
 * Catalogue consistency gate: every failure mode `check-i18n-consistency.ts`
 * claims to catch, driven through a synthetic catalogue directory so a regression
 * in the extractors cannot pass by reading the real catalogues.
 *
 * The gate only ever proved en and zh agree with *each other*; a key that never
 * made it out of the interface, a key that only one catalogue gained, an empty
 * translation, and a scan that silently found nothing were all green. Each case
 * below is one of those.
 */

const FIXTURE_DIRS: string[] = [];

/** Write a throwaway catalogue directory (`messages.ts`/`en.ts`/`zh.ts`). */
function catalogue(files: { messages?: string; en?: string; zh?: string }): Promise<GateOutcome> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-consistency-"));
	FIXTURE_DIRS.push(dir);
	for (const [name, source] of Object.entries(files)) {
		fs.writeFileSync(path.join(dir, `${name}.ts`), source ?? "");
	}
	return checkCatalogueDirectory(dir);
}

/** A catalogue object literal with one key per line. */
function entries(keys: ReadonlyArray<string | [string, string]>): string {
	return keys
		.map(entry => (typeof entry === "string" ? `\t${entry}: "value",` : `\t${entry[0]}: ${entry[1]},`))
		.join("\n");
}

function interfaceOf(keys: ReadonlyArray<string>): string {
	return ["export interface Messages {", ...keys.map(key => `\t${key}: string;`), "}"].join("\n");
}

afterAll(() => {
	for (const dir of FIXTURE_DIRS) fs.rmSync(dir, { recursive: true, force: true });
});

describe("catalogue consistency", () => {
	test("matching catalogues report the counts and exit 0", async () => {
		const outcome = await catalogue({
			messages: interfaceOf(["cmdFoo", "cmdBar"]),
			en: entries(["cmdFoo", "cmdBar"]),
			zh: entries(["cmdFoo", "cmdBar"]),
		});
		expect(outcome.summary).toBe("interface: 2, en: 2, zh: 2, failures: 0");
		expect(outcome.errors).toEqual([]);
		expect(outcome.exitCode).toBe(0);
	});

	test("an interface key missing from en is a failure", async () => {
		const outcome = await catalogue({
			messages: interfaceOf(["cmdFoo", "cmdBar"]),
			en: entries(["cmdFoo"]),
			zh: entries(["cmdFoo", "cmdBar"]),
		});
		expect(outcome.errors).toEqual(["messages-only (missing en): cmdBar"]);
		expect(outcome.exitCode).toBe(1);
	});

	test("an interface key missing from zh is a failure", async () => {
		const outcome = await catalogue({
			messages: interfaceOf(["cmdFoo"]),
			en: entries(["cmdFoo"]),
			zh: entries([]),
		});
		expect(outcome.errors).toEqual(["messages-only (missing zh): cmdFoo"]);
	});

	test("a key present in en but absent from the interface is a failure", async () => {
		const outcome = await catalogue({
			messages: interfaceOf(["cmdFoo"]),
			en: entries(["cmdFoo", "cmdExtra"]),
			zh: entries(["cmdFoo"]),
		});
		expect(outcome.errors).toEqual(["en-only (missing in messages interface): cmdExtra"]);
	});

	test("a key present in zh only is a failure", async () => {
		const outcome = await catalogue({
			messages: interfaceOf(["cmdFoo"]),
			en: entries(["cmdFoo"]),
			zh: entries(["cmdFoo", "cmdGhost"]),
		});
		expect(outcome.errors).toEqual(["zh-only (missing in messages interface): cmdGhost"]);
	});

	test("a zh entry whose value fell off is a failure", async () => {
		// The key is present in all three files but carries no value at all (no
		// same-line value, no continuation): the translation silently disappeared.
		// A deliberate `""` is NOT flagged — Chinese plurals legitimately resolve to
		// an empty suffix (`ftPluralS`, `agwPluralS` in `zh.ts`).
		const outcome = await catalogue({
			messages: interfaceOf(["cmdFoo", "cmdGone"]),
			en: entries(["cmdFoo", "cmdGone"]),
			zh: ['\tcmdFoo: "value",', "\tcmdGone:", "", "};"].join("\n"),
		});
		expect(outcome.errors).toEqual(["zh empty value: cmdGone"]);
	});

	test("a scan that finds no keys is a failure, not a green no-op", async () => {
		// A catalogue file that parses to nothing is a broken scan, not a clean
		// tree, so the gate must fail even though every set is trivially equal.
		const outcome = await catalogue({
			messages: "export interface Messages {}",
			en: "export const en = {};",
			zh: "export const zh = {};",
		});
		expect(outcome.summary).toBe("interface: 0, en: 0, zh: 0, failures: 1");
		expect(outcome.errors).toEqual(["no catalogue keys found — scan scope is broken"]);
		expect(outcome.exitCode).toBe(1);
	});

	test("extractors read indented members only, values included", () => {
		expect([...extractInterfaceKeys(interfaceOf(["cmdFoo", "Fn"]))]).toEqual(["cmdFoo", "Fn"]);
		expect([...extractCatalogueKeys(entries(["cmdFoo"]))]).toEqual([["cmdFoo", '"value",']]);
		// A value continued on the next line still counts as present and non-empty.
		expect(extractCatalogueKeys('\tcmdLong:\n\t\t"a long value",').get("cmdLong")).toBe('"a long value",');
	});
});

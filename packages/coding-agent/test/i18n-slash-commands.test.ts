import { afterEach, describe, expect, test } from "bun:test";
import { currentLanguage, M, setLanguage } from "../src/i18n";
import { en } from "../src/i18n/en";
import { zh } from "../src/i18n/zh";
import { BUILTIN_SLASH_COMMAND_DEFS } from "../src/slash-commands/builtin-registry";

/**
 * Anti-regression probe for the CLI /command zh localization (v18.1.5 base).
 *
 * Contract: every builtin slash command — including subcommands — must have a
 * Chinese description in the zh catalogue and the original English text in the
 * en catalogue. Upstream OMP adds new commands with hardcoded English strings
 * regularly; this probe turns that drift into a red CI run instead of a silent
 * regression (the v17.2.11 lesson: tests are contract, not ours-vs-theirs text).
 *
 * Note: BUILTIN_SLASH_COMMAND_DEFS snapshots description VALUES at import time
 * (language = whatever the loader detected), so the zh assertions compare
 * catalogue KEYS instead of the snapshot; the en assertions validate the
 * snapshot itself.
 */

const hasCjk = (s: string) => /[\u4e00-\u9fff]/.test(s);

/**
 * Descriptions exempt from catalogue reverse-lookup. Only empty or dynamically
 * composed descriptions may be listed here — a static description in any
 * language must live in the catalogues so `/language` can translate it. The
 * bundled /init file command is not part of this registry; its zh description
 * is overlaid at read time in src/task/commands.ts.
 */
const DESCRIPTION_ALLOWLIST: ReadonlySet<string> = new Set<string>([]);

/** The registry snapshot captured descriptions at import time with the
 * system-detected language, so map each DEFS description back to its en
 * catalogue key via the en catalogue values (language-independent). */
function referencedCmdKeys(): { key: string; via: string }[] {
	// The registry snapshot captured description VALUES at import time in the
	// system-detected language. Map each description back to its catalogue key
	// via either catalogue, then verify BOTH catalogues define the key.
	const enValues = new Map<string, string>();
	for (const [k, v] of Object.entries(en)) {
		if (k.startsWith("cmd") && typeof v === "string") enValues.set(v, k);
	}
	const zhValues = new Map<string, string>();
	for (const [k, v] of Object.entries(zh)) {
		if (k.startsWith("cmd") && typeof v === "string") zhValues.set(v, k);
	}
	const keys: { key: string; via: string }[] = [];
	for (const cmd of BUILTIN_SLASH_COMMAND_DEFS) {
		const k = enValues.get(cmd.description) ?? zhValues.get(cmd.description);
		if (k) keys.push({ key: k, via: `/${cmd.name}` });
		for (const sub of cmd.subcommands ?? []) {
			const sk = enValues.get(sub.description) ?? zhValues.get(sub.description);
			if (sk) keys.push({ key: sk, via: `/${cmd.name} ${sub.name}` });
		}
	}
	return keys;
}

/** Every description (main + subcommand) must resolve to a catalogue key via
 * either catalogue, or be explicitly allowlisted. Returns the violations. */
function hardcodedDescriptions(): { via: string; description: string }[] {
	const enValues = new Map<string, string>();
	for (const [k, v] of Object.entries(en)) {
		if (typeof v === "string") enValues.set(v, k);
	}
	const zhValues = new Map<string, string>();
	for (const [k, v] of Object.entries(zh)) {
		if (typeof v === "string") zhValues.set(v, k);
	}
	const violations: { via: string; description: string }[] = [];
	const check = (via: string, description: string) => {
		if (enValues.has(description) || zhValues.has(description)) return;
		if (DESCRIPTION_ALLOWLIST.has(via)) return;
		violations.push({ via, description });
	};
	for (const cmd of BUILTIN_SLASH_COMMAND_DEFS) {
		check(`/${cmd.name}`, cmd.description);
		for (const sub of cmd.subcommands ?? []) {
			check(`/${cmd.name} ${sub.name}`, sub.description);
		}
	}
	return violations;
}

afterEach(() => setLanguage("en"));

describe("builtin slash command zh localization", () => {
	test("commands exist and descriptions are non-empty", () => {
		expect(BUILTIN_SLASH_COMMAND_DEFS.length).toBeGreaterThan(40);
		for (const cmd of BUILTIN_SLASH_COMMAND_DEFS) {
			expect(cmd.description.length, `/${cmd.name} description empty`).toBeGreaterThan(0);
		}
	});

	test("registry descriptions resolve to en catalogue keys", () => {
		expect(referencedCmdKeys().length).toBeGreaterThan(40);
	});

	test("no hardcoded descriptions: every registry description maps to a catalogue key", () => {
		const violations = hardcodedDescriptions();
		expect(
			violations,
			`hardcoded descriptions bypass /language (add M.cmd* keys or, for genuinely\n` +
				`dynamic/empty descriptions, the DESCRIPTION_ALLOWLIST):\n` +
				violations.map(v => `${v.via}: ${JSON.stringify(v.description)}`).join("\n"),
		).toEqual([]);
	});

	test("zh: every registry-referenced cmd key has a CJK value in zh catalogue", () => {
		setLanguage("zh");
		const failures: string[] = [];
		for (const { key, via } of referencedCmdKeys()) {
			const zhValue = (zh as Record<string, unknown>)[key];
			if (typeof zhValue !== "string" || !hasCjk(zhValue)) {
				failures.push(`${via} -> ${key}: ${String(zhValue)}`);
			}
		}
		expect(failures, `zh catalogue missing/untranslated:\n${failures.join("\n")}`).toEqual([]);
	});

	test("en: catalogue values for registry keys stay English (no CJK)", () => {
		setLanguage("en");
		const failures: string[] = [];
		for (const { key, via } of referencedCmdKeys()) {
			const enValue = (en as Record<string, unknown>)[key];
			if (typeof enValue !== "string" || hasCjk(enValue)) {
				failures.push(`${via} -> ${key}: ${String(enValue)}`);
			}
		}
		expect(failures, `CJK leaked into en catalogue:\n${failures.join("\n")}`).toEqual([]);
	});

	test("zh snapshot test: descriptions re-resolved through M proxy are zh", () => {
		setLanguage("zh");
		const failures: string[] = [];
		for (const { key, via } of referencedCmdKeys()) {
			const value = (M as unknown as Record<string, string>)[key];
			if (typeof value !== "string" || !hasCjk(value)) {
				failures.push(`${via} -> ${key}: ${String(value)}`);
			}
		}
		expect(failures, `M proxy not zh:\n${failures.join("\n")}`).toEqual([]);
	});

	test("language switching round-trips", () => {
		setLanguage("zh");
		expect(currentLanguage()).toBe("zh");
		setLanguage("en");
		expect(currentLanguage()).toBe("en");
	});
});

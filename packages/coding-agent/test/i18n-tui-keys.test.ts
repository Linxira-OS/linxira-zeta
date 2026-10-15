import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { en } from "../src/i18n/en";
import { zh } from "../src/i18n/zh";

/**
 * S2 guard: every `tuiText` key passed by `packages/tui` must resolve to a real
 * catalogue entry.
 *
 * ## The mechanism being guarded
 *
 * pi-tui cannot import the coding-agent catalogue (dependency direction:
 * coding-agent -> pi-tui), so every user-visible string in a tui component goes
 * through `tuiText(key, englishFallback)` / `tuiTextFmt(key, fallback, …)`; the
 * host registers a text source (`packages/coding-agent/src/i18n/wire-tui.ts`)
 * and `packages/tui/src/i18n.ts` returns
 *
 *     textSource?.(key) ?? fallback
 *
 * That `??` is the hazard: a typo'd key, or a key that was never added to the
 * catalogue, renders the inline English in *every* language — no error, no
 * warning, and no visible difference in the English UI. Nothing inside either
 * package can catch it: pi-tui cannot see the catalogue, and the catalogue
 * cannot see the call sites. Walking the tui sources and cross-checking the
 * extracted keys is the only mechanical check available.
 *
 * ## Measured (before this guard existed)
 *
 * `packages/tui/src/**` holds 341 `tuiText`/`tuiTextFmt` call sites across 38
 * files, of which 285 pass a string literal (the remaining ones pass a
 * conditional branch, e.g. `tuiTextFmt(count === 1 ? "todoReminderHeaderOneFmt"
 * : "…ManyFmt", …)`, whose keys are covered by the same catalogue entries but are
 * not extracted here). All 285 exist in `en` and `zh`, and every zh value
 * differs from its en counterpart except the four language-neutral proper nouns
 * below — so this guard is green on arrival; its job is to stay green.
 *
 * The one dynamic family is `` tuiText(`tip${entry.line}`) `` in
 * `prompt/welcome.ts`, pinned below and structurally covered by
 * `test/i18n-tips-coverage.test.ts` against `prompt/tips.txt`.
 */

const TUI_SRC = path.resolve(import.meta.dir, "..", "..", "..", "packages/tui/src");

/** Repo-relative label for failure messages (absolute paths do not travel). */
const TUI_SRC_LABEL = "packages/tui/src";

/**
 * `packages/tui/src/i18n.ts` *defines* the bridge; its `tuiText(key: string, …)`
 * signatures would otherwise be read as call sites and report `key` itself as a
 * fake key.
 */
const BRIDGE_MODULE = path.join(TUI_SRC, "i18n.ts");

/** A broken scanner (bad glob, bad regex) must fail loudly, not pass vacuously. */
const MIN_LITERAL_KEYS = 250;

/**
 * Proper nouns and language-neutral tokens: the zh value is intentionally the
 * same as the English one. Anything else with an identical zh value is an
 * untranslated entry, not a style choice.
 */
const LANGUAGE_NEUTRAL: Record<string, string> = {
	composerShapeClaudeLabel: 'product name ("Claude Code")',
	composerShapePiLabel: 'product name ("Pi")',
	setupThemeLightLabel: 'theme name ("Light")',
	setupThemeTitaniumLabel: 'theme name ("Titanium")',
};

/** Template-literal key families; a new one needs an entry here AND a real guard. */
const DYNAMIC_KEY_FAMILIES: readonly string[] = ["tip"];

const CALL_SITE = /\btuiText(?:Fmt)?\(\s*"([^"]+)"/g;
const TEMPLATE_CALL_SITE = /\btuiText(?:Fmt)?\(\s*`([^`$]*)\$\{/g;

function walkSources(root: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const full = path.join(root, entry.name);
		if (entry.isDirectory()) files.push(...walkSources(full));
		else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
	}
	return files;
}

interface KeySites {
	/** key -> `file:line` of the first call site that passes it as a literal. */
	literal: Map<string, string>;
	/** template-literal prefixes (`` `tip${…}` `` -> `tip`). */
	families: Set<string>;
}

function collectKeySites(): KeySites {
	const literal = new Map<string, string>();
	const families = new Set<string>();
	for (const file of walkSources(TUI_SRC)) {
		if (file === BRIDGE_MODULE) continue;
		const text = fs.readFileSync(file, "utf8");
		const label = path
			.relative(path.resolve(TUI_SRC, "..", "..", ".."), file)
			.split(path.sep)
			.join("/");
		for (const match of text.matchAll(CALL_SITE)) {
			const line = text.slice(0, match.index).split("\n").length;
			if (!literal.has(match[1])) literal.set(match[1], `${label}:${line}`);
		}
		for (const match of text.matchAll(TEMPLATE_CALL_SITE)) {
			families.add(match[1]);
		}
	}
	return { literal, families };
}

describe("pi-tui text keys resolve in the catalogue", () => {
	test("every literal tuiText key exists in en and zh", () => {
		const { literal } = collectKeySites();
		expect(literal.size, `${TUI_SRC_LABEL} scan is broken: only ${literal.size} literal keys`).toBeGreaterThanOrEqual(
			MIN_LITERAL_KEYS,
		);
		const offenders: string[] = [];
		for (const [key, site] of literal) {
			if (!(key in en)) offenders.push(`en.${key} missing  <- ${site}`);
			else if (!(key in zh)) offenders.push(`zh.${key} missing  <- ${site}`);
			else if (String(zh[key as keyof typeof zh]).trim() === "") offenders.push(`zh.${key} empty  <- ${site}`);
		}
		expect(offenders).toEqual([]);
	});

	test("translatable tuiText keys are not shipped as English copies", () => {
		const { literal } = collectKeySites();
		const offenders = [...literal]
			.filter(([key]) => !(key in LANGUAGE_NEUTRAL))
			.filter(([key]) => en[key as keyof typeof en] === zh[key as keyof typeof zh])
			.map(([key, site]) => `${key}  <- ${site}`);
		expect(offenders).toEqual([]);
	});

	test("dynamic key families are exactly the pinned list", () => {
		const { families } = collectKeySites();
		expect([...families].sort()).toEqual([...DYNAMIC_KEY_FAMILIES].sort());
	});
});

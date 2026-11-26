import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { en } from "../src/i18n/en";
import { zh } from "../src/i18n/zh";

/**
 * S2 guard: every `tuiText` key passed by the terminal UI must resolve to a
 * real catalogue entry.
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
 * cannot see the call sites. Walking both source trees and cross-checking the
 * extracted keys is the only mechanical check available.
 *
 * ## Measured (19.2 reactive rewrite)
 *
 * The rewrite moved the terminal UI out of `packages/tui/src` into
 * `packages/coding-agent/src` (`modes/view-model`, `ui`, and the transcript/
 * command helpers). Call sites therefore span both roots. Most of the new
 * reactive components still paint inline English instead of going through the
 * bridge, so the literal set is 56 keys today (the pre-rewrite tree had 285);
 * `MIN_LITERAL_KEYS` only needs to catch a scanner that stops finding sites at
 * all, not to assert the old coverage.
 *
 * The one dynamic family is `` tuiText(`tip${line}`) `` in
 * `src/ui/welcome/tips.ts`, where the line number is the catalogue key suffix;
 * `test/i18n-tips-coverage.test.ts` guards that family against `tips.txt`.
 */

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const TUI_SRC = path.join(REPO_ROOT, "packages", "tui", "src");
const HOST_SRC = path.resolve(import.meta.dir, "..", "src");

/** Both trees that call the host bridge (see the header). */
const SCAN_ROOTS: readonly string[] = [TUI_SRC, HOST_SRC];

/** Repo-relative label for failure messages (absolute paths do not travel). */
const SCAN_LABEL = "packages/tui/src + packages/coding-agent/src";

/**
 * `packages/tui/src/i18n.ts` *defines* the bridge; its `tuiText(key: string, …)`
 * signatures would otherwise be read as call sites and report `key` itself as a
 * fake key.
 */
const BRIDGE_MODULE = path.join(TUI_SRC, "i18n.ts");

/** A broken scanner (bad glob, bad regex) must fail loudly, not pass vacuously. */
const MIN_LITERAL_KEYS = 50;

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
		else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) files.push(full);
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
	for (const root of SCAN_ROOTS) {
		for (const file of walkSources(root)) {
			if (file === BRIDGE_MODULE) continue;
			const text = fs.readFileSync(file, "utf8");
			const label = path.relative(REPO_ROOT, file).split(path.sep).join("/");
			for (const match of text.matchAll(CALL_SITE)) {
				const line = text.slice(0, match.index).split("\n").length;
				if (!literal.has(match[1])) literal.set(match[1], `${label}:${line}`);
			}
			for (const match of text.matchAll(TEMPLATE_CALL_SITE)) {
				families.add(match[1]);
			}
		}
	}
	return { literal, families };
}

describe("pi-tui text keys resolve in the catalogue", () => {
	test("every literal tuiText key exists in en and zh", () => {
		const { literal } = collectKeySites();
		expect(literal.size, `${SCAN_LABEL} scan is broken: only ${literal.size} literal keys`).toBeGreaterThanOrEqual(
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

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { en } from "../src/i18n/en";

/**
 * Orphan-key guard: every key in the message catalogue must have a call site.
 *
 * ## Why this guard exists
 *
 * `messages.test.ts` and `scripts/check-i18n-consistency.ts` pin the three
 * catalogue files to *each other* (messages interface == en == zh, no empty zh
 * value). Nothing pinned a key to the product, so the tree carried a generated
 * block of slash-command keys that no code ever read: measured before this
 * guard, **221 of 510 `cmd*` keys** had zero references anywhere in the
 * repository (packages, plugins, scripts, web-ui, docs). Two failure modes came
 * out of that:
 *
 *   - the visible bug — `cmdInitGenerateAgentsMd` and 21 `cmd*Acp` keys existed
 *     in en **and** zh while `/init` and 26 builtin commands still rendered
 *     their hardcoded English, because the catalogue is only as good as its
 *     call sites;
 *   - the maintenance cost — every catalogue edit had to keep 221 dead entries
 *     in lockstep across three files (the zh values were real translations, so
 *     a drift would have looked like a translation bug).
 *
 * A key that nothing references is either a missing wiring (fix the call site)
 * or dead weight (delete all three entries). Both are red here, which is the
 * point: the guard makes the *decision* mandatory.
 *
 * ## Method
 *
 * The catalogue keys are read from the live `en` object (not from a regex over
 * `messages.ts`, which `check-i18n-consistency.ts` already compares against
 * `en`). Every file in the repository is then reduced to its identifier tokens
 * and intersected with the key set — an exact, boundary-respecting match, so a
 * key named `cmdDump` is not "referenced" by `cmdDumpAcp`.
 *
 * `tipN` keys are the one dynamic family: `packages/tui/src/prompt/welcome.ts`
 * builds them as `` tuiText(`tip${entry.line}`) `` from `tips.txt`, so a literal
 * scan cannot see them. They are guarded structurally by
 * `test/i18n-tips-coverage.test.ts` (key set == tips.txt line numbers), which is
 * why the family is allowlisted here rather than left to rot.
 */

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..");

/** Catalogue files never count as a reference to their own keys. */
const CATALOGUE_FILES: Record<string, true> = { "en.ts": true, "zh.ts": true, "messages.ts": true };

/** `packages/tui/src/prompt/welcome.ts` resolves these by construction. */
const DYNAMIC_KEY_FAMILIES: readonly RegExp[] = [/^tip\d+$/];

const SKIP_DIRECTORIES: Record<string, true> = {
	node_modules: true,
	".git": true,
	// Sibling worktrees under temp/ are separate checkouts of the same repo; a
	// reference there is not a reference in this tree.
	temp: true,
	dist: true,
	build: true,
	__pycache__: true,
	".mimosa": true,
	".zed": true,
	// Session plan state (gitignored): a local plan file naming a key is not a
	// call site, and counting it made this guard pass or fail per machine.
	".zcode": true,
};

const SCANNED_EXTENSIONS: Record<string, true> = {
	".ts": true,
	".tsx": true,
	".js": true,
	".mjs": true,
	".cjs": true,
	".md": true,
};

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** Quoted string literals (the quote character included), single-line only. */
const QUOTED = /["'`][^"'`\n]*["'`]/g;

function collectSourceFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIP_DIRECTORIES[entry.name]) files.push(...collectSourceFiles(path.join(root, entry.name)));
			continue;
		}
		if (!entry.isFile() || !SCANNED_EXTENSIONS[path.extname(entry.name)]) continue;
		if (CATALOGUE_FILES[entry.name] && path.basename(path.dirname(path.join(root, entry.name))) === "i18n") continue;
		files.push(path.join(root, entry.name));
	}
	return files;
}

describe("message catalogue has no orphan keys", () => {
	test("every catalogue key is either referenced or pinned in the reviewed backlog", () => {
		const keys = Object.keys(en);
		// A truncated catalogue must fail loudly instead of scanning nothing.
		expect(keys.length).toBeGreaterThan(2500);

		const known = new Set(keys);
		const referenced = new Set<string>();
		for (const file of collectSourceFiles(REPO_ROOT)) {
			const text = fs.readFileSync(file, "utf8");
			// Identifiers cover the `M.foo` / `tuiText("foo")` forms; quoted
			// strings cover catalogue keys that contain a dot
			// (`models.originOmp`) and bracket lookups `M["foo"]`.
			for (const token of text.match(IDENTIFIER) ?? []) {
				if (known.has(token)) referenced.add(token);
			}
			for (const token of text.match(QUOTED) ?? []) {
				const body = token.slice(1, -1);
				if (known.has(body)) referenced.add(body);
			}
		}

		const orphans = keys
			.filter(key => !referenced.has(key))
			.filter(key => !DYNAMIC_KEY_FAMILIES.some(family => family.test(key)));

		// The pinned backlog is the reviewed list of keys already known to have
		// no call site (a large parked set from the port: see the coverage table).
		// New orphans fail; a pinned key that stops being an orphan also fails,
		// because that means its call site was wired (or the key deleted and the
		// baseline left behind) and the entry must go.
		const baseline = new Set(
			fs
				.readFileSync(path.join(import.meta.dir, "i18n-orphan-keys.baseline.txt"), "utf8")
				.split("\n")
				.map(line => line.trim())
				.filter(line => line !== "" && !line.startsWith("#")),
		);
		const orphanSet = new Set(orphans);
		expect(
			orphans.filter(key => !baseline.has(key)),
			"new catalogue keys with no call site — wire the call site (then the key is\n" +
				"live) or delete the entry from messages.ts, en.ts and zh.ts; a deliberately\n" +
				"parked key must be listed in test/i18n-orphan-keys.baseline.txt:",
		).toEqual([]);
		expect(
			[...baseline].filter(key => !orphanSet.has(key)).sort(),
			"stale baseline entries — these keys now HAVE a call site (or no longer exist),\n" +
				"so remove them from test/i18n-orphan-keys.baseline.txt:",
		).toEqual([]);
	}, 120_000); // default is too tight (the CI runner passes --timeout from OMP_TEST_TIMEOUT). // The scan reads every source file in the repository; `bun test`'s 5 s
});

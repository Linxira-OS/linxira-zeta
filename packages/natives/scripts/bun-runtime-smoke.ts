#!/usr/bin/env bun
/**
 * Bun runtime natives regression.
 *
 * The CI "Smoke native addons" step only proves an addon *requires* — under
 * `bun` when present, else `node` — and never calls a native export. A build
 * that dlopen's but trips inside an N-API entry point on Bun, or one that is
 * mistyped/stale in a way only a real call surfaces, still passes that step and
 * then fails much later in a test shard, or is silently downgraded to Node.
 * The product is Bun-only, so "the addons actually work on Bun" has to be a
 * blocking contract of its own.
 *
 * This script runs a bounded, hermetic set of real native operations — a line
 * diff, the PCRE2 matcher, the hashline hash, tiktoken BPE counting, the
 * syntect language table, and an async HTML→Markdown task through the addon's
 * Tokio runtime — against each addon path given on argv, and exits non-zero on
 * the first mismatch. No filesystem fixtures, no network.
 *
 * Usage: bun packages/natives/scripts/bun-runtime-smoke.ts <addon.node> [...]
 */
import { createRequire } from "node:module";
import * as path from "node:path";

const require_ = createRequire(import.meta.url);

/** Assertion helper: narrows `condition` and throws a labeled failure. */
function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface DiffChange {
	readonly value: string;
	readonly count: number;
	readonly added: boolean;
	readonly removed: boolean;
}

/**
 * Exercise every curated export of one addon. `addon` is the raw N-API export
 * table, so this sees exactly what the runtime exposes — not the workspace
 * loader's `missingNativeExport` stubs.
 */
async function checkAddon(addonPath: string): Promise<void> {
	const addon = require_(addonPath) as Record<string, unknown>;

	// A release addon carries the version stamp written post-link by
	// `scripts/stamp-native-version.ts`; the loader validates it only when
	// present. PR-path addons come from main's addon cache or the npm release
	// tarball, so an unstamped (legacy) addon is a supported state — the export
	// must exist and return `string | null`, nothing more.
	const buildVersion = addon.__piNativesBuildVersion;
	check(typeof buildVersion === "function", "addon does not export __piNativesBuildVersion");
	const stamp = buildVersion();
	check(
		stamp === null || (typeof stamp === "string" && stamp.length > 0),
		`addon reports a malformed build stamp: ${String(stamp)}`,
	);

	// The Rust module init deliberately defers building the Tokio runtime until
	// dlopen returns; call it before any async native runs.
	const installRuntime = addon.__ompInstallTokioRuntime;
	if (typeof installRuntime === "function") installRuntime();

	// 1. Pure Myers line diff (jsdiff `diffLines` parity).
	const diffLines = addon.diffLines;
	check(typeof diffLines === "function", "addon does not export diffLines");
	const changes = diffLines("alpha\nbeta\ngamma\n", "alpha\nBETA\ngamma\n") as DiffChange[];
	check(
		changes.some(change => change.added && change.value.includes("BETA")),
		"diffLines did not report the inserted line",
	);
	check(
		changes.some(change => change.removed && change.value.includes("beta")),
		"diffLines did not report the removed line",
	);

	// 2. PCRE2 regex matcher (real engine, not a JS fallback).
	const hasMatch = addon.hasMatch;
	check(typeof hasMatch === "function", "addon does not export hasMatch");
	check(hasMatch("hello world", "w.rld") === true, "hasMatch missed a matchable pattern");
	check(hasMatch("hello world", "^world") === false, "hasMatch matched an anchored pattern that cannot match");

	// 3. Content hash used by hashline recovery (4 hex digits).
	const hashlineFileHash = addon.hashlineFileHash;
	check(typeof hashlineFileHash === "function", "addon does not export hashlineFileHash");
	const hash = hashlineFileHash("bun runtime smoke\n");
	check(typeof hash === "string" && /^[0-9a-fA-F]{4}$/.test(hash), `hashlineFileHash returned ${String(hash)}`);

	// 4. Embedded tiktoken BPE counter.
	const countTokens = addon.countTokens;
	check(typeof countTokens === "function", "addon does not export countTokens");
	check(countTokens("the quick brown fox") > 0, "countTokens returned a non-positive count");

	// 5. Syntect language table (embedded syntax assets).
	const getSupportedLanguages = addon.getSupportedLanguages;
	check(typeof getSupportedLanguages === "function", "addon does not export getSupportedLanguages");
	const languages = getSupportedLanguages() as string[];
	check(languages.includes("Rust"), "getSupportedLanguages lost the Rust grammar");

	// 6. Async task through the addon's Tokio runtime (napi async_work path).
	const htmlToMarkdown = addon.htmlToMarkdown;
	check(typeof htmlToMarkdown === "function", "addon does not export htmlToMarkdown");
	const markdown = await htmlToMarkdown("<h1>Bun</h1><p>native</p>");
	check(typeof markdown === "string" && markdown.includes("Bun"), `htmlToMarkdown returned ${String(markdown)}`);

	console.log(`OK ${path.basename(addonPath)} (stamp ${stamp ?? "unstamped"})`);
}

const addonPaths = process.argv.slice(2);
if (addonPaths.length === 0) {
	console.error("usage: bun packages/natives/scripts/bun-runtime-smoke.ts <addon.node> [...]");
	process.exit(2);
}

console.log(`Bun ${Bun.version} native addon regression (${addonPaths.length} addon(s))`);
for (const addonPath of addonPaths) {
	await checkAddon(path.resolve(addonPath));
}
console.log(`All ${addonPaths.length} addon(s) passed real native operations on Bun.`);

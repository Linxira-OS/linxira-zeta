import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { AnnotateCommand } from "../extensibility/custom-commands/bundled/annotate";
import { GreenCommand } from "../extensibility/custom-commands/bundled/ci-green";
import { ReviewCommand } from "../extensibility/custom-commands/bundled/review";
import type { CustomCommandAPI } from "../extensibility/custom-commands/types";
import { BUILTIN_SLASH_COMMANDS_INTERNAL } from "../slash-commands/builtin-registry";
import { EMBEDDED_COMMAND_DESCRIPTION_KEYS, EMBEDDED_COMMANDS } from "../task/embedded-commands";

/**
 * Guard: every command description that reaches a user-visible command list MUST
 * be resolved against the i18n catalogue at read time, never frozen as an
 * English literal.
 *
 * ## Why this guard exists
 *
 * Measured on the pre-fix tree: 26 of 37 `acpDescription` sites were hardcoded
 * English while the matching `cmd*Acp` keys already existed in `en.ts`/`zh.ts`
 * (21 of them referenced by nothing at all), `/init` read its description from
 * markdown frontmatter while `cmdInitGenerateAgentsMd` sat unused, and the
 * bundled custom commands could not follow `/language` at all because their
 * type was `description: string`. A translated catalogue is worthless when no
 * call site reads it, so this file guards *registration*; the catalogues
 * themselves are guarded by `messages.test.ts` and
 * `scripts/check-i18n-consistency.ts`, and the reverse direction (a catalogue
 * key with no call site) by `test/i18n-message-references.test.ts`.
 *
 * ## Accepted forms
 *
 *   - a thunk     `description: () => M.cmdFoo`
 *   - an accessor `get description() { return M.cmdFoo... }`
 *
 * A plain string literal fails: it cannot follow `/language` and ships as
 * English on a Chinese UI.
 *
 * ## Registry set
 *
 * The describe blocks below are one entry per registration point; adding a
 * registry (a new `registerCommand` host, a new bundled command family, a new
 * embedded template directory) means adding a case, not rewriting the guard.
 * Surfaces that carry user-visible copy but are deliberately NOT gated here are
 * listed in the final test of this file with a reason and a pinned count, so
 * widening or narrowing that hole shows up in review.
 * `scripts/check-i18n-commands.ts` is the CLI-side twin (same rules, static
 * scan, runs in CI before the test buckets).
 */

/** A description that resolves lazily: a thunk, or a getter accessor. */
function isResolvedAtReadTime(value: unknown, owner: object, key: string): boolean {
	if (typeof value === "function") return true;
	const descriptor = Object.getOwnPropertyDescriptor(owner, key);
	return typeof descriptor?.get === "function";
}

const REGISTER_COMMAND = "registerCommand(";

/**
 * Every `description:` property inside `source`, with the brace depth it sits at
 * (0 = the options object's own property, > 0 = nested, e.g. an
 * `AutocompleteItem` hint) and its raw value expression.
 *
 * Quote- and bracket-aware rather than a lookahead window: the earlier
 * `window.slice(index, index + 600)` heuristic reported
 * `src/autoresearch/index.ts:133` — where the literal belongs to a nested
 * argument-completion item, not to the command — and a guard that cries wolf
 * gets disabled instead of fixed.
 */
function descriptionProperties(source: string): Array<{ depth: number; value: string; index: number }> {
	const found: Array<{ depth: number; value: string; index: number }> = [];
	let depth = 0;
	let quote: string | null = null;
	for (let index = 0; index < source.length; index++) {
		const char = source[index];
		if (quote) {
			if (char === "\\") index++;
			else if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "{" || char === "(" || char === "[") {
			depth++;
			continue;
		}
		if (char === "}" || char === ")" || char === "]") {
			depth--;
			continue;
		}
		const match = /^description\s*:\s*/.exec(source.slice(index, index + 16));
		if (!match) continue;
		const valueStart = index + match[0].length;
		let end = valueStart;
		let inner = 0;
		let innerQuote: string | null = null;
		for (; end < source.length; end++) {
			const c = source[end];
			if (innerQuote) {
				if (c === "\\") end++;
				else if (c === innerQuote) innerQuote = null;
				continue;
			}
			if (c === '"' || c === "'" || c === "`") {
				innerQuote = c;
				continue;
			}
			if (c === "{" || c === "(" || c === "[") inner++;
			else if (c === "}" || c === ")" || c === "]") inner--;
			else if (inner === 0 && (c === "," || c === "\n")) break;
		}
		found.push({ depth, value: source.slice(valueStart, end).trim(), index });
		index = end - 1;
	}
	return found;
}

/** The `( … )` argument text of the call whose `(` sits at `openParen`, or null when unbalanced. */
function callArguments(source: string, openParen: number): string | null {
	let depth = 0;
	let quote: string | null = null;
	for (let index = openParen; index < source.length; index++) {
		const char = source[index];
		if (quote) {
			if (char === "\\") index++;
			else if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "(") depth++;
		else if (char === ")") {
			depth--;
			if (depth === 0) return source.slice(openParen + 1, index);
		}
	}
	return null;
}

interface CallSiteScan {
	/** `description:` literals that belong to the call's own options object. */
	violations: Array<{ line: number; value: string }>;
	/** `description:` literals nested inside it (argument-completion hints). */
	nested: Array<{ line: number; value: string }>;
	sites: number;
}

/**
 * Scan one file for `registerCommand(name, { … })` call sites whose own
 * `description` is a string literal.
 *
 * The scan is bounded to each call's argument list (`callArguments`), so a
 * literal belonging to a later call can never be blamed on this one, and the
 * options object's own property is exactly depth 1 (`name` + the object).
 *
 * A `registerCommand` *declaration* (`extensibility/extensions/types.ts`,
 * `hooks/types.ts`) has no object argument; its `description?: string |
 * (() => string)` property is an interface member, not a depth-1 value, so it
 * cannot be reported here.
 */
function scanRegisterCommandSites(source: string): CallSiteScan {
	const violations: Array<{ line: number; value: string }> = [];
	const nested: Array<{ line: number; value: string }> = [];
	let sites = 0;
	let index = source.indexOf(REGISTER_COMMAND);
	while (index !== -1) {
		sites++;
		const args = callArguments(source, index + REGISTER_COMMAND.length - 1);
		if (args !== null) {
			for (const property of descriptionProperties(args)) {
				const line = source.slice(0, index + REGISTER_COMMAND.length + property.index).split("\n").length;
				if (property.depth === 1) {
					if (/^["'`]/.test(property.value)) violations.push({ line, value: property.value });
				} else if (property.depth > 1 && /^["'`]/.test(property.value)) {
					nested.push({ line, value: property.value });
				}
			}
		}
		index = source.indexOf(REGISTER_COMMAND, index + 1);
	}
	return { violations, nested, sites };
}

function walkSources(root: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const full = path.join(root, entry.name);
		if (entry.isDirectory()) files.push(...walkSources(full));
		else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
	}
	return files;
}

/** Repo-relative, forward-slashed: `path.relative` yields `\` on Windows. */
function relativeTo(root: string, file: string): string {
	return path.relative(root, file).split(path.sep).join("/");
}

describe("command descriptions go through the catalogue", () => {
	test("built-in slash command descriptions and ACP descriptions are thunks or accessors", () => {
		const offenders: string[] = [];
		for (const command of BUILTIN_SLASH_COMMANDS_INTERNAL) {
			if (!isResolvedAtReadTime(command.description, command, "description")) {
				offenders.push(`/${command.name} (description)`);
			}
			if (
				command.acpDescription !== undefined &&
				!isResolvedAtReadTime(command.acpDescription, command, "acpDescription")
			) {
				offenders.push(`/${command.name} (acpDescription)`);
			}
			for (const subcommand of command.subcommands ?? []) {
				if (!isResolvedAtReadTime(subcommand.description, subcommand, "description")) {
					offenders.push(`/${command.name} ${subcommand.name}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	test("bundled custom command descriptions are thunks", () => {
		// The bundled factories only touch their API in `execute`, so an empty
		// stand-in is safe for reading the description metadata.
		const api = {} as CustomCommandAPI;
		const bundled = [new GreenCommand(api), new AnnotateCommand(api), new ReviewCommand(api)];
		const offenders = bundled
			.filter(command => typeof command.description !== "function")
			.map(command => command.name);
		expect(offenders).toEqual([]);
	});

	test("embedded workflow commands resolve their description from the catalogue", () => {
		const offenders: string[] = [];
		expect(EMBEDDED_COMMANDS.length).toBeGreaterThan(0);
		for (const template of EMBEDDED_COMMANDS) {
			const name = template.name.replace(/\.md$/, "");
			if (typeof EMBEDDED_COMMAND_DESCRIPTION_KEYS[name] !== "function") offenders.push(name);
		}
		expect(offenders).toEqual([]);
	});

	test("extension-registered commands declare description as a thunk, not a literal", () => {
		const srcRoot = path.resolve(import.meta.dir, "..");
		const violations: string[] = [];
		let sites = 0;
		for (const file of walkSources(srcRoot)) {
			const scan = scanRegisterCommandSites(fs.readFileSync(file, "utf8"));
			sites += scan.sites;
			for (const violation of scan.violations) {
				violations.push(`${relativeTo(srcRoot, file)}:${violation.line} ${violation.value}`);
			}
		}
		// Zero call sites means the scan is broken, not that the tree is clean.
		expect(sites, "registerCommand scan found no call sites — scan scope is broken").toBeGreaterThanOrEqual(3);
		expect(violations).toEqual([]);
	});

	test("nested argument-completion hints are the only excluded in-src description surface", () => {
		// `AutocompleteItem.description` reaches a *dropdown row*, not a command
		// list; the hint text is a different surface with no `M.*` family today
		// (tracked by the coverage table). Pinned so the exclusion is a recorded
		// list of live sites rather than an open-ended allowlist.
		const srcRoot = path.resolve(import.meta.dir, "..");
		const sites: string[] = [];
		for (const file of walkSources(srcRoot)) {
			const scan = scanRegisterCommandSites(fs.readFileSync(file, "utf8"));
			for (const hint of scan.nested) {
				sites.push(`${relativeTo(srcRoot, file)}:${hint.line}`);
			}
		}
		expect(sites).toEqual(["autoresearch/index.ts:133", "autoresearch/index.ts:137"]);
	});
});

#!/usr/bin/env bun
/**
 * Gate: command descriptions must be i18n-backed, never static English.
 *
 * Surfaces and the rule each one gets:
 *
 *  - `src/slash-commands/*.ts` — the built-in command spec tables. RED when a
 *    `description:` / `*Description:` property starts with a string literal. In
 *    the `builtin-*` spec tables the value must additionally resolve through the
 *    catalogue at read time: an `M.*` reference, a thunk, a call of a thunk, or a
 *    reference into a local table whose entries are all thunks.
 *    `builtin-registry.ts`, `builtin-completions.ts` and `types.ts` are excluded:
 *    they materialize, resolve or merely declare the field.
 *  - `src/extensibility/custom-commands/bundled/<name>/index.ts` — bundled custom
 *    commands carry their copy as a *class field* (`description = "…"`), so only
 *    the `=` form is scanned; their `description:` properties belong to
 *    `AutocompleteItem`s (argument-completion hints, out of scope).
 *  - the `registerCommand(name, { … })` registration sources (extension and hook
 *    hosts, `src/autoresearch/index.ts`, `src/task/embedded-commands.ts`): only
 *    the options object's *own* top-level `description` is inspected. A literal
 *    there is RED; a literal nested deeper is an argument-completion hint and is
 *    deliberately left to `src/i18n/command-descriptions.test.ts`, which pins
 *    that excluded surface.
 *  - `src/task/embedded-commands.ts` — embedded workflow copy lives in a
 *    name-keyed map of thunks, so the gate checks thunkiness and coverage.
 *
 * Extraction is brace/quote/comment-aware rather than a character window after
 * `registerCommand(`: the earlier window heuristic reported
 * `src/autoresearch/index.ts:133`, where the literal belongs to an
 * `AutocompleteItem` nested inside the options object.
 *
 * The scanners and the report are pure functions
 * (`check-i18n-commands.test.ts` drives them against synthetic source files);
 * `main()` is the CLI wrapper.
 *
 * Usage: bun scripts/check-i18n-commands.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** A scanned source file, keyed by its path relative to `packages/coding-agent`. */
export interface SourceFile {
	file: string;
	source: string;
}

/** A `name: value` property whose name is a command description. */
export interface DescriptionSite {
	name: string;
	line: number;
	/** Bracket depth relative to the scanned region (1 = own property of the region). */
	depth: number;
	value: string;
}

/** What a gate run reports: the summary line, the diagnostics, the exit code. */
export interface GateOutcome {
	summary: string;
	errors: string[];
	exitCode: number;
}

const REGISTER_COMMAND = "registerCommand(";

const SPEC_DIR = "src/slash-commands";
const BUNDLED_DIR = "src/extensibility/custom-commands/bundled";
const EMBEDDED_DESCRIPTIONS = "src/task/embedded-commands.ts";

/** Files that materialize/resolve descriptions instead of declaring them. */
const NON_SPEC_FILES = new Set(["builtin-registry.ts", "builtin-completions.ts", "types.ts"]);

/**
 * Registration sources. Each builds a `registerCommand(name, { … })` options
 * object, so each can freeze English into a command list:
 *  - `extensions/loader.ts` — the extension host's registration API.
 *  - `extensions/types.ts` — the `ExtensionAPI` declaration those hosts satisfy.
 *  - `extensions/get-commands-handler.ts` — resolves command copy for extensions
 *    and skills; this file's own values must stay resolver calls, never literals.
 *  - `hooks/loader.ts` / `hooks/types.ts` — the hook host's twin of the above.
 *  - `autoresearch/index.ts` — the bundled plugin registering `/autoresearch`.
 */
const REGISTER_SOURCES = [
	"src/extensibility/extensions/loader.ts",
	"src/extensibility/extensions/types.ts",
	"src/extensibility/extensions/get-commands-handler.ts",
	"src/extensibility/hooks/loader.ts",
	"src/extensibility/hooks/types.ts",
	"src/autoresearch/index.ts",
];

/** The surface a scanned file belongs to; `undefined` = not a scanned surface. */
function surfaceOf(file: string): "spec" | "bundled" | "register" | "embedded" | undefined {
	if (file === EMBEDDED_DESCRIPTIONS) return "embedded";
	if (file.startsWith(`${SPEC_DIR}/`) && !NON_SPEC_FILES.has(path.posix.basename(file))) return "spec";
	if (file.startsWith(`${BUNDLED_DIR}/`) && file.endsWith("/index.ts")) return "bundled";
	if (REGISTER_SOURCES.includes(file)) return "register";
	return undefined;
}

/** Index just past the string/template literal opening at `start` (escapes and
 *  `${ … }` interpolations included). */
function skipString(source: string, start: number): number {
	const quote = source[start];
	let index = start + 1;
	while (index < source.length) {
		const char = source[index];
		if (char === "\\") {
			index += 2;
			continue;
		}
		if (char === quote) return index + 1;
		if (quote === "`" && char === "$" && source[index + 1] === "{") {
			index = skipBracketed(source, index + 1, "{", "}");
			continue;
		}
		index++;
	}
	return source.length;
}

/** Index just past the region opened by `open` at `start`, at nesting depth 0. */
function skipBracketed(source: string, start: number, open: string, close: string): number {
	let depth = 0;
	let index = start;
	while (index < source.length) {
		const char = source[index];
		if (char === '"' || char === "'" || char === "`") {
			index = skipString(source, index);
			continue;
		}
		if (char === open) depth++;
		else if (char === close) {
			depth--;
			if (depth === 0) return index + 1;
		}
		index++;
	}
	return source.length;
}

/** Index just past a `//` or block comment opening at `start`. */
function skipComment(source: string, start: number): number {
	if (source[start + 1] === "/") {
		const newline = source.indexOf("\n", start);
		return newline === -1 ? source.length : newline + 1;
	}
	const close = source.indexOf("*/", start + 2);
	return close === -1 ? source.length : close + 2;
}

/** Index where the value expression starting at `start` ends: the first `,`, `;`
 *  or newline at its own nesting level, or the bracket closing the region. */
function valueEnd(source: string, start: number): number {
	let depth = 0;
	let index = start;
	while (index < source.length) {
		const char = source[index];
		if (char === '"' || char === "'" || char === "`") {
			index = skipString(source, index);
			continue;
		}
		if (char === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
			index = skipComment(source, index);
			continue;
		}
		if (char === "{" || char === "(" || char === "[") {
			depth++;
			index++;
			continue;
		}
		if (char === "}" || char === ")" || char === "]") {
			if (depth === 0) return index;
			depth--;
			index++;
			continue;
		}
		// A blank value so far means the expression continues on the next line
		// (`description:` alone above its ternary), the idiom
		// `src/slash-commands/available-commands.ts` uses.
		if (depth === 0 && (char === "," || char === ";")) return index;
		if (depth === 0 && char === "\n" && source.slice(start, index).trim().length > 0) return index;
		index++;
	}
	return source.length;
}

/** Indices of `token` in `source` that are real code, not comments or strings. */
function codeOccurrences(source: string, token: string): number[] {
	const found: number[] = [];
	let index = 0;
	while (index < source.length) {
		const char = source[index];
		if (char === '"' || char === "'" || char === "`") {
			index = skipString(source, index);
			continue;
		}
		if (char === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
			index = skipComment(source, index);
			continue;
		}
		if (source.startsWith(token, index)) {
			found.push(index);
			index += token.length;
			continue;
		}
		index++;
	}
	return found;
}

/** True for a property name that is a command description: `description` and
 *  every `*Description` (e.g. the ACP-facing `acpDescription`). */
function isDescriptionName(name: string): boolean {
	return name === "description" || name.endsWith("Description");
}

/** Every `<name>: <value>` property in `source[regionStart, regionEnd)` that the
 *  filter accepts, with the bracket depth it sits at (1 = own property of the
 *  region's object literal). Comments, strings and templates are skipped. */
function propertySites(
	source: string,
	regionStart: number,
	regionEnd: number,
	accept: (name: string) => boolean,
): DescriptionSite[] {
	const sites: DescriptionSite[] = [];
	const region = source.slice(regionStart, regionEnd);
	let depth = 0;
	let index = 0;
	while (index < region.length) {
		const char = region[index];
		if (char === '"' || char === "'" || char === "`") {
			index = skipString(region, index);
			continue;
		}
		if (char === "/" && (region[index + 1] === "/" || region[index + 1] === "*")) {
			index = skipComment(region, index);
			continue;
		}
		if (char === "{" || char === "(" || char === "[") {
			depth++;
			index++;
			continue;
		}
		if (char === "}" || char === ")" || char === "]") {
			depth--;
			index++;
			continue;
		}
		if (/[A-Za-z_$]/.test(char)) {
			const name = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(region.slice(index))?.[0] ?? "";
			const colon = /^\s*:/.exec(region.slice(index + name.length, index + name.length + 4));
			if (accept(name) && colon) {
				const valueStart = index + name.length + colon[0].length;
				const end = valueEnd(region, valueStart);
				sites.push({
					name,
					line: source.slice(0, regionStart + index).split("\n").length,
					depth,
					value: region.slice(valueStart, end).trim(),
				});
				index = end;
				continue;
			}
			index += name.length || 1;
			continue;
		}
		index++;
	}
	return sites;
}

/** Every description property in `source`. */
export function descriptionSites(source: string): DescriptionSite[] {
	return propertySites(source, 0, source.length, isDescriptionName);
}

/** The `{ … }` options object of every `registerCommand(name, { … })` call. */
export function registerCommandOptions(source: string): Array<{ start: number; end: number }> {
	const objects: Array<{ start: number; end: number }> = [];
	for (const at of codeOccurrences(source, REGISTER_COMMAND)) {
		let depth = 1;
		let index = at + REGISTER_COMMAND.length;
		while (index < source.length) {
			const char = source[index];
			if (char === '"' || char === "'" || char === "`") {
				index = skipString(source, index);
				continue;
			}
			if (char === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
				index = skipComment(source, index);
				continue;
			}
			if (char === "{" && depth === 1) {
				objects.push({ start: index, end: skipBracketed(source, index, "{", "}") });
				break;
			}
			if (char === "(" || char === "[" || char === "{") depth++;
			else if (char === ")" || char === "]" || char === "}") {
				depth--;
				if (depth === 0) break; // declaration, or a call without an options object
			}
			index++;
		}
	}
	return objects;
}

/** The options object's *own* description properties: nested `AutocompleteItem`
 *  literals sit deeper (argument-completion hints are not command copy). */
export function registerCommandDescriptionSites(source: string): DescriptionSite[] {
	const sites: DescriptionSite[] = [];
	for (const { start, end } of registerCommandOptions(source)) {
		for (const site of propertySites(source, start, end, isDescriptionName)) {
			if (site.depth === 1) sites.push(site);
		}
	}
	return sites;
}

/** Class-field descriptions (`description = <value>;`), the form bundled custom
 *  commands use. `get description()` accessors have no `=` and are read-time by
 *  construction, so they are not fields to check. */
export function classFieldDescriptionSites(source: string): DescriptionSite[] {
	const sites: DescriptionSite[] = [];
	const pattern = /(?:^|\n)[ \t]+(?:(?:public|readonly|static)\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*/g;
	for (const match of source.matchAll(pattern)) {
		if (!isDescriptionName(match[1])) continue;
		const nameAt = match.index + match[0].lastIndexOf(match[1]);
		const valueStart = match.index + match[0].length;
		sites.push({
			name: match[1],
			line: source.slice(0, nameAt).split("\n").length,
			depth: 1,
			value: source.slice(valueStart, valueEnd(source, valueStart)).trim(),
		});
	}
	return sites;
}

/** True for a function expression: `() => x`, `async (a, b) => x`, `function () {}`. */
function isFunction(value: string): boolean {
	return /^(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/.test(value);
}

/** True when `source` declares `const NAME … = { … }` and every entry is a
 *  function expression — a table of thunks resolves per read, while a table of
 *  string literals would freeze English and must stay RED. */
function declaresThunkTable(source: string, name: string): boolean {
	const declaration = new RegExp(`(?:^|\\n)[ \\t]*(?:export\\s+)?const\\s+${name}\\b`).exec(source);
	if (!declaration) return false;
	const open = source.indexOf("{", declaration.index + declaration[0].length);
	if (open === -1) return false;
	const entries = propertySites(source, open, skipBracketed(source, open, "{", "}"), () => true).filter(
		site => site.depth === 1,
	);
	return entries.length > 0 && entries.every(entry => isFunction(entry.value));
}

/** True when the value resolves per read instead of freezing English: a catalogue
 *  reference, a thunk, a call of a thunk, or a reference into a local thunk table
 *  (the `/effort` subcommand table form). */
export function resolvedAtReadTime(value: string, source: string): boolean {
	if (/\bM\.[A-Za-z_$]/.test(value)) return true;
	if (isFunction(value)) return true;
	if (/\(\)\s*$/.test(value)) return true;
	const reference = /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\[[^\]]*\]|\.[A-Za-z_$][A-Za-z0-9_$]*)?$/.exec(value);
	return reference !== null && declaresThunkTable(source, reference[1]);
}

/** The command names `EMBEDDED_COMMANDS` registers (its entries are templates). */
function embeddedCommandNames(source: string): string[] {
	const declaration = /\bEMBEDDED_COMMANDS\b[^=]*=\s*\[/.exec(source);
	if (!declaration) return [];
	const open = declaration.index + declaration[0].length - 1;
	const templates = source.slice(open, skipBracketed(source, open, "[", "]"));
	return [...templates.matchAll(/(?:^|[\s{])name\s*:\s*"([^"]+)"/g)].map(match => match[1].replace(/\.md$/, ""));
}

/** `EMBEDDED_COMMAND_DESCRIPTION_KEYS` entries, one per embedded command. */
function embeddedDescriptionSites(source: string): DescriptionSite[] {
	const declaration = /\bEMBEDDED_COMMAND_DESCRIPTION_KEYS\b[^=]*=\s*/.exec(source);
	if (!declaration) return [];
	const open = source.indexOf("{", declaration.index + declaration[0].length);
	if (open === -1) return [];
	return propertySites(source, open, skipBracketed(source, open, "{", "}"), () => true).filter(
		site => site.depth === 1,
	);
}

/** The files this gate scans, each surface carrying the reason it is in scope. */
export async function collectSources(root: string): Promise<SourceFile[]> {
	const sources: SourceFile[] = [];
	const add = async (file: string): Promise<void> => {
		sources.push({ file, source: await Bun.file(path.join(root, file)).text() });
	};

	// `src/slash-commands/*.ts` — the built-in command spec tables.
	for (const name of fs
		.readdirSync(path.join(root, SPEC_DIR))
		.filter(entry => entry.endsWith(".ts"))
		.sort()) {
		if (NON_SPEC_FILES.has(name)) continue;
		await add(`${SPEC_DIR}/${name}`);
	}

	// `src/extensibility/custom-commands/bundled/*/index.ts` — bundled custom
	// commands, whose copy is a class field.
	for (const entry of fs
		.readdirSync(path.join(root, BUNDLED_DIR), { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => entry.name)
		.sort()) {
		await add(`${BUNDLED_DIR}/${entry}/index.ts`);
	}

	// The `registerCommand(name, { … })` registration sources.
	for (const file of REGISTER_SOURCES) await add(file);

	// `src/task/embedded-commands.ts` — embedded workflow command copy.
	await add(EMBEDDED_DESCRIPTIONS);
	return sources;
}

/** Scan every source and report the sites whose copy is frozen English. */
export function evaluateCommandDescriptions(sources: SourceFile[]): GateOutcome {
	const errors: string[] = [];
	let sites = 0;
	const report = (file: string, site: DescriptionSite, message: string): void => {
		errors.push(`${file}:${site.line}: ${message} ${site.value.split("\n")[0].slice(0, 60)}`);
	};
	const checkCopy = (file: string, site: DescriptionSite, source: string): void => {
		if (site.value.length === 0) {
			report(file, site, "description has no value expression");
			return;
		}
		if (/^["'`]/.test(site.value)) {
			report(file, site, "static description string (must be i18n-backed):");
			return;
		}
		if (path.posix.basename(file).startsWith("builtin-") && !resolvedAtReadTime(site.value, source)) {
			report(file, site, "description not catalogue-backed (expected M.*, a thunk, or a table of thunks):");
		}
	};

	for (const { file, source } of sources) {
		const surface = surfaceOf(file);
		if (surface === undefined) {
			errors.push(`unknown scan surface (not a command-description source): ${file}`);
			continue;
		}
		if (surface === "embedded") {
			const found = embeddedDescriptionSites(source);
			sites += found.length;
			for (const site of found) {
				if (site.value.length === 0 || !resolvedAtReadTime(site.value, source)) {
					report(file, site, "embedded command description is not a catalogue thunk:");
				}
			}
			for (const name of embeddedCommandNames(source)) {
				if (!found.some(site => site.name === name)) {
					errors.push(`${file}: embedded command has no description entry: ${name}`);
				}
			}
			continue;
		}
		const found =
			surface === "register"
				? registerCommandDescriptionSites(source)
				: surface === "bundled"
					? classFieldDescriptionSites(source)
					: descriptionSites(source);
		sites += found.length;
		for (const site of found) {
			if (surface === "register") {
				if (site.value.length > 0 && /^["'`]/.test(site.value)) {
					report(file, site, "static description string (must be i18n-backed):");
				}
				continue;
			}
			checkCopy(file, site, source);
		}
	}

	// Zero sites means the scan (paths, extractors) is broken, not that the tree
	// is clean: fail loudly instead of reporting a green no-op.
	if (sites === 0) errors.push("no description sites found — scan scope is broken");
	return {
		summary: `command descriptions scanned: ${sites} across ${sources.length} files, failures: ${errors.length}`,
		errors,
		exitCode: errors.length === 0 ? 0 : 1,
	};
}

async function main(): Promise<void> {
	const root = path.join(path.resolve(import.meta.dir, ".."), "packages/coding-agent");
	const outcome = evaluateCommandDescriptions(await collectSources(root));
	for (const error of outcome.errors) console.error(error);
	console.log(outcome.summary);
	process.exit(outcome.exitCode);
}

if (import.meta.main) await main();

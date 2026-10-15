import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	type GateOutcome,
	collectSources,
	classFieldDescriptionSites,
	descriptionSites,
	evaluateCommandDescriptions,
	registerCommandDescriptionSites,
	resolvedAtReadTime,
} from "./check-i18n-commands";

/**
 * Command-description gate: the sites `check-i18n-commands.ts` must report, and
 * the ones it must stay quiet about.
 *
 * The regression this file pins by name is `src/autoresearch/index.ts:133`: the
 * first version of the gate looked at a character window after every
 * `registerCommand(` and reported an `AutocompleteItem` hint nested inside the
 * options object — an argument-completion hint, not command copy. A gate that
 * cries wolf gets disabled, so the nested case is asserted GREEN here next to the
 * top-level case that is RED.
 */

const FIXTURE_DIRS: string[] = [];

const SPEC_FILE = "src/slash-commands/builtin-demo.ts";
const OTHER_SPEC_FILE = "src/slash-commands/shared.ts";
const BUNDLED_FILE = "src/extensibility/custom-commands/bundled/demo/index.ts";
const REGISTER_FILE = "src/extensibility/extensions/loader.ts";
const REGISTER_CALLS = "src/autoresearch/index.ts";
const RESOLVER_FILE = "src/extensibility/extensions/get-commands-handler.ts";
const EMBEDDED_FILE = "src/task/embedded-commands.ts";

/** A synthetic tree that is green: one description site in every surface. */
const DEFAULT_TREE: Readonly<Record<string, string>> = {
	[SPEC_FILE]: [
		'import { M } from "../i18n";',
		"export const DEMO_COMMANDS = [",
		"\t{",
		'\t\tname: "demo",',
		"\t\tdescription: () => M.cmdDemo,",
		"\t\tacpDescription: () => M.cmdDemoAcp,",
		"\t\tgetTuiAutocompleteDescription: runtime => `Demo: ${runtime.ctx.session.id}`,",
		"\t},",
		"];",
		"",
	].join("\n"),
	[OTHER_SPEC_FILE]: 'export const OTHER = [{ name: "other", description: () => M.cmdOther }];\n',
	// Declarations only: no options object, so nothing to report.
	"src/slash-commands/types.ts": "export interface SlashCommandSpec {\n\tdescription?: string;\n}\n",
	"src/extensibility/extensions/types.ts": "export interface ExtensionAPI {\n\tdescription?: string;\n}\n",
	[BUNDLED_FILE]: "export class DemoCommand {\n\tdescription = () => M.cmdDemo;\n}\n",
	[REGISTER_FILE]: [
		"export class ExtensionLoader {",
		"\tregisterCommand(",
		"\t\tname: string,",
		"\t\toptions: { description?: string | (() => string); handler: () => void },",
		"\t): void {}",
		"}",
		"",
	].join("\n"),
	[REGISTER_CALLS]: [
		'api.registerCommand("autoresearch", {',
		"\tdescription: () => M.cmdAutoresearch,",
		"\tgetArgumentCompletions(prefix: string) {",
		'\t\treturn [{ label: "off", value: "off", description: "Leave autoresearch mode" }];',
		"\t},",
		"});",
		"",
	].join("\n"),
	[RESOLVER_FILE]: [
		"export function handler(cmd) {",
		"\treturn {",
		"\t\tdescription:",
		"\t\t\tcmd.description === undefined ? undefined : resolveCommandDescription(cmd.description),",
		"\t};",
		"}",
		"",
	].join("\n"),
	[EMBEDDED_FILE]: [
		'export const EMBEDDED_COMMANDS = [{ name: "init.md", content: "x" }];',
		"export const EMBEDDED_COMMAND_DESCRIPTION_KEYS: Readonly<Record<string, () => string>> = {",
		"\tinit: () => M.cmdInit,",
		"};",
		"",
	].join("\n"),
	"src/extensibility/hooks/loader.ts": "export const HOOK_LOADER = 1;\n",
	"src/extensibility/hooks/types.ts": "export interface HookAPI {}\n",
};

/** Write `DEFAULT_TREE` with overrides into a fresh temp root. */
function writeTree(overrides: Readonly<Record<string, string>> = {}): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-commands-"));
	FIXTURE_DIRS.push(root);
	const tree = { ...DEFAULT_TREE, ...overrides };
	for (const [file, source] of Object.entries(tree)) {
		const full = path.join(root, file);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, source);
	}
	return root;
}

/** Run the real collection over a synthetic tree. */
async function scanTree(overrides: Readonly<Record<string, string>> = {}): Promise<GateOutcome> {
	return evaluateCommandDescriptions(await collectSources(writeTree(overrides)));
}

/** Scan one synthetic file without touching the tree. */
function scan(file: string, source: string): GateOutcome {
	return evaluateCommandDescriptions([{ file, source }]);
}

afterAll(() => {
	for (const dir of FIXTURE_DIRS) fs.rmSync(dir, { recursive: true, force: true });
});

describe("command description gate", () => {
	test("a tree whose descriptions all resolve is green", async () => {
		const outcome = await scanTree();
		expect(outcome.errors).toEqual([]);
		expect(outcome.exitCode).toBe(0);
		expect(outcome.summary).toMatch(/^command descriptions scanned: [1-9]\d* across \d+ files, failures: 0$/);
	});

	test("files that materialize or declare the field are not collected", async () => {
		const files = (await collectSources(writeTree())).map(source => source.file);
		expect(files).not.toContain("src/slash-commands/types.ts");
		expect(files).toContain(SPEC_FILE);
		expect(files).toContain(BUNDLED_FILE);
	});

	test("a static description literal in a spec file is red", async () => {
		const outcome = await scanTree({ [SPEC_FILE]: 'export const D = [{ description: "Demo command" }];\n' });
		expect(outcome.errors).toEqual([
			`${SPEC_FILE}:1: static description string (must be i18n-backed): "Demo command"`,
		]);
		expect(outcome.exitCode).toBe(1);
	});

	test("an acpDescription literal is red even in a non-builtin spec file", async () => {
		const outcome = await scan(OTHER_SPEC_FILE, 'export const X = [{ acpDescription: "Settings" }];\n');
		expect(outcome.errors).toEqual([
			`${OTHER_SPEC_FILE}:1: static description string (must be i18n-backed): "Settings"`,
		]);
	});

	test("an M-backed thunk is green", () => {
		const outcome = scan(OTHER_SPEC_FILE, "export const X = [{ description: () => M.cmdFoo }];\n");
		expect(outcome.errors).toEqual([]);
	});

	test("a builtin-* value that resolves nowhere is red", () => {
		const outcome = scan(SPEC_FILE, "export const X = [{ description: DESCRIPTIONS[level] }];\n");
		expect(outcome.errors).toEqual([
			`${SPEC_FILE}:1: description not catalogue-backed (expected M.*, a thunk, or a table of thunks): DESCRIPTIONS[level]`,
		]);
	});

	test("a reference into a local table of thunks is green, a table of literals is red", () => {
		const thunks = [
			"const DESCRIPTIONS: Record<string, () => string> = {",
			"\toff: () => M.cmdOff,",
			"\ton: () => M.cmdOn,",
			"};",
			"export const X = [{ description: DESCRIPTIONS[level] }];",
			"",
		].join("\n");
		expect(scan(SPEC_FILE, thunks).errors).toEqual([]);

		const literals = [
			'const DESCRIPTIONS: Record<string, string> = { off: "Turn off", on: "Turn on" };',
			"export const X = [{ description: DESCRIPTIONS[level] }];",
			"",
		].join("\n");
		expect(scan(SPEC_FILE, literals).errors.length).toBe(1);
	});

	test("a runtime-composed dropdown hint is green: it is resolved per read", () => {
		const outcome = scan(
			SPEC_FILE,
			"export const X = [{ getTuiAutocompleteDescription: runtime => `Model: ${runtime.model}` }];\n",
		);
		expect(outcome.errors).toEqual([]);
	});

	test("a registerCommand literal is red, a nested completion hint is green", () => {
		const literal = ['api.registerCommand("demo", {', '\tdescription: "Demo command",', "});", ""].join("\n");
		expect(scan(REGISTER_CALLS, literal).errors).toEqual([
			`${REGISTER_CALLS}:2: static description string (must be i18n-backed): "Demo command"`,
		]);

		// The false positive the brace/quote-aware extraction exists to avoid.
		const nested = [
			'api.registerCommand("demo", {',
			"\tdescription: () => M.cmdDemo,",
			"\tgetArgumentCompletions() {",
			'\t\treturn [{ label: "off", value: "off", description: "Leave demo mode" }];',
			"\t},",
			"});",
			"",
		].join("\n");
		const outcome = scan(REGISTER_CALLS, nested);
		expect(outcome.errors).toEqual([]);
		expect(registerCommandDescriptionSites(nested).map(site => site.line)).toEqual([2]);
	});

	test("a registerCommand declaration has no options object to read", () => {
		expect(registerCommandDescriptionSites(DEFAULT_TREE[REGISTER_FILE])).toEqual([]);
	});

	test("a bundled class-field literal is red, a thunk is green", () => {
		expect(scan(BUNDLED_FILE, 'export class C {\n\tdescription = "Demo command";\n}\n').errors).toEqual([
			`${BUNDLED_FILE}:2: static description string (must be i18n-backed): "Demo command"`,
		]);
		const outcome = scan(BUNDLED_FILE, "export class C {\n\tdescription = () => M.cmdDemo;\n}\n");
		expect(outcome.errors).toEqual([]);
		expect(classFieldDescriptionSites(DEFAULT_TREE[BUNDLED_FILE])).toHaveLength(1);
	});

	test("an embedded command description entry must be a catalogue thunk", async () => {
		const literal = DEFAULT_TREE[EMBEDDED_FILE].replace("() => M.cmdInit", '"Generate agents.md"');
		const outcome = await scanTree({ [EMBEDDED_FILE]: literal });
		expect(outcome.errors).toEqual([
			`${EMBEDDED_FILE}:3: embedded command description is not a catalogue thunk: "Generate agents.md"`,
		]);
	});

	test("an embedded command with no description entry is red", async () => {
		const missing = [
			'export const EMBEDDED_COMMANDS = [{ name: "init.md", content: "x" }, { name: "scan.md", content: "y" }];',
			"export const EMBEDDED_COMMAND_DESCRIPTION_KEYS: Readonly<Record<string, () => string>> = {",
			"\tinit: () => M.cmdInit,",
			"};",
			"",
		].join("\n");
		const outcome = await scanTree({ [EMBEDDED_FILE]: missing });
		expect(outcome.errors).toEqual([`${EMBEDDED_FILE}: embedded command has no description entry: scan`]);
	});

	test("a scan that finds no sites anywhere is a failure, not a pass", async () => {
		const blank = Object.fromEntries(Object.keys(DEFAULT_TREE).map(file => [file, "export {};\n"]));
		const outcome = await scanTree(blank);
		expect(outcome.errors).toEqual(["no description sites found — scan scope is broken"]);
		expect(outcome.exitCode).toBe(1);
		expect(evaluateCommandDescriptions([]).exitCode).toBe(1);
	});

	test("a file outside the known surfaces is reported instead of skipped", async () => {
		const outcome = evaluateCommandDescriptions([
			...(await collectSources(writeTree())),
			{ file: "src/random/whatever.ts", source: 'export const X = { description: "Demo" };\n' },
		]);
		expect(outcome.errors).toEqual([
			"unknown scan surface (not a command-description source): src/random/whatever.ts",
		]);
	});

	test("commented-out and quoted description text is not a site", () => {
		const source = [
			'// description: "Demo command"',
			'const hint = "description: \\"Demo command\\"";',
			"export const X = [{ description: () => M.cmdFoo }];",
			"",
		].join("\n");
		expect(descriptionSites(source).map(site => site.line)).toEqual([3]);
		expect(scan(OTHER_SPEC_FILE, source).errors).toEqual([]);
	});

	test("resolvedAtReadTime accepts catalogue reads and thunks, rejects literals", () => {
		expect(resolvedAtReadTime("() => M.cmdFoo", "")).toBe(true);
		expect(resolvedAtReadTime("runtime => runtime.model", "")).toBe(true);
		expect(resolvedAtReadTime("EFFORT_CMD_DESCRIPTIONS[level]()", "")).toBe(true);
		expect(resolvedAtReadTime('"Demo command"', "")).toBe(false);
		expect(resolvedAtReadTime("DESCRIPTIONS[level]", 'const DESCRIPTIONS = { off: "Turn off" };')).toBe(false);
	});
});

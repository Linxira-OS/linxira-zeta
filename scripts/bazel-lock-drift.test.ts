import { describe, expect, test } from "bun:test";
import { collectLockDriftInput, findLockDrift, type LockDriftInput } from "./bazel-lock-drift";

const WORKSPACE_TOML = [
	"[workspace]",
	'members = ["crates/pi-natives"]',
	"",
	"[workspace.dependencies]",
	'html-escape = "0.2"',
	'napi = { version = "3" }',
	'pipewire = { version = "=0.9.2", optional = true }',
	'brush-core = { version = "0.4", path = "crates/vendor/brush-core" }',
	"",
	"[patch.crates-io]",
	'napi = { path = "crates/vendor/napi" }',
	"",
].join("\n");

const CARGO_LOCK = [
	"[[package]]",
	'name = "pi-natives"',
	'version = "1.2.1"',
	"",
	"[[package]]",
	'name = "html-escape"',
	'version = "0.2.15"',
	'source = "registry+https://github.com/rust-lang/crates.io-index"',
	"",
	"[[package]]",
	'name = "napi"',
	'version = "3.0.0"',
	'source = "registry+https://github.com/rust-lang/crates.io-index"',
	"",
	"[[package]]",
	'name = "brush-core"',
	'version = "0.4.0"',
	"",
].join("\n");

const MEMBER_TOML = [
	"[package]",
	'name = "pi-natives"',
	'version = "1.2.1"',
	"",
	"[dependencies]",
	"html-escape = { workspace = true }",
	"napi = { workspace = true, optional = true }",
	"brush-core = { workspace = true }",
	"",
].join("\n");

/** Renders the `crates.bzl` dependency maps the way crate_universe does. */
function cratesBzl(memberDeps: Record<string, Record<string, string>>): string {
	const lines = ["_NORMAL_DEPENDENCIES = {"];
	for (const [member, deps] of Object.entries(memberDeps)) {
		lines.push(`    "${member}": {`, "        _COMMON_CONDITION: {");
		for (const [alias, target] of Object.entries(deps)) lines.push(`            "${alias}": Label("//${target}"),`);
		lines.push("        },", "    },");
	}
	lines.push("}", "", "_CONDITIONS = {", "}", "");
	return lines.join("\n");
}

function lockText(deps: Record<string, Record<string, string>>, renderedFiles: string[]): string {
	const contents: Record<string, string> = { "crates.bzl": cratesBzl(deps) };
	for (const file of renderedFiles) contents[file] = "# @generated\n";
	return JSON.stringify({
		lockFileVersion: 28,
		moduleExtensions: {
			"@@rules_rust+//crate_universe:extensions.bzl%crate": {
				general: { generatedRepoSpecs: { crates: { attributes: { contents } } } },
			},
		},
	});
}

function input(overrides: Partial<LockDriftInput>): LockDriftInput {
	return {
		lockText: lockText({ "crates/pi-natives": { "html-escape": "html-escape-0.2.15" } }, [
			"html-escape-0.2.15/BUILD.bazel",
		]),
		workspaceToml: WORKSPACE_TOML,
		cargoLockText: CARGO_LOCK,
		memberManifests: new Map([["crates/pi-natives", MEMBER_TOML]]),
		...overrides,
	};
}

describe("findLockDrift", () => {
	test("accepts a lock whose rendered result covers every member dependency", () => {
		expect(findLockDrift(input({}))).toEqual([]);
	});

	test("flags the crate a stale result never spliced in (the native-addon failure)", () => {
		// The lock as v18.11.1 shipped it: recorded inputs current, result stale.
		const stale = input({
			lockText: lockText({ "crates/pi-natives": {} }, ["html-escape-0.2.15/BUILD.bazel"]),
		});
		const problems = findLockDrift(stale);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("crates/pi-natives");
		expect(problems[0]).toContain("html-escape");
		expect(problems[0]).toContain("0.2.15");
	});

	test("flags an alias whose rendered BUILD.bazel is missing", () => {
		const problems = findLockDrift(
			input({ lockText: lockText({ "crates/pi-natives": { "html-escape": "html-escape-0.2.15" } }, []) }),
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("html-escape-0.2.15");
		expect(problems[0]).toContain("BUILD.bazel");
	});

	test("flags a lock with no crate_universe result at all", () => {
		expect(findLockDrift(input({ lockText: '{"lockFileVersion":28,"moduleExtensions":{}}' }))).toEqual([
			expect.stringContaining("no crate_universe extension entry"),
		]);
	});

	test("flags a dependency Cargo.lock does not pin", () => {
		const problems = findLockDrift(
			input({ cargoLockText: CARGO_LOCK.replace('name = "html-escape"', 'name = "html-escape-renamed"') }),
		);
		expect(problems.some(problem => problem.includes("Cargo.lock does not pin"))).toBe(true);
	});

	test("skips the crate kinds crate_universe renders no alias for", () => {
		// `napi` is [patch.crates-io]ed, `brush-core` inherits a path, and an
		// optional dependency (`pipewire`) is absent from this lock entirely.
		const optionalMember = MEMBER_TOML.replace(
			"brush-core = { workspace = true }",
			"brush-core = { workspace = true }\npipewire = { workspace = true }",
		);
		const problems = findLockDrift(input({ memberManifests: new Map([["crates/pi-natives", optionalMember]]) }));
		expect(problems).toEqual([]);
	});

	test("holds the committed MODULE.bazel.lock to the same coverage", () => {
		expect(findLockDrift(collectLockDriftInput())).toEqual([]);
	});
});

#!/usr/bin/env bun
/**
 * Crate-coverage guard for `MODULE.bazel.lock`.
 *
 * `gen-bazel-lock.ts --check` only replays the *input* hashes bazel recorded for
 * the `@crates` crate_universe extension (Cargo.toml, Cargo.lock, every member
 * manifest). It cannot see the recorded *result*: a lock whose `recordedInputs`
 * were refreshed by hand — or patched by anything that leaves the rendered
 * `generatedRepoSpecs` stale — still passes that check, bazel then reuses the
 * entry verbatim, never runs `cargo-bazel splice`, and a crate that has since
 * become a direct dependency of a member has no alias in `@crates//:defs.bzl`.
 * The crate fails to compile instead (`error[E0433]: cannot find module or
 * crate ...`), which only the native addon jobs notice.
 *
 * This guard reads the lock's rendered crate_universe output instead of its
 * hashes: every third-party dependency of every workspace member in the current
 * manifests must have a rendered alias in that member's dependency maps, and
 * every alias the result hands out must have a rendered `BUILD.bazel`. Crate
 * kinds that deliberately get no alias are skipped — optional dependencies,
 * `[patch.*]`ed crates, and path dependencies (including path-patched registry
 * crates, which `Cargo.lock` records without a `source`).
 *
 * Usage: bun scripts/bazel-lock-drift.ts   (gate mode; prints violations, exit 0/1)
 */
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

/** `moduleExtensions` key marker of the crate_universe `crate` extension. */
const CRATES_EXTENSION_MARKER = "crate_universe:extensions.bzl%crate";
/** Repo the extension renders the alias surface into (loaded as `@crates`). */
const CRATES_REPO = "crates";

export interface LockDriftInput {
	/** `MODULE.bazel.lock` contents. */
	lockText: string;
	/** Root `Cargo.toml` (workspace members, `[workspace.dependencies]`, `[patch.*]`). */
	workspaceToml: string;
	/** `Cargo.lock` contents. */
	cargoLockText: string;
	/** Member directory (posix, repo-relative) -> that member's `Cargo.toml` text. */
	memberManifests: ReadonlyMap<string, string>;
}

type Table = Record<string, any>;

interface ParsedLock {
	/** Rendered file -> contents inside the `@crates` repository. */
	contents: Record<string, string>;
	/** Member directory -> (alias -> rendered crate targets) across all dependency maps. */
	memberAliasTargets: Map<string, Map<string, string[]>>;
}

/** Everything the manifest side of the comparison needs. */
interface ManifestContext {
	/** `[workspace.dependencies]`, for `workspace = true` inheritance. */
	workspaceDeps: Table;
	/** Crate names replaced by a `[patch.*]` section; they render no alias. */
	patchedNames: Set<string>;
	/** Crate names `Cargo.lock` records without a `source` (path packages). */
	localNames: Set<string>;
	/** Crate name -> versions `Cargo.lock` records with a source. */
	sourcedVersions: Map<string, string[]>;
}

interface ExpectedDep {
	member: string;
	/** Dependency key in the member manifest: the alias `crate_deps` looks up. */
	alias: string;
	/** Underlying crate name, after `package = "..."` renames. */
	pkg: string;
}

/** Renders `@crates`'s file map; returns the reason when the lock has none. */
function parseCratesRepo(lockText: string): ParsedLock | string {
	let lock: Table;
	try {
		lock = JSON.parse(lockText);
	} catch (error) {
		return `MODULE.bazel.lock is not valid JSON (${error instanceof Error ? error.message : String(error)})`;
	}
	const extensions: Table = lock.moduleExtensions ?? {};
	const extensionKey = Object.keys(extensions).find(key => key.includes(CRATES_EXTENSION_MARKER));
	if (!extensionKey) return `MODULE.bazel.lock has no crate_universe extension entry (${CRATES_EXTENSION_MARKER})`;
	const spec = extensions[extensionKey]?.general?.generatedRepoSpecs?.[CRATES_REPO];
	const contents: Record<string, string> | undefined = spec?.attributes?.contents;
	if (!contents) return `MODULE.bazel.lock has no rendered @${CRATES_REPO} repository (crate_universe result)`;
	const cratesBzl: unknown = contents["crates.bzl"];
	if (typeof cratesBzl !== "string") return `MODULE.bazel.lock renders @${CRATES_REPO} without a crates.bzl`;
	return { contents, memberAliasTargets: parseCratesBzl(cratesBzl) };
}

/**
 * `crates.bzl` holds one `_*DEPENDENCIES` map per dependency kind, each keyed by
 * workspace member package (`"crates/pi-natives": { "<condition>": { "<alias>":
 * Label("//<crate>-<version>"), ... } }`). Kind-specific maps (proc-macro,
 * build) are merged per member: classifying a crate would need its own manifest,
 * and this guard only asks whether the alias surface covers the member.
 */
function parseCratesBzl(cratesBzl: string): Map<string, Map<string, string[]>> {
	const memberAliasTargets = new Map<string, Map<string, string[]>>();
	let currentMember: Map<string, string[]> | null = null;
	for (const line of cratesBzl.split(/\r?\n/)) {
		const memberMatch = /^ {4}"([^"]+)": \{$/.exec(line);
		if (memberMatch) {
			const existing = memberAliasTargets.get(memberMatch[1]);
			currentMember = existing ?? new Map<string, string[]>();
			memberAliasTargets.set(memberMatch[1], currentMember);
			continue;
		}
		if (/^_[A-Z_]+ = \{/.test(line)) {
			currentMember = null;
			continue;
		}
		const labelMatch = /^\s+"([^"]+)": Label\("\/\/([^"]+)"\),?$/.exec(line);
		if (!labelMatch || !currentMember) continue;
		const [, alias, target] = labelMatch;
		currentMember.set(alias, [...(currentMember.get(alias) ?? []), target]);
	}
	return memberAliasTargets;
}

/** Every `"alias": Label("//target")` target rendered anywhere in `crates.bzl`. */
function renderedCrateTargets(cratesBzl: string): Set<string> {
	const targets = new Set<string>();
	for (const match of cratesBzl.matchAll(/"([^"]+)": Label\("\/\/([^"]+)"\),?$/gm)) targets.add(match[2]);
	return targets;
}

/** Expands the workspace `members` patterns to package directories. */
function workspaceMembers(root: string, workspaceToml: string): string[] {
	const workspace = (Bun.TOML.parse(workspaceToml) as Table).workspace ?? {};
	const dirs = new Set<string>();
	for (const pattern of (workspace.members ?? []) as string[]) {
		if (!/[*?[]/.test(pattern)) {
			dirs.add(pattern.replace(/\/Cargo\.toml$/, ""));
			continue;
		}
		// `members` globs name package directories; the trailing slash keeps the scan to directories.
		for (const match of new Bun.Glob(`${pattern.replace(/\/+$/, "")}/`).scanSync({ cwd: root })) {
			dirs.add(match.replace(/\/+$/, ""));
		}
	}
	return [...dirs].sort();
}

/** Manifest-side view of the comparison: workspace tables plus `Cargo.lock` resolution. */
function manifestContext(input: LockDriftInput): ManifestContext {
	const cargoToml = Bun.TOML.parse(input.workspaceToml) as Table;
	const patchedNames = new Set<string>();
	for (const section of Object.values(cargoToml.patch ?? {})) {
		for (const name of Object.keys(section as Table)) patchedNames.add(name);
	}
	const sourcedVersions = new Map<string, string[]>();
	const localNames = new Set<string>();
	for (const pkg of ((Bun.TOML.parse(input.cargoLockText) as Table).package ?? []) as Table[]) {
		if (pkg.source) sourcedVersions.set(pkg.name, [...(sourcedVersions.get(pkg.name) ?? []), String(pkg.version)]);
		else localNames.add(pkg.name);
	}
	return { workspaceDeps: cargoToml.workspace?.dependencies ?? {}, patchedNames, localNames, sourcedVersions };
}

/**
 * Resolves one dependency key to the crate it uses. `local` returns mark crates
 * rendered from inside the workspace (path dependencies, path-patched registry
 * crates): bazel builds those from their directory, never through `@crates`.
 */
function resolveDependencyDep(
	member: string,
	alias: string,
	spec: unknown,
	context: ManifestContext,
): ExpectedDep | "local" | string {
	const dep = (pkg: string): ExpectedDep => ({ member, alias, pkg });
	if (typeof spec === "string") return dep(alias);
	if (!spec || typeof spec !== "object") return `${member}: dependency \`${alias}\` has an unreadable spec`;
	const table = spec as Table;
	if ("path" in table) return "local";
	if (table.workspace === true) {
		const base = context.workspaceDeps[alias];
		if (base === undefined) {
			return `${member}: \`${alias} = { workspace = true }\` has no [workspace.dependencies] entry in Cargo.toml`;
		}
		if (typeof base === "object" && base !== null) {
			if ("path" in base) return "local";
			return dep((base as Table).package ?? alias);
		}
		return dep(alias);
	}
	if ("git" in table) return dep(typeof table.package === "string" ? table.package : alias);
	return dep(typeof table.package === "string" ? table.package : alias);
}

/** Whether a dependency is one crate_universe deliberately renders no alias for. */
function skipsAlias(dep: ExpectedDep, spec: unknown, context: ManifestContext): boolean {
	const table = (typeof spec === "object" && spec !== null ? spec : {}) as Table;
	const inherited =
		table.workspace === true && typeof context.workspaceDeps[dep.alias] === "object"
			? (context.workspaceDeps[dep.alias] as Table)
			: {};
	return (
		table.optional === true ||
		inherited.optional === true ||
		context.patchedNames.has(dep.alias) ||
		context.patchedNames.has(dep.pkg) ||
		context.localNames.has(dep.pkg)
	);
}

/** Every third-party dependency `manifestText` declares, across kinds and target cfgs. */
function memberDependencies(
	member: string,
	manifestText: string,
	context: ManifestContext,
): { deps: { dep: ExpectedDep; spec: unknown }[]; problems: string[] } {
	const manifest = Bun.TOML.parse(manifestText) as Table;
	const declared: { dep: ExpectedDep; spec: unknown }[] = [];
	const problems: string[] = [];
	const collect = (table: unknown): void => {
		if (!table || typeof table !== "object") return;
		for (const [alias, spec] of Object.entries(table as Table)) {
			const resolved = resolveDependencyDep(member, alias, spec, context);
			if (resolved === "local") continue;
			if (typeof resolved === "string") problems.push(resolved);
			else declared.push({ dep: resolved, spec });
		}
	};
	for (const key of ["dependencies", "dev-dependencies", "build-dependencies"]) collect(manifest[key]);
	for (const target of Object.values(manifest.target ?? {})) {
		const table = target as Table;
		for (const key of ["dependencies", "dev-dependencies", "build-dependencies"]) collect(table[key]);
	}
	return { deps: declared, problems };
}

/**
 * Violations of the lock's rendered crate surface against the current manifests.
 * Empty means the recorded crate_universe result covers every workspace dependency.
 */
export function findLockDrift(input: LockDriftInput): string[] {
	const parsed = parseCratesRepo(input.lockText);
	if (typeof parsed === "string") return [parsed];
	const { contents, memberAliasTargets } = parsed;
	const problems: string[] = [];
	const cratesBzl = contents["crates.bzl"]!;

	// Every label `crates.bzl` hands out needs the alias BUILD file bazel loads
	// for it; a half-written result is otherwise only caught at build time.
	for (const target of renderedCrateTargets(cratesBzl)) {
		if (!contents[`${target}/BUILD.bazel`]) {
			problems.push(`@${CRATES_REPO} hands out \`//${target}\`, which the lock renders no BUILD.bazel for`);
		}
	}

	const context = manifestContext(input);
	for (const [member, manifestText] of input.memberManifests) {
		const { deps, problems: manifestProblems } = memberDependencies(member, manifestText, context);
		problems.push(...manifestProblems);
		const aliases = memberAliasTargets.get(member);
		for (const { dep, spec } of deps) {
			if (skipsAlias(dep, spec, context)) continue;
			const versions = context.sourcedVersions.get(dep.pkg);
			if (!versions || versions.length === 0) {
				problems.push(`${member}: \`${dep.alias}\` depends on crate \`${dep.pkg}\`, which Cargo.lock does not pin`);
				continue;
			}
			const rendered = aliases?.get(dep.alias) ?? [];
			if (!rendered.some(target => versions.some(version => target === `${dep.pkg}-${version}`))) {
				problems.push(
					`${member}: \`${dep.alias}\` needs crate \`${dep.pkg}\` ${versions.join("/")} (Cargo.lock), ` +
						`but the lock renders no alias for it — the recorded crate_universe result is stale`,
				);
			}
		}
	}
	return problems;
}

/** Reads the lock and the manifests it must cover from a checkout. */
export function collectLockDriftInput(root: string = repoRoot): LockDriftInput {
	const workspaceToml = fs.readFileSync(path.join(root, "Cargo.toml"), "utf8");
	const memberManifests = new Map<string, string>();
	for (const member of workspaceMembers(root, workspaceToml)) {
		memberManifests.set(member, fs.readFileSync(path.join(root, member, "Cargo.toml"), "utf8"));
	}
	return {
		lockText: fs.readFileSync(path.join(root, "MODULE.bazel.lock"), "utf8"),
		workspaceToml,
		cargoLockText: fs.readFileSync(path.join(root, "Cargo.lock"), "utf8"),
		memberManifests,
	};
}

if (import.meta.main) {
	const problems = findLockDrift(collectLockDriftInput());
	if (problems.length === 0) {
		console.log("bazel-lock-drift: MODULE.bazel.lock covers every workspace dependency.");
		process.exit(0);
	}
	console.error(
		`bazel-lock-drift: MODULE.bazel.lock lags the manifests (${problems.length} problem${problems.length === 1 ? "" : "s"}); ` +
			"run `bun run gen:bazel-lock` (needs bazelisk) and commit the result:",
	);
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

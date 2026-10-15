/**
 * Custom Git merge driver for package.json files.
 *
 * Called by Git with three args: %A (ours, the branch that runs the merge),
 * %O (base, the two parents' merge-base) and %B (theirs, the side merged in).
 *
 * Setup:
 *   git config merge.zeta-package.driver "bun scripts/merge-package-json.ts %A %O %B"
 *   git config merge.zeta-package.name "Zeta package.json merge driver"
 *
 * The .gitattributes file maps package.json files to this driver:
 *   package.json merge=zeta-package
 *   packages/&#42;/package.json merge=zeta-package
 *
 * ## Policy: a three-way merge, not "theirs plus a keep-list"
 *
 * The driver used to start from `{...theirs}` and re-apply a keep-list, so
 * **every path it did not own was silently taken from the merged-in side**: a
 * Zeta-only leaf vanished and a Zeta-side value edit was reverted. That is how
 * the v18.10.0 sync merge lost `workspaces.packages[1]` (`plugins/*`), the six
 * Zeta-only scripts (`check:nix-bun`, `check:relay-assets`,
 * `ci:release:publish-web-ui`, `ci:release:publish-plugin`, `gen:relay-assets`,
 * `gen:brand-art`), `devDependencies.figlet`, the exact catalog pins and the
 * `sdk/python/zeta-rpc` targets, and how it reverted `packageManager` to
 * `bun@>=1.4` — all without a conflict. The same run reverted the deliberate
 * `tsgo`→`tsc` switch in every `packages/<name>/package.json`.
 *
 * The rewrite below makes that erasure class impossible by construction. For
 * every leaf of the manifest the driver decides by rule, never by "whichever
 * side the result was seeded from":
 *
 * 1. **Zeta-owned path** (`ZETA_OWNED_PATHS`: brand/identity fields,
 *    `packageManager`, the Python entry points) — the branch side's value wins
 *    unconditionally; the merged-in side can neither overwrite nor delete it.
 * 2. **Zeta-only leaf** — the branch side introduced it since the last
 *    integrated upstream tag (`base`), so it is Zeta content no matter what the
 *    merged-in side carries under the same name. This covers every Zeta-only
 *    script, Zeta-only dependency and every `@linxiraos/*` pin *without* a
 *    keep-list entry, which is what stops the incident class from growing back
 *    one entry at a time.
 * 3. **Everything else** — the ordinary base→theirs delta: upstream's edit,
 *    addition or deletion lands, and a leaf upstream did not touch keeps the
 *    branch side's value (including a branch-side deletion). A leaf both sides
 *    changed keeps upstream's value, matching the merge doctrine
 *    (`document/merge-playbook.md`: upstream-wins + Zeta surface re-applied);
 *    the driver reports every such rejection on stderr so the merge is no longer
 *    silent.
 *
 * Two nested paths are merged entry-by-entry rather than by leaf delta:
 * `workspaces.catalog` (the Zeta pin table: `@linxiraos/*` entries follow the
 * Zeta product line and a key Zeta has moved off the base — an exact pin — stays
 * Zeta's, while unpinned keys take the upstream delta) and `workspaces.packages`
 * (an order-preserving union, so `plugins/*` survives and upstream additions
 * still land). See `DRIVER_MERGED_PATHS`.
 *
 * Before writing, the driver re-checks the invariant it promises
 * (`erasureViolations`) and **refuses to write a result that erased branch-side
 * content** — it exits non-zero, so git reports a conflict instead of shipping
 * the loss.
 *
 * `check-package-json-merge.ts` asserts the same invariant across a branch's own
 * merge commits and imports this module's policy (`ZETA_OWNED_PATHS`,
 * `manifestLeaves`) instead of re-declaring it.
 */

import * as fs from "node:fs";

/** A parsed package.json. */
export type Manifest = Record<string, unknown>;

/**
 * Top-level manifest keys that are Zeta product identity (name, version, CLI
 * bin, homepage/links, authorship, keywords): always the branch side's value.
 */
export const ZETA_IDENTITY_FIELDS: Record<string, true> = {
	name: true,
	version: true,
	homepage: true,
	bin: true,
	repository: true,
	bugs: true,
	author: true,
	contributors: true,
	keywords: true,
};

/** Dependency sections the driver merges key-by-key via `mergeDependencySection`. */
export const DEPENDENCY_SECTIONS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;

/**
 * Nested paths merged entry-by-entry from both sides instead of by the
 * unowned-leaf delta: `workspaces.catalog` through `mergeCatalog` and
 * `workspaces.packages` as an order-preserving union. Everything else under
 * `workspaces` follows the ordinary leaf delta.
 */
export const DRIVER_MERGED_PATHS = ["workspaces.catalog", "workspaces.packages"] as const;

/**
 * Dotted paths Zeta owns outright: the branch side's value wins, and the
 * merged-in side can neither overwrite nor delete them. This is the driver's
 * only keep-list; it is deliberately short, and it stays data (not a second,
 * drifting copy in the guard — `check-package-json-merge.ts` imports it).
 *
 * Zeta-only content is *not* listed here — `mergeLeaf` protects it structurally —
 * so adding a Zeta script, catalog pin or dependency never needs an entry:
 * that is what keeps this list from creeping.
 */
export const ZETA_OWNED_PATHS: readonly string[] = [
	...Object.keys(ZETA_IDENTITY_FIELDS),
	// The Bun pin is exact (`bun@1.4.3`, document/dev-conventions.md) and the CI
	// bun-install action resolves it; upstream's floor (`bun@>=1.4`) must never
	// replace it (v18.9.1 regression class).
	"packageManager",
	// These entry points target the tree Zeta actually has (`sdk/python/zeta-rpc`);
	// the merged-in side's Python SDK path does not exist here, so adopting its value
	// leaves a script that silently cannot run.
	"scripts.test:py",
	"scripts.robomp:install",
];

/** Whether `path` (dotted, relative to the manifest root) is Zeta-owned, subtree included. */
export function isZetaOwnedPath(path: string): boolean {
	return ZETA_OWNED_PATHS.some(owned => path === owned || path.startsWith(`${owned}.`));
}

const ZETA_SCOPE = "@linxiraos/";

// Upstream workspace packages are named @oh-my-pi/*. Zeta renames that scope
// to @linxiraos/* (with RENAME_BY_TAIL for renamed packages) and keeps its own
// independent versions (1.x product line), so the driver must map upstream
// keys back to Zeta names before merging. This constant MUST keep the literal
// upstream scope: sweeping it silently disables the mapping (recurring damage
// class; guarded by a brand-check MUST_CONTAIN entry).
const OMP_SCOPE = "@oh-my-pi/";

// Upstream's original author scope predating the @oh-my-pi rename. Legacy
// manifests and vendored plugin manifests still declare it; map it exactly
// like @oh-my-pi so dependency keys land on Zeta packages instead of passing
// through unmapped (install-smoke failure class). This literal MUST survive
// the sweep: dropping it silently breaks historical-scope mapping (guarded by
// a brand-check MUST_CONTAIN entry).
const LEGACY_AUTHOR_SCOPE = "@mariozechner/";

// Upstream names whose catalog/tail does not equal the Zeta package tail.
const RENAME_BY_TAIL: Record<string, string> = {
	hashline: "pi-hashline",
	"omp-stats": "pi-stats",
	omptype: "pi-omptype",
	"pi-coding-agent": "zeta",
	snapcompact: "pi-snapcompact",
};

function zetaKeyFor(ompKey: string): string | null {
	for (const scope of [OMP_SCOPE, LEGACY_AUTHOR_SCOPE] as const) {
		if (ompKey.startsWith(scope)) {
			const tail = ompKey.slice(scope.length);
			return `${ZETA_SCOPE}${RENAME_BY_TAIL[tail] ?? tail}`;
		}
	}
	return null;
}

function loadJson(path: string): Manifest | null {
	try {
		const raw = fs.readFileSync(path, "utf-8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function saveJson(path: string, obj: Manifest): void {
	fs.writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

function isPlainObject(value: unknown): value is Manifest {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Value equality for JSON leaves, with "absent" as a value of its own:
 * `JSON.stringify(undefined)` is `undefined`, so an absent leaf equals only
 * another absent leaf (every decision below depends on that).
 */
export function sameJson(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Record a leaf where the merged-in side carried a different value the driver
 * deliberately did not adopt, so the merge reports it instead of hiding it.
 */
function record(rejected: string[], path: string, kept: unknown, dropped: unknown): void {
	if (dropped !== undefined && !sameJson(kept, dropped)) {
		rejected.push(
			`${path}: kept ${JSON.stringify(kept) ?? "<absent>"} over the merged-in ${JSON.stringify(dropped)}`,
		);
	}
}

/**
 * Decide one leaf (`undefined` = the key is omitted from the result). Rule 1–3
 * of the header policy; `base` is the merge-base value.
 */
function mergeLeaf(path: string, base: unknown, ours: unknown, theirs: unknown, rejected: string[]): unknown {
	// 1. Zeta-owned path.
	if (isZetaOwnedPath(path)) {
		record(rejected, path, ours, theirs);
		return ours;
	}
	// 2. Zeta-only leaf: the branch side introduced it after the base.
	if (ours !== undefined && base === undefined) {
		record(rejected, path, ours, theirs);
		return ours;
	}
	// 3. Ordinary base→theirs delta.
	return sameJson(theirs, base) ? ours : theirs;
}

/**
 * Merge a manifest object key by key, recursing into plain objects so a nested
 * leaf is judged on its own instead of being swallowed by its parent's delta
 * (treating `scripts` as one leaf is what dropped the six Zeta-only scripts).
 * Key order follows the branch side, with merged-in-only keys appended.
 */
function mergeObjects(path: string, base: Manifest, ours: Manifest, theirs: Manifest, rejected: string[]): Manifest {
	const merged: Manifest = {};
	const keys = [...Object.keys(ours), ...Object.keys(theirs).filter(key => !(key in ours))];

	for (const key of keys) {
		const childPath = path === "" ? key : `${path}.${key}`;
		const baseValue = base[key];
		const oursValue = ours[key];
		const theirsValue = theirs[key];

		if ((DRIVER_MERGED_PATHS as readonly string[]).includes(childPath)) {
			const section = mergeSection(childPath, baseValue, oursValue, theirsValue, rejected);
			if (section !== undefined) merged[key] = section;
			continue;
		}
		if (isPlainObject(oursValue) && isPlainObject(theirsValue)) {
			merged[key] = mergeObjects(
				childPath,
				isPlainObject(baseValue) ? baseValue : {},
				oursValue,
				theirsValue,
				rejected,
			);
			continue;
		}
		const value = mergeLeaf(childPath, baseValue, oursValue, theirsValue, rejected);
		if (value !== undefined) merged[key] = value;
	}

	return merged;
}

/** `value` as a section keyed by package name, or `{}`. */
function sectionEntries(value: unknown): Record<string, string> {
	return isPlainObject(value) ? (value as Record<string, string>) : {};
}

/**
 * Section keys as they are comparable across the three sides: an upstream-scope
 * key (`@oh-my-pi/pi-ai`, `@mariozechner/pi-ai`) is the same entry as its Zeta
 * rename, so both sides must be read through `zetaKeyFor` before deciding.
 */
function effectiveSectionKeys(manifest: Record<string, string>): Map<string, string> {
	const keys = new Map<string, string>();
	for (const [key, value] of Object.entries(manifest)) keys.set(zetaKeyFor(key) ?? key, value);
	return keys;
}

/**
 * Merge one package-keyed section, keeping the branch side's key order and
 * letting `decide` pick each value.
 */
function mergeSectionKeys(
	ours: Record<string, string>,
	theirs: Record<string, string>,
	base: Record<string, string>,
	decide: (
		key: string,
		ours: string | undefined,
		theirs: string | undefined,
		base: string | undefined,
	) => string | undefined,
): Record<string, string> {
	const oursKeys = effectiveSectionKeys(ours);
	const theirsKeys = effectiveSectionKeys(theirs);
	const baseKeys = effectiveSectionKeys(base);
	const merged: Record<string, string> = {};
	const keys = [...oursKeys.keys(), ...[...theirsKeys.keys()].filter(key => !oursKeys.has(key))];

	for (const key of keys) {
		const value = decide(key, oursKeys.get(key), theirsKeys.get(key), baseKeys.get(key));
		if (value !== undefined) merged[key] = value;
	}
	return merged;
}

/**
 * Merge a dependency section.
 *
 * - An effective key in the Zeta scope carries the Zeta product line's own
 *   version (`catalog:` references included) and is never overwritten by
 *   upstream's; a Zeta-only package upstream lacks stays, and an upstream
 *   package Zeta has not declared yet joins under its Zeta name so the merge
 *   stays complete.
 * - Everything else follows the leaf rule: a Zeta-only dependency stays Zeta's,
 *   an upstream bump lands, an upstream deletion applies, and a leaf upstream
 *   did not touch keeps the branch side's value.
 */
export function mergeDependencySection(
	ours: Record<string, string>,
	theirs: Record<string, string>,
	base: Record<string, string> = {},
	rejected: string[] = [],
): Record<string, string> {
	return mergeSectionKeys(ours, theirs, base, (key, oursValue, theirsValue, baseValue) => {
		if (key.startsWith(ZETA_SCOPE)) {
			const value = oursValue ?? theirsValue;
			record(rejected, key, oursValue, theirsValue);
			return value;
		}
		return mergeLeaf(key, baseValue, oursValue, theirsValue, rejected) as string | undefined;
	});
}

/**
 * Merge `workspaces.catalog`, the Zeta pin table.
 *
 * - Effective `@linxiraos/*` keys: the Zeta product line's versions win; if Zeta
 *   has not declared the package yet, upstream's entry joins under the Zeta name.
 * - Third-party keys: the catalog is Zeta's own resolution table, so a key the
 *   branch side moved off the base is a deliberate Zeta pin (an exact pin stays
 *   exact, a pin the branch dropped stays dropped). A key the branch side did not
 *   touch takes the upstream delta, so genuine upstream version bumps land.
 */
export function mergeCatalog(
	ours: Record<string, string>,
	theirs: Record<string, string>,
	base: Record<string, string> = {},
	rejected: string[] = [],
): Record<string, string> {
	return mergeSectionKeys(ours, theirs, base, (key, oursValue, theirsValue, baseValue) => {
		if (key.startsWith(ZETA_SCOPE)) {
			record(rejected, key, oursValue, theirsValue);
			return oursValue ?? theirsValue;
		}
		if (oursValue !== baseValue) {
			record(rejected, key, oursValue, theirsValue);
			return oursValue;
		}
		return theirsValue;
	});
}

/**
 * Union of the workspace glob lists: the branch side's order first, then the
 * merged-in entries it lacks. A glob list has no meaningful "deletion" — a stale
 * glob matches nothing, while dropping `plugins/*` breaks every workspace it
 * covers — so no entry is ever dropped and upstream additions still land.
 */
function mergeGlobList(ours: unknown, theirs: unknown): unknown[] {
	const merged: unknown[] = [];
	const seen = new Set<string>();
	for (const source of [ours, theirs]) {
		if (!Array.isArray(source)) continue;
		for (const entry of source) {
			const identity = JSON.stringify(entry);
			if (seen.has(identity)) continue;
			seen.add(identity);
			merged.push(entry);
		}
	}
	return merged;
}

/** One of `DRIVER_MERGED_PATHS`, or `undefined` when the section is empty on both sides. */
function mergeSection(path: string, base: unknown, ours: unknown, theirs: unknown, rejected: string[]): unknown {
	if (path === "workspaces.catalog") {
		const merged = mergeCatalog(sectionEntries(ours), sectionEntries(theirs), sectionEntries(base), rejected);
		return Object.keys(merged).length === 0 ? undefined : merged;
	}
	if (path === "workspaces.packages") {
		const merged = mergeGlobList(ours, theirs);
		return merged.length === 0 ? undefined : merged;
	}
	// Unreachable while DRIVER_MERGED_PATHS and this function agree; fail loudly
	// rather than silently falling back to the leaf delta for a merged path.
	throw new Error(`merge-package-json.ts: no merge rule for ${path}`);
}

/** Three-way merge of one manifest. `rejected` collects the values the driver kept over the merged-in side. */
export function mergeManifests(base: Manifest, ours: Manifest, theirs: Manifest, rejected: string[] = []): Manifest {
	return mergeObjects("", base, ours, theirs, rejected);
}

/**
 * Flatten a manifest into dotted leaves: scalars and arrays are leaves, plain
 * objects are recursed into, and a Zeta-owned path is a leaf of its own (the
 * driver treats its whole subtree as one branch-side value).
 */
export function manifestLeaves(manifest: Manifest | undefined): Map<string, unknown> {
	const leaves = new Map<string, unknown>();
	const walk = (value: unknown, prefix: string): void => {
		if (!isPlainObject(value)) {
			leaves.set(prefix, value);
			return;
		}
		for (const [key, nested] of Object.entries(value)) {
			const child = prefix === "" ? key : `${prefix}.${key}`;
			if (isZetaOwnedPath(child)) leaves.set(child, nested);
			else walk(nested, child);
		}
	};
	walk(manifest ?? {}, "");
	return leaves;
}

/**
 * Whether `path` is a section key whose effective name is Zeta-scoped. Those are
 * the one place the driver may take the merged-in side's entry even though the
 * branch side moved the leaf: an upstream package Zeta has not declared yet joins
 * the section under its Zeta name so the merge stays complete
 * (`mergeDependencySection`, `mergeCatalog`).
 */
function adoptsMergedInSide(path: string): boolean {
	const section = [...DEPENDENCY_SECTIONS, "workspaces.catalog"].find(candidate => path.startsWith(`${candidate}.`));
	if (!section) return false;
	const key = path.slice(section.length + 1);
	return (zetaKeyFor(key) ?? key).startsWith(ZETA_SCOPE);
}

/**
 * The invariant the driver refuses to violate: for every leaf the branch side
 * moved off the base (a new value, or a deletion), the result carries the
 * branch-side state — unless the merged-in side moved that same leaf (upstream
 * wins by doctrine) or the leaf is a Zeta-scoped section key that upstream may
 * legitimately fill in.
 *
 * This is the machine-checkable form of the 2026-10-15 incident: the pre-rewrite
 * driver started from the merged-in side, so a branch-side move with an
 * *unchanged* merged-in counterpart — `packageManager`, the Zeta-only scripts,
 * `devDependencies.figlet`, the `sdk/python/zeta-rpc` targets, the exact catalog
 * pins, `plugins/*` — was silently lost. `main` calls this before writing and
 * exits non-zero when it is non-empty, so such a result can never ship.
 *
 * `workspaces.packages` merges as a union, so its guarantee is containment:
 * every branch-side glob survives while the merged-in side may add entries.
 */
export function erasureViolations(base: Manifest, ours: Manifest, theirs: Manifest, merged: Manifest): string[] {
	const baseLeaves = manifestLeaves(base);
	const oursLeaves = manifestLeaves(ours);
	const theirsLeaves = manifestLeaves(theirs);
	const mergedLeaves = manifestLeaves(merged);
	const violations: string[] = [];

	for (const path of new Set([...oursLeaves.keys(), ...baseLeaves.keys()])) {
		const branchValue = oursLeaves.get(path);
		const baseValue = baseLeaves.get(path);
		if (sameJson(branchValue, baseValue)) continue; // the branch never moved this leaf
		if (adoptsMergedInSide(path)) continue;
		if (!sameJson(theirsLeaves.get(path), baseValue)) continue; // upstream moved it too: upstream wins

		if (path === "workspaces.packages") {
			const mergedList = mergedLeaves.get(path);
			const entries = Array.isArray(branchValue) ? branchValue : [];
			const lost = entries.some(
				entry => !Array.isArray(mergedList) || !mergedList.some(kept => sameJson(kept, entry)),
			);
			if (lost) violations.push(path);
			continue;
		}

		if (!sameJson(mergedLeaves.get(path), branchValue)) violations.push(path);
	}
	return violations.sort();
}

function main(): void {
	const [oursPath, basePath, theirsPath] = process.argv.slice(2);

	if (!oursPath || !basePath || !theirsPath) {
		console.error("Usage: merge-package-json.ts %A %O %B");
		process.exit(1);
	}

	const ours = loadJson(oursPath);
	const base = loadJson(basePath);
	const theirs = loadJson(theirsPath);

	if (!ours || !base || !theirs) {
		// Unparseable input on some side: leave the branch side as it is and let the
		// caller see the file unchanged rather than inventing a manifest.
		if (ours) saveJson(oursPath, ours);
		console.error("package.json merge driver: unparseable input, left the branch side untouched");
		process.exit(0);
	}

	const rejected: string[] = [];
	const merged = mergeManifests(base, ours, theirs, rejected);
	const erased = erasureViolations(base, ours, theirs, merged);

	if (erased.length > 0) {
		// Refuse to produce an erasing result: exiting non-zero leaves git reporting a
		// conflict, which is visible, instead of a clean merge that dropped content.
		console.error("package.json merge driver REFUSED to write an erasing result:");
		for (const path of erased) console.error(`  - ${path} would lose its branch-side value`);
		console.error("Register the driver correctly and report this — see document/merge-playbook.md step 4.");
		process.exit(1);
	}

	saveJson(oursPath, merged);

	if (rejected.length > 0) {
		const shown = rejected.slice(0, 12);
		console.error(`package.json merge driver: kept the Zeta side for ${rejected.length} leaf(s):`);
		for (const entry of shown) console.error(`  - ${entry}`);
		if (rejected.length > shown.length) console.error(`  - … and ${rejected.length - shown.length} more`);
	}
	console.log("package.json merged: three-way (Zeta-owned and Zeta-only leaves kept, upstream delta applied)");
	process.exit(0);
}

export { zetaKeyFor };

if (import.meta.main) {
	main();
}

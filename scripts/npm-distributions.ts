/**
 * Vendored npm distributions on the Zeta release line — single source of truth
 * for the three places that touch them:
 *
 *   - `scripts/release-v2.ts` (Step 2f: release bump + pre-commit gate)
 *   - `scripts/set-version.ts` (Step 3b: local/test bump)
 *   - `scripts/check-version-consistency.ts` (drift gate)
 *
 * A distribution is a launcher package (`editor/npm/editor`, `main/npm/main`)
 * plus the platform leaves it pins EXACTLY in `optionalDependencies`
 * (`@linxiraos/editor-windows-x64`). None of them is a Bun workspace member,
 * so the version line has no other writer. The launcher ships no binary
 * itself: a pin that lags the line silently installs the previous release's
 * leaf, which is how the 1.2.0 npm publish shipped the editor launcher still
 * pinning 1.1.28 and needed a hand fix (PR #119). The editor distribution
 * changed payload (the vendored TTT editor retired 2026-10-16; the built-in
 * editor's `termide-editor` entry took the name over 2026-10-17) but not
 * shape, so it is registered here again — a registered distribution whose
 * directory is missing would make every bump walk a non-existent tree, which
 * is why it was absent only while no payload existed.
 *
 * Adding a distribution: register it here. `check-version-consistency.ts`
 * fails on any unregistered `@linxiraos/*` entry under an npm distribution's
 * `optionalDependencies`, so the table cannot silently fall behind the tree.
 *
 * `companions` are the same shape of pin for a *different product* the
 * launcher installs beside itself. `@linxiraos/main` (the zetawork workbench)
 * pins `@linxiraos/zeta` (bin `zetacode`) and `@linxiraos/ide` (bin `zetaide`)
 * in the same `optionalDependencies` block, so one install yields the whole
 * suite. They are not leaves: no `os`/`cpu` gate, no binary of their own — the
 * binary stays in that product's own platform leaf, and the pin is what makes
 * npm materialize it. The pin still rides the line exactly (a stale pin
 * installs the previous release's companion), so every bump/check pass treats
 * it like a leaf pin.
 */

export interface NpmLeafPin {
	/** Repo-relative dir of the platform leaf package. */
	readonly dir: string;
	/** Package name as pinned in the launcher's `optionalDependencies`. */
	readonly name: string;
}

/**
 * A same-line companion *product* the launcher installs beside itself. Same
 * pin semantics as a leaf, but it is another product's launcher package, not
 * a platform leaf of this one.
 */
export type NpmCompanionPin = NpmLeafPin;

export interface NpmDistribution {
	/** Repo-relative dir of the launcher package that pins `leaves`. */
	readonly dir: string;
	/** Platform leaves pinned by the launcher's `optionalDependencies`. */
	readonly leaves: readonly NpmLeafPin[];
	/** Companion products pinned in the same `optionalDependencies` block. */
	readonly companions?: readonly NpmCompanionPin[];
}

export const NPM_DISTRIBUTIONS: readonly NpmDistribution[] = [
	{
		// The built-in editor's payload (termide's editor-only entry), launcher
		// without a `bin` plus its platform leaves — see termide/VENDOR.md.
		dir: "editor/npm/editor",
		leaves: [
			{ dir: "editor/npm/editor-windows-x64", name: "@linxiraos/editor-windows-x64" },
			{ dir: "editor/npm/editor-linux-x64", name: "@linxiraos/editor-linux-x64" },
		],
	},
	{
		dir: "main/npm/main",
		leaves: [
			{ dir: "main/npm/main-windows-x64", name: "@linxiraos/main-windows-x64" },
			{ dir: "main/npm/main-linux-x64", name: "@linxiraos/main-linux-x64" },
		],
		// zetacode and zetaide ship with zetawork: one install, three commands.
		companions: [
			{ dir: "packages/coding-agent", name: "@linxiraos/zeta" },
			{ dir: "termide/npm/ide", name: "@linxiraos/ide" },
		],
	},
	{
		dir: "termide/npm/ide",
		leaves: [
			{ dir: "termide/npm/ide-windows-x64", name: "@linxiraos/ide-windows-x64" },
			{ dir: "termide/npm/ide-linux-x64", name: "@linxiraos/ide-linux-x64" },
		],
	},
];

/** Every pin (platform leaves, then companions) the launcher must carry. */
export function distributionPins(distribution: NpmDistribution): readonly NpmLeafPin[] {
	return [...distribution.leaves, ...(distribution.companions ?? [])];
}

/**
 * Glob (repo-relative) matching every manifest inside a vendored npm
 * distribution — launchers and leaves alike.
 */
export const NPM_MANIFEST_GLOB = "**/npm/**/package.json";

/** All manifests of `distribution`, launcher first. */
export function distributionManifests(distribution: NpmDistribution): string[] {
	return [`${distribution.dir}/package.json`, ...distribution.leaves.map(leaf => `${leaf.dir}/package.json`)];
}

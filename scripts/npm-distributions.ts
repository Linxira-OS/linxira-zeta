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
 */

export interface NpmLeafPin {
	/** Repo-relative dir of the platform leaf package. */
	readonly dir: string;
	/** Package name as pinned in the launcher's `optionalDependencies`. */
	readonly name: string;
}

export interface NpmDistribution {
	/** Repo-relative dir of the launcher package that pins `leaves`. */
	readonly dir: string;
	/** Platform leaves pinned by the launcher's `optionalDependencies`. */
	readonly leaves: readonly NpmLeafPin[];
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
	},
	{
		dir: "termide/npm/ide",
		leaves: [
			{ dir: "termide/npm/ide-windows-x64", name: "@linxiraos/ide-windows-x64" },
			{ dir: "termide/npm/ide-linux-x64", name: "@linxiraos/ide-linux-x64" },
		],
	},
];

/**
 * Glob (repo-relative) matching every manifest inside a vendored npm
 * distribution — launchers and leaves alike.
 */
export const NPM_MANIFEST_GLOB = "**/npm/**/package.json";

/** All manifests of `distribution`, launcher first. */
export function distributionManifests(distribution: NpmDistribution): string[] {
	return [`${distribution.dir}/package.json`, ...distribution.leaves.map(leaf => `${leaf.dir}/package.json`)];
}

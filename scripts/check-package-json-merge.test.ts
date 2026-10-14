import { describe, expect, test } from "bun:test";
import { isDriverOwnedPath, type Manifest, manifestLeaves, manifestViolations } from "./check-package-json-merge";

/**
 * The guard's contract: a merge that drops or reverts a branch-side manifest
 * leaf is RED, unless the leaf is one `scripts/merge-package-json.ts` owns. The
 * fixtures below are shaped like the real damage — `packageManager` reverted to
 * the merged-in side's value, and `scripts` entries that vanish.
 */

const MAIN: Manifest = {
	name: "zeta",
	version: "1.2.1",
	packageManager: "bun@1.4.3",
	scripts: { "check:ts": "tsc", "gen:models": "bun scripts/gen-models.ts" },
	dependencies: { zod: "4.0.0" },
	workspaces: { packages: ["packages/*"], catalog: { zod: "3.25.76", "@linxiraos/pi-ai": "1.1.11" } },
};

const at = (overrides: Partial<Manifest> = {}): Manifest => ({ ...structuredClone(MAIN), ...overrides });

describe("manifestViolations", () => {
	test("reports a dropped key the branch added", () => {
		expect(
			manifestViolations({
				branch: at({ scripts: { ...MAIN.scripts, "check:probe": "bun scripts/probe.ts" } }),
				ancestor: at(),
				merged: at(), // the driver rebuilt `scripts` from the merged-in side
				head: at(),
			}),
		).toEqual([
			{
				kind: "dropped",
				path: "scripts.check:probe",
				branchValue: '"bun scripts/probe.ts"',
				mergedValue: "<absent>",
			},
		]);
	});

	test("reports a dropped top-level key (packageManager)", () => {
		const { packageManager: _dropped, ...withoutPin } = at();
		// The branch bumped the pin and the merged-in side does not carry the key at all.
		expect(
			manifestViolations({
				branch: at(),
				ancestor: at({ packageManager: "bun@1.4.0" }),
				merged: withoutPin,
				head: withoutPin,
			}),
		).toEqual([{ kind: "dropped", path: "packageManager", branchValue: '"bun@1.4.3"', mergedValue: "<absent>" }]);
		// The key is branch-side only: absent at the merge-base and on the merged-in side.
		expect(manifestViolations({ branch: at(), ancestor: withoutPin, merged: withoutPin, head: withoutPin })).toEqual([
			{ kind: "dropped", path: "packageManager", branchValue: '"bun@1.4.3"', mergedValue: "<absent>" },
		]);
	});

	test("reports a reverted packageManager value", () => {
		const ancestor = at({ packageManager: "bun@1.4.0" });
		expect(
			manifestViolations({
				branch: at({ packageManager: "bun@1.4.3" }), // the branch bumped the pin
				ancestor,
				merged: ancestor, // the driver took the merged-in side's untouched value
				head: ancestor,
			}),
		).toEqual([{ kind: "reverted", path: "packageManager", branchValue: '"bun@1.4.3"', mergedValue: '"bun@1.4.0"' }]);
	});

	test("reports a reverted scripts entry", () => {
		const ancestor = at({ scripts: { ...MAIN.scripts, "check:probe": "old" } });
		expect(
			manifestViolations({
				branch: at({ scripts: { ...MAIN.scripts, "check:probe": "new" } }),
				ancestor,
				merged: ancestor,
				head: ancestor,
			}),
		).toEqual([{ kind: "reverted", path: "scripts.check:probe", branchValue: '"new"', mergedValue: '"old"' }]);
	});

	test("clears a revert once HEAD carries the branch value again", () => {
		const ancestor = at({ packageManager: "bun@1.4.0" });
		expect(
			manifestViolations({
				branch: at({ packageManager: "bun@1.4.3" }),
				ancestor,
				merged: ancestor, // the merge itself reverted it
				head: at({ packageManager: "bun@1.4.3" }), // a later commit restored it
			}),
		).toEqual([]);
	});

	test("clears a drop once HEAD carries the leaf again", () => {
		const branch = at({ scripts: { ...MAIN.scripts, "check:probe": "bun scripts/probe.ts" } });
		expect(manifestViolations({ branch, ancestor: at(), merged: at(), head: branch })).toEqual([]);
	});

	test("is green on a clean tree", () => {
		// No branch-side change at all.
		expect(manifestViolations({ branch: at(), ancestor: at(), merged: at(), head: at() })).toEqual([]);
		// A branch-side change the merge carried through.
		expect(
			manifestViolations({
				branch: at({ packageManager: "bun@1.4.3" }),
				ancestor: at({ packageManager: "bun@1.4.0" }),
				merged: at({ packageManager: "bun@1.4.3" }),
				head: at({ packageManager: "bun@1.4.3" }),
			}),
		).toEqual([]);
	});

	test("ignores a leaf only the merged-in side dropped or renamed (driver behavior, not branch loss)", () => {
		expect(
			manifestViolations({
				branch: at(),
				ancestor: at(),
				merged: at({ scripts: { "check:ts": "tsc" } }),
				head: at({ scripts: { "check:ts": "tsc" } }),
			}),
		).toEqual([]);
	});

	test("ignores a leaf both sides changed (upstream value wins by design)", () => {
		expect(
			manifestViolations({
				branch: at({ scripts: { ...MAIN.scripts, "gen:models": "branch command" } }),
				ancestor: at(),
				merged: at({ scripts: { ...MAIN.scripts, "gen:models": "main command" } }),
				head: at({ scripts: { ...MAIN.scripts, "gen:models": "main command" } }),
			}),
		).toEqual([]);
	});

	test("exempts the paths the driver owns", () => {
		// Identity fields and dependency sections come from the branch side by
		// construction, so a merge taking the merged-in value is not branch loss.
		expect(
			manifestViolations({
				branch: at({ version: "1.2.2", dependencies: { zod: "4.1.0", "zeta-only": "1.0.0" } }),
				ancestor: at({ version: "1.2.1", dependencies: { zod: "4.0.0" } }),
				merged: at({ version: "9.9.9", dependencies: { zod: "3.0.0" } }),
				head: at({ version: "9.9.9", dependencies: { zod: "3.0.0" } }),
			}),
		).toEqual([]);
		// `workspaces.catalog` is re-merged key-by-key; its siblings are not.
		const catalogOnly = at({ workspaces: { ...MAIN.workspaces, catalog: { zod: "4.0.0" } } });
		const packagesToo = at({ workspaces: { packages: ["packages/*", "vendor/*"], catalog: { zod: "4.0.0" } } });
		expect(manifestViolations({ branch: catalogOnly, ancestor: at(), merged: at(), head: at() })).toEqual([]);
		expect(
			manifestViolations({ branch: packagesToo, ancestor: at(), merged: at(), head: at() }).map(v => v.path),
		).toEqual(["workspaces.packages"]);
	});

	test("tolerates a missing manifest at any revision", () => {
		expect(
			manifestViolations({ branch: undefined, ancestor: undefined, merged: undefined, head: undefined }),
		).toEqual([]);
		expect(
			manifestViolations({
				branch: { scripts: { "check:probe": "x" } },
				ancestor: undefined, // the manifest is absent at the merge-base
				merged: undefined,
				head: undefined,
			}),
		).toEqual([{ kind: "dropped", path: "scripts.check:probe", branchValue: '"x"', mergedValue: "<absent>" }]);
	});

	test("reports every lost leaf once, sorted by path", () => {
		const ancestor = at({ packageManager: "bun@1.4.0" });
		const branch = at({ packageManager: "bun@1.4.3", scripts: { ...MAIN.scripts, "check:probe": "arena" } });
		const { packageManager: _dropped, ...pinless } = ancestor;
		const merged = { ...pinless, scripts: MAIN.scripts };
		expect(
			manifestViolations({ branch, ancestor, merged, head: merged }).map(
				violation => `${violation.kind}:${violation.path}`,
			),
		).toEqual(["dropped:packageManager", "dropped:scripts.check:probe"]);
	});
});

describe("isDriverOwnedPath", () => {
	test("derives the keep-list from the merge driver's own constants", () => {
		// ZETA_IDENTITY_FIELDS — the driver copies these from the branch side.
		for (const owned of ["name", "version", "bin", "homepage", "repository", "bugs", "keywords"]) {
			expect(isDriverOwnedPath(owned)).toBe(true);
		}
		// DEPENDENCY_SECTIONS — merged key-by-key via mergeDeps.
		for (const owned of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
			expect(isDriverOwnedPath(owned)).toBe(true);
		}
		// DRIVER_MERGED_PATHS — the nested paths rebuilt from the branch side.
		expect(isDriverOwnedPath("workspaces.catalog")).toBe(true);
		expect(isDriverOwnedPath("workspaces.catalog.zod")).toBe(true);
		// Everything else arrives from the merged-in side.
		for (const unowned of ["packageManager", "scripts", "type", "engines", "private", "exports"]) {
			expect(isDriverOwnedPath(unowned)).toBe(false);
		}
		for (const unowned of ["scripts.check:ts", "workspaces", "workspaces.packages", "packageManager.foo"]) {
			expect(isDriverOwnedPath(unowned)).toBe(false);
		}
	});
});

describe("manifestLeaves", () => {
	test("stops at driver-owned paths and keeps arrays opaque", () => {
		expect([...manifestLeaves(MAIN).keys()].sort()).toEqual([
			"packageManager",
			"scripts.check:ts",
			"scripts.gen:models",
			"workspaces.packages",
		]);
		// `workspaces.catalog` is owned, so none of its entries appear.
		expect(manifestLeaves(MAIN).get("workspaces.packages")).toEqual(["packages/*"]);
		expect(manifestLeaves(MAIN).has("workspaces.catalog.zod")).toBe(false);
		expect(manifestLeaves(undefined).size).toBe(0);
	});
});

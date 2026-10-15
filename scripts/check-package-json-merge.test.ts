import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { manifestViolations } from "./check-package-json-merge";
import { type Manifest, isZetaOwnedPath, manifestLeaves } from "./merge-package-json";

/**
 * The guard's contract: a merge that drops or reverts a branch-side manifest leaf
 * is RED. The failure-mode fixtures below are shaped like the real damage —
 * `packageManager` reverted to the merged-in side's value, `scripts` entries that
 * vanish, a dependency the branch deleted and the merge brought back.
 *
 * The final block is the incident itself: the real v18.10.0 merge manifests and
 * the pre-rewrite driver's recorded output on them (`__fixtures__/package-json-merge`,
 * see `merge-package-json.test.ts` for the provenance). It pins the guard's
 * non-vacuity — the guard must name every leaf that merge erased.
 */
const fixturesDir = path.join(import.meta.dir, "__fixtures__", "package-json-merge");

const fixture = (name: string): Manifest =>
	JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), "utf-8")) as Manifest;

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

	test("reports a branch-side deletion the merge undid", () => {
		// `chore(toolchain): TypeScript 7 stable tsc + bun 1.4.3` removed the preview
		// dependency; the merge brought it back from the pre-branch manifest.
		const ancestor = at({ devDependencies: { "@typescript/native-preview": "catalog:" } });
		const branch = at({ devDependencies: {} });
		expect(manifestViolations({ branch, ancestor, merged: ancestor, head: ancestor })).toEqual([
			{
				kind: "reverted",
				path: "devDependencies.@typescript/native-preview",
				branchValue: "<absent>",
				mergedValue: '"catalog:"',
			},
		]);
		// A merge taking an upstream value instead is not branch-side loss.
		expect(
			manifestViolations({
				branch,
				ancestor,
				merged: at({ devDependencies: { "@typescript/native-preview": "^7.0.1" } }),
				head: at({ devDependencies: { "@typescript/native-preview": "^7.0.1" } }),
			}),
		).toEqual([]);
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

	test("clears a resurrected deletion once HEAD deletes it again", () => {
		const ancestor = at({ devDependencies: { "@typescript/native-preview": "catalog:" } });
		const branch = at({ devDependencies: {} });
		expect(
			manifestViolations({
				branch,
				ancestor,
				merged: ancestor, // the merge brought it back
				head: branch, // a later commit removed it again
			}),
		).toEqual([]);
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

	test("checks the sections the driver merges itself, including the catalog", () => {
		// A Zeta-only dependency the merge dropped (the incident's `figlet`).
		expect(
			manifestViolations({
				branch: at({ devDependencies: { "zeta-only": "1.0.0" } }),
				ancestor: at(),
				merged: at(),
				head: at(),
			}).map(violation => `${violation.kind}:${violation.path}`),
		).toEqual(["dropped:devDependencies.zeta-only"]);

		// An exact catalog pin degraded to the merged-in side's caret (the incident's
		// `@types/bun`: "1.4.3" → "^1.3.14").
		const ancestor = at({ workspaces: { ...MAIN.workspaces, catalog: { zod: "3.25.76", "@types/bun": "^1.3.14" } } });
		expect(
			manifestViolations({
				branch: at({ workspaces: { ...MAIN.workspaces, catalog: { zod: "3.25.76", "@types/bun": "1.4.3" } } }),
				ancestor,
				merged: ancestor,
				head: ancestor,
			}),
		).toEqual([
			{
				kind: "reverted",
				path: "workspaces.catalog.@types/bun",
				branchValue: '"1.4.3"',
				mergedValue: '"^1.3.14"',
			},
		]);
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

describe("the guard on the v18.10.0 incident", () => {
	const incident = (name: "root" | "natives") => ({
		branch: fixture(`${name}.ours`),
		ancestor: fixture(`${name}.base`),
		merged: fixture(`${name}.merged-prefix`),
		head: fixture(`${name}.merged-prefix`),
	});

	test("names every leaf the pre-rewrite driver erased in the root manifest", () => {
		expect(manifestViolations(incident("root")).map(violation => `${violation.kind}:${violation.path}`)).toEqual([
			"reverted:devDependencies.@typescript/native-preview",
			"dropped:devDependencies.figlet",
			"reverted:packageManager",
			"dropped:scripts.check:nix-bun",
			"dropped:scripts.check:relay-assets",
			"dropped:scripts.ci:release:publish-plugin",
			"dropped:scripts.ci:release:publish-web-ui",
			"dropped:scripts.gen:brand-art",
			"dropped:scripts.gen:relay-assets",
			"reverted:scripts.robomp:install",
			"reverted:scripts.test:py",
			"reverted:workspaces.catalog.@types/babel__generator",
			"reverted:workspaces.catalog.@types/babel__traverse",
			"reverted:workspaces.catalog.@types/bun",
			"reverted:workspaces.catalog.@types/react",
			"reverted:workspaces.catalog.@types/react-dom",
			"reverted:workspaces.catalog.@typescript/native-preview",
			"reverted:workspaces.packages",
		]);
	});

	test("names the reverted `tsc` switch in packages/natives", () => {
		expect(manifestViolations(incident("natives"))).toEqual([
			{
				kind: "reverted",
				path: "scripts.check:types",
				branchValue: '"tsc -p tsconfig.json --noEmit"',
				mergedValue: '"tsgo -p tsconfig.json --noEmit"',
			},
		]);
	});
});

describe("isZetaOwnedPath", () => {
	test("covers the brand surface, the Bun pin and the Python entry points", () => {
		for (const owned of ["name", "version", "bin", "homepage", "repository", "bugs", "keywords"]) {
			expect(isZetaOwnedPath(owned)).toBe(true);
		}
		// The nested identity subtrees the driver keeps whole.
		expect(isZetaOwnedPath("repository.url")).toBe(true);
		expect(isZetaOwnedPath("author.name")).toBe(true);
		expect(isZetaOwnedPath("packageManager")).toBe(true);
		expect(isZetaOwnedPath("scripts.test:py")).toBe(true);
		expect(isZetaOwnedPath("scripts.robomp:install")).toBe(true);
		// Everything the driver protects structurally is *not* a keep-list entry:
		// the guard checks those leaves, which is what makes it catch the incident.
		for (const checked of [
			"scripts.check:nix-bun",
			"devDependencies.figlet",
			"workspaces.packages",
			"workspaces.catalog.@types/bun",
			"dependencies.@linxiraos/pi-ai",
		]) {
			expect(isZetaOwnedPath(checked)).toBe(false);
		}
	});
});

describe("manifestLeaves", () => {
	test("flattens nested keys and keeps arrays, owned subtrees and section keys visible", () => {
		expect([...manifestLeaves(MAIN).keys()].sort()).toEqual([
			"dependencies.zod",
			"name",
			"packageManager",
			"scripts.check:ts",
			"scripts.gen:models",
			"version",
			"workspaces.catalog.@linxiraos/pi-ai",
			"workspaces.catalog.zod",
			"workspaces.packages",
		]);
		expect(manifestLeaves(MAIN).get("workspaces.packages")).toEqual(["packages/*"]);
		expect(manifestLeaves(MAIN).get("dependencies.zod")).toBe("4.0.0");
		// An owned key is one leaf: its subtree is the branch side's value.
		expect([...manifestLeaves({ author: { name: "Stencil Labs, Inc.", url: "https://stencil.so" } }).keys()]).toEqual(
			["author"],
		);
		expect(manifestLeaves(undefined).size).toBe(0);
	});
});

import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	type Manifest,
	erasureViolations,
	manifestLeaves,
	mergeCatalog,
	mergeDependencySection,
	mergeManifests,
	zetaKeyFor,
} from "./merge-package-json";

/**
 * The fixtures are the REAL manifests of the 2026-10-15 v18.10.0 sync merge, not
 * shapes invented for the test — the merge that silently erased Zeta-only
 * package.json content (measured against `main` before the driver rewrite):
 *
 *   git show bd4dffd5e617ce732f8a14249b0be1e6c7621886:package.json > root.base.json
 *   git show 2291ae3dc805679c803af9e265b7f9d1cbddcca2:package.json > root.ours.json
 *   git show b83200eb866821f02625332025b453f06ce4e12a:package.json > root.theirs.json
 *
 * (`bd4dffd5e6` = v18.9.2, the previous integrated upstream tag and therefore the
 * merge-base; `2291ae3dc8` = main, the branch side; `b83200eb866` = the v18.10.0
 * tag, the merged-in side.) `natives.*` is the same triple for
 * `packages/natives/package.json`, the one manifest where upstream *also* changed
 * a leaf in that window (`scripts.bench:ipc`).
 *
 * `*.merged-prefix.json` is what the pre-rewrite driver wrote for that triple,
 * recorded from the incident; the tests below use it to keep the red case real —
 * if someone "fixes" the recording, the incident assertions fail.
 */
const fixturesDir = path.join(import.meta.dir, "__fixtures__", "package-json-merge");

const fixture = (name: string): Manifest =>
	JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), "utf-8")) as Manifest;

const incident = (manifest: "root" | "natives") => ({
	base: fixture(`${manifest}.base`),
	ours: fixture(`${manifest}.ours`),
	theirs: fixture(`${manifest}.theirs`),
	prefix: fixture(`${manifest}.merged-prefix`),
});

/** Dotted-path read, so an assertion names exactly one leaf. */
const at = (manifest: Manifest, keys: string[]): unknown =>
	keys.reduce<unknown>((value, key) => (value as Manifest | undefined)?.[key], manifest);

/**
 * The regression ledger captured from the real v18.10.0 sync merge
 * (`driver-loss-v18.10.0.json`: merge `6f89e908c67` versus pre-merge `main`
 * `2291ae3dc80`) — 29 leaves across 13 manifests the pre-rewrite driver dropped
 * or changed. Every entry below is one test: the ledger's recorded `driver`
 * value must still differ from `main`'s (the red case stays real) and the
 * rewritten driver must ship `main`'s value for it.
 */
const LOSS_LEDGER = JSON.parse(fs.readFileSync(path.join(fixturesDir, "driver-loss-v18.10.0.json"), "utf-8")) as {
	files: Record<
		string,
		Array<{ key: string; main: string | null; driver: string | null; kind: "changed" | "dropped" }>
	>;
};

/** `package.json` → `root`, `packages/agent/package.json` → `agent` (the fixture key). */
const manifestKey = (file: string) =>
	file.replace(/^packages\/(.+)\/package\.json$/, "$1").replace(/^package\.json$/, "root");

/** The ledger stores scalars raw and arrays as JSON text; normalise both to a value. */
const ledgerValue = (raw: string | null): unknown =>
	raw === null ? undefined : raw.startsWith("[") || raw.startsWith("{") ? JSON.parse(raw) : raw;

/** Every Zeta-only script that must survive a merge, with the command `main` ships. */
const ZETA_ONLY_SCRIPTS: Record<string, string> = {
	"check:nix-bun": "bun scripts/check-nix-bun-freshness.ts",
	"check:relay-assets": "bun scripts/check-extension-assets-freshness.ts",
	"ci:release:publish-web-ui": "bun scripts/ci-release-publish.ts --web-ui",
	"ci:release:publish-plugin": "bun scripts/ci-release-publish.ts --plugin plugins/official/pi-messenger",
	"gen:relay-assets": "bun --cwd=packages/browser-relay run gen:assets",
	"gen:brand-art": "bun scripts/brand/generate-logo-art.ts",
};

/** Exact catalog pins the Zeta toolchain commit set; upstream's caret floor must not replace them. */
const EXACT_CATALOG_PINS: Record<string, string> = {
	"@types/babel__generator": "7.27.0",
	"@types/babel__traverse": "7.28.0",
	"@types/bun": "1.4.3",
	"@types/react": "19.3.0",
	"@types/react-dom": "19.3.0",
};

describe("the v18.10.0 sync incident, replayed on the real manifests", () => {
	it("keeps every Zeta-only leaf the pre-rewrite driver erased", () => {
		const { base, ours, theirs } = incident("root");
		const merged = mergeManifests(base, ours, theirs);

		// `packageManager`: the exact Bun pin, not upstream's floor.
		expect(at(merged, ["packageManager"])).toBe("bun@1.4.3");

		// `workspaces.packages[1]`: the plugin workspace glob.
		expect(at(merged, ["workspaces", "packages"])).toEqual(["packages/*", "plugins/*", "python/robomp/web"]);

		// The six Zeta-only scripts.
		for (const [script, command] of Object.entries(ZETA_ONLY_SCRIPTS)) {
			expect(at(merged, ["scripts", script])).toBe(command);
		}

		// The Python entry points still target the tree that exists here.
		expect(at(merged, ["scripts", "test:py"])).toBe(
			"python3 -m pytest -x sdk/python/zeta-rpc/tests && python3 -m pytest -x python/robomp/tests",
		);
		expect(at(merged, ["scripts", "robomp:install"])).toBe(
			"pip install -e sdk/python/zeta-rpc -e 'python/robomp[dev]'",
		);

		// A Zeta-only dependency.
		expect(at(merged, ["devDependencies", "figlet"])).toBe("1.8.0");

		// The exact catalog pins (upstream carries carets at lower floors).
		expect(at(merged, ["workspaces", "catalog"])).toMatchObject(EXACT_CATALOG_PINS);
		// …and the pin `chore(toolchain): TypeScript 7 stable tsc + bun 1.4.3` removed stays removed.
		expect(at(merged, ["workspaces", "catalog", "@typescript/native-preview"])).toBeUndefined();
		expect(at(merged, ["devDependencies", "@typescript/native-preview"])).toBeUndefined();

		// Nothing else moved in this window, so the merge result *is* the branch side.
		// (The pre-rewrite driver's result differs from it in 18 leaves.)
		expect(merged).toEqual(ours);
	});

	it("records the pre-rewrite output, so the red case stays real", () => {
		const { prefix, ours, theirs } = incident("root");
		expect(at(prefix, ["packageManager"])).toBe("bun@>=1.4");
		expect(at(prefix, ["workspaces", "packages"])).toEqual(["packages/*", "python/robomp/web"]);
		expect(at(prefix, ["devDependencies", "figlet"])).toBeUndefined();
		expect(at(prefix, ["scripts", "check:nix-bun"])).toBeUndefined();
		// The recording carries the merged-in side's Python SDK targets verbatim (the
		// defect) while the branch side's own targets must survive the rewrite.
		expect(at(prefix, ["scripts", "test:py"])).toBe(at(theirs, ["scripts", "test:py"]));
		expect(at(prefix, ["scripts", "robomp:install"])).toBe(at(theirs, ["scripts", "robomp:install"]));
		expect(at(ours, ["scripts", "test:py"])).toContain("sdk/python/zeta-rpc");
		expect(at(prefix, ["workspaces", "catalog", "@types/bun"])).toBe("^1.3.14");
		expect(at(prefix, ["devDependencies", "@typescript/native-preview"])).toBe("catalog:");
		expect(at(incident("natives").prefix, ["scripts", "check:types"])).toBe("tsgo -p tsconfig.json --noEmit");
	});

	it("refuses that result: erasureViolations names every leaf the merge lost", () => {
		const { base, ours, theirs, prefix } = incident("root");
		expect(erasureViolations(base, ours, theirs, prefix)).toEqual([
			"devDependencies.@typescript/native-preview",
			"devDependencies.figlet",
			"packageManager",
			"scripts.check:nix-bun",
			"scripts.check:relay-assets",
			"scripts.ci:release:publish-plugin",
			"scripts.ci:release:publish-web-ui",
			"scripts.gen:brand-art",
			"scripts.gen:relay-assets",
			"scripts.robomp:install",
			"scripts.test:py",
			"workspaces.catalog.@types/babel__generator",
			"workspaces.catalog.@types/babel__traverse",
			"workspaces.catalog.@types/bun",
			"workspaces.catalog.@types/react",
			"workspaces.catalog.@types/react-dom",
			"workspaces.catalog.@typescript/native-preview",
			"workspaces.packages",
		]);
		// The result the driver now produces trips nothing.
		expect(erasureViolations(base, ours, theirs, mergeManifests(base, ours, theirs))).toEqual([]);
	});

	it("keeps the 17-package `tsc` switch and lands upstream's one genuine change", () => {
		const { base, ours, theirs, prefix } = incident("natives");
		const merged = mergeManifests(base, ours, theirs);

		// The deliberate `tsgo`→`tsc` switch (`chore(toolchain): …`) survives; the
		// pre-rewrite driver reverted it in every package manifest that has the script.
		expect(at(merged, ["scripts", "check:types"])).toBe("tsc -p tsconfig.json --noEmit");
		expect(at(prefix, ["scripts", "check:types"])).toBe("tsgo -p tsconfig.json --noEmit");

		// Positive control: a genuine upstream change to an unowned leaf still lands.
		expect(at(merged, ["scripts", "bench:ipc"])).toBe("bun bench/ipc.ts");

		// …and it is the only difference from the branch side.
		expect(merged).toEqual({ ...ours, scripts: { ...(ours.scripts as Manifest), "bench:ipc": "bun bench/ipc.ts" } });
		expect(erasureViolations(base, ours, theirs, merged)).toEqual([]);
	});
});

describe("the PR #200 driver-loss ledger, entry by entry", () => {
	const files = Object.entries(LOSS_LEDGER.files);

	it("is the captured incident: 13 manifests, 29 leaves", () => {
		expect(files).toHaveLength(13);
		expect(files.reduce((count, [, entries]) => count + entries.length, 0)).toBe(29);
	});

	for (const [file, entries] of files) {
		const key = manifestKey(file);
		const base = fixture(`${key}.base`);
		const ours = fixture(`${key}.ours`);
		const theirs = fixture(`${key}.theirs`);
		const merged = mergeManifests(base, ours, theirs);

		it(`${file}: merges without losing a branch-side leaf`, () => {
			expect(erasureViolations(base, ours, theirs, merged)).toEqual([]);
		});

		for (const entry of entries) {
			it(`${file} ${entry.kind} ${entry.key}`, () => {
				// The ledger recorded a real loss, so the assertion is not vacuous…
				expect(ledgerValue(entry.driver)).not.toEqual(ledgerValue(entry.main));
				// …and the rewrite does not reproduce it.
				expect(manifestLeaves(merged).get(entry.key)).toEqual(ledgerValue(entry.main));
			});
		}
	}
});

describe("merge rules", () => {
	it("keeps the exact packageManager pin when upstream raises its own floor", () => {
		const merged = mergeManifests(
			{ packageManager: "bun@>=1.4" },
			{ packageManager: "bun@1.4.3" },
			{ packageManager: "bun@>=1.5" },
		);
		expect(merged.packageManager).toBe("bun@1.4.3");
	});

	it("keeps a Zeta-only script upstream also ships under the same name", () => {
		const merged = mergeManifests(
			{ scripts: { build: "bun run build" } },
			{ scripts: { build: "bun run build", ...ZETA_ONLY_SCRIPTS } },
			{ scripts: { build: "bun run build", "check:nix-bun": "upstream-nix-check" } },
		);
		expect(merged.scripts).toEqual({ build: "bun run build", ...ZETA_ONLY_SCRIPTS });
	});

	it("keeps a Zeta-only dependency that upstream introduces too", () => {
		const merged = mergeManifests(
			{ devDependencies: { oxlint: "catalog:" } },
			{ devDependencies: { oxlint: "catalog:", figlet: "1.8.0" } },
			{ devDependencies: { oxlint: "catalog:", figlet: "2.0.0" } },
		);
		expect(merged.devDependencies).toEqual({ oxlint: "catalog:", figlet: "1.8.0" });
	});

	it("unions the workspace globs: `plugins/*` survives, upstream additions land", () => {
		const merged = mergeManifests(
			{ workspaces: { packages: ["packages/*", "python/robomp/web"] } },
			{ workspaces: { packages: ["packages/*", "plugins/*", "python/robomp/web"] } },
			{ workspaces: { packages: ["packages/*", "python/robomp/web", "examples/*"] } },
		);
		expect(merged.workspaces).toEqual({
			packages: ["packages/*", "plugins/*", "python/robomp/web", "examples/*"],
		});
	});

	it("keeps exact catalog pins exact even when upstream moves its own caret", () => {
		const base = { "@types/bun": "^1.3.14", "@types/react": "^19.2.17", zod: "3.25.76" };
		const merged = mergeCatalog(
			{ ...base, "@types/bun": "1.4.3", "@types/react": "19.3.0" },
			{ ...base, "@types/bun": "^1.3.15" },
			base,
		);
		expect(merged["@types/bun"]).toBe("1.4.3");
		expect(merged["@types/react"]).toBe("19.3.0");
		expect(merged.zod).toBe("3.25.76");
	});

	it("keeps the Zeta-scope catalog pins on the Zeta version line", () => {
		const merged = mergeCatalog(
			{ "@linxiraos/pi-ai": "1.2.1", "@linxiraos/pi-channels": "1.2.1" },
			{ "@oh-my-pi/pi-ai": "18.10.0", "@oh-my-pi/pi-newcomer": "18.10.0" },
			{ "@oh-my-pi/pi-ai": "18.9.2" },
		);
		expect(merged).toEqual({
			"@linxiraos/pi-ai": "1.2.1",
			"@linxiraos/pi-channels": "1.2.1",
			"@linxiraos/pi-newcomer": "18.10.0",
		});
	});

	it("keeps the Zeta-scope dependency versions and names", () => {
		const merged = mergeDependencySection(
			{ "@linxiraos/pi-ai": "catalog:", "@linxiraos/pi-channels": "catalog:", zod: "3.25.76" },
			{ "@oh-my-pi/pi-ai": "catalog:", zod: "4.0.0" },
			{ "@oh-my-pi/pi-ai": "catalog:", zod: "3.25.76" },
		);
		expect(merged).toEqual({
			"@linxiraos/pi-ai": "catalog:",
			"@linxiraos/pi-channels": "catalog:",
			zod: "4.0.0",
		});
		expect(Object.keys(merged).some(key => key.startsWith("@oh-my-pi/"))).toBeFalse();
	});

	it("keeps a Zeta-only dependency and adopts upstream's new package under its Zeta name", () => {
		const merged = mergeDependencySection(
			{ "@linxiraos/pi-channels": "catalog:" },
			{ "@oh-my-pi/pi-newcomer": "^18.10.0" },
			{},
		);
		expect(merged).toEqual({ "@linxiraos/pi-channels": "catalog:", "@linxiraos/pi-newcomer": "^18.10.0" });
	});

	it("lands an upstream dependency bump, an upstream addition and an upstream deletion", () => {
		const merged = mergeManifests(
			{ dependencies: { zod: "3.25.76", diff: "^9.0.0" }, devDependencies: { oxlint: "catalog:" } },
			{ dependencies: { zod: "3.25.76", diff: "^9.0.0" }, devDependencies: { oxlint: "catalog:" } },
			{ dependencies: { zod: "4.0.0", katex: "^0.18.4" } },
		);
		expect(merged.dependencies).toEqual({ zod: "4.0.0", katex: "^0.18.4" });
		expect(merged.devDependencies).toBeUndefined();
	});

	it("applies an upstream change to an unowned leaf, and upstream's value when both sides moved it", () => {
		const merged = mergeManifests(
			{ type: "module", engines: { bun: ">=1.3.14" } },
			{ type: "module", engines: { bun: ">=1.4.3" } },
			{ type: "module", engines: { bun: ">=1.5.0" }, scripts: { bench: "bun bench/grep.ts" } },
		);
		// Both sides moved `engines.bun` off the base: upstream wins (merge doctrine).
		expect(merged.engines).toEqual({ bun: ">=1.5.0" });
		// A branch-side move upstream did not touch survives.
		expect(merged.scripts).toEqual({ bench: "bun bench/grep.ts" });
	});

	it("reports the values it kept over the merged-in side, so a merge is not silent", () => {
		const rejected: string[] = [];
		mergeManifests(
			{ name: "omp", version: "18.9.2" },
			{ name: "zeta", version: "1.2.1" },
			{ name: "omp", version: "18.10.0" },
			rejected,
		);
		expect(rejected).toEqual([
			'name: kept "zeta" over the merged-in "omp"',
			'version: kept "1.2.1" over the merged-in "18.10.0"',
		]);
	});

	it("keeps a branch-side deletion upstream did not touch", () => {
		const merged = mergeManifests(
			{ devDependencies: { "@typescript/native-preview": "catalog:", oxlint: "catalog:" } },
			{ devDependencies: { oxlint: "catalog:" } },
			{ devDependencies: { "@typescript/native-preview": "catalog:", oxlint: "catalog:" } },
		);
		expect(merged.devDependencies).toEqual({ oxlint: "catalog:" });
	});
});

describe("zetaKeyFor", () => {
	it("maps the upstream scope to the Zeta scope with rename awareness", () => {
		expect(zetaKeyFor("@oh-my-pi/pi-ai")).toBe("@linxiraos/pi-ai");
		expect(zetaKeyFor("@oh-my-pi/pi-omptype")).toBe("@linxiraos/pi-omptype");
		expect(zetaKeyFor("@oh-my-pi/omp-stats")).toBe("@linxiraos/pi-stats");
		expect(zetaKeyFor("@oh-my-pi/pi-coding-agent")).toBe("@linxiraos/zeta");
	});

	it("maps upstream's original @mariozechner author scope the same way", () => {
		// Historical manifests (and vendored plugin manifests) still declare the
		// pre-@oh-my-pi scope; unmapped keys re-create the install-smoke
		// "Cannot find package '@mariozechner/pi-coding-agent'" failure class.
		expect(zetaKeyFor("@mariozechner/pi-coding-agent")).toBe("@linxiraos/zeta");
		expect(zetaKeyFor("@mariozechner/pi-ai")).toBe("@linxiraos/pi-ai");
		expect(zetaKeyFor("@mariozechner/omptype")).toBe("@linxiraos/pi-omptype");
		expect(zetaKeyFor("@mariozechner/pi-natives")).toBe("@linxiraos/pi-natives");
	});

	it("returns null for non-upstream keys", () => {
		expect(zetaKeyFor("@linxiraos/pi-ai")).toBeNull();
		expect(zetaKeyFor("zod")).toBeNull();
		expect(zetaKeyFor("@acme/thing")).toBeNull();
	});
});

/**
 * The reproduction end to end: a real `git merge` in a scratch repository, with
 * `.gitattributes` and `merge.zeta-package` wired to the real driver, carrying
 * the real manifests — and the guard (`--repo`) run on the merge commit.
 */
describe("a real git merge through the driver", () => {
	const scratch: string[] = [];

	const sh = (dir: string, cmd: string[]) => Bun.spawnSync(cmd, { cwd: dir, stdout: "pipe", stderr: "pipe" });
	/** Git runs the driver through a shell, which eats backslashes: config needs POSIX separators. */
	const shPath = (value: string) => value.replaceAll("\\", "/");

	function repo(name: string): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zeta-pkgjson-${name}-`));
		scratch.push(dir);
		fs.mkdirSync(path.join(dir, "packages", "natives"), { recursive: true });
		fs.writeFileSync(
			path.join(dir, ".gitattributes"),
			"* text=auto eol=lf\npackage.json merge=zeta-package\npackages/*/package.json merge=zeta-package\n",
		);
		sh(dir, ["git", "init", "-q", "-b", "zeta"]);
		sh(dir, ["git", "config", "user.email", "repro@example.invalid"]);
		sh(dir, ["git", "config", "user.name", "repro"]);
		sh(dir, ["git", "config", "merge.zeta-package.name", "Zeta package.json merge driver"]);
		// `ZETA_MERGE_DRIVER` is the seam that re-derives the red case: point it at
		// any other revision of the driver (e.g. `git show <sha>:scripts/merge-package-json.ts`
		// written to a temp file) and the merge below reproduces that revision's output.
		const driver = process.env.ZETA_MERGE_DRIVER ?? path.join(import.meta.dir, "merge-package-json.ts");
		sh(dir, ["git", "config", "merge.zeta-package.driver", `bun ${shPath(driver)} %A %O %B`]);
		return dir;
	}

	const copy = (dir: string, source: string, target: string) =>
		fs.copyFileSync(path.join(fixturesDir, source), path.join(dir, target));

	const commit = (dir: string, message: string) => {
		sh(dir, ["git", "add", "-A"]);
		sh(dir, ["git", "commit", "-qm", message]);
	};

	/** base commit + `upstream` (theirs) + `zeta` (ours), as the sync merge had them. */
	function stageIncident(dir: string): void {
		copy(dir, "root.base.json", "package.json");
		copy(dir, "natives.base.json", "packages/natives/package.json");
		commit(dir, "base: v18.9.2");
		sh(dir, ["git", "tag", "base"]);

		sh(dir, ["git", "checkout", "-qb", "upstream"]);
		copy(dir, "root.theirs.json", "package.json");
		copy(dir, "natives.theirs.json", "packages/natives/package.json");
		commit(dir, "upstream: v18.10.0");

		sh(dir, ["git", "checkout", "-q", "zeta"]);
		copy(dir, "root.ours.json", "package.json");
		copy(dir, "natives.ours.json", "packages/natives/package.json");
		commit(dir, "zeta: main");
	}

	const read = (dir: string, file: string): Manifest =>
		JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as Manifest;

	afterAll(() => {
		// Best effort: Windows keeps a handle on the .git directory of a repo git
		// touched seconds ago, and a leftover temp directory is not a test failure.
		for (const dir of scratch) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// ignored
			}
		}
	});

	it("merges the real triple without losing branch-side content", () => {
		const dir = repo("green");
		stageIncident(dir);

		const merge = sh(dir, ["git", "merge", "upstream", "--no-edit"]);
		expect(merge.exitCode).toBe(0);
		expect(merge.stderr.toString()).not.toContain("CONFLICT");
		expect(sh(dir, ["git", "status", "--short"]).stdout.toString().trim()).toBe("");

		const merged = read(dir, "package.json");
		expect(merged).toEqual(fixture("root.ours"));
		expect(at(read(dir, "packages/natives/package.json"), ["scripts", "bench:ipc"])).toBe("bun bench/ipc.ts");

		const guard = sh(dir, [
			"bun",
			path.join(import.meta.dir, "check-package-json-merge.ts"),
			"--repo",
			dir,
			"--base",
			"base",
		]);
		expect(guard.stderr.toString()).not.toContain("FAILED");
		expect(guard.stdout.toString()).toContain("no branch-side leaf dropped or reverted");
	}, 120_000);

	it("goes red on the recorded pre-rewrite result of the same merge", () => {
		const dir = repo("red");
		stageIncident(dir);

		// Replay: perform the real merge, then put the pre-rewrite driver's recorded
		// output into the merge commit — the incident's tree with its real parents.
		sh(dir, ["git", "merge", "upstream", "--no-edit", "--no-commit"]);
		copy(dir, "root.merged-prefix.json", "package.json");
		copy(dir, "natives.merged-prefix.json", "packages/natives/package.json");
		commit(dir, "merge upstream (pre-rewrite driver output)");

		const guard = sh(dir, [
			"bun",
			path.join(import.meta.dir, "check-package-json-merge.ts"),
			"--repo",
			dir,
			"--base",
			"base",
		]);
		expect(guard.exitCode).toBe(1);
		const reported = guard.stderr.toString();
		for (const leaf of [
			"devDependencies.figlet",
			"packageManager",
			"scripts.check:nix-bun",
			"scripts.gen:brand-art",
			"scripts.test:py",
			"workspaces.catalog.@types/bun",
			"workspaces.packages",
			"scripts.check:types",
		]) {
			expect(reported).toContain(`"${leaf}"`);
		}
	}, 120_000);
});

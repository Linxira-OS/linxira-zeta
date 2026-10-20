import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";
import { LEAF_TARGETS, SHIPPED_LEAF_TAGS } from "../packages/natives/scripts/gen-npm-packages";
import { SHIPPED_CLI_ASSETS, shippedCliAssetName } from "../packages/utils/src/release-assets";
import { buildNativeOptionalDependencies } from "./ci-release-publish";
import { mainWorkspaceMembers, pinnedWorkspaceVersions, rewriteWorkspaceVersions } from "./cargo-workspace-lock";
import { leafStampProblem, STAMP_SUFFIX, type LeafStamp, WORKBENCH_LEAVES } from "./workbench-leaves";

const ROOT = path.resolve(import.meta.dir, "..");
const WORKFLOW = ".github/workflows/ci.yml";
const STAGED_DIR = "packages/coding-agent/binaries";

interface WorkflowJob {
	steps?: Array<{ name?: string; run?: string; with?: { files?: unknown } }>;
	strategy?: { matrix?: { include?: Array<{ target_id?: string; binary_path?: string }> } };
}
interface Workflow {
	jobs?: Record<string, WorkflowJob>;
}

const workflow = parse(fs.readFileSync(path.join(ROOT, WORKFLOW), "utf8")) as Workflow;

function stepRun(job: string, step: string): string {
	return workflow.jobs?.[job]?.steps?.find(candidate => candidate.name === step)?.run ?? "";
}

describe("main/ Cargo workspace lock", () => {
	it("rewrites every workspace member, not just zeta-main", () => {
		const members = mainWorkspaceMembers().map(member => member.name);
		// Derived from main/Cargo.toml + each member manifest: a new crate joins
		// the bump automatically, and a rename updates both sides at once.
		expect(members.length).toBeGreaterThan(1);
		expect(members).toContain("zeta-main");
		expect(members).toContain("zetawork-gui");
		expect(members).toContain("sysmon");
		expect(members).toContain("workbench-projects");

		const lock = fs.readFileSync(path.join(ROOT, "main", "Cargo.lock"), "utf8");
		const { lock: bumped, rewritten } = rewriteWorkspaceVersions(lock, members, "9.9.9");
		expect(rewritten.sort()).toEqual([...members].sort());
		const pinnedAfter = pinnedWorkspaceVersions(bumped, members);
		for (const name of members) expect(pinnedAfter.get(name)).toBe("9.9.9");
		// Only member entries move: an unrelated path dependency keeps its own line.
		expect(bumped).toContain('name = "termide-core"');
	});

	it("throws when a workspace member has no lock entry", () => {
		expect(() =>
			rewriteWorkspaceVersions(
				'[[package]]\nname = "zeta-main"\nversion = "1.0.0"\n',
				["zeta-main", "ghost"],
				"2.0.0",
			),
		).toThrow("ghost");
	});

	it("has every member of the committed lock on the manifest version", () => {
		const manifestVersion = /\[workspace\.package\][^[]*?version = "([^"]+)"/s.exec(
			fs.readFileSync(path.join(ROOT, "main", "Cargo.toml"), "utf8"),
		)?.[1];
		const lock = fs.readFileSync(path.join(ROOT, "main", "Cargo.lock"), "utf8");
		const pinned = pinnedWorkspaceVersions(
			lock,
			mainWorkspaceMembers().map(member => member.name),
		);
		for (const member of mainWorkspaceMembers()) {
			expect(pinned.get(member.name)).toBe(manifestVersion);
		}
	});
});

describe("native leaf single source of truth", () => {
	it("pins exactly the leaves the release publishes", () => {
		const pins = Object.keys(buildNativeOptionalDependencies("9.9.9"));
		expect(pins.sort()).toEqual(SHIPPED_LEAF_TAGS.map(tag => `@linxiraos/pi-natives-${tag}`).sort());
		// Every shipped tag is a real buildable target (never a pin for a leaf
		// the generator cannot produce).
		for (const tag of SHIPPED_LEAF_TAGS) {
			expect(LEAF_TARGETS.map(target => target.tag)).toContain(tag);
		}
	});

	it("agrees with the updater's installable leaf set and the CI publish loop", () => {
		// Read, do not import: the updater's module graph reaches the native
		// loader, and this test has to run in the artifact-free `check` job.
		const updater = fs.readFileSync(path.join(ROOT, "packages/coding-agent/src/cli/update-cli.ts"), "utf8");
		const updaterTags = /SHIPPED_NATIVE_TAGS[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(updater)?.[1] ?? "";
		const updaterSet = [...updaterTags.matchAll(/"([^"]+)"/g)].map(match => match[1]);
		expect(updaterSet.sort()).toEqual([...SHIPPED_LEAF_TAGS].sort());
		const publishRun = stepRun("release_native_leaves", "Publish native leaf packages");
		const published = (/(?:^|\n)\s*for tag in ([^;\n]+);/.exec(publishRun)?.[1] ?? "").trim().split(/\s+/);
		expect(published.sort()).toEqual([...SHIPPED_LEAF_TAGS].sort());
	});

	it("downloads every shipped leaf's addon through the native-artifacts action", () => {
		const install = workflow.jobs?.release_native_leaves?.steps?.find(
			candidate => candidate.name === "Install native addons for the shipped leaves",
		);
		const targets = String((install?.with as { targets?: string } | undefined)?.targets ?? "");
		for (const target of ["linux-x64-baseline", "linux-x64-modern", "win32-x64-baseline"]) {
			expect(targets).toContain(target);
		}
		// The old raw `download-artifact pattern: native-addons-*` step matched
		// no artifact (the name is `native-addons`) and was dead weight.
		const patterns = (workflow.jobs?.release_native_leaves?.steps ?? [])
			.map(candidate => JSON.stringify(candidate.with ?? {}))
			.join("\n");
		expect(patterns).not.toContain("native-addons-*");
	});
});

describe("CLI asset / updater shipped matrix", () => {
	it("matches the release matrix's binary_path basenames", () => {
		const shipped = (workflow.jobs?.release_binary?.strategy?.matrix?.include ?? [])
			.map(entry => path.basename(entry.binary_path ?? ""))
			.filter(Boolean);
		expect(shipped.sort()).toEqual([...SHIPPED_CLI_ASSETS].sort());
	});

	it("never resolves an updater name outside the shipped set", () => {
		for (const platform of ["darwin", "linux", "win32"] as const) {
			for (const arch of ["x64", "arm64"] as const) {
				for (const musl of [false, true]) {
					if (musl && platform !== "linux") continue;
					const resolved = shippedCliAssetName(platform, arch, { musl });
					if (resolved !== undefined) expect(SHIPPED_CLI_ASSETS).toContain(resolved);
				}
			}
		}
		// darwin was trimmed from the release surface: no name, no 404.
		expect(shippedCliAssetName("darwin", "arm64")).toBeUndefined();
		expect(shippedCliAssetName("win32", "arm64")).toBeUndefined();
		expect(shippedCliAssetName("linux", "x64", { musl: true })).toBe("zeta-cli-linux-musl-x64");
	});
});

describe("release asset surfaces", () => {
	const upload = String(
		workflow.jobs?.release_github?.steps?.find(step => step.name === "Create GitHub Release")?.with?.files ?? "",
	);
	const checksums = stepRun("release_github", "Generate checksums");
	const preflight = stepRun("release_github", "Preflight release assets");

	it("uploads, hashes and preflights the same families", () => {
		for (const family of [
			`${STAGED_DIR}/zeta-cli-*`,
			`${STAGED_DIR}/zeta-work-*`,
			`${STAGED_DIR}/zeta-ide-*`,
			`${STAGED_DIR}/zetawork-*-setup-x64.exe`,
			`${STAGED_DIR}/zetawork-*-windows-x64.zip`,
			`${STAGED_DIR}/zetawork-*.AppImage`,
			`${STAGED_DIR}/zetawork-*.pkg.tar.zst`,
			"packages/browser-relay/dist/zeta-browser-relay-extension.zip",
			"plugins/dist/zeta-plugin-example-*.zip",
			"LICENSE",
			"THIRD-PARTY-NOTICES.txt",
		]) {
			expect(upload).toContain(family);
			expect(checksums).toContain(family);
		}
	});

	it("preflights the example-plugin zip and the four desktop archives", () => {
		expect(preflight).toContain("plugins/dist/zeta-plugin-example-*.zip");
		expect(preflight).toContain("packages/browser-relay/dist/zeta-browser-relay-extension.zip");
		for (const suffix of ["-setup-x64.exe", "-windows-x64.zip", ".AppImage", ".pkg.tar.zst"]) {
			expect(preflight).toContain(suffix);
		}
	});
});

describe("leaf freshness stamps", () => {
	it("stamps every workbench leaf binary at (or ahead of) its manifest version, over its exact bytes", () => {
		for (const leaf of WORKBENCH_LEAVES) {
			const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, leaf.dir, "package.json"), "utf8")) as {
				version?: string;
			};
			const binaryPath = path.join(ROOT, leaf.dir, "bin", leaf.binary);
			expect(fs.existsSync(binaryPath)).toBe(true);
			const stamp = JSON.parse(fs.readFileSync(`${binaryPath}${STAMP_SUFFIX}`, "utf8")) as LeafStamp;
			const actual = new Bun.CryptoHasher("sha256").update(fs.readFileSync(binaryPath)).digest("hex");
			expect(leafStampProblem(stamp, manifest.version ?? "", actual)).toBeUndefined();
		}
	});

	it("fails a stale stamp, a missing stamp and a mismatched payload", () => {
		const digest = "a".repeat(64);
		expect(leafStampProblem(undefined, "1.3.2", digest)).toContain("no stamp");
		expect(leafStampProblem({ version: "1.3.1", sha256: digest }, "1.3.2", digest)).toContain("not rebuilt");
		expect(leafStampProblem({ version: "1.3.2", sha256: digest }, "1.3.2", "b".repeat(64))).toContain(
			"sha256 does not match",
		);
		// A binary rebuilt ahead of the manifest is the repo's release ritual,
		// not drift: the bump commit lifts the manifest to it.
		expect(leafStampProblem({ version: "1.3.3", sha256: digest }, "1.3.2", digest)).toBeUndefined();
	});
});

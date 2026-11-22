import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";
import { LEAF_TARGETS, SHIPPED_LEAF_TAGS } from "../packages/natives/scripts/gen-npm-packages";
import { SHIPPED_CLI_ASSETS, shippedCliAssetName } from "../packages/utils/src/release-assets";
import { buildNativeOptionalDependencies, prepareStandalonePackage } from "./ci-release-publish";

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

describe("standalone npm package payload", () => {
	it("packs notices alongside the allowlisted payload", async () => {
		const scratch = path.join(ROOT, "temp");
		fs.mkdirSync(scratch, { recursive: true });
		const fixture = fs.mkdtempSync(path.join(scratch, "release-package-"));
		try {
			fs.writeFileSync(
				path.join(fixture, "package.json"),
				JSON.stringify({ name: "release-payload-fixture", version: "1.0.0", license: "MIT", files: ["bin"] }),
			);
			fs.mkdirSync(path.join(fixture, "bin"));
			fs.writeFileSync(path.join(fixture, "bin", "fixture"), "payload");
			await prepareStandalonePackage(fixture, true);
			const pack = Bun.spawnSync([process.execPath, "pm", "pack", "--quiet"], { cwd: fixture });
			expect(pack.exitCode, pack.stderr.toString()).toBe(0);
			const archive = path.join(fixture, "release-payload-fixture-1.0.0.tgz");
			for (const filename of ["LICENSE", "THIRD-PARTY-NOTICES.txt"]) {
				const entry = Bun.spawnSync(["tar", "-xOzf", archive, `package/${filename}`]);
				expect(entry.exitCode, entry.stderr.toString()).toBe(0);
				expect(entry.stdout.equals(fs.readFileSync(path.join(ROOT, filename)))).toBe(true);
			}
			const payload = Bun.spawnSync(["tar", "-xOzf", archive, "package/bin/fixture"]);
			expect(payload.stdout.toString()).toBe("payload");
		} finally {
			fs.rmSync(fixture, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform !== "linux")("packs both Linux payloads as executables", async () => {
		const scratch = path.join(ROOT, "temp");
		fs.mkdirSync(scratch, { recursive: true });
		for (const [name, filename] of [
			["ide", "termide-linux-x64"],
			["editor", "termide-editor-linux-x64"],
		]) {
			const fixture = fs.mkdtempSync(path.join(scratch, "release-package-mode-"));
			try {
				const pkg = `@linxiraos/${name}-linux-x64`;
				fs.writeFileSync(
					path.join(fixture, "package.json"),
					JSON.stringify({ name: pkg, version: "1.0.0", files: ["bin"] }),
				);
				fs.mkdirSync(path.join(fixture, "bin"));
				fs.writeFileSync(path.join(fixture, "bin", filename), "#!/bin/sh\nprintf 'ready\\n'\n", { mode: 0o644 });
				await prepareStandalonePackage(fixture, true);
				const pack = Bun.spawnSync([process.execPath, "pm", "pack", "--quiet"], { cwd: fixture });
				expect(pack.exitCode, pack.stderr.toString()).toBe(0);
				const archive = path.join(fixture, `linxiraos-${name}-linux-x64-1.0.0.tgz`);
				const extract = Bun.spawnSync(["tar", "-xzf", archive], { cwd: fixture });
				expect(extract.exitCode, extract.stderr.toString()).toBe(0);
				const launched = Bun.spawnSync([path.join(fixture, "package", "bin", filename)]);
				expect(launched.exitCode).toBe(0);
				expect(launched.stdout.toString()).toBe("ready\n");
			} finally {
				fs.rmSync(fixture, { recursive: true, force: true });
			}
		}
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
			`${STAGED_DIR}/zeta-ide-*`,
			"packages/browser-relay/dist/zeta-browser-relay-extension.zip",
			"plugins/dist/zeta-plugin-example-*.zip",
			"LICENSE",
			"THIRD-PARTY-NOTICES.txt",
		]) {
			expect(upload).toContain(family);
			expect(checksums).toContain(family);
		}
	});

	it("leaves the paused zetawork families off every release surface", () => {
		// zetawork is paused (2026-11-05 ruling): its TUI and the desktop
		// archives are not release assets, so none of the three surfaces may
		// name them — a leftover glob would silently re-publish a paused build.
		for (const family of [
			`${STAGED_DIR}/zeta-work-*`,
			`${STAGED_DIR}/linxira-zeta-*-setup-x64.exe`,
			`${STAGED_DIR}/linxira-zeta-*-windows-x64.zip`,
			`${STAGED_DIR}/linxira-zeta-*.AppImage`,
			`${STAGED_DIR}/linxira-zeta-*.pkg.tar.zst`,
		]) {
			expect(upload).not.toContain(family);
			expect(checksums).not.toContain(family);
		}
		expect(preflight).not.toMatch(/\/zeta-work-/u);
		expect(preflight).not.toMatch(
			/\/linxira-zeta-(?:\$\{?version\}?|\*)(?:-setup-x64\.exe|-windows-x64\.zip|\.AppImage|\.pkg\.tar\.zst)(?=["'\s]|$)/u,
		);
		expect(preflight).toContain("plugins/dist/zeta-plugin-example-*.zip");
		expect(preflight).toContain("packages/browser-relay/dist/zeta-browser-relay-extension.zip");
	});
});

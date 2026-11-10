/* eslint-disable no-template-curly-in-string -- these strings must stay verbatim */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { checkPackageLinkage, loadContext, validateLinkage } from "./check-package-linkage";

const ROOT = path.resolve(import.meta.dir, "..");
const MANIFEST = path.join(ROOT, "packaging/package-linkage.json");
const ctx = loadContext(ROOT);

interface MigrationRow {
	platform?: string;
	from?: { package?: string };
	samePackageName?: boolean;
	mechanism?: string;
	requiresUninstall?: boolean;
}

interface TestManifest {
	product: { appId: string };
	upstreamIdentity: { artifactNamePattern: string };
	migration: { rows: MigrationRow[] };
	packages: Array<{ name?: string; status?: string }>;
	verification: { claims: Array<{ id?: string; status?: string; evidence?: string }> };
}

interface WorkflowStep {
	run?: string;
	with?: { files?: string };
}

interface TestWorkflow {
	jobs: { release_github: { steps: WorkflowStep[] } };
}

/** The manifest is a checked-in fixture; the guard validates its shape. */
const manifest = () => JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as TestManifest;

describe("package linkage contract", () => {
	it("matches the repository's own identity, release assets and migration rules", () => {
		expect(checkPackageLinkage(ROOT)).toEqual([]);
	});

	it("rejects an appId that does not match electron-builder", () => {
		const mutated = manifest();
		mutated.product.appId = "com.example.other";
		expect(validateLinkage(mutated, ctx).join("\n")).toContain('product.appId must be "com.zeta.desktop"');
	});

	it("rejects an artifact pattern that drifts from artifactName", () => {
		const mutated = manifest();
		mutated.upstreamIdentity.artifactNamePattern = "zeta-${version}-{os}-{arch}.{ext}";
		expect(validateLinkage(mutated, ctx).join("\n")).toContain("artifactNamePattern renders");
	});

	it("rejects a different installer identity that does not require an uninstall", () => {
		const mutated = manifest();
		const windows = mutated.migration.rows.find(row => row.platform === "windows");
		expect(windows).toBeDefined();
		if (windows) windows.requiresUninstall = false;
		expect(validateLinkage(mutated, ctx).join("\n")).toContain(
			"different installer identity but does not require an uninstall",
		);
	});

	it("rejects a different package name claimed as an in-place upgrade", () => {
		const mutated = manifest();
		const row = mutated.migration.rows.find(candidate => candidate.from?.package === "linxira-zetawork");
		expect(row).toBeDefined();
		if (row) {
			row.samePackageName = false;
			row.mechanism = "in-place";
		}
		expect(validateLinkage(mutated, ctx).join("\n")).toContain(
			"different package name but claims an in-place mechanism",
		);
	});

	it("rejects the paused @linxiraos/main line as current", () => {
		const mutated = manifest();
		const main = mutated.packages.find(pkg => pkg.name === "@linxiraos/main");
		expect(main).toBeDefined();
		if (main) main.status = "current";
		expect(validateLinkage(mutated, ctx).join("\n")).toContain("@linxiraos/main must be marked paused");
	});

	it("rejects a release job that does not ship the manifest", () => {
		const mutatedWorkflow = structuredClone(ctx.workflow) as unknown as TestWorkflow;
		for (const step of mutatedWorkflow.jobs.release_github.steps) {
			if (typeof step.run === "string") step.run = step.run.replace("packaging/package-linkage.json", "");
			if (step.with && typeof step.with.files === "string") {
				step.with.files = step.with.files.replace("packaging/package-linkage.json", "");
			}
		}
		const problems = validateLinkage(manifest(), { ...ctx, workflow: mutatedWorkflow }).join("\n");
		expect(problems).toContain("release_github must upload packaging/package-linkage.json");
		expect(problems).toContain("checksums must cover packaging/package-linkage.json");
	});

	it("keeps every verified claim backed by evidence", () => {
		const mutated = manifest();
		const verified = mutated.verification.claims.find(claim => claim.status === "verified");
		expect(verified).toBeDefined();
		if (verified) verified.evidence = "";
		expect(validateLinkage(mutated, ctx).join("\n")).toContain("must be a non-empty string");
	});
});

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";
import {
	assertAssetsAllowed,
	assertPublishAllowed,
	assertTagAllowed,
	classifyReleaseVersion,
	evaluatePublishPolicy,
	INTERNAL_BUILD_MARKER,
	internalBuildTagMessage,
	RELEASE_FREEZE,
} from "./release-policy";

const ROOT = path.resolve(import.meta.dir, "..");

interface WorkflowJob {
	if?: unknown;
	steps?: Array<{ name?: string; run?: string; with?: Record<string, unknown> }>;
}
interface Workflow {
	on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } };
	jobs?: Record<string, WorkflowJob>;
}

function readWorkflow(rel: string): Workflow {
	return parse(fs.readFileSync(path.join(ROOT, rel), "utf8")) as Workflow;
}

function stepRun(job: WorkflowJob, name: string): string {
	return job.steps?.find(step => step.name === name)?.run ?? "";
}

const ci = readWorkflow(".github/workflows/ci.yml");

describe("release freeze policy (ADR 0006)", () => {
	it("keeps the public version 1.5.1 untagged and unpublished", () => {
		for (const version of ["1.5.0", "1.5.1"]) {
			const decision = classifyReleaseVersion(version);
			expect(decision.channel).toBe("internal-build");
			expect(decision.tagAllowed).toBe(false);
			expect(decision.publishAllowed).toBe(false);
			expect(decision.assetsAllowed).toBe(false);
		}
	});

	it("allows code-only 1.5.2–1.5.10 tags and never publishes them", () => {
		for (const version of ["1.5.2", "1.5.9", "1.5.10"]) {
			const decision = classifyReleaseVersion(version);
			expect(decision.tagAllowed).toBe(true);
			expect(decision.publishAllowed).toBe(false);
			expect(decision.assetsAllowed).toBe(false);
			// The override exists for 1.6.0+ only: naming a 1.5.x build must not
			// unlock assets or npm.
			const overridden = evaluatePublishPolicy({
				version,
				overrideVersion: version,
				overrideReason: "emergency",
			});
			expect(overridden.publishAllowed).toBe(false);
			expect(overridden.assetsAllowed).toBe(false);
			expect(overridden.overrideApplied).toBe(false);
		}
	});

	it("refuses versions past the internal ceiling and retired lines", () => {
		for (const version of ["1.5.11", "1.5.99", "1.4.13", "1.0.0"]) {
			const decision = classifyReleaseVersion(version);
			expect(decision.tagAllowed).toBe(false);
			expect(decision.publishAllowed).toBe(false);
		}
	});

	it("requires an exact, reasoned owner override for 1.6.0+", () => {
		const denied = classifyReleaseVersion(RELEASE_FREEZE.nextPublicVersion);
		expect(denied.channel).toBe("public");
		expect(denied.tagAllowed).toBe(false);
		expect(denied.publishAllowed).toBe(false);
		expect(denied.assetsAllowed).toBe(false);

		const noReason = evaluatePublishPolicy({
			version: "1.6.0",
			overrideVersion: "1.6.0",
			overrideReason: "  ",
		});
		expect(noReason.publishAllowed).toBe(false);

		const mismatch = evaluatePublishPolicy({
			version: "1.6.0",
			overrideVersion: "1.6.1",
			overrideReason: "approved",
		});
		expect(mismatch.publishAllowed).toBe(false);

		const approved = evaluatePublishPolicy({
			version: "v1.6.0",
			overrideVersion: "1.6.0",
			overrideReason: "owner approved the public release",
		});
		expect(approved.tagAllowed).toBe(true);
		expect(approved.publishAllowed).toBe(true);
		expect(approved.assetsAllowed).toBe(true);
		expect(approved.overrideApplied).toBe(true);
	});

	it("rejects prereleases and malformed versions", () => {
		for (const version of ["1.6.0-rc.1", "1.5.2-canary.1", "latest", "1.5"]) {
			const decision = classifyReleaseVersion(version);
			expect(decision.tagAllowed).toBe(false);
			expect(decision.publishAllowed).toBe(false);
			expect(decision.assetsAllowed).toBe(false);
		}
	});

	it("throws from the assert helpers when the freeze denies the action", () => {
		expect(() => assertTagAllowed("1.5.11", {})).toThrow(/release freeze/);
		expect(() => assertPublishAllowed("1.5.2", {})).toThrow(/release freeze/);
		expect(() => assertAssetsAllowed("1.6.0", {})).toThrow(/release freeze/);
		expect(() =>
			assertPublishAllowed("1.6.0", {
				ZETA_RELEASE_OVERRIDE_VERSION: "1.6.0",
				ZETA_RELEASE_OVERRIDE_REASON: "approved",
			}),
		).not.toThrow();
	});

	it("marks internal build tags as code-only in the annotation", () => {
		const message = internalBuildTagMessage("1.5.3");
		expect(message).toContain(INTERNAL_BUILD_MARKER);
		expect(message).toContain("1.5.3");
		expect(message).toContain("No npm publish");
		expect(message).toContain("1.5.1");
	});
});

describe("CI publish surface is guarded by the freeze", () => {
	const publishJobs = [
		"release_native_leaves",
		"release_npm",
		"release_editor_packages",
		"release_ide_packages",
		"release_web_ui_packages",
		"release_main_packages",
		"release_plugin_packages",
		"release_plugin_packages_manual",
	];

	it("declares the policy outputs on release_metadata", () => {
		const metadata = ci.jobs?.release_metadata as WorkflowJob & { outputs?: Record<string, string> };
		expect(metadata.outputs?.["publish-allowed"]).toContain("steps.policy.outputs.publish-allowed");
		expect(metadata.outputs?.["assets-allowed"]).toContain("steps.policy.outputs.assets-allowed");
		expect(stepRun(metadata, "Evaluate release freeze policy")).toContain("release-policy.ts decide");
	});

	it("requires publish-allowed for every npm publish job", () => {
		for (const name of publishJobs) {
			const job = ci.jobs?.[name];
			expect(job, `missing job ${name}`).toBeDefined();
			expect(String(job?.if), `${name} must gate on publish-allowed`).toContain(
				"needs.release_metadata.outputs.publish-allowed == 'true'",
			);
		}
	});

	it("requires assets-allowed for the GitHub Release asset upload", () => {
		const job = ci.jobs?.release_github;
		expect(job).toBeDefined();
		expect(String(job?.if)).toContain("needs.release_metadata.outputs.assets-allowed == 'true'");
	});

	it("forwards the owner override to dispatched publish workflows", () => {
		for (const [job, workflow] of [
			["release_editor_packages", "editor-publish.yml"],
			["release_ide_packages", "ide-publish.yml"],
			["release_main_packages", "main-publish.yml"],
		] as const) {
			const step = ci.jobs?.[job]?.steps?.find(candidate => candidate.name?.startsWith(`Dispatch ${workflow}`));
			expect(step, `missing dispatch step for ${job}`).toBeDefined();
			expect(step?.run).toContain(`gh workflow run ${workflow}`);
			expect(step?.run).toContain('override_version="$RELEASE_OVERRIDE_VERSION"');
			expect(step?.run).toContain('override_reason="$RELEASE_OVERRIDE_REASON"');
		}
	});

	it("keeps standalone publish workflows fail-closed behind the guard", () => {
		for (const rel of [
			".github/workflows/main-publish.yml",
			".github/workflows/ide-publish.yml",
			".github/workflows/editor-publish.yml",
		]) {
			const workflow = readWorkflow(rel);
			const inputs = workflow.on?.workflow_dispatch?.inputs ?? {};
			for (const input of ["override_version", "override_reason"]) {
				const spec = inputs[input] as { default?: unknown } | undefined;
				expect(spec, `${rel} must declare ${input}`).toBeDefined();
				expect(spec?.default, `${rel}.${input} must default empty`).toBe("");
			}
			const publish = workflow.jobs?.publish;
			expect(publish, `${rel} must keep its publish job`).toBeDefined();
			const guard = stepRun(publish ?? {}, "Release freeze guard");
			expect(guard, `${rel} must run the freeze guard`).toContain("release-policy.ts assert-publish");
		}
	});

	it("makes the release script and npm publisher consult the policy", () => {
		const releaseV2 = fs.readFileSync(path.join(ROOT, "scripts", "release-v2.ts"), "utf8");
		expect(releaseV2).toContain("assertTagAllowed");
		expect(releaseV2).toContain('"tag", "-f", "-a"');
		const publisher = fs.readFileSync(path.join(ROOT, "scripts", "ci-release-publish.ts"), "utf8");
		expect(publisher).toContain("assertPublishAllowed");
	});
});

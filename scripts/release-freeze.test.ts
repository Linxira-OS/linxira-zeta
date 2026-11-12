import { describe, expect, it } from "bun:test";
import {
	assertAssetsAllowed,
	assertPublishAllowed,
	assertTagAllowed,
	classifyReleaseVersion,
	evaluatePublishPolicy,
	RELEASE_FREEZE,
} from "./release-policy";

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

	it("allows code-only 1.5.3–1.5.10 tags and never publishes them", () => {
		for (const version of ["1.5.3", "1.5.9", "1.5.10"]) {
			const decision = classifyReleaseVersion(version);
			expect(decision.tagAllowed).toBe(true);
			expect(decision.publishAllowed).toBe(false);
			expect(decision.assetsAllowed).toBe(false);
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

	it("keeps 1.5.2 code-only by default and allows exact GitHub-assets override only", () => {
		const defaultDecision = classifyReleaseVersion("1.5.2");
		expect(defaultDecision.tagAllowed).toBe(true);
		expect(defaultDecision.publishAllowed).toBe(false);
		expect(defaultDecision.assetsAllowed).toBe(false);

		const noOverride = evaluatePublishPolicy({ version: "1.5.2" });
		expect(noOverride.assetsAllowed).toBe(false);
		expect(noOverride.requiresOverride).toBe(true);

		const wrongVersion = evaluatePublishPolicy({
			version: "1.5.2",
			overrideVersion: "1.5.3",
			overrideReason: "owner review",
		});
		expect(wrongVersion.assetsAllowed).toBe(false);

		const prereleaseOverride = evaluatePublishPolicy({
			version: "1.5.2",
			overrideVersion: "1.5.2-rc.1",
			overrideReason: "owner review",
		});
		expect(prereleaseOverride.assetsAllowed).toBe(false);

		const noReason = evaluatePublishPolicy({
			version: "1.5.2",
			overrideVersion: "1.5.2",
			overrideReason: " ",
		});
		expect(noReason.assetsAllowed).toBe(false);

		const assetsOnly = evaluatePublishPolicy({
			version: "1.5.2",
			overrideVersion: "1.5.2",
			overrideReason: "owner requested manual 1.5.x asset review",
		});
		expect(assetsOnly.channel).toBe("public");
		expect(assetsOnly.tagAllowed).toBe(true);
		expect(assetsOnly.assetsAllowed).toBe(true);
		expect(assetsOnly.publishAllowed).toBe(false);
		expect(assetsOnly.overrideApplied).toBe(true);
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
});

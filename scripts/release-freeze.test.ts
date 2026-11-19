import { describe, expect, it } from "bun:test";
import {
	assertAssetsAllowed,
	assertPublishAllowed,
	assertTagAllowed,
	classifyReleaseVersion,
	evaluatePublishPolicy,
} from "./release-policy";

describe("stable release policy (ADR 0072)", () => {
	it("keeps the public version 1.5.1 untagged and unpublished", () => {
		for (const version of ["1.5.0", "1.5.1"]) {
			const decision = classifyReleaseVersion(version);
			expect(decision.channel).toBe("internal-build");
			expect(decision.tagAllowed).toBe(false);
			expect(decision.publishAllowed).toBe(false);
			expect(decision.assetsAllowed).toBe(false);
		}
	});

	it("allows code-only 1.5.3–1.5.9 tags and never publishes them", () => {
		for (const version of ["1.5.3", "1.5.9"]) {
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

	it("does not reopen retired versions", () => {
		for (const version of ["1.4.13", "1.0.0"]) {
			const decision = classifyReleaseVersion(version);
			expect(decision.tagAllowed).toBe(false);
			expect(decision.publishAllowed).toBe(false);
		}
	});

	it("releases stable versions starting at 1.5.10 without an override", () => {
		for (const version of ["v1.5.10", "1.5.11", "1.6.0"]) {
			expect(evaluatePublishPolicy({ version })).toMatchObject({
				channel: "public",
				tagAllowed: true,
				publishAllowed: true,
				assetsAllowed: true,
				requiresOverride: false,
				overrideApplied: false,
			});
		}
	});

	it("rejects prereleases and malformed versions", () => {
		for (const version of ["1.6.0-rc.1", "1.5.2-canary.1", "latest", "1.5"]) {
			const decision = classifyReleaseVersion(version);
			expect(decision.tagAllowed).toBe(false);
			expect(decision.publishAllowed).toBe(false);
			expect(decision.assetsAllowed).toBe(false);
		}
	});

	it("refuses invalid and historical publish requests", () => {
		expect(() => assertTagAllowed("1.5.10-rc.1", {})).toThrow(/release freeze/);
		expect(() => assertPublishAllowed("1.5.2", {})).toThrow(/release freeze/);
		expect(() => assertAssetsAllowed("1.4.13", {})).toThrow(/release freeze/);
	});
});

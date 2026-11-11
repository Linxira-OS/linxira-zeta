import { describe, expect, it } from "bun:test";
import { evaluatePublishPolicy } from "./release-policy";
import {
	type AdrRecord,
	evaluateScope,
	evidenceIsIndependent,
	isVerifiedCiConclusion,
	type LedgerRequirement,
	parseAdrs,
	type ReleaseScopeManifest,
} from "./release-scope";

const ledger: LedgerRequirement[] = [
	{ id: "REQ-020", status: "VERIFIED", evidence: "bun run check:adr; scripts/check-adr-index.ts" },
	{ id: "REQ-021", status: "VERIFIED", evidence: "bun test scripts/release-scope.test.ts (CI run 123)" },
	{ id: "REQ-030", status: "DEFERRED", evidence: "audit only" },
];

const adrs: AdrRecord[] = [
	{ id: "0006", status: "Accepted", indexed: true },
	{ id: "0016", status: "Accepted", indexed: true },
];

const manifest = (entry: Partial<ReleaseScopeManifest["releases"][string]> = {}): ReleaseScopeManifest => ({
	releases: {
		"1.6.0": {
			requirements: ["REQ-020", "REQ-021"],
			adrs: ["0006", "0016"],
			approvedDeferrals: [
				{ id: "REQ-030", approvedBy: "owner", reason: "not this train", reentryTrigger: "owner names it" },
			],
			...entry,
		},
	},
});

describe("release scope gate (REQ-021)", () => {
	it("accepts a fully verified, approved, cited scope", () => {
		const report = evaluateScope({
			version: "1.6.0",
			manifest: manifest(),
			ledger,
			adrs,
			notes: "ADR-0006 ADR-0016 REQ-020 REQ-021",
		});
		expect(report.problems).toEqual([]);
		expect(report.ok).toBe(true);
	});

	it("fails closed when the version has no declared scope", () => {
		const report = evaluateScope({ version: "1.6.0", manifest: { releases: {} }, ledger, adrs });
		expect(report.ok).toBe(false);
		expect(report.problems.map(problem => problem.code)).toContain("scope-missing");
	});

	it("rejects a PR number as the only evidence", () => {
		expect(evidenceIsIndependent("PR #320")).toBe(false);
		expect(evidenceIsIndependent("https://github.com/x/y/pull/320")).toBe(false);
		expect(evidenceIsIndependent("PR #320; bun test scripts/release-scope.test.ts")).toBe(true);
		expect(evidenceIsIndependent("bun run check:adr")).toBe(true);
		expect(evidenceIsIndependent("bun test ... (CI run 42)")).toBe(true);
		expect(evidenceIsIndependent("PR #320; verification pending")).toBe(false);
	});

	it("blocks an unverified scoped requirement and weak evidence", () => {
		const report = evaluateScope({
			version: "1.6.0",
			manifest: manifest(),
			ledger: [
				{ id: "REQ-020", status: "IMPLEMENTED", evidence: "PR #316" },
				{ id: "REQ-021", status: "VERIFIED", evidence: "PR #320" },
			],
			adrs,
		});
		const codes = report.problems.map(problem => problem.code);
		expect(codes).toContain("req-not-verified");
		expect(codes).toContain("req-evidence-weak");
	});

	it("blocks a Proposed contract ADR", () => {
		const report = evaluateScope({
			version: "1.6.0",
			manifest: manifest(),
			ledger,
			adrs: [
				{ id: "0006", status: "Accepted", indexed: true },
				{ id: "0016", status: "Proposed", indexed: true },
			],
		});
		expect(report.ok).toBe(false);
		expect(report.problems.map(problem => problem.code)).toContain("adr-not-accepted");
	});

	it("blocks an unapproved deferred row", () => {
		const report = evaluateScope({
			version: "1.6.0",
			manifest: manifest({ approvedDeferrals: [] }),
			ledger,
			adrs,
		});
		expect(report.problems.map(problem => problem.code)).toContain("deferral-unapproved");
	});

	it("blocks an incomplete deferral approval", () => {
		const report = evaluateScope({
			version: "1.6.0",
			manifest: manifest({
				approvedDeferrals: [{ id: "REQ-030", approvedBy: "owner", reason: " ", reentryTrigger: " " }],
			}),
			ledger,
			adrs,
		});
		expect(report.problems.map(problem => problem.code)).toContain("deferral-incomplete");
	});

	it("flags notes that omit a scoped ADR/REQ", () => {
		const report = evaluateScope({
			version: "1.6.0",
			manifest: manifest(),
			ledger,
			adrs,
			notes: "ADR-0006 REQ-020",
		});
		const codes = report.problems.map(problem => problem.code);
		expect(codes).toContain("notes-missing-adr");
		expect(codes).toContain("notes-missing-req");
	});

	it("runs the structural pass without requiring a scope entry", () => {
		const report = evaluateScope({
			version: "1.5.3",
			manifest: { releases: {} },
			ledger,
			adrs: [
				{ id: "0006", status: "Accepted", indexed: true },
				{ id: "0007", status: "Proposed", indexed: false },
			],
			mode: "structural",
		});
		expect(report.problems.map(problem => problem.code)).toEqual(["adr-unindexed"]);
	});
});

describe("CI evidence and freeze invariants", () => {
	it("only a completed success counts as green", () => {
		expect(isVerifiedCiConclusion("success")).toBe(true);
		expect(isVerifiedCiConclusion("cancelled")).toBe(false);
		expect(isVerifiedCiConclusion("skipped")).toBe(false);
		expect(isVerifiedCiConclusion("stale")).toBe(false);
		expect(isVerifiedCiConclusion(null)).toBe(false);
	});

	it("1.5.x can never unlock assets or npm, even with an override", () => {
		for (const version of ["1.5.2", "1.5.10"]) {
			const decision = evaluatePublishPolicy({
				version,
				overrideVersion: version,
				overrideReason: "emergency",
			});
			expect(decision.tagAllowed).toBe(true);
			expect(decision.publishAllowed).toBe(false);
			expect(decision.assetsAllowed).toBe(false);
		}
	});
});

describe("ADR index parsing", () => {
	it("matches status and index rows", () => {
		const parsed = parseAdrs(
			[{ id: "0016", content: "# 0016. X\n\n- **Status:** Accepted\n" }],
			"| [0016](0016-x.md) | X | Accepted | 2026-11-11 | — | x |",
		);
		expect(parsed).toEqual([{ id: "0016", status: "Accepted", indexed: true }]);
	});
});

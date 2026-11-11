#!/usr/bin/env bun
/**
 * Mechanical release-scope gate (REQ-021, ADR draft `local://release-preconditions-contract-adr-draft.md`).
 *
 * A public release is only ready when every requirement it ships is provably
 * VERIFIED/RELEASED, every deferred item is explicitly approved with a
 * re-entry trigger, every contract ADR is Accepted and indexed, and the release
 * notes cite those ADR/REQ IDs. This module is shared by `scripts/release-v2.ts`
 * (pre-tag), the CI `release_gate`/`check` jobs, `scripts/ci-release-notes.ts`
 * and the `release_github` notes check — no second release framework.
 *
 * Evidence is judged, not string-matched for a PR number: a row marked
 * VERIFIED must name a real verification surface (`bun test`/`bun run`/a named
 * check/CI run/workflow) and must not still say "pending". `PR #123` alone is
 * not independent verification.
 *
 * Usage:
 *   bun scripts/release-scope.ts structural
 *   bun scripts/release-scope.ts check --version 1.6.0 [--notes release-notes.md] [--json]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { evaluateFromEnv } from "./release-policy";

/**
 * A release may only trust a CI verdict that actually completed green.
 * GitHub's run conclusions include `cancelled`, `skipped` and `stale`; none of
 * them is evidence that the source commit passed, so only `success` counts.
 */
export function isVerifiedCiConclusion(conclusion: string | null | undefined): boolean {
	return conclusion === "success";
}

export const RELEASE_SCOPE_PATH = "release-scope.json";
export const LEDGER_PATH = "document/requirements-ledger.md";
export const ADR_DIR = "document/adr";
export const ADR_INDEX_PATH = "document/adr/README.md";
const ID_PATTERN = /^REQ-\d{3}$/;

export interface ApprovedDeferral {
	id: string;
	approvedBy: string;
	reason: string;
	reentryTrigger: string;
}

export interface ReleaseScopeEntry {
	requirements: string[];
	adrs: string[];
	approvedDeferrals?: ApprovedDeferral[];
}

export interface ReleaseScopeManifest {
	releases: Record<string, ReleaseScopeEntry>;
}

export interface LedgerRequirement {
	id: string;
	status: string;
	evidence: string;
}

export interface AdrRecord {
	id: string;
	status: string;
	indexed: boolean;
}

export interface ScopeProblem {
	code: string;
	message: string;
}

export interface ReleaseScopeReport {
	version: string;
	mode: "structural" | "release";
	ok: boolean;
	problems: ScopeProblem[];
	requirements: string[];
	adrs: string[];
}

/** Verification surfaces that count as independent evidence. */
const VERIFICATION_MARKERS: readonly RegExp[] = [
	/\bbun test\b/i,
	/\bbun run\b/i,
	/\bworkflow\b/i,
	/\bCI (run|workflow|#\d+)\b/i,
	/\bcheck:[a-z0-9-]+\b/i,
	/\b(unit|regression|e2e|integration) tests?\b/i,
	/\btested by\b/i,
	/\bverified by\b/i,
];
const PR_REFERENCE = /\b(?:PR\s*#\d+|#\d+)\b/gi;

/**
 * True when `evidence` names a verification surface independent of a PR
 * number. A bare `PR #123` (with or without a link) is a code pointer, not
 * verification.
 */
export function evidenceIsIndependent(evidence: string): boolean {
	if (/\bpending\b/i.test(evidence)) return false;
	const withoutPrs = evidence.replace(PR_REFERENCE, " ");
	return VERIFICATION_MARKERS.some(marker => marker.test(withoutPrs));
}

export function parseLedger(source: string): LedgerRequirement[] {
	const rows: LedgerRequirement[] = [];
	for (const line of source.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("| REQ-")) continue;
		const cells = trimmed
			.split("|")
			.slice(1, -1)
			.map(cell => cell.trim());
		if (cells.length < 10) continue;
		const [id, , , , , status, , , evidence] = cells;
		if (!ID_PATTERN.test(id)) continue;
		rows.push({ id, status, evidence });
	}
	return rows;
}

export function parseAdrs(files: Array<{ id: string; content: string }>, indexSource: string): AdrRecord[] {
	const indexed = new Map<string, string>();
	for (const line of indexSource.split(/\r?\n/)) {
		const match = /^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|\s*([A-Za-z]+)\s*\|/.exec(line);
		if (match) indexed.set(match[1], match[4]);
	}
	return files.map(({ id, content }) => ({
		id,
		status: /^-\s*\*\*Status:\*\*\s*([A-Za-z]+)/m.exec(content)?.[1] ?? "unknown",
		indexed: indexed.get(id) === (/^-\s*\*\*Status:\*\*\s*([A-Za-z]+)/m.exec(content)?.[1] ?? ""),
	}));
}

export function readAdrFiles(root = "."): Array<{ id: string; content: string }> {
	return readdirSync(join(root, ADR_DIR))
		.filter(name => /^\d{4}-[a-z0-9-]+\.md$/.test(name))
		.map(name => ({ id: name.slice(0, 4), content: readFileSync(join(root, ADR_DIR, name), "utf8") }));
}

export function readReleaseScope(root = "."): ReleaseScopeManifest {
	const path = join(root, RELEASE_SCOPE_PATH);
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ReleaseScopeManifest>;
		return { releases: parsed.releases ?? {} };
	} catch (err) {
		throw new Error(`${RELEASE_SCOPE_PATH}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/** Release-notes traceability block for `ci-release-notes.ts`. */
export function renderTraceability(entry: ReleaseScopeEntry): string {
	const adrs = entry.adrs.map(id => `ADR-${id}`);
	const reqs = [...entry.requirements];
	return [
		"## Release traceability",
		"",
		`- ADRs: ${adrs.length > 0 ? adrs.join(", ") : "none"}`,
		`- Requirements: ${reqs.length > 0 ? reqs.join(", ") : "none"}`,
		"",
		"Scope is enforced mechanically by `scripts/release-scope.ts` (REQ-021);",
		"only VERIFIED/RELEASED rows with independent evidence are releasable.",
	].join("\n");
}

export interface EvaluateScopeInput {
	version: string;
	manifest: ReleaseScopeManifest;
	ledger: LedgerRequirement[];
	adrs: AdrRecord[];
	notes?: string;
	mode?: "structural" | "release";
}

export function evaluateScope(input: EvaluateScopeInput): ReleaseScopeReport {
	const { version, manifest, ledger, adrs, notes } = input;
	const mode = input.mode ?? "release";
	const problems: ScopeProblem[] = [];
	const byId = new Map(ledger.map(row => [row.id, row]));
	const adrById = new Map(adrs.map(adr => [adr.id, adr]));
	const entry = manifest.releases[version];

	if (mode === "structural") {
		for (const adr of adrs) {
			if (!adr.indexed) {
				problems.push({
					code: "adr-unindexed",
					message: `ADR-${adr.id} is missing from or disagrees with ${ADR_INDEX_PATH}`,
				});
			}
		}
		return {
			version,
			mode,
			ok: problems.length === 0,
			problems,
			requirements: [],
			adrs: [],
		};
	}

	if (!entry) {
		problems.push({
			code: "scope-missing",
			message: `${RELEASE_SCOPE_PATH} has no entry for ${version}; a public release needs a declared REQ scope`,
		});
		return { version, mode, ok: false, problems, requirements: [], adrs: [] };
	}
	if (entry.requirements.length === 0) {
		problems.push({ code: "scope-empty", message: `${version} declares no requirements` });
	}
	for (const id of entry.requirements) {
		const row = byId.get(id);
		if (!row) {
			problems.push({ code: "req-missing", message: `${id} is not in ${LEDGER_PATH}` });
			continue;
		}
		if (row.status !== "VERIFIED" && row.status !== "RELEASED") {
			problems.push({
				code: "req-not-verified",
				message: `${id} is ${row.status}; release scope requires VERIFIED or RELEASED`,
			});
		}
		if (!evidenceIsIndependent(row.evidence)) {
			problems.push({
				code: "req-evidence-weak",
				message: `${id} evidence names no independent test/check/CI (a PR number alone is not verification)`,
			});
		}
		if (row.status === "RELEASED" && !/\bv?\d+\.\d+\.\d+\b|\btag\b/i.test(row.evidence)) {
			problems.push({ code: "req-no-release-pointer", message: `${id} is RELEASED without a tag pointer` });
		}
	}
	for (const id of entry.adrs) {
		const adr = adrById.get(id);
		if (!adr) {
			problems.push({ code: "adr-missing", message: `ADR-${id} does not exist` });
			continue;
		}
		if (adr.status !== "Accepted") {
			problems.push({ code: "adr-not-accepted", message: `contract ADR-${id} is ${adr.status}, not Accepted` });
		}
		if (!adr.indexed) {
			problems.push({ code: "adr-unindexed", message: `contract ADR-${id} is missing from ${ADR_INDEX_PATH}` });
		}
	}

	const scoped = new Set(entry.requirements);
	const approved = new Map((entry.approvedDeferrals ?? []).map(item => [item.id, item]));
	for (const item of entry.approvedDeferrals ?? []) {
		const row = byId.get(item.id);
		if (!row) {
			problems.push({ code: "deferral-missing", message: `approved deferral ${item.id} is not in the ledger` });
			continue;
		}
		if (row.status !== "DEFERRED" && row.status !== "BLOCKED") {
			problems.push({ code: "deferral-not-deferred", message: `${item.id} is ${row.status}, not DEFERRED/BLOCKED` });
		}
		if (!item.approvedBy.trim() || !item.reason.trim() || !item.reentryTrigger.trim()) {
			problems.push({
				code: "deferral-incomplete",
				message: `${item.id} needs approvedBy, reason and reentryTrigger`,
			});
		}
	}
	for (const row of ledger) {
		if (row.status !== "DEFERRED" && row.status !== "BLOCKED") continue;
		if (scoped.has(row.id)) continue;
		if (!approved.has(row.id)) {
			problems.push({
				code: "deferral-unapproved",
				message: `${row.id} is ${row.status} but not in ${version}.approvedDeferrals (needs owner approval + re-entry trigger)`,
			});
		}
	}

	if (notes !== undefined) {
		for (const id of entry.adrs) {
			if (!notes.includes(`ADR-${id}`)) {
				problems.push({ code: "notes-missing-adr", message: `release notes do not cite ADR-${id}` });
			}
		}
		for (const id of entry.requirements) {
			if (!notes.includes(id)) {
				problems.push({ code: "notes-missing-req", message: `release notes do not cite ${id}` });
			}
		}
	}

	return {
		version,
		mode,
		ok: problems.length === 0,
		problems,
		requirements: entry.requirements,
		adrs: entry.adrs,
	};
}

/** Read the repository inputs and evaluate one version. */
export function checkReleaseScope(
	version: string,
	options: { notes?: string; structuralOnly?: boolean; root?: string } = {},
): ReleaseScopeReport {
	const root = options.root ?? ".";
	const ledger = parseLedger(readFileSync(join(root, LEDGER_PATH), "utf8"));
	const adrs = parseAdrs(readAdrFiles(root), readFileSync(join(root, ADR_INDEX_PATH), "utf8"));
	const manifest = readReleaseScope(root);
	return evaluateScope({
		version,
		manifest,
		ledger,
		adrs,
		notes: options.notes,
		mode: options.structuralOnly ? "structural" : "release",
	});
}

/** Whether a release for `version` is public (publish/assets allowed). */
export function isPublicRelease(version: string): boolean {
	const decision = evaluateFromEnv(version);
	if (decision.publishAllowed) return true;
	// The release_github job knows `assets-allowed` from release_metadata; trust
	// that flag for a public-line version when the override env is not mapped
	// into this step. Frozen 1.5.x can never become public this way.
	return process.env.ZETA_RELEASE_SCOPE_PUBLIC === "true" && decision.channel === "public";
}

export function formatProblems(report: ReleaseScopeReport): string {
	return report.problems.map(problem => `- [${problem.code}] ${problem.message}`).join("\n");
}

function argValue(args: string[], flag: string): string | null {
	const index = args.indexOf(flag);
	return index === -1 ? null : (args[index + 1] ?? null);
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const command = args[0] ?? "structural";
	if (command !== "structural" && command !== "check") {
		console.error("usage: bun scripts/release-scope.ts <structural|check> [--version X.Y.Z] [--notes file] [--json]");
		process.exit(2);
	}
	const version = argValue(args, "--version") ?? process.env.GITHUB_REF_NAME?.replace(/^v/, "") ?? "";
	if (command === "check" && !version) {
		console.error("release-scope check requires --version (or GITHUB_REF_NAME).");
		process.exit(2);
	}
	const structuralOnly = command === "structural";
	if (command === "check" && !isPublicRelease(version)) {
		console.log(`release-scope: ${version} does not publish (freeze policy); running structural checks only.`);
	}
	const report = checkReleaseScope(version, {
		notes: argValue(args, "--notes") ?? undefined,
		structuralOnly: structuralOnly || (command === "check" && !isPublicRelease(version)),
	});
	if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
	if (!report.ok) {
		console.error(`Release scope check failed for ${version || "(structural)"}:`);
		console.error(formatProblems(report));
		process.exit(1);
	}
	console.log(
		report.mode === "structural"
			? "Release scope structural check passed (ledger + ADR index)."
			: `Release scope passed for ${report.version}: ${report.requirements.length} REQ(s), ${report.adrs.length} ADR(s).`,
	);
}

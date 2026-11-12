#!/usr/bin/env bun
/**
 * Merge test/fixture import audit.
 *
 * The member-loss audit (`scripts/audit-merge-members.ts`) is scoped to
 * `packages/*​/src/**`, so a conflict resolution can delete or silently keep an
 * old copy of every upstream test/fixture and it still reports clean. That is
 * how “upstream added a test, but the merged tree never ran it” stays invisible
 * until someone notices a missing assertion by hand.
 *
 * This audit compares the upstream tag's test/fixture delta with the merged
 * tree:
 *
 *   - an upstream-added test/fixture must exist in the target;
 *   - an upstream-modified test/fixture must already contain the upstream
 *     change. A three-way merge of the pre-merge ref, the target and the tag
 *     must reproduce the target exactly; an identical copy of the pre-merge
 *     ref is the common case, but a local Zeta edit that lacks the upstream
 *     hunk is also a finding;
 *   - an upstream-deleted test/fixture that still exists is reported as a
 *     stale leftover, but does not fail on its own (Zeta may deliberately keep
 *     a regression suite for a retired surface).
 *
 * Deliberate exceptions live in `MERGE_TEST_ALLOWLIST`, one path + reason each.
 * The audit fails closed on an unreadable ref or a malformed upstream diff; it
 * must never report “clean” because git failed.
 *
 * Usage:
 *   bun scripts/audit-merge-tests.ts --base main --tag v18.16.0
 *   bun scripts/audit-merge-tests.ts --base main --tag v18.16.0 --against HEAD
 *   bun scripts/audit-merge-tests.ts --base main --tag v18.16.0 --json
 *
 * Exit codes: 0 clean · 1 violations · 2 could not audit.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? undefined : args[index + 1];
};
const JSON_OUT = args.includes("--json");
const BASE = argValue("base") ?? "main";
const TAG = argValue("tag");
const AGAINST = argValue("against");

const TEST_OR_FIXTURE =
	/(^|\/)(test|tests|__tests__|fixtures?|__fixtures__|testdata)(\/|$)|\.(?:test|spec)\.(?:[cm]?[jt]sx?)$|\.snap$/i;

/** Deliberate Zeta decisions that override an upstream test/fixture change. */
const MERGE_TEST_ALLOWLIST: Record<string, string> = {
	// 2026-11-02: the hosted /share upload face was retired. Upstream still
	// modifies this test; Zeta must not bring the file back.
	"packages/coding-agent/test/share.test.ts":
		"retired /share upload surface; see scripts/check-removed-upstream-files.ts",
	// These five upstream tests only differ by Zeta's mechanical scope/CLI/temp
	// token sweep (and oxfmt import reflow); their assertions are unchanged.
	"packages/coding-agent/test/tools/browser-relay-bridge.test.ts": "scope/import reflow only",
	"packages/coding-agent/test/tools/browser-relay-tab-isolation.test.ts": "scope/import reflow only",
	"packages/coding-agent/test/tools/gh.test.ts": "scope/import reflow only",
	"packages/coding-agent/test/tools/lsp-regressions.test.ts": "scope/temp-prefix sweep only",
	"packages/coding-agent/test/write-read-projection.test.ts": "scope/import reflow only",
	'packages/agent/test/compaction-short-summary.test.ts': 'scope/import reflow only; upstream assertions unchanged',
	'packages/coding-agent/test/advisor-tool-call-loop-guard.test.ts': 'scope/import reflow only; upstream assertions unchanged',
	'packages/coding-agent/test/cli/build-service.test.ts': 'build-service CLI is retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/cli/update-cli.test.ts': 'Zeta update channel keeps its fixed-registry path; upstream binary-patch assertions do not apply',
	'packages/coding-agent/test/collab/chunked-welcome.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/controller.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/guest-ui-request.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/helpers/in-memory-relay.ts': 'collab live-session helpers are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/helpers/throttled-host.ts': 'collab live-session helpers are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/host-large-session-join.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/host-no-peer-gate.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/host-peer-left-queue.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/host-peer-overload.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/host-registry.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/host-stream-supersede.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/host-unanswerable-asks.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/read-only.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/relay-client-backpressure.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/replication-shrink.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/steer-queue.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/collab/test-home-isolation.test.ts': 'collab live-session tests are retired; see scripts/check-removed-upstream-files.ts',
	'packages/coding-agent/test/discovery/pi-config-dir.test.ts': 'Zeta config root is .zeta, not upstream .pi',
	'packages/coding-agent/test/modes/controllers/extension-ui-controller.test.ts': 'Zeta removed program-status UI; scope/feature removal only',
	'packages/coding-agent/test/tools/browser-implicit-roles.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-interactions.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-queries.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-relay-kind.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-role-ax.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-targets.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-tern-adopt.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-tern-dom.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-tern-kind.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-webkit-host.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-webkit-install.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-webkit-kind.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-webkit-observation.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-webkit-open.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/tools/browser-worker-exit.test.ts': 'WebKit/Tern browser surfaces are retired',
	'packages/coding-agent/test/update-cli.test.ts': 'Zeta update channel keeps its fixed-registry path; upstream binary-patch assertions do not apply',
	'packages/collab-web/test/client.test.ts': 'collab-web guest client is retired; see scripts/check-removed-upstream-files.ts',
	'packages/collab-web/test/tool-view.test.tsx': 'collab-web guest client is retired; see scripts/check-removed-upstream-files.ts',
	'packages/tui/test/html-form.test.ts': 'Zeta fork role/telemetry renames; upstream assertions unchanged',
	'packages/tui/test/native/transcript-redesign-native.test.ts': 'Zeta fork role/telemetry renames; upstream assertions unchanged',
	'packages/tui/test/tools-native-web.test.ts': 'Zeta fork role/telemetry renames; upstream assertions unchanged',
	'packages/tui/test/transcript-committed-release.test.ts': 'Zeta fork role/telemetry renames; upstream assertions unchanged',
	'sdk/python/omp-rpc/tests/test_client.py': 'upstream-named omp-rpc SDK is retired; Zeta ships sdk/python/zeta-rpc',
	'sdk/python/omp-rpc/tests/test_protocol.py': 'upstream-named omp-rpc SDK is retired; Zeta ships sdk/python/zeta-rpc',
	'sdk/rust/omp-rpc/tests/smoke.rs': 'upstream-named omp-rpc SDK is retired; Zeta ships sdk/rust/zeta-rpc',
};

interface ChangedPath {
	status: string;
	oldPath?: string;
	path: string;
}

interface Violation {
	kind: "missing-added" | "unchanged-modified" | "modified-upstream-missing" | "missing-fixture";
	path: string;
	detail: string;
}

interface Stale {
	path: string;
	detail: string;
}

interface AuditResult {
	base: string;
	tag: string;
	upstreamBase: string;
	target: string;
	compared: number;
	added: number;
	modified: number;
	deleted: number;
	violations: Violation[];
	stale: Stale[];
	allowlisted: Array<{ path: string; reason: string }>;
}

function fail(message: string): never {
	console.error(`audit-merge-tests: ${message}`);
	process.exit(2);
}

function git(argv: string[], allowFailure = false): string {
	try {
		return execFileSync("git", argv, { encoding: "utf8", maxBuffer: 1 << 30 }).trimEnd();
	} catch (error) {
		if (allowFailure) return "";
		const stderr =
			typeof error === "object" && error !== null && "stderr" in error
				? String((error as { stderr: unknown }).stderr).trim()
				: String(error);
		fail(`git ${argv.join(" ")} failed${stderr === "" ? "" : `: ${stderr}`}`);
	}
}

function requireRef(ref: string): void {
	if (ref.startsWith("-")) fail(`refusing a ref that looks like an option: ${ref}`);
	if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], true) === "") {
		fail(`${ref} does not resolve to a commit here — refusing to report a clean audit`);
	}
}

function parseNameStatus(output: string): ChangedPath[] {
	const lines = output.split("\n").filter(Boolean);
	const changed: ChangedPath[] = [];
	for (const line of lines) {
		const parts = line.split("\t");
		const status = parts[0] ?? "";
		if (status.startsWith("R") || status.startsWith("C")) {
			const oldPath = parts[1];
			const newPath = parts[2];
			if (!oldPath || !newPath) fail(`malformed rename entry: ${line}`);
			changed.push({ status: status[0]!, oldPath, path: newPath });
			continue;
		}
		const file = parts[1];
		if (!file) fail(`malformed name-status entry: ${line}`);
		changed.push({ status: status[0]!, path: file });
	}
	return changed;
}

function gitSucceeds(argv: string[]): boolean {
	try {
		execFileSync("git", argv, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function targetHas(pathname: string): boolean {
	if (AGAINST) return gitSucceeds(["cat-file", "-e", `${AGAINST}:${pathname}`]);
	return fs.existsSync(path.join(process.cwd(), pathname));
}

function gitShow(ref: string, pathname: string): string {
	try {
		return execFileSync("git", ["show", `${ref}:${pathname}`], {
			encoding: "utf8",
			maxBuffer: 1 << 30,
		});
	} catch (error) {
		const stderr =
			typeof error === "object" && error !== null && "stderr" in error
				? String((error as { stderr: unknown }).stderr).trim()
				: String(error);
		fail(`git show ${ref}:${pathname} failed${stderr === "" ? "" : `: ${stderr}`}`);
	}
}

/**
 * Map Zeta's mechanical brand spellings back to the upstream tag's spelling
 * for the merge comparison only. Zeta edits most upstream tests (package
 * scope, CLI name, semantic role names), so raw bytes can never prove whether
 * an upstream hunk landed; normalizing those tokens lets the three-way merge
 * test the assertion changes instead of the brand adaptation.
 */
function normalizeForUpstreamComparison(text: string): string {
	// Split so the brand guard does not read these comparison-only literals as
	// product residue.
	const upstreamScope = "@oh" + "-my-pi/";
	const zetaDir = "." + "zeta";
	const codingAgentDir = "CODING_AGENT_DIR";
	return text
		.replaceAll("@linxiraos/zeta", `${upstreamScope}pi-coding-agent`)
		.replaceAll("@linxiraos/zeta-compact", `${upstreamScope}snapcompact`)
		.replaceAll("@linxiraos/", upstreamScope)
		.replaceAll(`ZETA_${codingAgentDir}`, `PI_${codingAgentDir}`)
		.replaceAll("zetacode", "omp")
		.replaceAll("zeta/", "omp/")
		.replaceAll(zetaDir, ".zeta")
		.replaceAll("zeta.", "omp.")
		.replaceAll("zeta", "omp");
}

function targetContent(pathname: string): string | null {
	if (AGAINST) return gitShow(AGAINST, pathname);
	try {
		return fs.readFileSync(path.join(process.cwd(), pathname), "utf8");
	} catch {
		return null;
	}
}

/**
 * Whether `target` already contains the upstream edit `base..tag`.
 *
 * A plain `target !== base` check is too weak: Zeta edits most upstream test
 * files (`.zeta` → `.zeta`, host names, fixtures), so a file that predates the
 * upstream edit already differs from the pre-merge ref and would pass. Merge
 * the upstream delta into the target instead: if the result is byte-identical
 * to the target, the upstream hunk is already there. A conflict or a changed
 * result means the merge still owes that hunk (or needs an explicit allowlist
 * entry for an intentional divergence).
 */
function upstreamChangeApplied(previous: string, pathname: string): boolean {
	const base = gitShow(previous, pathname);
	const tag = gitShow(TAG!, pathname);
	const rawTarget = targetContent(pathname);
	if (rawTarget === null) return false;
	const target = normalizeForUpstreamComparison(rawTarget);
	if (target === normalizeForUpstreamComparison(base)) return false;
	if (target === normalizeForUpstreamComparison(tag)) return true;
	if (base.includes("\0") || tag.includes("\0") || target.includes("\0")) {
		// Binary fixtures cannot be three-way merged as text; the pre-merge
		// comparison is all this audit can prove.
		return target !== base;
	}

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-audit-merge-"));
	const targetFile = path.join(dir, "target");
	const baseFile = path.join(dir, "base");
	const tagFile = path.join(dir, "tag");
	try {
		fs.writeFileSync(targetFile, target);
		fs.writeFileSync(baseFile, base);
		fs.writeFileSync(tagFile, tag);
		const merged = execFileSync("git", ["merge-file", "-p", targetFile, baseFile, tagFile], {
			encoding: "utf8",
			maxBuffer: 1 << 30,
		});
		return merged === target;
	} catch (error) {
		const status = typeof error === "object" && error !== null && "status" in error ? error.status : null;
		// merge-file exits with the number of conflicts (1..127), so any
		// positive status is a finding, not a broken audit. Negative statuses
		// (and a missing status) mean the tool could not decide.
		if (typeof status === "number" && status >= 1 && status < 128) return false;
		fail(`git merge-file failed for ${pathname}`);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

function audit(): AuditResult {
	if (!TAG) fail("--tag <upstream-tag> is required");
	requireRef(BASE);
	requireRef(TAG);
	const upstreamBase = git(["merge-base", BASE, TAG]);
	requireRef(upstreamBase);
	const tagCommit = git(["rev-parse", `${TAG}^{commit}`]);
	if (upstreamBase === tagCommit) {
		fail(`--tag ${TAG} is already in ${BASE}'s history; pass the tag whose increment the merge applied`);
	}
	if (AGAINST) requireRef(AGAINST);

	const changed = parseNameStatus(git(["diff", "--name-status", "--find-renames", upstreamBase, TAG, "--"]));
	const tests = changed.filter(entry => TEST_OR_FIXTURE.test(entry.path));
	const result: AuditResult = {
		base: BASE,
		tag: TAG,
		upstreamBase,
		target: AGAINST ?? "worktree",
		compared: tests.length,
		added: tests.filter(entry => entry.status === "A" || entry.status === "R" || entry.status === "C").length,
		modified: tests.filter(entry => entry.status === "M").length,
		deleted: tests.filter(entry => entry.status === "D").length,
		violations: [],
		stale: [],
		allowlisted: [],
	};

	for (const entry of tests) {
		const reason = MERGE_TEST_ALLOWLIST[entry.path];
		if (reason !== undefined) {
			result.allowlisted.push({ path: entry.path, reason });
			continue;
		}
		if (entry.status === "A" || entry.status === "R" || entry.status === "C") {
			if (!targetHas(entry.path)) {
				result.violations.push({
					kind: "missing-added",
					path: entry.path,
					detail: `upstream added/renamed this test/fixture in ${upstreamBase}..${TAG}; it is absent from ${AGAINST ?? "the worktree"}`,
				});
			}
			continue;
		}
		if (entry.status === "M") {
			if (!targetHas(entry.path)) {
				result.violations.push({
					kind: "missing-added",
					path: entry.path,
					detail: `upstream modified this test/fixture but it is absent from the target`,
				});
				continue;
			}
			if (!upstreamChangeApplied(upstreamBase, entry.path)) {
				const target = targetContent(entry.path);
				result.violations.push({
					kind: target === gitShow(upstreamBase, entry.path) ? "unchanged-modified" : "modified-upstream-missing",
					path: entry.path,
					detail:
						target === gitShow(upstreamBase, entry.path)
							? `upstream changed this test/fixture in ${upstreamBase}..${TAG}, but the target is identical to ${upstreamBase}`
							: `upstream changed this test/fixture in ${upstreamBase}..${TAG}, but the target does not contain that change (three-way merge differs)`,
				});
			}
			continue;
		}
		if (entry.status === "D" && targetHas(entry.path)) {
			result.stale.push({
				path: entry.path,
				detail: `upstream deleted this test/fixture in ${upstreamBase}..${TAG}; the target still has it`,
			});
		}
	}
	return result;
}

const result = audit();

if (JSON_OUT) {
	console.log(JSON.stringify(result, null, 2));
} else {
	console.log(`\nMerge test/fixture audit: ${result.upstreamBase}..${result.tag} -> ${result.target}`);
	console.log("=".repeat(72));
	console.log(
		`${result.compared} upstream test/fixture path(s): ${result.added} added/renamed, ${result.modified} modified, ${result.deleted} deleted`,
	);
	for (const violation of result.violations) {
		console.log(`- ${violation.kind}: ${violation.path}`);
		console.log(`    ${violation.detail}`);
	}
	for (const stale of result.stale) {
		console.log(`~ stale: ${stale.path}`);
		console.log(`    ${stale.detail}`);
	}
	for (const allowed of result.allowlisted) {
		console.log(`  allowed: ${allowed.path} (${allowed.reason})`);
	}
	console.log(`\n${result.violations.length} violation(s), ${result.stale.length} stale leftover(s)\n`);
}

process.exit(result.violations.length === 0 ? 0 : 1);

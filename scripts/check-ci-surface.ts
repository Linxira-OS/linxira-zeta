/**
 * CI release-surface guard. Machine-reconciles the GitHub workflow job
 * inventory, needs wiring, and artifact naming against
 * scripts/brand/ci-surface-registry.ts, so an OMP merge (damage class 7) or a
 * platform trim (damage class 10) cannot silently drop Zeta-only jobs, break
 * the release_github dependency edge, or let upstream omp-* artifact names
 * overwrite the release surface.
 *
 * brand-check.ts cannot cover this: its SCAN_EXT excludes .yml, and a job
 * inventory is structural, not a line-token problem. Parsing is deliberately
 * minimal and fail-loud — a workflow whose `jobs:` section or a target job
 * whose `needs:` array cannot be parsed is a violation, never a silent skip.
 *
 * Usage: bun scripts/check-ci-surface.ts            (gate mode; exit 0/1)
 *        bun scripts/check-ci-surface.ts --json     (machine-readable report)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { CI_SURFACE, MIN_CI_JOBS, type WorkflowSurface } from "./brand/ci-surface-registry";

const ROOT = path.resolve(import.meta.dir, "..");

/** Trigger keys sharing job-key indentation under `on:` (defensive; they precede `jobs:`). */
const TRIGGER_KEYS = new Set(["push", "pull_request", "workflow_dispatch", "workflow_call", "schedule", "release"]);

interface Violation {
	file: string;
	line: number;
	rule: string;
	text: string;
	why: string;
}

interface JobEntry {
	keyLine: number; // 1-based line of the job key
	endLine: number; // last line of the job's window (inclusive, 1-based)
	needsLine: number; // 1-based line of the `needs: [..]` declaration (0 = none found)
	needs: string[] | null; // parsed needs list; null = absent or unparseable
}

interface ParsedWorkflow {
	jobsLine: number; // 1-based line of the `jobs:` declaration
	jobs: Map<string, JobEntry>;
}

/** Top-level job keys sit at 2-4 space indent under `jobs:` (this repo uses 3). */
const JOB_KEY = /^ {2,4}([A-Za-z_][A-Za-z_0-9-]*):\s*$/;
const NEEDS_ARRAY = /^\s*needs:\s*\[(.*?)\]/;
const NEEDS_BLOCK = /^\s*needs:\s*$/;

function parseWorkflow(lines: string[]): ParsedWorkflow | null {
	const jobsLineIdx = lines.findIndex(line => /^jobs:\s*$/.test(line));
	if (jobsLineIdx === -1) return null;

	// First pass: collect job-key lines until the next indent-0 top-level key.
	const starts: Array<{ name: string; line: number }> = [];
	for (let i = jobsLineIdx + 1; i < lines.length; i++) {
		if (/^\S/.test(lines[i])) break; // next top-level key: jobs section over
		const match = JOB_KEY.exec(lines[i]);
		if (match && !TRIGGER_KEYS.has(match[1])) starts.push({ name: match[1], line: i + 1 });
	}

	// Second pass: within each job's window, grab its needs array.
	const jobs = new Map<string, JobEntry>();
	starts.forEach((start, index) => {
		const endLine = index + 1 < starts.length ? starts[index + 1].line - 1 : lines.length;
		let needsLine = 0;
		let needs: string[] | null = null;
		for (let i = start.line; i <= endLine; i++) {
			const arrayMatch = NEEDS_ARRAY.exec(lines[i]);
			if (arrayMatch) {
				needsLine = i + 1;
				needs = arrayMatch[1]
					.split(",")
					.map(entry => entry.trim())
					.filter(Boolean);
				break;
			}
			if (NEEDS_BLOCK.test(lines[i])) {
				// Block-form needs (`needs:\n  - a`): unparseable → fail loud below.
				needsLine = i + 1;
				break;
			}
		}
		jobs.set(start.name, { keyLine: start.line, endLine, needsLine, needs });
	});

	return { jobsLine: jobsLineIdx + 1, jobs };
}

const MATRIX_INCLUDE = /^\s*include:\s*$/;
const MATRIX_ITEM_OPEN = /^\s*-\s*\{\s*$/;
const MATRIX_ITEM_CLOSE = /^\s*\}\s*,?\s*$/;
const MATRIX_ITEM_KEY = /^\s*([A-Za-z_][A-Za-z0-9_-]*):/;
const MATRIX_REFERENCE = /\$\{\{\s*matrix\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/g;

/**
 * Every `matrix.<key>` a job reads must be defined by *every* `include` entry.
 *
 * A key that only some entries set leaves the rest with an empty value at
 * expansion time. For `runs-on` that is not a partial failure: GitHub cannot
 * expand the matrix at all, so the job never appears in the run — while the
 * `needs.<job>.result == 'success'` gates downstream keep evaluating against a
 * job that does not exist, and the whole publish tail is skipped without a
 * single failing step. That is how `release_binary` silently stopped building
 * the `zeta-cli-*` release assets (AGENTS.md damage class 7/12).
 */
function checkMatrixCoverage(
	file: string,
	lines: string[],
	jobs: Map<string, JobEntry>,
	violations: Violation[],
): void {
	for (const [name, entry] of jobs) {
		const window = lines.slice(entry.keyLine - 1, entry.endLine);
		const includeAt = window.findIndex(line => MATRIX_INCLUDE.test(line));
		if (includeAt === -1) continue;

		const entries: Array<{ keys: Set<string>; line: number }> = [];
		for (let i = includeAt + 1; i < window.length; i++) {
			const line = window[i];
			if (!MATRIX_ITEM_OPEN.test(line)) {
				if (entries.length > 0 && MATRIX_ITEM_CLOSE.test(line))
					entries[entries.length - 1].line = entry.keyLine + i;
				continue;
			}
			const keys = new Set<string>();
			let lineNo = entry.keyLine + i;
			for (let j = i + 1; j < window.length; j++) {
				const inner = window[j];
				if (MATRIX_ITEM_CLOSE.test(inner)) {
					i = j;
					break;
				}
				const key = MATRIX_ITEM_KEY.exec(inner);
				if (key) keys.add(key[1]);
			}
			entries.push({ keys, line: lineNo });
		}
		if (entries.length === 0) continue;

		const referenced = new Set<string>();
		for (const line of window) {
			for (const match of line.matchAll(MATRIX_REFERENCE)) referenced.add(match[1]);
		}

		for (const key of referenced) {
			const missing = entries.filter(item => !item.keys.has(key));
			if (missing.length === 0) continue;
			violations.push({
				file,
				line: missing[0].line,
				rule: "matrix-key-coverage",
				text: `${name}: matrix.${key} is read but ${missing.length}/${entries.length} include entr${
					missing.length === 1 ? "y" : "ies"
				} do not define it`,
				why: "a partially defined matrix key expands to empty — an unusable runs-on hides the whole job from the run",
			});
		}
	}
}

function checkSurface(surface: WorkflowSurface): { violations: Violation[]; jobCount: number } {
	const violations: Violation[] = [];
	const abs = path.join(ROOT, surface.file);
	if (!fs.existsSync(abs)) {
		violations.push({
			file: surface.file,
			line: 0,
			rule: "workflow-missing",
			text: surface.file,
			why: "workflow file deleted — CI release surface gone (damage class 7)",
		});
		return { violations, jobCount: 0 };
	}

	const lines = fs
		.readFileSync(abs, "utf8")
		.split("\n")
		.map(line => line.replace(/\r$/, ""));
	const parsed = parseWorkflow(lines);
	if (!parsed) {
		violations.push({
			file: surface.file,
			line: 1,
			rule: "unparseable-jobs",
			text: "no `jobs:` section found",
			why: "fail loud: an unparseable workflow must block the gate, never pass silently",
		});
		return { violations, jobCount: 0 };
	}
	const jobNames = [...parsed.jobs.keys()];

	// requiresAll: missing job subset entries.
	for (const required of surface.requiresAll) {
		if (!parsed.jobs.has(required.job)) {
			violations.push({
				file: surface.file,
				line: parsed.jobsLine,
				rule: "missing-job",
				text: required.job,
				why: required.why,
			});
		}
	}

	// Job-count floor (whole-file regression guard).
	if (surface.minJobs !== undefined && jobNames.length < surface.minJobs) {
		violations.push({
			file: surface.file,
			line: parsed.jobsLine,
			rule: "job-floor",
			text: `${jobNames.length} job(s) < floor ${surface.minJobs}`,
			why: "registry floor prevents wholesale CI regression (MIN_CI_JOBS)",
		});
	}

	// needsEdges: needs ⊇ required dependencies.
	for (const edge of surface.needsEdges) {
		const entry = parsed.jobs.get(edge.job);
		if (!entry) {
			violations.push({
				file: surface.file,
				line: parsed.jobsLine,
				rule: "needs-edge",
				text: `${edge.job}: job missing — needs edge unverifiable`,
				why: edge.why,
			});
			continue;
		}
		if (entry.needs === null) {
			violations.push({
				file: surface.file,
				line: entry.needsLine > 0 ? entry.needsLine : entry.keyLine,
				rule: "unparseable-needs",
				text: `${edge.job}: needs is not a parseable [ .. ] array`,
				why: "fail loud: silent skip would hide wiring damage",
			});
			continue;
		}
		for (const need of edge.needs) {
			if (!entry.needs.includes(need)) {
				violations.push({
					file: surface.file,
					line: entry.needsLine > 0 ? entry.needsLine : entry.keyLine,
					rule: "needs-edge",
					text: `${edge.job}.needs missing ${need} (has: ${entry.needs.join(", ")})`,
					why: edge.why,
				});
			}
		}
	}

	// artifactRules: line-scoped naming assertions.
	lines.forEach((line, index) => {
		for (const rule of surface.artifactRules) {
			if (!rule.scope.test(line)) continue;
			if (rule.mustContain && !rule.mustContain.test(line)) {
				violations.push({
					file: surface.file,
					line: index + 1,
					rule: "artifact-must-contain",
					text: line.trim().slice(0, 120),
					why: "scoped mustContain assertion failed",
				});
			}
			for (const ban of rule.mustNotContain) {
				if (!ban.needle.test(line)) continue;
				if (ban.allow && ban.allow.test(line)) continue;
				violations.push({
					file: surface.file,
					line: index + 1,
					rule: ban.tag ?? "artifact-name",
					text: line.trim().slice(0, 120),
					why: ban.why,
				});
			}
		}
	});

	checkMatrixCoverage(surface.file, lines, parsed.jobs, violations);

	return { violations, jobCount: jobNames.length };
}

const violations: Violation[] = [];
const census: Array<{ file: string; jobs: number; floor?: number }> = [];

for (const surface of CI_SURFACE) {
	const { violations: hits, jobCount } = checkSurface(surface);
	violations.push(...hits);
	census.push({ file: surface.file, jobs: jobCount, floor: surface.minJobs });
}

// Registry floor (zeta-sentinels MIN style): a truncated registry must fail
// loudly instead of weakening the guard silently.
const totalRequired = CI_SURFACE.reduce((sum, surface) => sum + surface.requiresAll.length, 0);
if (totalRequired < MIN_CI_JOBS) {
	violations.push({
		file: "scripts/brand/ci-surface-registry.ts",
		line: 0,
		rule: "registry-floor",
		text: `${totalRequired} required job(s) across registry, floor is ${MIN_CI_JOBS}`,
		why: "registry truncated or deleted? (MIN_CI_JOBS)",
	});
}

if (process.argv.includes("--json")) {
	console.log(JSON.stringify({ violations, files: census }, null, 2));
} else {
	for (const violation of violations) {
		console.log(`✗ ${violation.file}:${violation.line} [${violation.rule}] ${violation.text} — ${violation.why}`);
	}
	if (violations.length === 0) {
		const files = census.map(entry => `${entry.file} ${entry.jobs} job(s)`).join(", ");
		console.log(
			`CI surface OK: ${files}; ${totalRequired} required job(s), ` +
				`${CI_SURFACE.reduce((sum, surface) => sum + surface.needsEdges.length, 0)} needs edge(s) verified (floor ${MIN_CI_JOBS})`,
		);
	} else {
		for (const entry of census) {
			console.log(
				`  ${entry.file}: ${entry.jobs} job(s)${entry.floor !== undefined ? ` (floor ${entry.floor})` : ""}`,
			);
		}
		console.log(`\n${violations.length} violation(s)`);
	}
}
process.exit(violations.length > 0 ? 1 : 0);

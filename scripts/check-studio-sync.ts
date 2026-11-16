#!/usr/bin/env bun
import * as path from "node:path";
import { isRecord } from "../packages/utils/src/type-guards";
import type { SyncRow } from "./studio-sync";

export interface Landing {
	path: string;
	hash: string;
}
export interface SyncDecision {
	upstream: string;
	fromCommit: string;
	targetCommit: string;
	reason: string;
	evidence: string;
	landings: Landing[];
}
interface Report {
	from: { commit: string };
	target: { commit: string };
	remoteVerified: boolean;
	rows: SyncRow[];
}
const HASH = /^(?:[a-f0-9]{64}|absent)$/;
export function checkDecisions(
	report: Report,
	decisions: SyncDecision[],
	current: Map<string, string>,
): { unresolved: string[]; problems: string[]; accepted: number } {
	const problems: string[] = [],
		unresolved: string[] = [];
	const byPath = new Map<string, SyncDecision>();
	for (const decision of decisions) {
		if (byPath.has(decision.upstream)) problems.push(`duplicate decision: ${decision.upstream}`);
		byPath.set(decision.upstream, decision);
		if (!report.rows.some(row => row.upstream === decision.upstream))
			problems.push(`decision outside this tag delta: ${decision.upstream}`);
	}
	let accepted = 0;
	for (const row of report.rows) {
		if (row.local && row.beforeHash !== undefined) {
			const expected = row.applied ? row.afterHash : row.beforeHash;
			if (current.get(row.local) !== expected)
				problems.push(`report preimage changed: ${row.local}; regenerate the report`);
		}
		if (row.status === "current" || row.status === "local-preserved" || row.applied) continue;
		const decision = byPath.get(row.upstream);
		if (!decision) {
			unresolved.push(row.upstream);
			continue;
		}
		const valid =
			decision.fromCommit === report.from.commit &&
			decision.targetCommit === report.target.commit &&
			decision.reason.trim() !== "" &&
			decision.evidence.trim() !== "" &&
			decision.landings.length > 0 &&
			(!row.local || decision.landings.some(landing => landing.path === row.local)) &&
			decision.landings.every(landing => HASH.test(landing.hash) && current.get(landing.path) === landing.hash);
		if (!valid) {
			problems.push(`stale/incomplete decision: ${row.upstream}`);
			unresolved.push(row.upstream);
		} else accepted++;
	}
	return { unresolved, problems, accepted };
}
function safePath(root: string, file: string): string {
	const absolute = path.resolve(root, file),
		relative = path.relative(root, absolute);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
		throw new Error(`expected repository-relative file: ${file}`);
	return absolute;
}
async function fileHash(root: string, file: string): Promise<string> {
	const absolute = safePath(root, file);
	if (!(await Bun.file(absolute).exists())) return "absent";
	return new Bun.CryptoHasher("sha256").update(await Bun.file(absolute).bytes()).digest("hex");
}
async function main(): Promise<void> {
	const root = path.resolve(import.meta.dir, "..");
	let reportPath = "",
		decisionsPath: string | undefined,
		requireComplete = false,
		requireAncestry = false;
	const args = process.argv.slice(2);
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]!;
		if (arg === "--help") {
			console.log(
				"bun scripts/check-studio-sync.ts --report temp/<run>/report.json [--decisions <json>] [--require-complete] [--require-ancestry]",
			);
			return;
		}
		if (arg === "--require-complete") {
			requireComplete = true;
			continue;
		}
		if (arg === "--require-ancestry") {
			requireAncestry = true;
			continue;
		}
		const value = args[++index];
		if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
		if (arg === "--report") reportPath = value;
		else if (arg === "--decisions") decisionsPath = value;
		else throw new Error(`unknown argument: ${arg}`);
	}
	if (!reportPath) throw new Error("--report is required");
	const raw: unknown = await Bun.file(safePath(root, reportPath)).json();
	if (
		!isRecord(raw) ||
		raw.schemaVersion !== 1 ||
		!isRecord(raw.from) ||
		!isRecord(raw.target) ||
		!Array.isArray(raw.rows)
	)
		throw new Error("invalid Studio sync report");
	const report = raw as unknown as Report;
	const decisions: SyncDecision[] = decisionsPath ? await Bun.file(safePath(root, decisionsPath)).json() : [];
	if (!Array.isArray(decisions)) throw new Error("decisions must be an array");
	const files = new Set([
		...report.rows.flatMap(row => (row.local ? [row.local] : [])),
		...decisions.flatMap(decision => decision.landings.map(landing => landing.path)),
	]);
	const current = new Map<string, string>();
	for (const file of files) current.set(file, await fileHash(root, file));
	const result = checkDecisions(report, decisions, current);
	if (requireAncestry) {
		const child = Bun.spawn(["git", "merge-base", "--is-ancestor", report.target.commit, "HEAD"], {
			cwd: root,
			stdout: "ignore",
			stderr: "pipe",
			windowsHide: true,
		});
		if ((await child.exited) !== 0)
			result.problems.push(`official target ${report.target.commit} is not an ancestor of HEAD`);
	}
	if (requireComplete && !report.remoteVerified) result.problems.push("report has no live official tag verification");
	console.log(
		JSON.stringify(
			{
				acceptedDecisions: result.accepted,
				unresolved: result.unresolved.length,
				unresolvedByStatus: Object.fromEntries(
					[...new Set(report.rows.map(row => row.status))]
						.map(status => [
							status,
							report.rows.filter(row => row.status === status && result.unresolved.includes(row.upstream))
								.length,
						])
						.filter(([, count]) => count !== 0),
				),
				problems: result.problems,
			},
			null,
			2,
		),
	);
	if (result.problems.length || (requireComplete && result.unresolved.length)) process.exitCode = 1;
}
if (import.meta.main)
	await main().catch(error => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 2;
	});

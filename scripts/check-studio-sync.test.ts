import { expect, test } from "bun:test";
import { checkDecisions, type SyncDecision } from "./check-studio-sync";

const hash = "a".repeat(64),
	changed = "b".repeat(64);
const report = {
	from: { commit: "from" },
	target: { commit: "target" },
	remoteVerified: true,
	rows: [{ upstream: "apps/desktop/src/composition.ts", change: "M", status: "host-adaptation" as const }],
};
const decision: SyncDecision = {
	upstream: report.rows[0]!.upstream,
	fromCommit: "from",
	targetCommit: "target",
	reason: "Zeta standalone Host retains the existing authority",
	evidence: "studio-host-contexts.test.ts",
	landings: [{ path: "packages/host.ts", hash }],
};

test("accepted decisions expire when their landing or source tag changes", () => {
	const current = new Map([["packages/host.ts", hash]]);
	expect(checkDecisions(report, [decision], current)).toEqual({ accepted: 1, unresolved: [], problems: [] });
	const staleLanding = checkDecisions(report, [decision], new Map([["packages/host.ts", changed]]));
	expect(staleLanding.accepted).toBe(0);
	expect(staleLanding.unresolved).toEqual([decision.upstream]);
	expect(staleLanding.problems).toEqual([`stale/incomplete decision: ${decision.upstream}`]);
	expect(checkDecisions({ ...report, target: { commit: "new-tag" } }, [decision], current).accepted).toBe(0);
	expect(checkDecisions(report, [], current).unresolved).toEqual([decision.upstream]);
	expect(checkDecisions(report, [decision, decision], current).problems).toContain(
		`duplicate decision: ${decision.upstream}`,
	);
});

test("a formerly current file cannot stay green after its report preimage changes", () => {
	const mapped = {
		...report,
		rows: [
			{
				upstream: "apps/renderer/src/App.tsx",
				local: "web-app/src/studio/App.tsx",
				change: "M",
				status: "current" as const,
				beforeHash: hash,
			},
		],
	};
	expect(checkDecisions(mapped, [], new Map([[mapped.rows[0]!.local, changed]])).problems).toEqual([
		`report preimage changed: ${mapped.rows[0]!.local}; regenerate the report`,
	]);
	const applied = { ...report, rows: [{ ...mapped.rows[0]!, applied: true, afterHash: "absent" }] };
	expect(checkDecisions(applied, [], new Map([[mapped.rows[0]!.local, "absent"]])).problems).toEqual([]);
	const unrelated = { ...decision, upstream: mapped.rows[0]!.upstream };
	expect(
		checkDecisions(
			{ ...mapped, rows: [{ ...mapped.rows[0]!, status: "conflict" as const }] },
			[unrelated],
			new Map([
				[mapped.rows[0]!.local, hash],
				["packages/host.ts", hash],
			]),
		).accepted,
	).toBe(0);
});

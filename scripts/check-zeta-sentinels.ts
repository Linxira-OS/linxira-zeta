/**
 * Zeta-only sentinel checker — merge gate for damage class #4 (silent
 * deletion of Zeta-only code during an OMP release merge).
 *
 * Every entry in scripts/brand/zeta-sentinels.ts must appear in its file.
 * Additionally:
 * - the sentinel registry itself must never shrink below MIN_SENTINELS
 *   (a merge dropping the data file or emptying it fails here, not silently);
 * - AGENTS.md must link document/merge-review.md (the "dynamic link" between
 *   the governance prose and this machine check).
 *
 * Usage: bun scripts/check-zeta-sentinels.ts            (gate mode; exit 0/1)
 *        bun scripts/check-zeta-sentinels.ts --json     (machine-readable)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ZETA_SENTINELS } from "./brand/zeta-sentinels";

const ROOT = path.resolve(import.meta.dir, "..");

/** Hard floor: a merge that deletes/empties the registry must fail loudly. */
const MIN_SENTINELS = 40;

/** Governance link AGENTS.md must carry (dynamic-link check). */
const MERGE_REVIEW_LINK = "document/merge-review.md";

function main(): void {
	const missing: Array<{ file: string; symbol: string; why: string }> = [];

	for (const entry of ZETA_SENTINELS) {
		const file = path.join(ROOT, entry.file);
		let content: string;
		try {
			content = fs.readFileSync(file, "utf8");
		} catch {
			missing.push({ file: entry.file, symbol: entry.symbol, why: `${entry.why} (file missing)` });
			continue;
		}
		if (!content.includes(entry.symbol)) {
			missing.push({ file: entry.file, symbol: entry.symbol, why: entry.why });
		}
	}

	// Registry floor.
	const registryProblems: string[] = [];
	if (ZETA_SENTINELS.length < MIN_SENTINELS) {
		registryProblems.push(
			`sentinel registry has ${ZETA_SENTINELS.length} entries, floor is ${MIN_SENTINELS} (deleted or truncated?)`,
		);
	}

	// AGENTS.md dynamic link to the merge-review rules.
	const agentsPath = path.join(ROOT, "AGENTS.md");
	const agents = fs.readFileSync(agentsPath, "utf8");
	const linkOk = agents.includes(MERGE_REVIEW_LINK);

	const failed = missing.length > 0 || registryProblems.length > 0 || !linkOk;

	if (process.argv.includes("--json")) {
		console.log(JSON.stringify({ missing, registryProblems, agentsLinkOk: linkOk }, null, 2));
	} else if (failed) {
		console.error("Zeta sentinel check FAILED:");
		for (const m of missing) {
			console.error(`  - ${m.file}: missing \`${m.symbol}\` (${m.why})`);
		}
		for (const p of registryProblems) console.error(`  - registry: ${p}`);
		if (!linkOk) console.error(`  - AGENTS.md: missing link to ${MERGE_REVIEW_LINK}`);
		process.exit(1);
	} else {
		console.log(`Zeta sentinels OK: ${ZETA_SENTINELS.length} sentinels verified, AGENTS.md → ${MERGE_REVIEW_LINK}`);
	}

	if (failed) process.exit(1);
}

main();

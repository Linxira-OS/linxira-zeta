/**
 * Brand-regression scan across a merge diff.
 *
 * The brand overlay misses prose/identifier variants it has no rule for; the
 * merge then silently reverts a Zeta spelling that used to be correct
 * (v18.8.7/v18.8.8: `omp update`, `~/.omp`, `Set up omp in terminal`,
 * `agentInfo.name = "omp"`). `brand-check.ts` passes because no rule covers
 * those exact tokens.
 *
 * This scan looks at the merge diff (`git diff <base> HEAD`) and prints, per
 * file, added lines that carry an upstream `omp` token next to removed lines
 * that carried a Zeta token — i.e. spots where the merge moved a line from
 * Zeta spelling to upstream spelling.
 *
 * Usage: bun scripts/scan-brand-regressions.ts --base <pre-merge-ref>
 */

import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const BASE = baseIdx !== -1 ? args[baseIdx + 1] : "main";

const OMP_TOKEN = /(?<![A-Za-z0-9_])omp(?![A-Za-z0-9_])|~\/\.omp|@oh-my-pi|\.omp-plugin|omp\.sh/;
const ZETA_TOKEN = /zeta|CLI_BIN_NAME|ZETA_|\.zeta/;

// The trailing `--` is load-bearing: this repo also has a `main/` directory
// (the npm distribution leaves), so a bare `git diff main HEAD` dies with
// "fatal: ambiguous argument 'main': both revision and filename" — the script's
// own default base was unusable. `--` ends the revision list, so `main` is read
// as a ref and the diff still covers the whole tree (no pathspecs).
const diff = execFileSync("git", ["diff", "-U0", BASE, "HEAD", "--"], { encoding: "utf8", maxBuffer: 1 << 30 });

interface Hit {
	file: string;
	added: string;
}

const hits: Hit[] = [];
let file = "";
let removedZeta: string | null = null;
for (const line of diff.split("\n")) {
	if (line.startsWith("+++ b/")) {
		file = line.slice(6);
		removedZeta = null;
		continue;
	}
	if (line.startsWith("@@")) {
		removedZeta = null;
		continue;
	}
	if (line.startsWith("---") || line.startsWith("+++")) continue;
	if (line.startsWith("-")) {
		if (ZETA_TOKEN.test(line)) removedZeta = line.slice(1).trim();
		continue;
	}
	if (line.startsWith("+")) {
		const added = line.slice(1).trim();
		if (OMP_TOKEN.test(added) && removedZeta)
			hits.push({ file, added: removedZeta ? `+ ${added}\n     - ${removedZeta}` : added });
		continue;
	}
	if (line.trim() === "") removedZeta = null;
}

for (const h of hits) console.log(`${h.file}\n     ${h.added}\n`);
console.log(`${hits.length} brand regressions in the merge diff (${BASE}..HEAD)`);

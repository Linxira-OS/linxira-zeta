/**
 * One-shot: resolve conflicted paths by taking the upstream side and re-applying
 * the Zeta package-scope map (`@oh-my-pi/<pkg>` → `@linxiraos/<zeta-name>`).
 *
 * `bun .tmp-take-theirs.ts <file>...`
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const RENAMES: Record<string, string> = {
	omptype: "pi-omptype",
	"pi-coding-agent": "zeta",
	"pi-agent": "pi-agent-core",
	stats: "pi-stats",
	snapcompact: "pi-snapcompact",
};

for (const file of process.argv.slice(2)) {
	execFileSync("git", ["checkout", "--theirs", "--", file]);
	const before = readFileSync(file, "utf8");
	const after = before.replace(/@oh-my-pi\/([a-z0-9-]+)/g, (_m, name: string) => `@linxiraos/${RENAMES[name] ?? name}`);
	if (after !== before) writeFileSync(file, after);
	execFileSync("git", ["add", "--", file]);
	console.log(`resolved (theirs+scope): ${file}`);
}
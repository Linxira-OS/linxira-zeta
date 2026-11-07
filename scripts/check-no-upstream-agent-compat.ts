/**
 * Guard against reintroducing upstream Tern/OMP agent compatibility.
 *
 * TSP is a presentation protocol and stays. What must not come back:
 * - Tern's window-agent prompt/tool branch menu (Carly, cx.*, read_block, …)
 * - Tern's browser backend / pane auto-selection / session-restore hooks
 * - OMP legacy storage, plugin discovery, lockfile, env aliases, and internal
 *   compatibility names.
 *
 * Frozen external contracts (`client-id "omp"`, catalog/docs hosts,
 * `__omp_judgment_images`, `icon.pi`) are intentionally outside this scan.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const SCAN_DIRS = [
	"packages/coding-agent/src",
	"packages/tui/src",
	"packages/ai/src",
	"packages/agent/src",
	"web-app/src",
	"desktop/src",
];

const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; why: string }> = [
	{ pattern: /\bTERN_PANE(?:_SOCKET)?\b/, why: "Tern pane auto-selection is removed" },
	{ pattern: /\bPI_BROWSER_TERN\b/, why: "Tern browser override is removed" },
	{ pattern: /\bbrowser\.tern\b/, why: "Tern browser setting is removed" },
	{ pattern: /\bomp_restore\b/, why: "Tern session restore hook is removed" },
	{ pattern: /\bCarly\b/, why: "Tern agent prompt/tool family is removed" },
	{ pattern: /\bcx\.(?:agents|layout|session|whiteboard|action)\b/, why: "Tern agent tool API is removed" },
	{ pattern: /\btern\.carly\b/, why: "Tern scheduler API is removed" },
	{ pattern: /\b(?:read_block|send_input|run_command)\b/, why: "Tern window-agent tool branches are removed" },
	{ pattern: /\bomp\.(?:hud|composer|review|plan|queue|working)\./, why: "Tern OMP role projection is removed" },
	{ pattern: /\.omp-plugin\b/, why: "legacy OMP plugin discovery is removed" },
	{ pattern: /\bomp-plugins\b/, why: "legacy OMP provider/lockfile naming is removed" },
	{
		pattern: /PLUGIN_MANIFEST_KEYS\s*=\s*\[[^\]]*["']omp["']/,
		why: "the upstream manifest key omp is not read; Zeta reads only its own keys",
	},
	{ pattern: /\bcompat\.importLegacyOmp\b/, why: "automatic OMP storage import is removed" },
	{ pattern: /\bZETA_OMP_COMPAT\b/, why: "automatic OMP compatibility switch is removed" },
	{
		pattern: /\bOMP_(?:AUTH_BROKER_|AUTORESEARCH_DB_DIR|CONVERSATION_PARSER_REUSE|HARMONY_DEBUG|NO_WEBP|PROFILE)/,
		why: "OMP env aliases are removed",
	},
	{ pattern: /__omp/, why: "OMP internal marker is removed", allow: /__omp_judgment_images|mcp__omp__/ },
	{ pattern: /\.ompcast\b/, why: "legacy OMP recording extension is removed" },
	{ pattern: /\.ompshare\b/, why: "legacy OMP share extension is removed" },
	{ pattern: /\bompMarkdown\b/, why: "legacy OMP viewer global is removed" },
	{ pattern: /\bompExportViewer\b/, why: "legacy OMP viewer marker is removed" },
	{ pattern: /\.omp-ready\b/, why: "legacy OMP cache marker is removed" },
	{ pattern: /\.omp-retained-backend\.json\b/, why: "legacy OMP backend marker is removed" },
];

function filesUnder(rel: string): string[] {
	const dir = path.join(ROOT, rel);
	if (!fs.existsSync(dir)) return [];
	const out: string[] = [];
	const walk = (current: string): void => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (/\.(?:ts|tsx|js|jsx|mjs|cjs|json|md)$/.test(entry.name)) out.push(full);
		}
	};
	walk(dir);
	return out;
}

const violations: string[] = [];
for (const rel of SCAN_DIRS) {
	for (const file of filesUnder(rel)) {
		const text = fs.readFileSync(file, "utf8");
		const lines = text.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			for (const rule of FORBIDDEN) {
				if (rule.allow?.test(line)) continue;
				if (rule.pattern.test(line)) {
					violations.push(`${path.relative(ROOT, file)}:${i + 1}: ${rule.why}`);
				}
			}
		}
	}
}

if (violations.length > 0) {
	console.error("Upstream Tern/OMP compatibility residue found:");
	for (const violation of violations) console.error(`  - ${violation}`);
	process.exit(1);
}
console.log("No upstream Tern/OMP runtime compatibility residue.");

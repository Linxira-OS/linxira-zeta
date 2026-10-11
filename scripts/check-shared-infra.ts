#!/usr/bin/env bun
/**
 * Shared-infrastructure guard — the machine half of
 * `document/upstream-commercial-assets.md`.
 *
 * Upstream hardcodes a set of shared/commercial endpoints in the client. Zeta
 * keeps some on purpose (a changed URL breaks `/collab`, `/join <link>`, model
 * discovery or login), keeps others as code-with-user-credentials, replaces a
 * third group on a schedule, and still points a few brand surfaces at upstream.
 * Brand scanning deliberately ignores these domains — they are registry-listed
 * keepers — so a merge could silently add a NEW endpoint and nothing would
 * notice.
 *
 * This gate pins the inventory: an unregistered `*.omp.sh` / `*.stencil.so` /
 * `scl.so` URL in a scanned file fails, and so does a known domain showing up
 * in a file it was not whitelisted for. Test files are exempt (fixtures may
 * quote any endpoint). Adding a placement is a deliberate two-step act: record
 * it in the ledger, then here.
 */
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const SCAN_ROOTS = ["packages", "scripts", ".github", "desktop", "crates"];
const SCAN_EXT = /\.(ts|tsx|js|mjs|cjs|json|kdl|rs|sh|ps1|yml|yaml|html|txt)$/;
const DOMAIN_RE = /https?:\/\/[a-zA-Z0-9._-]*(?:omp\.sh|stencil\.so|scl\.so)[a-zA-Z0-9./_@?=&%#-]*/g;

type Status = "keep" | "keep-code-user-credential" | "replace-P1" | "replace-P2" | "replace-P3" | "replace-brand";

interface Placement {
	/** URL prefix this entry governs (longest match wins). */
	domain: string;
	/** Non-test files allowed to contain it. */
	files: string[];
	/** Ledger disposition. */
	status: Status;
	why: string;
}

const MANIFEST_COPIES = [
	"packages/browser-relay/extension/manifest.json",
	"packages/coding-agent/src/tools/browser/relay/extension-assets/manifest.json.txt",
];

const INVENTORY: Placement[] = [
	{
		domain: "https://my.omp.sh",
		status: "keep",
		files: [
			"packages/collab-web/index.html",
			"packages/collab-web/public/robots.txt",
			"packages/collab-web/public/sitemap.xml",
			"packages/collab-web/scripts/local-relay.ts",
			"packages/wire/src/index.ts",
		],
		why: "collab relay + share URLs; both protocol ends run upstream (registry: 不品牌化)",
	},
	{
		domain: "https://omp.sh/install",
		status: "keep",
		files: ["packages/coding-agent/src/cli/update-cli.ts"],
		why: "install hint URL (registry: 共享基础设施，勿改)",
	},
	{
		domain: "https://omp.sh/docs/",
		status: "keep",
		files: ["packages/coding-agent/src/discovery/builtin.ts"],
		why: "provenance comment quoting upstream's doc path; not a runtime call",
	},
	{
		domain: "https://catalog.stencil.so",
		status: "keep",
		files: ["packages/catalog/scripts/generate-models.ts", "packages/catalog/src/provider-models/openai-compat.ts"],
		why: "model-discovery data source; replacing it needs a self-hosted catalog service, not planned",
	},
	{
		domain: "https://build.stencil.so",
		status: "keep",
		files: [".github/workflows/ci.yml", "scripts/ci-build-upload.ts"],
		why: "anonymous CI artifact upload channel; no user credentials involved",
	},
	{
		domain: "https://api.stencil.so",
		status: "keep-code-user-credential",
		files: ["packages/catalog/src/compat/rules.json", "packages/catalog/src/compat/rules/auth/stencil.kdl"],
		why: "Stencil API endpoints; credentials come from the user (STENCIL_API_KEY)",
	},
	{
		domain: "https://auth.stencil.so",
		status: "keep-code-user-credential",
		files: ["packages/catalog/src/compat/rules.json", "packages/catalog/src/compat/rules/auth/stencil.kdl"],
		why: 'OIDC issuer; client-id "omp" and the issuer/scope names are protocol contract — renaming breaks login',
	},
	{
		domain: "https://qa.omp.sh",
		status: "replace-P1",
		files: [
			"packages/coding-agent/src/cli/grievances-cli.ts",
			"packages/coding-agent/src/tools/report-tool-issue.ts",
			"packages/coding-agent/src/tools/settings.ts",
		],
		why: "grievances endpoint: user-reachable, dies if upstream shuts it down; replacement = GitHub Issues API",
	},
	{
		domain: "https://skills.omp.sh",
		status: "replace-P2",
		files: [
			"packages/coding-agent/src/cli/command-help.ts",
			"packages/coding-agent/src/commands/skill.ts",
			"packages/coding-agent/src/skillshare/client.ts",
			"packages/coding-agent/src/slash-commands/builtin-skills.ts",
			"packages/wire/src/skillshare.ts",
		],
		why: "skillshare default source; replacement = @linxiraos/linxira-skills (npm+git, no server)",
	},
	{
		domain: "https://live.omp.sh",
		status: "replace-P3",
		files: [
			"packages/catalog/src/compat/rules/auth/stencil.kdl",
			"packages/coding-agent/src/cli/command-help.ts",
			"packages/coding-agent/src/stream/clip-upload.ts",
			"packages/wire/src/stream.ts",
		],
		why: "live voice service; same account family as Stencil, lowest priority",
	},
	{
		domain: "https://docs.stencil.so",
		status: "keep",
		files: [
			"packages/tui/src/prompt/tips.txt",
			"packages/tui/src/prompt/welcome.ts",
			"packages/tui/src/native/node.ts",
			"packages/wire/src/tsp.ts",
		],
		why: "documentation link (tips/welcome copy + protocol comments)",
	},
	{
		domain: "https://scl.so",
		status: "keep",
		files: ["packages/tui/src/prompt/tips.txt", "packages/tui/src/prompt/welcome.ts"],
		why: "copy link only — no API call",
	},
	{
		domain: "https://omp.sh/schemas/",
		status: "replace-brand",
		files: [
			"packages/coding-agent/src/modes/rpc/wire/index.ts",
			"packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json",
		],
		why: "JSON-Schema $id of OUR wire schema still names upstream's host (added by c4d3204151a, never swept); low risk, point it at a Zeta URL",
	},
	{
		domain: "https://omp.sh",
		status: "replace-brand",
		files: [...MANIFEST_COPIES, "packages/collab-web/index.html"],
		why: "browser-relay extension homepage_url + collab-web JSON-LD still point at the upstream site; needs a Zeta-owned URL",
	},
	{
		domain: "https://stencil.so",
		status: "replace-brand",
		files: ["packages/collab-web/index.html"],
		why: "collab-web JSON-LD publisher names Stencil Labs, Inc.; needs a Zeta-owned identity",
	},
];

const hits: string[] = [];

const SELF = "scripts/check-shared-infra.ts";

/**
 * The guard's own `INVENTORY` names every pinned endpoint by design; scanning
 * itself would report 15 fake placements. The ledger document is excluded by
 * `SCAN_ROOTS` (it lives in `document/`).
 */
function isSelf(rel: string): boolean {
	return rel === SELF;
}

function isTest(rel: string): boolean {
	return (
		rel.startsWith("test/") ||
		rel.includes("/test/") ||
		rel.includes("/tests/") ||
		rel.includes("/__tests__/") ||
		/\.(test|spec)\./.test(rel)
	);
}

function longestMatch(url: string): Placement | undefined {
	let best: Placement | undefined;
	for (const entry of INVENTORY) {
		if (!url.startsWith(entry.domain)) continue;
		if (!best || entry.domain.length > best.domain.length) best = entry;
	}
	return best;
}

const out = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT, stdout: "pipe" });
const files = out.stdout
	.toString()
	.split("\n")
	.map(line => line.trim())
	.filter(Boolean)
	.filter(file => SCAN_ROOTS.some(root => file === root || file.startsWith(`${root}/`)))
	.filter(file => SCAN_EXT.test(file))
	.filter(file => !isTest(file.replaceAll("\\", "/")))
	.filter(file => !isSelf(file.replaceAll("\\", "/")));

for (const file of files) {
	const rel = file.replaceAll("\\", "/");
	const text = await Bun.file(path.join(ROOT, file)).text();
	const seen = new Set<string>();
	for (const url of text.match(DOMAIN_RE) ?? []) {
		if (seen.has(url)) continue;
		seen.add(url);
		const entry = longestMatch(url);
		if (!entry) {
			hits.push(
				`${rel}: unregistered upstream endpoint ${url} — record it in document/upstream-commercial-assets.md, then add it to this inventory`,
			);
			continue;
		}
		if (!entry.files.includes(rel)) {
			hits.push(
				`${rel}: ${url} is a registered endpoint (${entry.status}) but not whitelisted for this file — a new placement is a deliberate act: ledger first, inventory second`,
			);
		}
	}
}

if (hits.length > 0) {
	for (const hit of hits) console.log(`✗ ${hit}`);
	console.log(`\n${hits.length} shared-infra hit(s). Ledger: document/upstream-commercial-assets.md`);
	process.exit(1);
}

const replaceCount = INVENTORY.filter(entry => entry.status.startsWith("replace")).length;
console.log(
	`Shared-infra ledger OK: ${INVENTORY.length} endpoints pinned across ${files.length} scanned files (${replaceCount} marked for replacement).`,
);

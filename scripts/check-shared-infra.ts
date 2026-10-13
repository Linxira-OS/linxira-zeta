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

type Status =
	| "keep"
	| "keep-code-user-credential"
	| "replace-P1"
	| "replace-P2"
	| "replace-P3"
	| "replace-brand"
	| "replaced";

interface Placement {
	/** URL prefix this entry governs (longest match wins). */
	domain: string;
	/** Non-test files allowed to contain it. */
	files: string[];
	/** Ledger disposition. */
	status: Status;
	why: string;
}

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
		status: "replaced",
		// Deliberately empty: `installerHint()` (the recovery line printed when an
		// upgrade fails verification) points at OUR site's installers since
		// 2026-10-13. The old value was worse than a 404 — it installed upstream
		// OMP on a user's machine — so any re-placement is a regression.
		files: [],
		why: "upstream installer one-liner; replaced by https://linxira-os.github.io/install.{sh,ps1} (2026-10-13) — it installs OMP, not Zeta",
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
		status: "replaced",
		// Deliberately empty: the release step `Publish to build.stencil.so` and
		// its `scripts/ci-build-upload.ts` are deleted. The service permanently
		// 403s this fork ("only repositories of can1357 or stencil-hq may publish
		// omp builds"), which reddened the v1.2.0 and v1.2.1 publish tails after
		// npm had already shipped. Zeta publishes binaries to its own GitHub
		// Release only; any placement is a regression.
		files: [],
		why: "upstream OMP build server — permanently 403 for this fork; retired 2026-10-14 (damage class 11); binaries ship in our own GitHub Release",
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
		status: "replaced",
		// Deliberately empty: the transport moved to the GitHub Issues API and no
		// placement may come back. A merge that re-introduces the upstream endpoint
		// trips "registered endpoint (replaced) but not whitelisted".
		files: [],
		why: "grievances endpoint — replaced by the GitHub Issues client (src/grievances/client.ts, ZETA_ISSUE_REPO) on 2026-10-11; any placement is a regression",
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
		files: ["packages/tui/src/native/node.ts", "packages/wire/src/tsp.ts"],
		why: "provenance comment linking the Tern Surface Protocol spec; not a runtime call",
	},
	{
		domain: "https://scl.so",
		status: "replaced",
		// Deliberately empty: the upstream Tern promo tip (tips.txt `[NO-TERN] …
		// [tern](https://scl.so/tern)` + its i18n `tip33` copy) was removed by user
		// ruling 2026-10-14 — it pitched the upstream terminal via an upstream
		// short-link, and the product surface belongs to Zeta. The `[NO-TERN]`
		// visibility-marker mechanism went with it. A merge that re-introduces the
		// tip trips "registered endpoint (replaced) but not whitelisted".
		files: [],
		why: "upstream Tern promo copy link — removed 2026-10-14 (user ruling); any placement is a regression",
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
		files: ["packages/collab-web/index.html"],
		why: "collab-web JSON-LD still points at the upstream site; needs a Zeta-owned URL (the browser-relay manifests moved to our site 2026-10-14)",
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
	// A tracked file can be missing from the worktree mid-merge (a side deleted it, the
	// conflict is unresolved). Skip it instead of dying with ENOENT and masking every
	// other finding; a committed tree cannot be in that state.
	if (!(await Bun.file(path.join(ROOT, file)).exists())) continue;
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

const replaceCount = INVENTORY.filter(
	entry => entry.status.startsWith("replace") && entry.status !== "replaced",
).length;
console.log(
	`Shared-infra ledger OK: ${INVENTORY.length} endpoints pinned across ${files.length} scanned files (${replaceCount} marked for replacement).`,
);

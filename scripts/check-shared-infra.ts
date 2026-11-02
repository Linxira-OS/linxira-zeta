#!/usr/bin/env bun
/**
 * Shared-infrastructure guard — the machine half of
 * `document/upstream-commercial-assets.md`.
 *
 * Upstream hardcodes a set of shared/commercial endpoints in the client. Zeta
 * keeps some on purpose (a changed URL breaks `/collab`, `/join <link>`, model
 * discovery or login), and retires the rest. Brand scanning deliberately
 * ignores these domains — they are registry-listed keepers — so a merge could
 * silently add a NEW endpoint and nothing would notice.
 *
 * This gate pins the inventory: an unregistered `*.omp.sh` / `*.stencil.so` /
 * `scl.so` URL in a scanned file fails, and so does a known domain showing up
 * in a file it was not whitelisted for. Test files and recorded fixture trees
 * (`__fixtures__/`: real manifests, leak corpora) are exempt — fixtures must
 * quote the upstream endpoints verbatim, exactly like brand-check's token bans.
 * That exemption is scoped to a `__fixtures__` directory on purpose and MUST NOT
 * be widened (`scripts/**`, a whole top-level tree, or the repository root): a
 * recorded fixture is the only thing here allowed to quote an endpoint it does
 * not own, and a broader exemption would silently retire this inventory. Adding a placement is a deliberate two-step act: record
 * it in the ledger, then here.
 *
 * Every placement also says what it is (`kind`: static artifact, build-time
 * fetch, runtime data, dynamic auth, or a provenance comment). Entries marked
 * `replace-*` must carry a `deadline`; once that date passes this gate fails,
 * so a replacement promise cannot outlive the milestone that made it. A
 * keeper with a deadline is rejected too — that means someone scheduled a
 * deletion they never registered in `status`.
 */
import * as path from "node:path";

import { DOMAIN_RE, INVENTORY, isReplaceStatus, longestMatch, validateInventory } from "./shared-infra-inventory";

const ROOT = path.resolve(import.meta.dir, "..");
const SCAN_ROOTS = ["packages", "scripts", ".github", "desktop", "crates"];
const SCAN_EXT = /\.(ts|tsx|js|mjs|cjs|json|kdl|rs|sh|ps1|yml|yaml|html|txt)$/;

const hits: string[] = [];

// The inventory's own promises are checked first: a `replace-*` entry past its
// deadline is a finding even when nothing in the tree moved.
hits.push(...validateInventory(INVENTORY));

/**
 * Files that name every pinned endpoint by design: this guard and the
 * inventory module it reads. Scanning them would report one fake placement
 * per entry. The ledger document is excluded by `SCAN_ROOTS` (it lives in
 * `document/`).
 */
const SELF_FILES: Record<string, true> = {
	"scripts/check-shared-infra.ts": true,
	"scripts/shared-infra-inventory.ts": true,
};

function isSelf(rel: string): boolean {
	return SELF_FILES[rel] === true;
}

function isTest(rel: string): boolean {
	return (
		rel.startsWith("test/") ||
		rel.includes("/test/") ||
		rel.includes("/tests/") ||
		rel.includes("/__tests__/") ||
		rel.includes("/__fixtures__/") ||
		/\.(test|spec)\./.test(rel)
	);
}

const out = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT, stdout: "pipe" });
const tracked = out.stdout
	.toString()
	.split("\n")
	.map(line => line.trim())
	.filter(Boolean);
const files = tracked
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

/**
 * A second URL class this guard owns: a committed lockfile whose `resolved`
 * fields point at a registry that is not the public one.
 *
 * npm >= 12 refuses to fetch a tarball whose `resolved` host is not the
 * configured registry (`EALLOWREMOTE`), so a single mirror URL in a committed
 * lockfile turns `npm ci` into a hard failure on every machine that does not
 * share the `.npmrc` that wrote it. `desktop/package-lock.json` carried 323
 * `registry.npmmirror.com` URLs from exactly that leak (rewritten to
 * `registry.npmjs.org` on 2026-10-14); `bun.lock` leaked the same way before
 * (v1.1.x, normalized during the release step). The leak is invisible on the
 * machine that produced it and invisible in CI while CI runs the
 * node-bundled npm rather than the pinned one, so a habit cannot catch it —
 * hence a guard on the committed bytes.
 *
 * Test fixtures are exempt (`isTest`). An intentional non-public registry
 * would have to be added here first, the same deliberate act the endpoint
 * inventory requires.
 */
const LOCKFILE_RE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|bun\.lock)$/;
const PUBLIC_REGISTRY_HOST = "registry.npmjs.org";
const REGISTRY_HOST_RE = /registry\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
let lockfiles = 0;

for (const file of tracked) {
	const rel = file.replaceAll("\\", "/");
	if (!LOCKFILE_RE.test(rel) || isTest(rel)) continue;
	if (!(await Bun.file(path.join(ROOT, file)).exists())) continue;
	lockfiles++;
	const text = await Bun.file(path.join(ROOT, file)).text();

	// npm lockfiles name the tarball host of every entry; check the field
	// itself so an off-registry host is caught no matter what it is called.
	if (/(^|\/)package-lock\.json$/.test(rel)) {
		let lock: { packages?: Record<string, { resolved?: unknown }> };
		try {
			lock = JSON.parse(text);
		} catch (err) {
			hits.push(`${rel}: does not parse as JSON (${err}) — the registry rule cannot run on it`);
			continue;
		}
		for (const [entry, meta] of Object.entries(lock.packages ?? {})) {
			if (typeof meta?.resolved !== "string") continue;
			let host: string;
			try {
				host = new URL(meta.resolved).host;
			} catch {
				hits.push(`${rel}: ${entry || "<root>"} has an unparseable "resolved" URL: ${meta.resolved}`);
				continue;
			}
			if (host === PUBLIC_REGISTRY_HOST) continue;
			hits.push(
				`${rel}: ${entry || "<root>"} resolves against ${host} — npm >= 12 refuses off-registry tarball hosts (EALLOWREMOTE); rewrite it to https://${PUBLIC_REGISTRY_HOST}/ with a forced re-resolve (--registry=https://registry.npmjs.org) or a resolved-only URL rewrite`,
			);
		}
	}

	// bun/pnpm lockfiles record a registry URL only for non-default sources;
	// any `registry.<…>` host they do name must be the public one (same rule
	// the release step applies to the regenerated `bun.lock`).
	for (const host of new Set(text.match(REGISTRY_HOST_RE) ?? [])) {
		if (host.toLowerCase() === PUBLIC_REGISTRY_HOST) continue;
		hits.push(`${rel}: names non-public registry host ${host} — rewrite it to https://${PUBLIC_REGISTRY_HOST}/`);
	}
}

if (hits.length > 0) {
	for (const hit of hits) console.log(`✗ ${hit}`);
	console.log(`\n${hits.length} shared-infra hit(s). Ledger: document/upstream-commercial-assets.md`);
	process.exit(1);
}

const replaceCount = INVENTORY.filter(entry => isReplaceStatus(entry.status)).length;
console.log(
	`Shared-infra ledger OK: ${INVENTORY.length} endpoints pinned across ${files.length} scanned files (${replaceCount} marked for replacement); ${lockfiles} lockfile(s) on the public registry.`,
);

#!/usr/bin/env bun
/**
 * Removed-upstream-files guard.
 *
 * A sync merge can silently restore a file Zeta deleted on purpose: when the
 * file is unchanged upstream, a correct three-way merge keeps the deletion, so
 * seeing it again means the resolution took the upstream tree for that path.
 * That is what happened to `export/custom-share.ts` in the v18.13.2 merge
 * (`e7fe9f1452f`, 2026-10-28): a Zeta commit had retired the custom `/share`
 * hook, the file came back, and nobody noticed until the share surface was
 * audited by hand.
 *
 * Every entry below is a deliberate Zeta deletion that upstream still ships.
 * Restoring one is only valid as a new decision: remove it from this list in the
 * same commit that brings the file back, and say why.
 *
 * Ledger: `document/agents/brand/registry.md` §「合并不许复活的删除项」.
 */
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");

interface RemovedFile {
	path: string;
	/** Why Zeta does not ship it. */
	why: string;
}

const REMOVED: RemovedFile[] = [
	{
		path: "packages/coding-agent/src/cli/build-service.ts",
		why: "upstream hosted build service; Zeta builds locally and in CI",
	},
	{
		path: "packages/coding-agent/test/cli/build-service.test.ts",
		why: "tests the removed build service",
	},
	{
		path: "packages/coding-agent/src/telemetry-settings.ts",
		why: "telemetry export is hard-disabled (`TELEMETRY_EXPORT_ENABLED = false`), so the settings surface is gone",
	},
	{
		path: "packages/coding-agent/src/prompts/internal-urls/omp.md",
		why: "upstream-branded internal URL documentation",
	},
	{ path: "scripts/ci-build-upload.ts", why: "upload to the upstream build service" },
	{ path: "scripts/install.test.ts", why: "tests the upstream `omp.sh/install` hint, replaced by our own installer" },
	{ path: ".github/workflows/bun-cache-warm.yml", why: "upstream cache-warming workflow; Zeta runs its own CI" },
	// `.zeta/tools/` is Zeta's own PTY tooling (commits 657b9c7a1e7 and before);
	// it is not an upstream tree and must not be deleted by the merge guard.
	{ path: "README.zh-CN.md", why: "product front door is Zeta's own README" },
	{ path: "sdk/go/omp-rpc/go.mod", why: "upstream-named Go SDK module; Zeta ships `sdk/go/zeta-rpc`" },
	// The hosted /share upload face was retired on 2026-11-02: `/share` only
	// redacts the transcript and hands it to the agent. Upstream still ships all
	// three, so a merge with the upstream tree would put the upload path back.
	{
		path: "packages/coding-agent/src/commands/share.ts",
		why: "the `share` CLI command was retired with the hosted upload path",
	},
	{
		path: "packages/coding-agent/src/export/share.ts",
		why: "the encrypted blob/gist upload path; `/share` now hands a redacted transcript to the agent",
	},
	{
		path: "packages/coding-agent/test/share.test.ts",
		why: "tests the retired upload path",
	},
];

const hits = REMOVED.filter(entry => Bun.file(path.join(ROOT, entry.path)).size > 0);
if (hits.length > 0) {
	for (const hit of hits) {
		console.log(`✗ ${hit.path} is back — ${hit.why}.`);
	}
	console.log(
		`\n${hits.length} deliberately removed file(s) restored. A sync merge must keep them deleted; if this is a new decision, drop the entry here in the same commit.`,
	);
	process.exit(1);
}

console.log(`Removed-upstream-files guard OK: ${REMOVED.length} Zeta deletions still absent.`);

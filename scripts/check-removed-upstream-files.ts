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
import { existsSync, readdirSync } from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");

interface RemovedFile {
	path: string;
	/** Why Zeta does not ship it. */
	why: string;
}

const REMOVED: RemovedFile[] = [
	// Collab live-session sharing was fully retired on 2026-11-07. Upstream
	// still ships it; a "take theirs" resolution must not bring any of it back.
	{ path: "packages/coding-agent/src/collab/", why: "collab live-session sharing is retired" },
	{ path: "packages/coding-agent/src/cli/collab-cli.ts", why: "collab CLI is retired" },
	{ path: "packages/coding-agent/src/commands/collab.ts", why: "collab CLI command is retired" },
	{ path: "packages/coding-agent/src/commands/join.ts", why: "collab join command is retired" },
	{
		path: "packages/coding-agent/src/slash-commands/builtin-collaboration.ts",
		why: "collab slash commands are retired",
	},
	{ path: "packages/coding-agent/test/collab/", why: "collab tests are retired" },
	{ path: "packages/coding-agent/test/cli/collab-cli.test.ts", why: "collab CLI tests are retired" },
	{ path: "packages/tui/src/chat/collab-prompt-message.ts", why: "collab guest rendering is retired" },
	{ path: "packages/tui/src/chrome/collab-qrcode.ts", why: "collab join QR rendering is retired" },
	{ path: "packages/collab-web/", why: "browser guest client for collab is retired" },
	{ path: "docs/collab.md", why: "collab documentation is retired" },
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

function isRestored(entry: RemovedFile): boolean {
	const full = path.join(ROOT, entry.path);
	if (entry.path.endsWith("/")) return existsSync(full) && readdirSync(full).length > 0;
	return existsSync(full) && Bun.file(full).size > 0;
}

const hits = REMOVED.filter(isRestored);
if (hits.length > 0) {
	for (const hit of hits) {
		console.log(`✗ ${hit.path} is back — ${hit.why}.`);
	}
	console.log(
		`\n${hits.length} deliberately removed file(s) restored. A sync merge must keep them deleted; if this is a new decision, drop the entry here in the same commit.`,
	);
	process.exit(1);
}

/**
 * Symbols that live in files Zeta still ships, so the file guard above cannot
 * see them. A merge can re-add one without restoring any deleted file.
 */
interface ForbiddenSymbol {
	path: string;
	pattern: RegExp;
	why: string;
}

const FORBIDDEN: ForbiddenSymbol[] = [
	{
		path: "packages/wire/src/index.ts",
		pattern: /\bCOLLAB_PROTO\b|\bCOLLAB_PROMPT_MESSAGE_TYPE\b|\bParsedCollabLink\b|\bCollabUiRequest\b/,
		why: "collab wire protocol is retired",
	},
	{
		path: "packages/coding-agent/src/config/settings-schema.ts",
		pattern: /"collab\.(?:enabled|relayUrl|webUrl|autoStart)"/,
		why: "collab settings are retired",
	},
	{
		path: "packages/coding-agent/src/cli-commands.ts",
		pattern: /name: "collab"/,
		why: "the collab CLI command is retired",
	},
];

const symbolHits: string[] = [];
for (const entry of FORBIDDEN) {
	const full = path.join(ROOT, entry.path);
	if (!existsSync(full)) continue;
	const text = await Bun.file(full).text();
	if (entry.pattern.test(text))
		symbolHits.push(`✗ ${entry.path} still contains retired collab symbols — ${entry.why}.`);
}
if (symbolHits.length > 0) {
	for (const hit of symbolHits) console.log(hit);
	console.log(
		`\n${symbolHits.length} shared file(s) carry retired collab symbols. A sync merge must keep the feature retired; remove them in the same commit if this is a new decision.`,
	);
	process.exit(1);
}

console.log(`Removed-upstream-files guard OK: ${REMOVED.length} Zeta deletions still absent.`);

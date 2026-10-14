#!/usr/bin/env bun
/**
 * Committed browser-relay extension asset freshness guard.
 *
 * `packages/coding-agent/src/tools/browser/relay/extension-assets/*` is a
 * committed generated file set: `zetacode browser-relay install` serves it out
 * of the compiled binary, and `packages/browser-relay/scripts/build-extension.ts`
 * derives every entry from `extension/` (plus the repo-root license files).
 * Nothing regenerated it on a normal PR — the build only ran in the
 * `release_binary` CI job — so the copies drifted silently and a license test
 * noticed two stale tokens months later (PR that fixed `background.js.txt`).
 *
 * This guard re-runs that same derivation into a temp directory and compares
 * bytes, so drift is a red check on the PR that caused it. It needs no `zip`
 * (the packaging half stays in the builder) and no `bun install` (the builder
 * is dependency-free on purpose).
 *
 * Usage: bun run check:relay-assets   (gate mode; exit 0/1)
 * Fix:   bun run gen:relay-assets     (regenerates the committed copies)
 */

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
	buildUnpackedExtension,
	EMBEDDED_ASSETS,
	EMBEDDED_ASSETS_DIR,
} from "../packages/browser-relay/scripts/build-extension";
import { reportStale, sameBytes, trackedDiff } from "./generated-freshness";

const repoRoot = path.resolve(import.meta.dir, "..");
const HEADLINE = "browser-relay extension assets freshness FAILED:";
const FIX =
	"Fix: bun run gen:relay-assets  (regenerates packages/coding-agent/src/tools/browser/relay/extension-assets/ from packages/browser-relay/extension/)";

const relative = (absolute: string): string => path.relative(repoRoot, absolute).replaceAll("\\", "/");

async function main(): Promise<void> {
	const problems: string[] = [];
	const diffs: string[] = [];
	const dir = await mkdtemp(path.join(tmpdir(), "zeta-relay-assets-"));
	try {
		// Same derivation the builder runs, staged outside the repository.
		await buildUnpackedExtension(dir);
		for (const { staged, asset, from } of EMBEDDED_ASSETS) {
			const trackedPath = path.join(EMBEDDED_ASSETS_DIR, asset);
			const tracked = Bun.file(trackedPath);
			if (!(await tracked.exists())) {
				problems.push(`${relative(trackedPath)} is missing (${from})`);
				continue;
			}
			const freshPath = path.join(dir, staged);
			const fresh = await Bun.file(freshPath).bytes();
			const committed = await tracked.bytes();
			if (sameBytes(committed, fresh)) continue;
			problems.push(
				`${relative(trackedPath)} is stale (${from}; checked in: ${committed.byteLength} bytes, regenerated: ${fresh.byteLength} bytes)`,
			);
			const diff = await trackedDiff(repoRoot, relative(trackedPath), freshPath);
			if (diff) diffs.push(diff);
		}
		// The committed set is exactly the derivation's output: a leftover copy
		// (an entry removed from `EMBEDDED_ASSETS` or renamed) is dead weight that
		// no per-entry comparison below would notice, and `writeEmbeddedAssets`
		// replaces the directory wholesale, so it can only be stale residue.
		for (const name of await readdir(EMBEDDED_ASSETS_DIR).catch(() => [] as string[])) {
			if (EMBEDDED_ASSETS.some(entry => entry.asset === name)) continue;
			problems.push(
				`${relative(path.join(EMBEDDED_ASSETS_DIR, name))} is not produced by the extension build (stray committed copy)`,
			);
		}
	} catch (error) {
		problems.push(`the asset build could not run: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}

	if (problems.length > 0)
		return reportStale({ headline: HEADLINE, problems, fix: FIX, diff: diffs.join("\n\n") || undefined });
	console.log(
		`browser-relay extension assets are fresh: ${EMBEDDED_ASSETS.length} committed copies match a fresh ${relative(EMBEDDED_ASSETS_DIR)} build`,
	);
}

if (import.meta.main) await main();

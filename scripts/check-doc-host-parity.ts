#!/usr/bin/env bun
/**
 * Docs/host parity guard — `docs/` must not instruct users to reach an
 * upstream host.
 *
 * `docs/` ships inside the npm package and is what `zeta://docs` renders, so a
 * sentence there is a product instruction, not a comment. Upstream's docs are
 * the source of most of these pages, which means a merge can quietly restore
 * "download from `build.stencil.so`" or "open `live.omp.sh`" long after the
 * endpoint was retired here — and the reader has no way to tell that the host
 * 403s or serves someone else's build.
 *
 * The rule: every upstream host a page names must be in the shared-infra
 * inventory (`scripts/shared-infra-inventory.ts`) with a status other than
 * `replaced`. A retired endpoint has no correct mention — not even a warning
 * that it is gone.
 *
 * Ledger: `document/upstream-commercial-assets.md`.
 *
 * Usage: `bun scripts/check-doc-host-parity.ts [file...]`
 * (no arguments = every tracked page under `docs/`).
 */
import * as path from "node:path";

import { DOMAIN_RE, longestMatch } from "./shared-infra-inventory";

const ROOT = path.resolve(import.meta.dir, "..");

const hits: string[] = [];
const explicit = process.argv.slice(2).filter(argument => !argument.startsWith("-"));
const files =
	explicit.length > 0
		? explicit
		: (() => {
				const listed = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT, stdout: "pipe" });
				return listed.stdout
					.toString()
					.split("\n")
					.map(line => line.trim())
					.filter(Boolean)
					.filter(file => file.replaceAll("\\", "/").startsWith("docs/") && file.endsWith(".md"));
			})();

let mentions = 0;
for (const file of files) {
	const absolute = path.isAbsolute(file) ? file : path.join(ROOT, file);
	if (!(await Bun.file(absolute).exists())) {
		hits.push(`${file}: not found — the docs/host guard cannot run on it`);
		continue;
	}
	const rel = path.isAbsolute(file) ? path.relative(ROOT, file).replaceAll("\\", "/") : file.replaceAll("\\", "/");
	let line = 0;
	for (const raw of (await Bun.file(absolute).text()).split("\n")) {
		line++;
		for (const url of raw.match(DOMAIN_RE) ?? []) {
			mentions++;
			const entry = longestMatch(url);
			if (!entry) {
				hits.push(
					`${rel}:${line}: ${url} names an upstream host the inventory does not know — add it to scripts/shared-infra-inventory.ts (with a ledger row), or drop it from the page`,
				);
				continue;
			}
			if (entry.status === "replaced") {
				hits.push(
					`${rel}:${line}: ${url} is a retired endpoint (${entry.domain}) — the page must not send readers there: ${entry.why}`,
				);
			}
		}
	}
}

if (hits.length > 0) {
	for (const hit of hits) console.log(`✗ ${hit}`);
	console.log(`\n${hits.length} docs/host mismatch(es). Ledger: document/upstream-commercial-assets.md`);
	process.exit(1);
}
console.log(
	`Docs/host parity OK: ${files.length} page(s), ${mentions} upstream host mention(s), all registered and live.`,
);

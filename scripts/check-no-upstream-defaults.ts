#!/usr/bin/env bun
/**
 * Upstream-default guard — settings must not ship an upstream host as a value.
 *
 * A merge keeps whatever literal it finds: upstream's `default:` values come
 * back with the file that carried them, and a single restored default routes
 * user traffic to an upstream service that either 403s this fork or answers
 * with someone else's data. `check-shared-infra.ts` catches those hosts in
 * *code*, but a default is data — it never looks like a call site, and the
 * value it resolves to at runtime is invisible in review.
 *
 * What is checked: every string literal assigned to `default:` in
 * `packages/coding-agent/src/<domain>/settings.ts` (plus the `*-settings.ts`
 * siblings, `model-settings.ts` among them) and
 * `packages/coding-agent/src/config/settings-schema.ts`.
 *
 * Two rules:
 *
 * 1. A default that names an upstream host (`omp.sh`, `stencil.so`, `scl.so`,
 *    any subdomain) fails outright.
 * 2. A default that is an absolute URL must be ours — `linxira-os.github.io`
 *    — or a loopback host, because a shipped URL default is a promise about
 *    where the client will send requests. Non-URL strings (enum values, model
 *    ids, paths) are none of this guard's business.
 *
 * Intentionally not checked: defaults written as identifiers
 * (`default: DEFAULT_SHARE_URL`). Resolving an import needs a type checker,
 * and those constants are already pinned per file by
 * `check-shared-infra.ts`, which also carries the replacement deadline.
 *
 * Usage: `bun scripts/check-no-upstream-defaults.ts [file...]`
 * (no arguments = every tracked settings file).
 */
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");

/** Hosts that belong to upstream. Matched as a whole label so `omp.sh` does not hit `omp.shadow`. */
const UPSTREAM_HOST_RE = /(^|\.)((?:omp|stencil|scl)\.sh|stencil\.so|scl\.so)(?=$|[:/?#])/i;

/** The only registrable domain a shipped URL default may point at. */
const OWN_DOMAIN = "linxira-os.github.io";

/** A `default:` string literal: `default: "x"`, `default: 'x'`, `default: undefined` is not a match. */
const DEFAULT_LITERAL_RE = /default:\s*(?:"([^"\\]*)"|'([^'\\]*)')/g;

/** Absolute URL, as opposed to an enum value or a bare host. */
const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Host of an absolute URL, or undefined when it does not parse. */
function urlHost(value: string): string | undefined {
	try {
		return new URL(value).hostname.toLowerCase();
	} catch {
		return undefined;
	}
}

function isLoopbackHost(host: string): boolean {
	return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

function allowedUrlHost(host: string): boolean {
	return host === OWN_DOMAIN || host.endsWith(`.${OWN_DOMAIN}`) || isLoopbackHost(host);
}

async function main(): Promise<void> {
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
						.filter(file => {
							const rel = file.replaceAll("\\", "/");
							if (!rel.startsWith("packages/coding-agent/src/")) return false;
							// `<domain>/settings.ts` plus the `*-settings.ts` siblings
							// (`model-settings.ts`, `gc-settings.ts`, …) and the legacy schema.
							return (
								rel.endsWith("settings.ts") || rel === "packages/coding-agent/src/config/settings-schema.ts"
							);
						});
				})();

	const hits: string[] = [];
	for (const file of files) {
		const rel = path.isAbsolute(file) ? path.relative(ROOT, file).replaceAll("\\", "/") : file.replaceAll("\\", "/");
		const absolute = path.isAbsolute(file) ? file : path.join(ROOT, file);
		if (!(await Bun.file(absolute).exists())) {
			hits.push(`${rel}: not found — the default guard cannot run on it`);
			continue;
		}
		const text = await Bun.file(absolute).text();
		let line = 0;
		for (const raw of text.split("\n")) {
			line++;
			for (const match of raw.matchAll(DEFAULT_LITERAL_RE)) {
				const value = match[1] ?? match[2] ?? "";
				if (UPSTREAM_HOST_RE.test(value)) {
					hits.push(
						`${rel}:${line}: default "${value}" points at an upstream host — a shipped default must be empty, loopback, or ${OWN_DOMAIN}`,
					);
					continue;
				}
				if (!ABSOLUTE_URL_RE.test(value)) continue;
				const host = urlHost(value);
				if (host === undefined) {
					hits.push(`${rel}:${line}: default "${value}" is not a parseable URL`);
					continue;
				}
				if (!allowedUrlHost(host)) {
					hits.push(
						`${rel}:${line}: default "${value}" is hosted on ${host} — a shipped URL default must be loopback or ${OWN_DOMAIN}`,
					);
				}
			}
		}
	}

	if (hits.length > 0) {
		for (const hit of hits) console.log(`✗ ${hit}`);
		console.log(`\n${hits.length} upstream default(s). Ledger: document/upstream-commercial-assets.md`);
		process.exit(1);
	}
	console.log(`Settings defaults OK: ${files.length} settings file(s), no upstream host and no foreign URL default.`);
}

if (import.meta.main) await main();

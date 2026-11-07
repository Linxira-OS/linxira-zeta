#!/usr/bin/env bun
/**
 * The shared-infra endpoint inventory — the single table behind both
 * `check-shared-infra.ts` (code placements) and `check-doc-host-parity.ts`
 * (documentation mentions).
 *
 * It lives in its own module because both guards must agree: a host this table
 * marks `replaced` is a regression in code AND a stale instruction in `docs/`,
 * and a host it does not know at all is unregistered in both. Importing
 * `check-shared-infra.ts` for the table would execute that whole guard.
 *
 * Ledger: `document/upstream-commercial-assets.md`.
 */

export const DOMAIN_RE =
	/https?:\/\/(?:[a-zA-Z0-9._-]*\.)?(?:omp\.sh|stencil\.so|scl\.so)[a-zA-Z0-9./_@?=&%#-]*|https?:\/\/github\.com\/stencil-hq[a-zA-Z0-9./_@?=&%#-]*/g;

export type Status =
	| "keep"
	| "keep-code-user-credential"
	| "replace-P1"
	| "replace-P2"
	| "replace-P3"
	| "replace-brand"
	| "replaced"
	| "disabled";

/**
 * What the placement physically is. The disposition (`status`) says whether we
 * keep it; `kind` says what breaking it would cost, which is what decides
 * whether a replacement is even possible (a `comment-only` link is a one-line
 * edit, a `dynamic-auth` issuer is a protocol contract).
 *
 * - `static-artifact` — a URL in shipped bytes (HTML metadata, schema `$id`, docs)
 * - `build-time` — fetched by a build/publish step, never at runtime
 * - `runtime-data` — fetched by the running client (catalog, grammars, updates)
 * - `dynamic-auth` — a credential/issuer endpoint the user's account lives on
 * - `comment-only` — a provenance comment; nothing dereferences it
 */
export type Kind = "static-artifact" | "build-time" | "runtime-data" | "dynamic-auth" | "comment-only";

export interface Placement {
	/** URL prefix this entry governs (longest match wins). */
	domain: string;
	/** Non-test files allowed to contain it. */
	files: string[];
	/** Ledger disposition. */
	status: Status;
	/** What the placement is, for replacement planning. */
	kind: Kind;
	/**
	 * `YYYY-MM-DD` a `replace-*` entry must be gone by. Required for every
	 * `replace-*` status and rejected elsewhere: a dated keeper implies a
	 * deletion nobody scheduled, and an undated replacement is how a "P1" sits
	 * in the tree for a year. Past the date this guard fails and points at the
	 * ledger.
	 */
	deadline?: string;
	why: string;
}

/** Today as `YYYY-MM-DD`, so the deadline check is testable by faking the clock. */
export function today(): string {
	return new Date().toISOString().slice(0, 10);
}

/** True when `status` still promises a replacement (not already `replaced`/`disabled`). */
export function isReplaceStatus(status: Status): boolean {
	return status.startsWith("replace") && status !== "replaced";
}

/**
 * Validate the inventory itself: every promise to replace something carries a
 * date, and no keeper carries one. Returns human-readable problems.
 */
export function validateInventory(inventory: readonly Placement[], now: string = today()): string[] {
	const problems: string[] = [];
	const LEDGER = "document/upstream-commercial-assets.md §3d";
	for (const entry of inventory) {
		if (isReplaceStatus(entry.status)) {
			if (!entry.deadline) {
				problems.push(
					`${entry.domain}: status ${entry.status} has no deadline — every replace-* entry must say when it is gone (${LEDGER})`,
				);
			} else if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.deadline)) {
				problems.push(`${entry.domain}: deadline ${entry.deadline} is not YYYY-MM-DD (${LEDGER})`);
			} else if (entry.deadline < now) {
				problems.push(
					`${entry.domain}: replacement deadline ${entry.deadline} has passed (today ${now}) — replace it, or re-date it in the ledger and here (${LEDGER})`,
				);
			}
		} else if (entry.deadline) {
			problems.push(
				`${entry.domain}: status ${entry.status} must not carry a deadline (${entry.deadline}) — only replace-* promises expire (${LEDGER})`,
			);
		}
	}
	return problems;
}

export const INVENTORY: Placement[] = [
	{
		domain: "https://github.com/stencil-hq",
		status: "keep",
		kind: "runtime-data",
		files: [
			"packages/coding-agent/src/utils/grammars.ts",
			"crates/pi-ast/src/language/grammar.rs",
			"crates/pi-ast/src/language/wasm_grammars.rs",
			"crates/pi-natives/src/grammars.rs",
			"packages/natives/native/index.d.ts",
		],
		why:
			"on-demand WASM grammar releases under Stencil's GitHub org (DEFAULT_GRAMMARS_URL); " +
			"GitHub Releases has no operator lock-in — recorded in ledger §3d; a future mirror can replace it",
	},
	{
		domain: "https://my.omp.sh",
		status: "disabled",
		kind: "runtime-data",
		files: [],
		why:
			"the live-session collaboration relay was retired on 2026-11-07 with the whole `/collab` feature; " +
			"no relay constant or client link ships, so the domain must not reappear in runtime code",
	},
	{
		domain: "https://omp.sh/install",
		status: "replaced",
		kind: "static-artifact",
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
		kind: "comment-only",
		files: ["packages/coding-agent/src/discovery/builtin.ts"],
		why: "provenance comment quoting upstream's doc path; not a runtime call",
	},
	{
		domain: "https://catalog.stencil.so",
		status: "keep",
		kind: "runtime-data",
		files: ["packages/catalog/scripts/generate-models.ts", "packages/catalog/src/provider-models/openai-compat.ts"],
		why: "model-discovery data source; replacing it needs a self-hosted catalog service, not planned",
	},
	{
		domain: "https://build.stencil.so",
		status: "replaced",
		kind: "build-time",
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
		kind: "dynamic-auth",
		files: ["packages/catalog/src/compat/rules.json", "packages/catalog/src/compat/rules/auth/stencil.kdl"],
		why: "Stencil API endpoints; credentials come from the user (STENCIL_API_KEY)",
	},
	{
		domain: "https://auth.stencil.so",
		status: "keep-code-user-credential",
		kind: "dynamic-auth",
		files: ["packages/catalog/src/compat/rules.json", "packages/catalog/src/compat/rules/auth/stencil.kdl"],
		why: 'OIDC issuer; client-id "omp" and the issuer/scope names are protocol contract — renaming breaks login',
	},
	{
		domain: "https://cloud.stencil.so/v1/spotlight",
		status: "keep-code-user-credential",
		kind: "runtime-data",
		files: ["packages/coding-agent/src/spotlight/types.ts"],
		why: "upstream Spotlight shaping service added by v18.18.0; opt-in and authenticated with the user's own Stencil credential",
	},
	{
		domain: "https://qa.omp.sh",
		status: "replaced",
		kind: "runtime-data",
		// Deliberately empty: the transport moved to the GitHub Issues API and no
		// placement may come back. A merge that re-introduces the upstream endpoint
		// trips "registered endpoint (replaced) but not whitelisted".
		files: [],
		why: "grievances endpoint — replaced by the GitHub Issues client (src/grievances/client.ts, ZETA_ISSUE_REPO) on 2026-10-11; any placement is a regression",
	},
	{
		domain: "https://skills.omp.sh",
		status: "replaced",
		kind: "runtime-data",
		// Deliberately empty: no registry default ships. Extra skills come from
		// the npm package `@linxiraos/linxira-skills`; a user who runs a registry
		// configures it in `skills.registryUrl`. The wire contract keeps the
		// protocol usable for such a registry, but any committed upstream host is
		// a regression (2026-10-18).
		files: [],
		why: "upstream skill registry default — removed 2026-10-18; extra skills now come from the npm package @linxiraos/linxira-skills (npm i -g @linxiraos/linxira-skills), or a user-configured skills.registryUrl",
	},
	{
		domain: "https://live.omp.sh",
		status: "disabled",
		kind: "runtime-data",
		// Deliberately empty: Zeta ships no stream/clip server. `zetacode stream`
		// needs a user-configured `stream.serverUrl` and `uploadClip` refuses
		// (CLIP_UPLOAD_ENABLED = false). A merge that re-introduces the upstream
		// host trips "registered endpoint (disabled) but not whitelisted".
		files: [],
		why: "upstream live stream/clip service — hosting disabled 2026-10-18; no stream server ships, clip uploads are unavailable, any placement is a regression",
	},
	{
		domain: "https://docs.stencil.so",
		status: "replaced",
		kind: "comment-only",
		// Deliberately empty: the two TSP provenance comments now say the norm is
		// "the Tern Surface Protocol" with no host (2026-11-02). A merge that
		// restores the upstream doc link trips "registered endpoint (replaced)
		// but not whitelisted".
		files: [],
		why: "upstream Tern protocol docs link in the wire/TUI comments — host dropped 2026-11-02; the vocabulary stands on its own",
	},
	{
		domain: "https://scl.so",
		status: "replaced",
		kind: "static-artifact",
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
		domain: "https://omp.sh",
		status: "replaced",
		kind: "static-artifact",
		// Deliberately empty: collab-web's JSON-LD no longer cites the upstream
		// site; its Open Graph and Twitter cards are host-less (2026-11-02). Any
		// `omp.sh` URL that a longer prefix above does not claim is a regression.
		files: [],
		why: "upstream product site — every shipped citation removed 2026-11-02; subpaths with a live placement have their own entry above",
	},
	{
		domain: "https://stencil.so",
		status: "replaced",
		kind: "static-artifact",
		// Deliberately empty: collab-web's JSON-LD publisher no longer carries the
		// upstream organization `@id`/`url` (2026-11-02).
		files: [],
		why: "upstream company site — collab-web identity citations removed 2026-11-02; any placement is a regression",
	},
];

/**
 * The inventory entry governing `url`: the longest matching `domain` prefix
 * wins, so `https://omp.sh/docs/` overrides `https://omp.sh`. Undefined means
 * the URL is unregistered.
 */
export function longestMatch(url: string): Placement | undefined {
	let best: Placement | undefined;
	for (const entry of INVENTORY) {
		if (!url.startsWith(entry.domain)) continue;
		if (!best || entry.domain.length > best.domain.length) best = entry;
	}
	return best;
}

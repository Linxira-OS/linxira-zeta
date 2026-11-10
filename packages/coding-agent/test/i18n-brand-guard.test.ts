import { describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en";
import { zh } from "../src/i18n/zh";

/**
 * Brand guard: Zeta is the product; the upstream product name must never
 * resurface as a product self-reference in user-visible catalogue text (zh menu
 * lines saying "OMP 原生安全扫描" shipped unnoticed before). Interop surfaces
 * where the token is a native/sentinel identifier, not the product name, are
 * allowlisted by exact substring (see OMP_INTEROP_ALLOWLIST).
 *
 * Host tokens are NOT allowlisted: an entry that quotes an upstream host no
 * longer buys a blanket pass for the product name next to it (2026-10-14
 * narrowing), and upstream-host placements are inventoried by
 * `scripts/check-shared-infra.ts` against
 * `document/upstream-commercial-assets.md` instead. Profile env keys are
 * ZETA-owned and are not allowed to surface in i18n strings at all.
 *
 * The lowercase product spelling and the upstream project name are scanned too:
 * the 2026-10-11 sweep found wizard/settings copy addressing the product in
 * lowercase (the CLI is zetacode, the product is Zeta), which an
 * uppercase-only pass could not see.
 */
const OMP_INTEROP_ALLOWLIST: readonly string[] = ["__omp"];

/** The upstream project name, split so this guard file stays clean for brand-check. */
const UPSTREAM_PROJECT = ["oh", "my", "pi"].join("-");

function catalogueOmpLeaks(name: string, catalogue: Record<string, unknown>): string[] {
	const leaks: string[] = [];
	for (const [key, value] of Object.entries(catalogue)) {
		if (typeof value !== "string") continue;
		if (OMP_INTEROP_ALLOWLIST.some(token => value.includes(token))) continue;
		if (/\bOMP\b/.test(value)) leaks.push(`${name}.${key}: ${value}`);
		else if (/\bomp\b/.test(value)) leaks.push(`${name}.${key} (lowercase): ${value}`);
		else if (value.toLowerCase().includes(UPSTREAM_PROJECT))
			leaks.push(`${name}.${key} (upstream project): ${value}`);
	}
	return leaks;
}

describe("i18n brand guard", () => {
	test("catalogue values never self-reference the upstream product name", () => {
		const leaks = [...catalogueOmpLeaks("en", en), ...catalogueOmpLeaks("zh", zh)];
		expect(
			leaks,
			`product-name leak in catalogue values (say "Zeta", or allowlist a genuine\n` +
				`interop token in OMP_INTEROP_ALLOWLIST):\n${leaks.join("\n")}`,
		).toEqual([]);
	});
});

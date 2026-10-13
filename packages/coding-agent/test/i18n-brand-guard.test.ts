import { describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en";
import { zh } from "../src/i18n/zh";

/**
 * Brand guard: Zeta is the product; upstream OMP must never resurface as a
 * product self-reference in user-visible catalogue text (zh menu lines saying
 * "OMP 原生安全扫描" shipped unnoticed before). Interop surfaces where the
 * token is a protocol/path identifier, not the product name, are allowlisted
 * by exact substring: plugin manifest dirs (.omp-plugin) and native/sentinel
 * prefixes (__omp). Host tokens are NOT allowlisted: an entry that quotes an
 * upstream host no longer buys a blanket pass for the product name next to it
 * (2026-10-14 narrowing), and upstream-host placements are inventoried by
 * `scripts/check-shared-infra.ts` against
 * `document/upstream-commercial-assets.md` instead. Profile env keys are
 * ZETA-owned and are not allowed to surface in i18n strings at all.
 */
const OMP_INTEROP_ALLOWLIST: readonly string[] = [".omp-plugin", "__omp"];

// Provenance labels (user ruling 2026-10-02): the read-only OMP model-config
// compatibility feature deliberately references upstream as data — the
// "from OMP" badge marks where a model/provider came from. That is interop
// attribution, not product self-identification.
const PROVENANCE_LABEL_KEYS: readonly string[] = ["models.originOmp"];

function catalogueOmpLeaks(name: string, catalogue: Record<string, unknown>): string[] {
	const leaks: string[] = [];
	for (const [key, value] of Object.entries(catalogue)) {
		if (typeof value !== "string") continue;
		if (PROVENANCE_LABEL_KEYS.includes(key)) continue;
		if (OMP_INTEROP_ALLOWLIST.some(token => value.includes(token))) continue;
		if (/\bOMP\b/.test(value)) leaks.push(`${name}.${key}: ${value}`);
	}
	return leaks;
}

describe("i18n brand guard", () => {
	test("catalogue values never self-reference the OMP product name", () => {
		const leaks = [...catalogueOmpLeaks("en", en), ...catalogueOmpLeaks("zh", zh)];
		expect(
			leaks,
			`product-name leak in catalogue values (say "Zeta", or allowlist a genuine\n` +
				`interop token in OMP_INTEROP_ALLOWLIST):\n${leaks.join("\n")}`,
		).toEqual([]);
	});
});

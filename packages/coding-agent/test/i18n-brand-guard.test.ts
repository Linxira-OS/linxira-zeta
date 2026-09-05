import { describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en";
import { zh } from "../src/i18n/zh";

/**
 * Brand guard: Zeta is the product; upstream OMP must never resurface as a
 * product self-reference in user-visible catalogue text (zh menu lines saying
 * "OMP 原生安全扫描" shipped unnoticed before). Interop surfaces where the
 * token is a protocol/path identifier, not the product name, are allowlisted
 * by exact substring: env vars (OMP_PROFILE), hosts (omp.sh), plugin manifest
 * dirs (.omp-plugin), native/sentinel prefixes (__omp).
 */
const OMP_INTEROP_ALLOWLIST: readonly string[] = ["OMP_PROFILE", "omp.sh", ".omp-plugin", "__omp"];

function catalogueOmpLeaks(name: string, catalogue: Record<string, unknown>): string[] {
	const leaks: string[] = [];
	for (const [key, value] of Object.entries(catalogue)) {
		if (typeof value !== "string") continue;
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

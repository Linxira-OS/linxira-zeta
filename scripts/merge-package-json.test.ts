import { describe, expect, it } from "bun:test";
import { mergeDeps, zetaKeyFor } from "./merge-package-json";

/**
 * Guards the recurring workspaces.catalog damage class: the driver must map
 * every upstream @linxiraos/* workspace key back to its @linxiraos/* name and
 * keep Zeta's own version pins through the merge.
 */

const UPSTREAM_CATALOG: Record<string, string> = {
	"@linxiraos/pi-agent-core": "18.1.15",
	"@linxiraos/pi-ai": "18.1.15",
	"@linxiraos/pi-omptype": "18.1.15",
	"@linxiraos/pi-stats": "18.1.15",
	"@linxiraos/zeta": "18.1.15",
	"@linxiraos/pi-natives": "18.1.15",
	zod: "4.0.0",
};

const ZETA_CATALOG: Record<string, string> = {
	"@linxiraos/pi-agent-core": "1.1.11",
	"@linxiraos/pi-ai": "1.1.11",
	"@linxiraos/pi-omptype": "1.1.11",
	"@linxiraos/pi-stats": "1.1.11",
	"@linxiraos/zeta": "1.1.11",
	"@linxiraos/pi-natives": "1.1.11",
	"@linxiraos/pi-channels": "1.1.11", // Zeta-only package upstream lacks
	zod: "3.25.76",
};

describe("zetaKeyFor", () => {
	it("maps the upstream scope to the Zeta scope with rename awareness", () => {
		expect(zetaKeyFor("@linxiraos/pi-ai")).toBe("@linxiraos/pi-ai");
		expect(zetaKeyFor("@linxiraos/pi-omptype")).toBe("@linxiraos/pi-omptype");
		expect(zetaKeyFor("@linxiraos/pi-stats")).toBe("@linxiraos/pi-stats");
		expect(zetaKeyFor("@linxiraos/zeta")).toBe("@linxiraos/zeta");
	});

	it("returns null for non-upstream keys", () => {
		expect(zetaKeyFor("@linxiraos/pi-ai")).toBeNull();
		expect(zetaKeyFor("zod")).toBeNull();
		expect(zetaKeyFor("@acme/thing")).toBeNull();
	});
});

describe("mergeDeps", () => {
	it("keeps Zeta names and Zeta version pins for workspace packages", () => {
		const merged = mergeDeps(ZETA_CATALOG, UPSTREAM_CATALOG);
		expect(merged["@linxiraos/pi-ai"]).toBe("1.1.11");
		expect(merged["@linxiraos/pi-omptype"]).toBe("1.1.11");
		expect(merged["@linxiraos/pi-stats"]).toBe("1.1.11");
		expect(merged["@linxiraos/zeta"]).toBe("1.1.11");
	});

	it("never emits an upstream-scope key", () => {
		const merged = mergeDeps(ZETA_CATALOG, UPSTREAM_CATALOG);
		for (const key of Object.keys(merged)) {
			expect(key.startsWith("@linxiraos/")).toBeFalse();
		}
	});

	it("keeps Zeta-only packages upstream does not have", () => {
		const merged = mergeDeps(ZETA_CATALOG, UPSTREAM_CATALOG);
		expect(merged["@linxiraos/pi-channels"]).toBe("1.1.11");
	});

	it("adopts the upstream version for packages Zeta does not have yet", () => {
		const merged = mergeDeps(ZETA_CATALOG, {
			"@linxiraos/pi-newcomer": "18.1.15",
		});
		expect(merged["@linxiraos/pi-newcomer"]).toBe("18.1.15");
	});

	it("accepts upstream versions for third-party deps", () => {
		const merged = mergeDeps(ZETA_CATALOG, UPSTREAM_CATALOG);
		expect(merged.zod).toBe("4.0.0");
	});
});

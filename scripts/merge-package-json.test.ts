import { describe, expect, test } from "bun:test";
import { mergeDeps, zetaKeyFor } from "./merge-package-json";

describe("zetaKeyFor", () => {
	test("maps upstream scope keys to the Zeta scope", () => {
		expect(zetaKeyFor("@oh-my-pi/pi-ai")).toBe("@linxiraos/pi-ai");
		expect(zetaKeyFor("@oh-my-pi/hashline")).toBe("@linxiraos/hashline");
		expect(zetaKeyFor("@oh-my-pi/pi-utils")).toBe("@linxiraos/pi-utils");
	});

	test("applies renames where upstream and Zeta tails differ", () => {
		expect(zetaKeyFor("@oh-my-pi/omptype")).toBe("@linxiraos/pi-omptype");
	});

	test("returns null for third-party and Zeta-scoped keys", () => {
		expect(zetaKeyFor("react")).toBe(null);
		expect(zetaKeyFor("@omega/pi-ai")).toBe(null);
		expect(zetaKeyFor("@linxiraos/pi-ai")).toBe(null);
	});
});

describe("mergeDeps", () => {
	test("adopts upstream workspace deps under Zeta names with current versions", () => {
		const current = { "@linxiraos/pi-ai": "1.0.0", "@linxiraos/pi-utils": "1.0.0" };
		const other = { "@oh-my-pi/pi-ai": "17.2.12", "@oh-my-pi/pi-utils": "17.2.12" };
		const merged = mergeDeps(current, other);
		expect(merged["@linxiraos/pi-ai"]).toBe("1.0.0");
		expect(merged["@linxiraos/pi-utils"]).toBe("1.0.0");
	});

	test("keeps third-party dependency ranges from upstream", () => {
		const merged = mergeDeps({}, { react: "^19.0.0", "@tanstack/react-table": "^8.0.0" });
		expect(merged.react).toBe("^19.0.0");
		expect(merged["@tanstack/react-table"]).toBe("^8.0.0");
	});

	test("keeps Zeta deps upstream does not have", () => {
		const merged = mergeDeps({ "@linxiraos/pi-metaharness": "1.0.0" }, {});
		expect(merged["@linxiraos/pi-metaharness"]).toBe("1.0.0");
	});

	test("keeps Zeta 1.0.0 versions over conflicting upstream keys", () => {
		const current = { "@linxiraos/pi-tui": "1.0.0" };
		const other = { "@linxiraos/pi-tui": "17.2.12" };
		expect(mergeDeps(current, other)["@linxiraos/pi-tui"]).toBe("1.0.0");
	});
});

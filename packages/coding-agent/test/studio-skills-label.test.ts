import { describe, expect, test } from "bun:test";
// Evaluated first so the Studio family graph initializes top-down; importing
// `skills` alone re-enters ops/index.ts through the gateway's session handlers
// and hits its temporal dead zone.
import "../src/server/studio-host/registry";
import { skillSourceLabel } from "../src/server/studio-host/ops/skills";

const base = {
	name: "demo",
	description: "Demo skill",
	filePath: undefined,
	hiddenFromModel: false,
	level: "user",
	hasInstall: false,
	installScope: undefined,
} as const;

describe("Studio skill source labels", () => {
	test("labels built-in and official skills as Zeta", () => {
		expect(skillSourceLabel({ ...base, provider: "native" }, "native")).toBe("Zeta");
		expect(skillSourceLabel({ ...base, provider: "zeta-official" }, "native")).toBe("Zeta");
	});

	test("labels providerless native skills as Zeta", () => {
		expect(skillSourceLabel({ ...base, provider: undefined }, "native")).toBe("Zeta");
	});

	test("keeps the managed label distinct", () => {
		expect(skillSourceLabel({ ...base, provider: undefined }, "managed")).toBe("托管");
	});

	test("falls back to the raw provider id for third-party sources", () => {
		expect(skillSourceLabel({ ...base, provider: "claude" }, "plugin")).toBe("Claude");
		expect(skillSourceLabel({ ...base, provider: "unknown-provider" }, "plugin")).toBe("unknown-provider");
	});
});

import { describe, expect, it } from "bun:test";
import { InternalUrlRouter } from "@linxiraos/zeta/internal-urls";

describe("ZetaProtocolHandler", () => {
	it("treats zeta://docs as the documentation root", async () => {
		const resource = await InternalUrlRouter.instance().resolve("zeta://docs");

		expect(resource.content).toContain("# Documentation");
		expect(resource.content).toContain("tools/read.md");
	});

	it("resolves docs-prefixed documentation paths", async () => {
		const router = InternalUrlRouter.instance();
		const direct = await router.resolve("zeta://tools/read.md");
		const prefixed = await router.resolve("zeta://docs/tools/read.md");

		expect(prefixed.content).toBe(direct.content);
		expect(prefixed.content).toContain("# read");
	});
});

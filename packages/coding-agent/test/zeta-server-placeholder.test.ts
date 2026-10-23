import { describe, expect, it } from "bun:test";
import { NO_WEB_UI_PAGE } from "../src/server/zeta-server";

/**
 * The package intentionally does not ship a Web UI; `serve` answers `/` with a
 * placeholder. It must say the Web UI is still coming, not that the install is
 * broken.
 */
describe("serve Web UI placeholder", () => {
	it("announces the Web UI as forthcoming", () => {
		expect(NO_WEB_UI_PAGE).toContain("Web UI 正在补齐");
		expect(NO_WEB_UI_PAGE).toContain("coming soon");
		expect(NO_WEB_UI_PAGE).toContain("后续版本补齐");
	});

	it("keeps the terminal and gateway paths discoverable", () => {
		expect(NO_WEB_UI_PAGE).toContain("zetacode");
		expect(NO_WEB_UI_PAGE).toContain("/api/*");
	});

	it("no longer claims the install is missing a Web UI build", () => {
		expect(NO_WEB_UI_PAGE).not.toContain("ships no Web UI build");
	});
});

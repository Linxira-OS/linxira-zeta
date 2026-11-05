import { describe, expect, it } from "bun:test";
import { NO_WEB_UI_PAGE } from "../src/server/zeta-server";

/**
 * The package ships the Studio renderer; the placeholder is the fallback for a
 * source checkout without a build (or a truncated install). It must name the
 * real ways to get one and never promise a download that does not exist.
 */
describe("serve Web UI placeholder", () => {
	it("names the packaged renderer", () => {
		expect(NO_WEB_UI_PAGE).toContain("dist/web-app");
		expect(NO_WEB_UI_PAGE).toContain("@linxiraos/zeta");
	});

	it("names the override and the repository build", () => {
		expect(NO_WEB_UI_PAGE).toContain("ZETA_WEB_APP_DIR");
		expect(NO_WEB_UI_PAGE).toContain("web-app/dist");
		expect(NO_WEB_UI_PAGE).toContain("npm run build:ci");
	});

	it("keeps the terminal and gateway paths discoverable", () => {
		expect(NO_WEB_UI_PAGE).toContain("zetacode");
		expect(NO_WEB_UI_PAGE).toContain("/api/*");
	});

	it("does not promise a download or a future release", () => {
		expect(NO_WEB_UI_PAGE).not.toContain("coming soon");
		expect(NO_WEB_UI_PAGE).not.toContain("正在补齐");
		expect(NO_WEB_UI_PAGE).not.toContain("后续版本补齐");
		expect(NO_WEB_UI_PAGE).not.toContain("按需从 npm 安装");
	});
});

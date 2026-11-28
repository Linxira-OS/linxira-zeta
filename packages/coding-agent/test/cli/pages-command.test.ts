import { describe, expect, test } from "bun:test";
import { isPageName, pageUrlFromIdentity } from "../../src/cli/pages-cli";
import type { ServeIdentity } from "../../src/server/web-gateway/identity";

const identity: ServeIdentity = {
	app: "zeta",
	version: "1.5.15",
	pid: 1,
	startedAt: "2026-11-28T00:00:00.000Z",
	webUrl: "http://127.0.0.1:43141",
	pages: {
		team: "http://127.0.0.1:43141/pages/team/",
		rooms: "http://127.0.0.1:43141/pages/rooms/",
		im: "http://127.0.0.1:43141/pages/im/",
	},
};

describe("zetacode pages", () => {
	test("uses advertised URLs for the ADR-0101 pages", () => {
		expect(pageUrlFromIdentity(identity, "team")).toBe("http://127.0.0.1:43141/pages/team/");
		expect(pageUrlFromIdentity(identity, "im")).toBe("http://127.0.0.1:43141/pages/im/");
	});

	test("builds the model page from the served origin", () => {
		expect(pageUrlFromIdentity(identity, "models")).toBe("http://127.0.0.1:43141/pages/models/");
	});

	test("falls back to the origin for older serves without pages", () => {
		expect(pageUrlFromIdentity({ ...identity, pages: undefined }, "rooms")).toBe(
			"http://127.0.0.1:43141/pages/rooms/",
		);
	});

	test("rejects unknown names and a serve without an origin", () => {
		expect(isPageName("team")).toBe(true);
		expect(isPageName("settings")).toBe(false);
		expect(pageUrlFromIdentity({ ...identity, webUrl: undefined, pages: undefined }, "team")).toBeUndefined();
	});
});

/**
 * The shared bundle maps its mount path to one of the three page entries.
 * These are the URLs `zetacode serve` or the ADR-0101 alias can hand out.
 */
import { describe, expect, test } from "vitest";
import { pagePathFor, pageRouteFromPath } from "../pageRoutes";

describe("external page routes", () => {
	test("root and /team open the Team workspace", () => {
		expect(pageRouteFromPath("/")).toBe("team");
		expect(pageRouteFromPath("/team")).toBe("team");
		expect(pageRouteFromPath("/team/")).toBe("team");
	});

	test("rooms, IM and models keep their own paths", () => {
		expect(pageRouteFromPath("/rooms")).toBe("rooms");
		expect(pageRouteFromPath("/rooms/")).toBe("rooms");
		expect(pageRouteFromPath("/im")).toBe("im");
		expect(pageRouteFromPath("/im/")).toBe("im");
		expect(pageRouteFromPath("/models")).toBe("models");
		expect(pageRouteFromPath("/models/")).toBe("models");
	});

	test("the mounted and alias prefixes resolve to the same pages", () => {
		expect(pageRouteFromPath("/zeta-pages/team")).toBe("team");
		expect(pageRouteFromPath("/zeta-pages/rooms")).toBe("rooms");
		expect(pageRouteFromPath("/zeta-pages/im")).toBe("im");
		expect(pageRouteFromPath("/zeta-pages/im/")).toBe("im");
		expect(pageRouteFromPath("/pages/team")).toBe("team");
		expect(pageRouteFromPath("/pages/rooms")).toBe("rooms");
		expect(pageRouteFromPath("/pages/im")).toBe("im");
		expect(pageRouteFromPath("/pages/models")).toBe("models");
		expect(pageRouteFromPath("/zeta-pages/models/")).toBe("models");
	});

	test("an unknown deep link falls back to Team, not a blank route", () => {
		expect(pageRouteFromPath("/settings")).toBe("team");
		expect(pageRouteFromPath("/zeta-pages/settings")).toBe("team");
	});
});

describe("page navigation paths", () => {
	test("a direct page mount pushes URLs the host serves", () => {
		expect(pagePathFor("team", "/")).toBe("/team");
		expect(pagePathFor("rooms", "/team")).toBe("/rooms");
		expect(pagePathFor("im", "/team")).toBe("/zeta-pages/im");
		expect(pagePathFor("models", "/team")).toBe("/models");
	});

	test("navigation keeps the /pages or /zeta-pages mount", () => {
		expect(pagePathFor("team", "/pages/rooms")).toBe("/pages/team");
		expect(pagePathFor("im", "/pages/rooms")).toBe("/pages/im");
		expect(pagePathFor("rooms", "/zeta-pages/im")).toBe("/zeta-pages/rooms");
		expect(pagePathFor("models", "/pages/rooms")).toBe("/pages/models");
		expect(pagePathFor("models", "/zeta-pages/team")).toBe("/zeta-pages/models");
	});
});

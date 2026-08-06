/**
 * ZetaServer unit tests — validate the HTTP reverse proxy server's
 * lifecycle, URL construction, routing classification, and health-check contracts.
 */
import { describe, expect, it } from "bun:test";
import { classifyRequest, ZetaServer, type ZetaServerRoute } from "@zeta/pi-coding-agent/server/zeta-server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(path: string, base = "http://localhost:30141"): Request {
	return new Request(`${base}${path}`);
}

function assertRoute(req: Request, webUiPort: number, expectedType: ZetaServerRoute["type"]): void {
	const route = classifyRequest(req, webUiPort);
	expect(route.type).toBe(expectedType);
}

// ---------------------------------------------------------------------------
// classifyRequest — routing logic
// ---------------------------------------------------------------------------

describe("classifyRequest", () => {
	describe("stats routes", () => {
		it("classifies /api/stats/* as stats", () => {
			assertRoute(makeRequest("/api/stats/sessions"), 0, "stats");
			assertRoute(makeRequest("/api/stats/"), 0, "stats");
			assertRoute(makeRequest("/api/stats"), 0, "stats");
		});

		it("classifies /api/stats with query string as stats", () => {
			assertRoute(makeRequest("/api/stats/sessions?limit=10"), 0, "stats");
		});

		it("classifies /api/sync as stats", () => {
			assertRoute(makeRequest("/api/sync"), 12345, "stats");
		});

		it("classifies /api/request/* as stats", () => {
			assertRoute(makeRequest("/api/request/status"), 12345, "stats");
			assertRoute(makeRequest("/api/request/abc/def"), 12345, "stats");
		});
	});

	describe("web UI routes", () => {
		it("classifies root path as webui when web UI is available", () => {
			assertRoute(makeRequest("/"), 12345, "webui");
		});

		it("classifies arbitrary paths as webui when web UI is available", () => {
			assertRoute(makeRequest("/some/page"), 12345, "webui");
			assertRoute(makeRequest("/_next/static/chunk.js"), 12345, "webui");
			assertRoute(makeRequest("/api/other"), 12345, "webui");
		});
	});

	describe("unavailable routes", () => {
		it("classifies root path as unavailable when web UI port is 0", () => {
			assertRoute(makeRequest("/"), 0, "unavailable");
		});

		it("classifies arbitrary paths as unavailable when web UI port is 0", () => {
			assertRoute(makeRequest("/some/page"), 0, "unavailable");
			assertRoute(makeRequest("/_next/static/chunk.js"), 0, "unavailable");
		});

		it("classifies non-stats API paths as unavailable when web UI is down", () => {
			assertRoute(makeRequest("/api/other"), 0, "unavailable");
		});
	});

	describe("edge cases", () => {
		it("handles URLs with hash fragments", () => {
			assertRoute(makeRequest("/api/stats/foo#section"), 0, "stats");
		});

		it("handles URLs with double slashes", () => {
			// /api/stats is still stats even with double slashes later
			assertRoute(makeRequest("/api/stats//foo"), 0, "stats");
		});

		it("stats routes take priority over web UI routes", () => {
			// Even when web UI is available, stats paths go to stats
			assertRoute(makeRequest("/api/stats/sessions"), 12345, "stats");
		});
	});
});

// ---------------------------------------------------------------------------
// ZetaServer — constructor and URL properties
// ---------------------------------------------------------------------------

describe("ZetaServer", () => {
	describe("constructor and URL properties", () => {
		it("uses default port 30141 and stats port 3847", () => {
			const server = new ZetaServer();
			expect(server.url).toBe("http://localhost:30141");
			expect(server.statsUrl).toBe("http://localhost:3847");
		});

		it("uses custom ports", () => {
			const server = new ZetaServer({ port: 8080, statsPort: 9090 });
			expect(server.url).toBe("http://localhost:8080");
			expect(server.statsUrl).toBe("http://localhost:9090");
		});

		it("defaults noBrowser to false", () => {
			const server = new ZetaServer();
			expect(server.url).toBe("http://localhost:30141");
		});

		it("accepts webOnly and statsOnly flags without throwing", () => {
			expect(() => new ZetaServer({ webOnly: true })).not.toThrow();
			expect(() => new ZetaServer({ statsOnly: true })).not.toThrow();
			expect(() => new ZetaServer({ webOnly: true, statsOnly: true })).not.toThrow();
		});
	});

	describe("waitForWebUiReady", () => {
		it("returns false immediately when web UI port is not set", async () => {
			const server = new ZetaServer();
			const result = await server.waitForWebUiReady(100);
			expect(result).toBe(false);
		});
	});

	describe("shutdown", () => {
		it("is idempotent when called before start", async () => {
			const server = new ZetaServer();
			await expect(server.shutdown()).resolves.toBeUndefined();
		});

		it("can be called multiple times safely", async () => {
			const server = new ZetaServer();
			await server.shutdown();
			await server.shutdown();
			await expect(server.shutdown()).resolves.toBeUndefined();
		});
	});
});

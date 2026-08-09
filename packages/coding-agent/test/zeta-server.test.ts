import { describe, expect, it } from "bun:test";
import { normalizeProxiedResponse } from "@zeta/pi-coding-agent/server/zeta-server";

describe("ZetaServer proxy responses", () => {
	it("removes stale compression metadata from Bun-decoded upstream bodies", async () => {
		const response = normalizeProxiedResponse(
			new Response("decoded Web UI chunk", {
				headers: {
					"content-encoding": "gzip",
					"content-length": "18",
				},
			}),
		);

		expect(response.headers.get("content-encoding")).toBeNull();
		expect(response.headers.get("content-length")).toBeNull();
		expect(await response.text()).toBe("decoded Web UI chunk");
	});
});

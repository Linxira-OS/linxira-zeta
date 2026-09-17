import { describe, expect, it } from "bun:test";
import {
	formatServerUrl,
	normalizeProxiedResponse,
	parsePlanApprovalReply,
	ZetaServer,
} from "@linxiraos/zeta/server/zeta-server";

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

describe("ZetaServer host URLs", () => {
	it("reports the configured public host and brackets IPv6 literals", () => {
		expect(new ZetaServer({ host: "192.168.1.5", port: 30141 }).url).toBe("http://192.168.1.5:30141");
		expect(formatServerUrl("::1", 30141)).toBe("http://[::1]:30141");
	});
});

describe("parsePlanApprovalReply", () => {
	it("maps exact 1-4 replies to approval modes and nothing else", () => {
		expect(parsePlanApprovalReply("1")).toBe("preserve");
		expect(parsePlanApprovalReply("2")).toBe("compact");
		expect(parsePlanApprovalReply("3")).toBe("fresh");
		expect(parsePlanApprovalReply("4")).toBe("cancel");
		// Whitespace-trimmed replies are accepted; non-mode text is not.
		expect(parsePlanApprovalReply(" 2 ")).toBe("compact");
		expect(parsePlanApprovalReply("5")).toBeNull();
		expect(parsePlanApprovalReply("12")).toBeNull();
		expect(parsePlanApprovalReply("go ahead")).toBeNull();
	});
});

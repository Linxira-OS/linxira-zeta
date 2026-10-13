import { describe, expect, it } from "bun:test";
import {
	classifyRequest,
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

describe("ZetaServer routing", () => {
	const classify = (path: string) => classifyRequest(new Request(`http://127.0.0.1:30141${path}`), 51234, true);

	it("dispatches the gateway-owned tracking family in-process on a custom gateway port", () => {
		// The Next-side rewrite target is frozen at web-ui build time, so serve
		// must not depend on it for a non-default --gateway-port.
		expect(classify("/api/tracking?cwd=/repo").type).toBe("gateway");
		expect(classify("/api/tracking/events?cwd=/repo").type).toBe("gateway");
	});

	it("keeps the Next-owned families in the Web UI child", () => {
		// Next serves /api/git/* end to end (status/diff locally, the rest as
		// request-time gateway proxies) and resolves the origin itself.
		expect(classify("/api/git/branches?cwd=/repo").type).toBe("webui");
		expect(classify("/api/git/status?cwd=/repo").type).toBe("webui");
		expect(classify("/api/fs/directories").type).toBe("webui");
		expect(classify("/api/files/tmp/a.png").type).toBe("webui");
	});

	it("still sends the other gateway families to the gateway", () => {
		expect(classify("/api/sessions").type).toBe("gateway");
		expect(classify("/api/agent/running/events").type).toBe("gateway");
	});

	it("reports the stats dashboard on its own route", () => {
		expect(classify("/api/stats/overview").type).toBe("stats");
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

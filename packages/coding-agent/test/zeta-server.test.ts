import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
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

	it("switches the main origin to https when a TLS listener is configured", () => {
		const server = new ZetaServer({
			host: "zeta.example",
			port: 30141,
			tls: { cert: "/certs/fullchain.pem", key: "/certs/key.pem" },
		});
		expect(server.scheme).toBe("https");
		expect(server.url).toBe("https://zeta.example:30141");
		// The stats dashboard is a separate plain-HTTP service.
		expect(server.statsUrl).toBe("http://zeta.example:43147");
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

	it("keeps the plugin page host in the Web UI child", () => {
		// Both routes are Next-owned filesystem reads (page discovery and the
		// plugin package's own assets). The gateway has no handler for either,
		// so routing them there turned every HTML plugin page into a 404.
		expect(classify("/api/plugin-pages").type).toBe("webui");
		expect(classify("/api/plugin-assets/pi-messenger/ui/board.html").type).toBe("webui");
	});

	it("reports the stats dashboard on its own route", () => {
		expect(classify("/api/stats/overview").type).toBe("stats");
	});

	it("keeps serving the backend when no Web UI build exists", () => {
		// A release without the Web UI payload must still have a backend: the
		// page and the Next-owned families report 503, everything the terminal
		// and `attach` use keeps working.
		const degraded = (path: string) => classifyRequest(new Request(`http://127.0.0.1:30141${path}`), 0, true);
		expect(degraded("/").type).toBe("unavailable");
		expect(degraded("/api/fs/directories").type).toBe("unavailable");
		expect(degraded("/api/sessions").type).toBe("gateway");
		expect(degraded("/api/agent/running/events").type).toBe("gateway");
		expect(degraded("/api/stats/overview").type).toBe("stats");
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

describe("ZetaServer exposure guard", () => {
	async function withConfig(yaml: string | null, run: () => Promise<void>): Promise<void> {
		const dir = await mkdtemp(join(tmpdir(), "zeta-server-exposure-"));
		const previous = process.env.ZETA_CODING_AGENT_DIR;
		process.env.ZETA_CODING_AGENT_DIR = dir;
		if (yaml !== null) await writeFile(join(dir, "web.yml"), yaml, "utf8");
		refreshDirsFromEnv();
		try {
			await run();
		} finally {
			if (previous === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
			else process.env.ZETA_CODING_AGENT_DIR = previous;
			refreshDirsFromEnv();
			await rm(dir, { recursive: true, force: true });
		}
	}

	it("refuses a non-loopback listener without a remote token before opening any socket", async () => {
		await withConfig(null, async () => {
			const server = new ZetaServer({ host: "0.0.0.0", port: 1, statsOnly: true });
			await expect(server.start()).rejects.toThrow(/remote\.token/);
		});
	});

	it("refuses plaintext beyond loopback without the explicit opt-in", async () => {
		await withConfig("remote:\n  token: tok\n", async () => {
			const server = new ZetaServer({ host: "0.0.0.0", port: 1, statsOnly: true });
			await expect(server.start()).rejects.toThrow(/plain HTTP/);
		});
	});
});

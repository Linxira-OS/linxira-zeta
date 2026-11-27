import { describe, expect, it } from "bun:test";
import { VERSION } from "@linxiraos/pi-utils/dirs";
import { findFreeCdpPort } from "@linxiraos/zeta/tools/browser/attach";
import {
	relayExtensionNotice,
	UPDATE_RELAY_EXTENSION,
	waitForRelayExtension,
} from "@linxiraos/zeta/tools/browser/relay/probe";
import { DISCARDED_TABS_PROTOCOL_VERSION } from "@linxiraos/zeta/tools/browser/relay/protocol";

const readyBody = (overrides: Record<string, unknown> = {}) =>
	Response.json({
		ompRelayVersion: VERSION,
		ompRelayInstance: "probe-test",
		ompRelayCdpClients: 0,
		ompRelayDiscardedTabsProtocol: String(DISCARDED_TABS_PROTOCOL_VERSION),
		ompExtensionDiscardedTabsProtocol: String(DISCARDED_TABS_PROTOCOL_VERSION),
		...overrides,
	});

describe("waitForRelayExtension", () => {
	it("gives up at once when nothing is listening", async () => {
		const port = await findFreeCdpPort();
		const started = performance.now();
		expect(await waitForRelayExtension(`http://127.0.0.1:${port}`)).toBe("unreachable");
		expect(performance.now() - started).toBeLessThan(2_000);
	});

	it("reports a compatible current relay as ready", async () => {
		const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => readyBody() });
		try {
			expect(await waitForRelayExtension(`http://127.0.0.1:${server.port}`)).toBe("ready");
		} finally {
			server.stop(true);
		}
	});

	it("reports an older relay with no CDP clients as idle", async () => {
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => readyBody({ ompRelayVersion: "1.3.0" }),
		});
		try {
			expect(await waitForRelayExtension(`http://127.0.0.1:${server.port}`)).toBe("idle-older-relay");
		} finally {
			server.stop(true);
		}
	});

	it("rejects a relay without the discarded-tab protocol marker", async () => {
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () =>
				Response.json({
					Browser: "Chrome/151",
					"Protocol-Version": "1.3",
					webSocketDebuggerUrl: "ws://127.0.0.1/cdp",
				}),
		});
		try {
			expect(await waitForRelayExtension(`http://127.0.0.1:${server.port}`)).toBe("outdated-relay");
		} finally {
			server.stop(true);
		}
	});
});

describe("relayExtensionNotice", () => {
	it("says nothing when the relay does not report an extension version", async () => {
		const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => readyBody() });
		try {
			expect(await relayExtensionNotice(`http://127.0.0.1:${server.port}`)).toBeNull();
		} finally {
			server.stop(true);
		}
	});

	it("names the older Zeta that installed the extension", async () => {
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => readyBody({ ompExtensionVersion: "1.3.0" }),
		});
		try {
			const notice = await relayExtensionNotice(`http://127.0.0.1:${server.port}`);
			expect(notice).toContain("installed by zetacode 1.3.0; this is zeta");
			expect(notice).toContain(UPDATE_RELAY_EXTENSION);
		} finally {
			server.stop(true);
		}
	});

	it("says nothing when the extension is current", async () => {
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => readyBody({ ompExtensionVersion: VERSION }),
		});
		try {
			expect(await relayExtensionNotice(`http://127.0.0.1:${server.port}`)).toBeNull();
		} finally {
			server.stop(true);
		}
	});
});

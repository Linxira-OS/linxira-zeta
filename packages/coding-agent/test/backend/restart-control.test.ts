/**
 * `/restart` while attached: the gateway asks the serve host to re-exec, and
 * the client gets an explicit acceptance instead of a silent no-op.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { BackendClient } from "../../src/backend/client";
import { registerServeRestartHandler, requestServeRestart } from "../../src/server/serve-control";
import { startWebGateway } from "../../src/server/web-gateway";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	registerServeRestartHandler(null);
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("serve restart control", () => {
	test("reports that an embedded server cannot restart itself", () => {
		registerServeRestartHandler(null);
		expect(requestServeRestart()).toEqual({
			accepted: false,
			reason: "this server was not started by `zetacode serve`",
		});
	});

	test("POST /api/server/restart runs the registered host handler", async () => {
		const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("probe") });
		const port = probe.port ?? 0;
		await probe.stop(true);
		const server = await startWebGateway(port);
		cleanups.push(() => server.shutdown());

		const first = Promise.withResolvers<void>();
		registerServeRestartHandler(first.resolve);

		const response = await fetch(`${server.url}/api/server/restart`, { method: "POST" });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ accepted: true });
		// The handler runs after a real HTTP-flush delay; awaiting its signal is
		// the condition, not a guessed duration (the platform timer is intrinsic
		// to letting the accepted response reach the client before shutdown).
		await first.promise;

		// The same route through the typed client used by attached terminals.
		const second = Promise.withResolvers<void>();
		registerServeRestartHandler(second.resolve);
		expect(await new BackendClient(server.url).restartServer()).toEqual({ accepted: true });
		await second.promise;
	});
});

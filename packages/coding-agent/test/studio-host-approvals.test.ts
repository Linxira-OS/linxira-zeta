import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioHost, StudioOperations } from "../src/server/studio-host/index.js";
import { settingsOps } from "../src/server/studio-host/ops/settings.js";

test("approvals.forget clears the existing approval cache through the host", async () => {
	process.env.ZETA_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "zeta-studio-approvals-"));
	const host = new StudioHost(new StudioOperations([settingsOps]));
	const origin = "http://127.0.0.1:43150";
	const bootstrap = await host.handle(
		new Request("http://127.0.0.1/api/v1/bootstrap", { headers: { origin } }),
		"127.0.0.1",
	);
	expect(bootstrap.status).toBe(200);
	const cookie = bootstrap.headers.get("set-cookie");
	const csrf = bootstrap.headers.get("x-studio-csrf");
	expect(cookie).toBeTruthy();
	expect(csrf).toBeTruthy();

	const response = await host.handle(
		new Request("http://127.0.0.1/api/v1/command", {
			method: "POST",
			headers: {
				origin,
				cookie: cookie!,
				"x-studio-csrf": csrf!,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				commandName: "approvals.forget",
				input: { sessionId: "test-session" },
				idempotencyKey: "forget",
				requestId: "forget",
			}),
		}),
		"127.0.0.1",
	);

	expect(response.status).toBe(202);
});

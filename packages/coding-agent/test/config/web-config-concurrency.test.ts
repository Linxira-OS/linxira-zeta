/**
 * web.yml concurrent writers — a long-lived adapter snapshot (the channels the
 * CLI/serve process runs) and a gateway request both write the same file.
 *
 * Every mutator is a read-modify-write under the config file lock, so a write
 * never replaces keys the other writer just changed, and a stale snapshot can
 * never resurrect a `remote.token` that was rotated (or revoked) meanwhile.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { WebConfig } from "../../src/config/web-config";
import { handleWebConfigPut } from "../../src/server/web-gateway/web-config";
import { hashRemoteToken } from "../../src/utils/remote-token";

describe("web.yml concurrent writers", () => {
	let dir: string;
	let file: string;
	let savedAgentDir: string | undefined;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-web-config-writers-"));
		file = path.join(dir, "web.yml");
		savedAgentDir = process.env.ZETA_CODING_AGENT_DIR;
		process.env.ZETA_CODING_AGENT_DIR = dir;
		refreshDirsFromEnv();
		WebConfig.resetShared();
	});

	afterEach(() => {
		WebConfig.resetShared();
		if (savedAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
		else process.env.ZETA_CODING_AGENT_DIR = savedAgentDir;
		refreshDirsFromEnv();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("adapter and gateway writes both survive", async () => {
		// The adapter loads once, long before the gateway request arrives.
		const adapter = await WebConfig.load(file);
		await adapter.set("channels.wechat.peerTokens", { peer1: "tok-1" });

		// A gateway PUT runs on its own per-request snapshot.
		const gateway = await WebConfig.load(file);
		await Promise.all([
			adapter.set("channels.wechat.peerTokens", { peer1: "tok-2" }),
			gateway.set("channels.telegram.enabled", true),
		]);

		const reloaded = await WebConfig.load(file);
		expect(reloaded.getData().channels.telegram.enabled).toBe(true);
		expect(reloaded.getData().channels.wechat.peerTokens).toEqual({ peer1: "tok-2" });
	});

	test("the gateway handler and a stale adapter snapshot do not erase each other", async () => {
		const adapter = await WebConfig.load(file);
		await adapter.set("channels.wechat.botToken", "bot-token");
		// The adapter snapshot predates the gateway PUT below.
		const put = await handleWebConfigPut(
			new Request("http://gateway/api/web-config", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path: "channels.feishu.enabled", value: true }),
			}),
		);
		expect(put.status).toBe(200);

		await adapter.set("channels.wechat.ilinkBotId", "bot-id");

		const reloaded = await WebConfig.load(file);
		expect(reloaded.getData().channels.wechat.botToken).toBe("bot-token");
		expect(reloaded.getData().channels.wechat.ilinkBotId).toBe("bot-id");
		expect(reloaded.getData().channels.feishu.enabled).toBe(true);
	});

	test("a stale snapshot cannot resurrect a rotated token", async () => {
		const adapter = await WebConfig.load(file);
		await adapter.set("channels.wechat.enabled", false);

		// Another writer (the pairing endpoint) rotates the remote token.
		const rotated = await (await WebConfig.load(file)).rotateRemoteToken();

		// The adapter's next write starts from disk, so it keeps the rotation
		// instead of writing its stale `remote` block back.
		await adapter.set("channels.wechat.enabled", true);

		const reloaded = await WebConfig.load(file);
		expect(reloaded.getRemoteToken()).toBe(rotated);
		expect(reloaded.getRevokedTokenHashes()).not.toContain(hashRemoteToken(rotated));
		expect(reloaded.getData().channels.wechat.enabled).toBe(true);
	});

	test("a revocation by another writer is not undone by a stale snapshot", async () => {
		const token = await (await WebConfig.load(file)).rotateRemoteToken();
		const adapter = await WebConfig.load(file);
		expect(adapter.getRemoteToken()).toBe(token); // snapshot is behind after revoke
		await (await WebConfig.load(file)).revokeRemoteToken(token);

		await adapter.set("tray.autostart", true);

		const reloaded = await WebConfig.load(file);
		expect(reloaded.getRemoteToken()).toBeUndefined();
		expect(reloaded.getRevokedTokenHashes()).toContain(hashRemoteToken(token));
		expect(reloaded.getData().tray.autostart).toBe(true);
	});

	test("interleaved bursts lose nothing", async () => {
		const adapter = await WebConfig.load(file);
		const gateway = await WebConfig.load(file);
		await Promise.all([
			(async () => {
				for (let i = 0; i < 5; i++) {
					await adapter.set("channels.wechat.peerTokens", { [`peer${i}`]: `tok-${i}` });
				}
			})(),
			(async () => {
				for (let i = 0; i < 5; i++) {
					await gateway.set("channels.telegram.botToken", `tg-${i}`);
				}
			})(),
		]);

		const reloaded = await WebConfig.load(file);
		expect(reloaded.getData().channels.wechat.peerTokens).toEqual({ peer4: "tok-4" });
		expect(reloaded.getData().channels.telegram.botToken).toBe("tg-4");
	});
});

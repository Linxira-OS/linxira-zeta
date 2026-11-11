/**
 * web.yml concurrent writers — a long-lived adapter snapshot (the instances the
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

const PROFILE = {
	id: "companion",
	label: "Companion",
	persona: { mode: "workspace" },
	location: { kind: "workspace", workspace: "main" },
	tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
	memory: {},
};

function instance(id: string, platform: string): Record<string, unknown> {
	return {
		id,
		platform,
		label: id,
		enabled: false,
		agentProfile: PROFILE.id,
		allow: { peers: [`${id}-peer`] },
		credentials: {},
	};
}

describe("web.yml concurrent writers", () => {
	let dir: string;
	let file: string;
	let savedAgentDir: string | undefined;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-web-config-writers-"));
		file = path.join(dir, "web.yml");
		fs.writeFileSync(
			file,
			JSON.stringify({
				channels: {
					instances: [
						instance("wechat", "wechat"),
						instance("telegram", "telegram"),
						instance("feishu", "feishu"),
					],
				},
				imAgents: [PROFILE],
				remote: {},
			}),
		);
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
		await adapter.setInstance("wechat", { options: { peerTokens: { peer1: "tok-1" } } });

		// A gateway PUT runs on its own per-request snapshot.
		const gateway = await WebConfig.load(file);
		await Promise.all([
			adapter.setInstance("wechat", { options: { peerTokens: { peer1: "tok-2" } } }),
			gateway.set("tray.autostart", true),
		]);

		const reloaded = await WebConfig.load(file);
		expect(reloaded.getData().tray.autostart).toBe(true);
		expect(reloaded.getChannelInstance("wechat")?.options?.peerTokens).toEqual({ peer1: "tok-2" });
	});

	test("the gateway handler and a stale adapter snapshot do not erase each other", async () => {
		const adapter = await WebConfig.load(file);
		await adapter.setInstance("wechat", { credentials: { botToken: "bot-token" } });
		// The adapter snapshot predates the gateway PUT below.
		const put = await handleWebConfigPut(
			new Request("http://gateway/api/web-config", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path: "tray.autostart", value: true }),
			}),
		);
		expect(put.status).toBe(200);

		await adapter.setInstance("wechat", {
			credentials: { botToken: "bot-token", ilinkBotId: "bot-id" },
		});

		const reloaded = await WebConfig.load(file);
		expect(reloaded.getChannelInstance("wechat")?.credentials).toEqual({
			botToken: "bot-token",
			ilinkBotId: "bot-id",
		});
		expect(reloaded.getData().tray.autostart).toBe(true);
	});

	test("a stale snapshot cannot resurrect a rotated token", async () => {
		const adapter = await WebConfig.load(file);
		await adapter.setInstance("wechat", { enabled: false });

		// Another writer (the pairing endpoint) rotates the remote token.
		const rotated = await (await WebConfig.load(file)).rotateRemoteToken();

		// The adapter's next write starts from disk, so it keeps the rotation
		// instead of writing its stale `remote` block back.
		await adapter.setInstance("wechat", { enabled: true });

		const reloaded = await WebConfig.load(file);
		expect(reloaded.getRemoteToken()).toBe(rotated);
		expect(reloaded.getRevokedTokenHashes()).not.toContain(hashRemoteToken(rotated));
		expect(reloaded.getChannelInstance("wechat")?.enabled).toBe(true);
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

	test("stale writers patch distinct fields and bindings without losing responder roles", async () => {
		const first = await WebConfig.load(file);
		const second = await WebConfig.load(file);
		await Promise.all([
			first.setInstance("wechat", { note: "personal bot" }),
			second.setInstance("wechat", { enabled: true }),
		]);
		await Promise.all([
			first.patchImBinding("wechat", "room", { lang: "zh", role: "answer" }),
			second.patchImBinding("telegram", "room", { role: "observe", model: { provider: "example", model: "chat" } }),
		]);
		await second.patchImBinding("wechat", "room", { sessionId: "persisted-session" });
		const reloaded = await WebConfig.load(file);
		expect(reloaded.getChannelInstance("wechat")).toMatchObject({ note: "personal bot", enabled: true });
		expect(reloaded.findImBinding("wechat", "room")).toMatchObject({
			lang: "zh",
			sessionId: "persisted-session",
			role: "answer",
		});
		expect(reloaded.findImBinding("telegram", "room")).toMatchObject({
			role: "observe",
			model: { provider: "example", model: "chat" },
		});
	});

	test("masked form saves preserve freshly rotated credentials and reconnect tokens", async () => {
		const form = await WebConfig.load(file);
		await form.setInstance("wechat", {
			credentials: { botToken: "old" },
			options: { peerTokens: { peer: "old-context" } },
		});
		const masked = form.getMasked().channels.instances;
		await (
			await WebConfig.load(file)
		).setInstance("wechat", {
			credentials: { botToken: "rotated" },
			options: { peerTokens: { peer: "new-context" } },
		});
		await form.setChannelInstances(masked, { preserveSecrets: true });
		const reloaded = await WebConfig.load(file);
		expect(reloaded.getChannelInstance("wechat")).toMatchObject({
			credentials: { botToken: "rotated" },
			options: { peerTokens: { peer: "new-context" } },
		});
		expect(JSON.stringify(reloaded.getMasked())).not.toContain("rotated");
		expect(JSON.stringify(reloaded.getMasked())).not.toContain("new-context");
	});

	test("profile deletion checks bindings and instances committed by another writer", async () => {
		const stale = await WebConfig.load(file);
		const writer = await WebConfig.load(file);
		await writer.setImAgents([PROFILE, { ...PROFILE, id: "observer" }]);
		await writer.patchImBinding("wechat", "room", { agentProfileId: "observer", role: "observe" });
		await expect(stale.setImAgents([PROFILE])).rejects.toThrow();
		expect((await WebConfig.load(file)).getImAgent("observer")).toBeDefined();
	});

	test("interleaved bursts lose nothing", async () => {
		const adapter = await WebConfig.load(file);
		const gateway = await WebConfig.load(file);
		await Promise.all([
			(async () => {
				for (let i = 0; i < 5; i++) {
					await adapter.setInstance("wechat", { options: { peerTokens: { [`peer${i}`]: `tok-${i}` } } });
				}
			})(),
			(async () => {
				for (let i = 0; i < 5; i++) {
					await gateway.setInstance("telegram", { credentials: { botToken: `tg-${i}` } });
				}
			})(),
		]);

		const reloaded = await WebConfig.load(file);
		expect(reloaded.getChannelInstance("wechat")?.options?.peerTokens).toEqual({ peer4: "tok-4" });
		expect(reloaded.getChannelInstance("telegram")?.credentials.botToken).toBe("tg-4");
	});
});

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as YAML from "yaml";
import { WebConfig } from "../../src/config/web-config";

const tempDirs: string[] = [];

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

async function tempFile(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-web-config-im-"));
	tempDirs.push(dir);
	return path.join(dir, "web.yml");
}

const PROFILE = {
	id: "companion",
	label: "Companion",
	persona: { mode: "workspace" },
	location: { kind: "workspace", workspace: "main" },
	tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
	memory: {},
};

function instance(id: string, platform: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id,
		platform,
		label: id,
		enabled: false,
		agentProfile: PROFILE.id,
		allow: { peers: [`${id}-peer`] },
		credentials: {},
		...overrides,
	};
}

async function makeConfig(): Promise<WebConfig> {
	const file = await tempFile();
	await Bun.write(file, "{}\n");
	return await WebConfig.load(file);
}

describe("web.yml — Discord/QQ as explicit instances", () => {
	test("a fresh config has no implicit platform instances", async () => {
		const config = await makeConfig();
		expect(config.getData().channels.instances).toEqual([]);
		expect(config.getData().imAgents).toEqual([]);
	});

	test("instances carry credentials and per-instance allowlists", async () => {
		const config = await makeConfig();
		await config.setImAgents([PROFILE]);
		await config.setChannelInstances([
			instance("discord", "discord", {
				enabled: true,
				allow: { peers: ["c1", "guild:g1"] },
				credentials: { botToken: "discord-token" },
			}),
			instance("qq", "qq", {
				allow: { peers: ["group:42"], users: ["900"] },
				credentials: { mode: "forward", endpoint: "ws://127.0.0.1:3001", port: 8082 },
			}),
		]);

		const reloaded = await WebConfig.load(config.path);
		const discord = reloaded.getChannelInstance("discord");
		expect(discord?.platform).toBe("discord");
		expect(discord?.allow).toEqual({ peers: ["c1", "guild:g1"] });
		expect(reloaded.getMasked().channels.instances.find(entry => entry.id === "discord")?.credentials.botToken).toBe("••••");
		const qq = reloaded.getChannelInstance("qq");
		expect(qq?.credentials).toMatchObject({ mode: "forward", port: 8082 });
		expect(qq?.allow).toEqual({ peers: ["group:42"], users: ["900"] });
	});

	test("instances are validated before anything is written", async () => {
		const config = await makeConfig();
		await config.setImAgents([PROFILE]);

		// Unknown platform.
		await expect(config.setChannelInstances([instance("slack", "slack")])).rejects.toThrow(/unknown platform/);
		// Deny-by-default: an empty allowlist is not a valid startable instance.
		await expect(
			config.setChannelInstances([instance("discord", "discord", { allow: { peers: [] } })]),
		).rejects.toThrow(/allow\.peers/);
		// The agent profile must exist.
		await expect(
			config.setChannelInstances([instance("discord", "discord", { agentProfile: "missing" })]),
		).rejects.toThrow(/unknown profile/);
		expect(config.getData().channels.instances).toEqual([]);
	});

	test("instances are keyed by id, so two accounts may share a platform", async () => {
		const config = await makeConfig();
		await config.setImAgents([PROFILE]);
		await config.setChannelInstances([instance("discord-main", "discord"), instance("discord-roleplay", "discord")]);
		expect(config.getChannelInstances().map(entry => entry.id)).toEqual(["discord-main", "discord-roleplay"]);
		expect(config.getChannelInstances().map(entry => entry.platform)).toEqual(["discord", "discord"]);
	});
});

describe("legacy channels.<platform> migration", () => {
	test("migrates once to explicit instances and remove the legacy blocks", async () => {
		const file = await tempFile();
		const dir = path.dirname(file);
		await Bun.write(
			file,
			JSON.stringify({
				channels: {
					feishu: {
						enabled: true,
						appId: "cli_legacy",
						appSecret: "secret-legacy",
						allowedChannels: ["oc_1"],
					},
					wechat: {
						enabled: false,
						botToken: "wx-token",
						allowedChannels: ["u1@im.wechat"],
						peerTokens: { "u1@im.wechat": "ctx" },
					},
				},
				remote: {},
			}),
		);

		const config = await WebConfig.load(file);
		const data = config.getData();
		expect(data.channels.instances).toHaveLength(2);
		const feishu = data.channels.instances.find(entry => entry.id === "feishu");
		expect(feishu).toMatchObject({
			id: "feishu",
			platform: "feishu",
			enabled: true,
			allow: { peers: ["oc_1"] },
			credentials: { appId: "cli_legacy", appSecret: "secret-legacy" },
		});
		expect(feishu?.agentProfile).toBe("legacy-feishu");
		expect(data.channels.instances.find(entry => entry.id === "wechat")).toMatchObject({
			platform: "wechat",
			options: { peerTokens: { "u1@im.wechat": "ctx" } },
		});
		expect(data.imAgents.map(profile => profile.id).sort()).toEqual(["legacy-feishu", "legacy-wechat"]);

		// The legacy blocks are gone from the file, and a backup was written once.
		const raw = YAML.parse(await Bun.file(file).text()) as Record<string, unknown>;
		expect(raw.channels).toEqual({ instances: data.channels.instances });
		expect(Object.keys(raw.channels as Record<string, unknown>)).toEqual(["instances"]);
		const backups = (await fs.readdir(dir)).filter(name => name.startsWith("web.yml.bak-"));
		expect(backups).toHaveLength(1);

		// Loading again is a no-op (no second migration, no second backup).
		await WebConfig.load(file);
		expect((await fs.readdir(dir)).filter(name => name.startsWith("web.yml.bak-"))).toHaveLength(1);
	});

	test("legacy sessionMappings become bindings; an unmatched connectionId keeps needsReview", async () => {
		const file = await tempFile();
		await Bun.write(
			file,
			JSON.stringify({
				channels: {
					feishu: { enabled: true, appId: "cli", appSecret: "s", allowedChannels: ["oc_1"] },
				},
				remote: {
					sessionMappings: [
						{
							platform: "feishu",
							chatId: "oc_matched",
							connectionId: "feishu",
							sessionId: "s-matched",
							lang: "zh",
						},
						{
							platform: "feishu",
							chatId: "oc_unmatched",
							connectionId: "bot-2",
							sessionId: "s-unmatched",
						},
						{ platform: "feishu", chatId: "oc_none", sessionId: "s-none" },
					],
				},
			}),
		);

		const config = await WebConfig.load(file);
		const bindings = config.getImBindings();
		expect(bindings).toHaveLength(3);
		const byChat = (chatId: string) => bindings.find(binding => binding.chatId === chatId);

		// A connectionId naming a migrated instance is trusted.
		expect(byChat("oc_matched")).toMatchObject({
			instanceId: "feishu",
			platform: "feishu",
			sessionId: "s-matched",
			lang: "zh",
			role: "answer",
			target: { kind: "workspace", workspace: "main" },
		});
		expect(byChat("oc_matched")?.needsReview).toBeUndefined();

		// An unknown connectionId is re-homed to the platform instance for review,
		// never silently trusted.
		expect(byChat("oc_unmatched")).toMatchObject({
			instanceId: "feishu",
			sessionId: "s-unmatched",
			needsReview: true,
		});
		expect(byChat("oc_none")).toMatchObject({ instanceId: "feishu", needsReview: true });

		// The legacy array is gone from the file.
		const raw = YAML.parse(await Bun.file(file).text()) as { remote: Record<string, unknown> };
		expect(raw.remote.sessionMappings).toBeUndefined();
		expect(raw.remote.imBindings).toEqual(bindings);
	});
});

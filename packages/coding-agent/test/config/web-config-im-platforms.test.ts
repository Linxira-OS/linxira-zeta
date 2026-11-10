import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { WebConfig } from "../../src/config/web-config";

const tempDirs: string[] = [];

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

async function makeConfig(): Promise<WebConfig> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-web-config-im-"));
	tempDirs.push(dir);
	const file = path.join(dir, "web.yml");
	await Bun.write(file, "{}\n");
	return await WebConfig.load(file);
}

describe("web.yml — Discord/QQ platform config", () => {
	test("both platforms default to disabled with empty allowlists", async () => {
		const config = await makeConfig();
		const data = config.getData();
		expect(data.channels.discord).toMatchObject({ enabled: false, allowedChannels: [], allowedUsers: [] });
		expect(data.channels.qq).toMatchObject({
			enabled: false,
			mode: "forward",
			port: 8082,
			allowedGroups: [],
			allowedUsers: [],
		});
	});

	test("discord secrets are masked and allowlists accept arrays", async () => {
		const config = await makeConfig();
		await config.set("channels.discord.botToken", "discord-token");
		await config.set("channels.discord.allowedChannels", ["c1", "guild:g1"]);
		await config.set("channels.discord.allowedUsers", ["u1"]);
		expect(config.getData().channels.discord.allowedChannels).toEqual(["c1", "guild:g1"]);
		expect(config.getMasked().channels.discord.botToken).not.toBe("discord-token");
	});

	test("qq numeric, enum and string fields validate before writing", async () => {
		const config = await makeConfig();
		await config.set("channels.qq.port", 9000);
		await config.set("channels.qq.mode", "reverse");
		await config.set("channels.qq.token", "onebot-token");
		await config.set("channels.qq.allowedGroups", ["42"]);
		expect(config.getData().channels.qq).toMatchObject({
			port: 9000,
			mode: "reverse",
			allowedGroups: ["42"],
		});
		expect(config.getMasked().channels.qq.token).not.toBe("onebot-token");

		await expect(config.set("channels.qq.port", 9000.5)).rejects.toThrow(/1 and 65535/);
		await expect(config.set("channels.qq.port", 0)).rejects.toThrow(/1 and 65535/);
		await expect(config.set("channels.qq.port", -1)).rejects.toThrow(/1 and 65535/);
		await expect(config.set("channels.qq.port", 70_000)).rejects.toThrow(/1 and 65535/);
		await expect(config.set("channels.qq.mode", "sideways")).rejects.toThrow(/forward/);
		await expect(config.set("channels.discord.allowedGuilds", [])).rejects.toThrow(/Unknown web config path/);
	});

	test("session mappings accept the new platforms and reject unknown ones", async () => {
		const config = await makeConfig();
		await config.set("remote.sessionMappings", [
			{ platform: "discord", chatId: "c1", workspaceAlias: "proj" },
			{ platform: "qq", chatId: "group:42", workspaceAlias: "proj" },
		]);
		expect(config.getData().remote.sessionMappings).toHaveLength(2);

		await expect(
			config.set("remote.sessionMappings", [{ platform: "slack", chatId: "x", workspaceAlias: "proj" }]),
		).rejects.toThrow(/discord/);
	});
});

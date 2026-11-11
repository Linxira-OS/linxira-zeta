import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { YAML } from "bun";
import { validateImBindings } from "../../src/channels/im-config";
import { migrateLegacyWebConfigFile, WebConfig } from "../../src/config/web-config";

const dirs: string[] = [];
async function fixture(contents: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-im-migration-"));
	dirs.push(dir);
	const file = path.join(dir, "web.yml");
	await Bun.write(file, contents);
	return file;
}
afterEach(async () => {
	for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("legacy IM migration", () => {
	test("channels.<platform> becomes an instance + profile, and unknown connectionId is needsReview", async () => {
		const file = await fixture(
			YAML.stringify({
				channels: {
					telegram: { enabled: true, botToken: "t", allowedChannels: ["c1"] },
					allowedPeers: ["legacy-peer"],
				},
				remote: {
					sessionMappings: [
						{ platform: "telegram", connectionId: "missing-account", chatId: "c1", sessionId: "old-session" },
					],
				},
			}),
		);
		expect(await migrateLegacyWebConfigFile(file)).toBe(true);
		const raw = YAML.parse(await Bun.file(file).text()) as Record<string, any>;
		expect(raw.channels.instances).toHaveLength(1);
		expect(raw.channels.instances[0]).toMatchObject({
			id: "telegram",
			platform: "telegram",
			enabled: true,
			credentials: { botToken: "t" },
			allow: { peers: ["c1"] },
		});
		expect(raw.imAgents[0].id).toBe("legacy-telegram");
		expect(raw.remote.sessionMappings).toBeUndefined();
		expect(raw.remote.imBindings[0]).toMatchObject({
			instanceId: "telegram",
			platform: "telegram",
			chatId: "c1",
			role: "answer",
			needsReview: true,
		});
		const loaded = await WebConfig.load(file);
		expect(loaded.getImBindings()).toHaveLength(1);
		const backups = (await fs.readdir(path.dirname(file))).filter(name => name.startsWith("web.yml.bak-"));
		expect(backups).toHaveLength(1);
	});

	test("duplicate legacy answers become mention + needsReview instead of two senders", async () => {
		const file = await fixture(
			YAML.stringify({
				channels: { telegram: { enabled: true, botToken: "t", allowedChannels: ["c1"] } },
				remote: {
					sessionMappings: [
						{ platform: "telegram", connectionId: "telegram", chatId: "c1", sessionId: "same" },
						{ platform: "telegram", connectionId: "telegram", chatId: "c1", sessionId: "same" },
					],
				},
			}),
		);
		await migrateLegacyWebConfigFile(file);
		const raw = YAML.parse(await Bun.file(file).text()) as Record<string, any>;
		const bindings = raw.remote.imBindings;
		expect(bindings).toHaveLength(2);
		expect(bindings[0].role).toBe("answer");
		expect(bindings[1].role).toBe("mention");
		expect(bindings[1].needsReview).toBe(true);
		expect(bindings[0].sessionId).not.toBe(bindings[1].sessionId);
	});
});

describe("binding validation", () => {
	const instance = {
		id: "telegram",
		platform: "telegram" as const,
		label: "Telegram",
		enabled: true,
		agentProfile: "profile",
		allow: { peers: ["c1"] },
		credentials: {},
	};
	const profile = {
		id: "profile",
		label: "P",
		persona: { mode: "workspace" as const },
		location: { kind: "workspace" as const, workspace: "main" },
		tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
		memory: { backend: "mnemopi" as const },
	};
	const base = {
		id: "b_0123456789abcdef",
		instanceId: "telegram",
		platform: "telegram" as const,
		chatId: "c1",
		agentProfileId: "profile",
		sessionId: "s1",
		target: { kind: "workspace" as const, workspace: "main" },
		role: "answer" as const,
		createdAt: new Date().toISOString(),
	};

	test("rejects malformed/duplicate ids, unknown roles and incomplete models", () => {
		expect(() => validateImBindings([{ ...base, id: "nope" }], [instance], [profile])).toThrow();
		expect(() => validateImBindings([base, { ...base, sessionId: "s2" }], [instance], [profile])).toThrow();
		expect(() => validateImBindings([{ ...base, role: "broadcast" }], [instance], [profile])).toThrow();
		expect(() => validateImBindings([{ ...base, model: { provider: "x" } }], [instance], [profile])).toThrow();
		expect(() => validateImBindings([{ ...base, chatId: "c\u0000evil" }], [instance], [profile])).toThrow();
	});

	test("allows one answer and multiple mentions in the same platform/chat", () => {
		const mention = {
			...base,
			id: "b_fedcba9876543210",
			sessionId: "s2",
			role: "mention" as const,
		};
		expect(validateImBindings([base, mention], [instance], [profile])).toHaveLength(2);
		expect(() => validateImBindings([base, { ...mention, role: "answer" }], [instance], [profile])).toThrow();
	});
});

describe("persisted chat-key healing", () => {
	const instance = {
		id: "telegram",
		platform: "telegram" as const,
		label: "Telegram",
		enabled: true,
		agentProfile: "profile",
		allow: { peers: ["c1"] },
		credentials: {},
	};
	const profile = {
		id: "profile",
		label: "P",
		persona: { mode: "workspace" as const },
		location: { kind: "workspace" as const, workspace: "main" },
		tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
		memory: { backend: "mnemopi" as const },
	};
	const legal = {
		id: "b_0123456789abcdef",
		instanceId: "telegram",
		platform: "telegram" as const,
		chatId: "c1",
		agentProfileId: "profile",
		sessionId: "s1",
		target: { kind: "workspace" as const, workspace: "main" },
		role: "answer" as const,
		createdAt: "2026-01-01T00:00:00.000Z",
	};
	const malformed = {
		...legal,
		id: "b_fedcba9876543210",
		chatId: "bad\u0001key",
		sessionId: "s2",
	};

	test("v2 rows with an unp persistable chat key are dropped on mutate; legal rows survive", async () => {
		const file = await fixture(
			YAML.stringify({
				channels: { instances: [instance] },
				imAgents: [profile],
				remote: { imBindings: [legal, malformed] },
			}),
		);
		const loaded = await WebConfig.load(file);
		expect(loaded.getImBindings().map(binding => binding.chatId)).toEqual(["c1"]);
		await loaded.setWorkspaceEntry("other", path.dirname(file));
		const raw = YAML.parse(await Bun.file(file).text()) as Record<string, any>;
		expect(raw.remote.imBindings).toHaveLength(1);
		expect(raw.remote.imBindings[0]).toMatchObject({ id: legal.id, chatId: "c1" });
	});

	test("a clean v2 file is not rewritten or altered by a mutate", async () => {
		const file = await fixture(
			YAML.stringify({
				channels: { instances: [instance] },
				imAgents: [profile],
				remote: { imBindings: [{ ...legal, role: "answer" }] },
			}),
		);
		const loaded = await WebConfig.load(file);
		expect(loaded.getImBindings()).toHaveLength(1);
		await loaded.setWorkspaceEntry("other", path.dirname(file));
		const raw = YAML.parse(await Bun.file(file).text()) as Record<string, any>;
		expect(raw.remote.imBindings).toHaveLength(1);
		expect(raw.remote.imBindings[0]).toMatchObject({ chatId: "c1", sessionId: "s1", role: "answer" });
	});

	test("legacy mappings drop only the unp persistable key; bot session keys are cleaned", async () => {
		const file = await fixture(
			YAML.stringify({
				channels: { telegram: { enabled: true, botToken: "t", allowedChannels: ["c1"] } },
				remote: {
					sessionMappings: [
						{ platform: "telegram", connectionId: "telegram", chatId: "c1", sessionId: "keep" },
						{ platform: "telegram", connectionId: "telegram", chatId: "bad\u0001key", sessionId: "drop" },
					],
					botSessions: [
						{
							id: "legacy-bot",
							name: "Old Bot",
							tag: "bot",
							sessionFile: path.join(os.tmpdir(), "zeta-legacy-bot.jsonl"),
							platform: "telegram",
							chatId: "bad\u0001key",
							createdAt: "2026-01-01T00:00:00.000Z",
						},
					],
				},
			}),
		);
		expect(await migrateLegacyWebConfigFile(file)).toBe(true);
		const migrated = YAML.parse(await Bun.file(file).text()) as Record<string, any>;
		expect(migrated.remote.imBindings).toHaveLength(1);
		expect(migrated.remote.imBindings[0]).toMatchObject({ chatId: "c1", sessionId: "keep" });
		const loaded = await WebConfig.load(file);
		expect(loaded.getImBindings()).toHaveLength(1);
		await loaded.setWorkspaceEntry("other", path.dirname(file));
		const raw = YAML.parse(await Bun.file(file).text()) as Record<string, any>;
		expect(raw.remote.sessionMappings).toBeUndefined();
		expect(raw.remote.imBindings).toHaveLength(1);
		expect(raw.remote.botSessions[0].chatId).toBeUndefined();
		expect(raw.remote.botSessions[0].id).toBe("legacy-bot");
	});
});

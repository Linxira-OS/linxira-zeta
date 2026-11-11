import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WebConfig } from "../../src/config/web-config";

// The GUI's 工作区路由 writes the whole `remote.workspaces` / `remote.imBindings`
// array through the gateway. These tests hold the write contract the GUI
// depends on: alias rules, absolute directories, and the binding shape the
// router reads (one instance id per chat, never a platform-wide fallback).

const PROFILE = {
	id: "companion",
	label: "Companion",
	persona: { mode: "workspace" },
	location: { kind: "workspace", workspace: "main" },
	tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
	memory: {},
};

const INSTANCE = {
	id: "feishu",
	platform: "feishu",
	label: "Feishu",
	enabled: true,
	agentProfile: PROFILE.id,
	allow: { peers: ["oc_1"] },
	credentials: {},
};

const BINDING = {
	id: "b1",
	instanceId: "feishu",
	platform: "feishu",
	chatId: "oc_1",
	agentProfileId: PROFILE.id,
	sessionId: "s1",
	target: { kind: "workspace", workspace: "alpha" },
	role: "answer",
	lang: "zh",
	createdAt: "2026-01-01T00:00:00.000Z",
};

describe("web-config workspace routing writes", () => {
	let dir: string;
	let file: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-web-config-"));
		file = path.join(dir, "web.yml");
		fs.writeFileSync(
			file,
			JSON.stringify({ channels: { instances: [INSTANCE] }, imAgents: [PROFILE], remote: {} }),
		);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("stores aliases and paths as objects and reads them back", async () => {
		const config = await WebConfig.load(file);
		await config.set("remote.workspaces", [
			{ alias: "alpha", path: path.join(dir, "alpha") },
			{ alias: "beta", path: path.join(dir, "beta") },
		]);

		const reloaded = await WebConfig.load(file);
		expect(reloaded.getWorkspaces()).toEqual([
			{ alias: "alpha", path: path.join(dir, "alpha") },
			{ alias: "beta", path: path.join(dir, "beta") },
		]);
	});

	it("still accepts the legacy bare-path form", async () => {
		const config = await WebConfig.load(file);
		await config.set("remote.workspaces", [path.join(dir, "legacy")]);
		const reloaded = await WebConfig.load(file);
		expect(reloaded.getWorkspaces()).toEqual([{ alias: "legacy", path: path.join(dir, "legacy") }]);
	});

	it("rejects relative paths, the reserved alias and duplicates", async () => {
		const config = await WebConfig.load(file);
		await expect(config.set("remote.workspaces", [{ alias: "rel", path: "relative/dir" }])).rejects.toThrow(
			/absolute/,
		);
		await expect(config.set("remote.workspaces", [{ alias: "main", path: path.join(dir, "main") }])).rejects.toThrow(
			/reserved/,
		);
		await expect(
			config.set("remote.workspaces", [
				{ alias: "dup", path: path.join(dir, "one") },
				{ alias: "dup", path: path.join(dir, "two") },
			]),
		).rejects.toThrow(/Duplicate/);
	});

	it("stores a chat binding the router can read", async () => {
		const config = await WebConfig.load(file);
		await config.setImBindings([BINDING]);

		const reloaded = await WebConfig.load(file);
		expect(reloaded.getImBindings()).toEqual([BINDING]);
		// The router resolves the binding by instance id + chat id.
		expect(reloaded.findImBinding("feishu", "oc_1")?.target).toEqual({ kind: "workspace", workspace: "alpha" });
		// A platform name is not an instance namespace.
		expect(reloaded.findImBinding("telegram", "oc_1")).toBeUndefined();
	});

	it("rejects a binding without a chat id or with an unknown instance", async () => {
		const config = await WebConfig.load(file);
		await expect(config.setImBindings([{ ...BINDING, chatId: "" }])).rejects.toThrow(/chatId/);
		await expect(config.setImBindings([{ ...BINDING, instanceId: "irc" }])).rejects.toThrow(/unknown instance/);
	});

	it("accepts the session-only updates !lang / !session use write", async () => {
		const config = await WebConfig.load(file);
		await config.patchImBinding("feishu", "oc_2", { lang: "zh" });
		await config.patchImBinding("feishu", "oc_2", { sessionId: "abc123" });

		const rows = (await WebConfig.load(file)).getImBindings();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ instanceId: "feishu", chatId: "oc_2", lang: "zh", sessionId: "abc123" });
		// The GUI's whole-array PUT of exactly this array must be accepted.
		await expect(config.setImBindings(rows)).resolves.toHaveLength(1);
	});

	it("rejects a binding that carries no target", async () => {
		const config = await WebConfig.load(file);
		const { target: _target, ...untargeted } = BINDING;
		await expect(config.setImBindings([{ ...untargeted, chatId: "oc_3" }])).rejects.toThrow(/target/);
	});

	it("refuses to load a binding that names an unknown instance instead of healing it", async () => {
		// An older build could write a platform name; the loader must not invent
		// an instance or silently drop the row.
		fs.writeFileSync(
			file,
			JSON.stringify({
				channels: { instances: [INSTANCE] },
				imAgents: [PROFILE],
				remote: { imBindings: [{ ...BINDING, instanceId: "telegram" }] },
			}),
		);
		await expect(WebConfig.load(file)).rejects.toThrow(/unknown instance/);
	});
});

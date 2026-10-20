import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WebConfig } from "../../src/config/web-config";

// The GUI's 工作区路由 writes the whole `remote.workspaces` /
// `remote.sessionMappings` array through `PUT /api/web-config`. Before this
// route existed those two paths were unknown to PUT, so the desktop's add/edit/
// remove could only be exercised by the IM commands. These tests hold the
// write contract the GUI depends on: alias rules, absolute directories, and
// the binding shape the router reads.

describe("web-config workspace routing writes", () => {
	let dir: string;
	let file: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-web-config-"));
		file = path.join(dir, "web.yml");
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
		await config.set("remote.sessionMappings", [
			{ platform: "feishu", chatId: "oc_1", workspaceAlias: "alpha", lang: "zh", mode: "direct" },
		]);

		const reloaded = await WebConfig.load(file);
		expect(reloaded.getSessionMappings()).toEqual([
			{ platform: "feishu", chatId: "oc_1", workspaceAlias: "alpha", lang: "zh", mode: "direct" },
		]);
	});

	it("rejects a binding without a chat id or with an unknown platform", async () => {
		const config = await WebConfig.load(file);
		await expect(
			config.set("remote.sessionMappings", [{ platform: "feishu", chatId: "", workspaceAlias: "alpha" }]),
		).rejects.toThrow(/chatId/);
		await expect(
			config.set("remote.sessionMappings", [{ platform: "irc", chatId: "x", workspaceAlias: "alpha" }]),
		).rejects.toThrow(/platform/);
	});

	it("accepts the session-only rows !lang / !session use write", async () => {
		const config = await WebConfig.load(file);
		await config.updateChatMapping("feishu", "oc_2", { lang: "zh" });
		await config.updateChatMapping("feishu", "oc_2", { sessionId: "abc123" });

		const rows = (await WebConfig.load(file)).getSessionMappings();
		expect(rows).toEqual([{ platform: "feishu", chatId: "oc_2", lang: "zh", sessionId: "abc123" }]);
		// The GUI's whole-array PUT of exactly this array must be accepted.
		await expect(config.set("remote.sessionMappings", rows)).resolves.toBeUndefined();
	});

	it("rejects a row that carries no alias, language or session", async () => {
		const config = await WebConfig.load(file);
		await expect(config.set("remote.sessionMappings", [{ platform: "feishu", chatId: "oc_3" }])).rejects.toThrow(
			/workspaceAlias, lang or sessionId/,
		);
	});

	it("drops rows that would fail validation instead of persisting them", async () => {
		// An older build wrote this row; the next write heals the file.
		await Bun.write(
			file,
			JSON.stringify({
				remote: { sessionMappings: [{ platform: "feishu", chatId: "oc_4" }] },
			}),
		);
		const config = await WebConfig.load(file);
		await config.set("tray.autostart", true);

		const rows = (await WebConfig.load(file)).getSessionMappings();
		expect(rows).toEqual([]);
		await expect((await WebConfig.load(file)).set("remote.sessionMappings", rows)).resolves.toBeUndefined();
	});
});

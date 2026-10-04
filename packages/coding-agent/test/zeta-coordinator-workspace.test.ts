/**
 * Coordinator anchoring: the relay transcript relocates from the serve
 * process cwd's session dir (desktop installs: the app install dir) into the
 * default workspace's session dir, repointing the web.yml `relay` registry
 * entry so history and relay tagging survive. A fresh install (no legacy
 * transcript) resolves straight to the default-workspace file.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { WebConfig } from "../src/config/web-config";
import { defaultCoordinatorWorkspace, resolveCoordinatorFile } from "../src/server/zeta-server";
import { SessionManager } from "../src/session/session-manager";

describe("coordinator default-workspace anchoring", () => {
	let agentDir: string;
	const savedAgentDir = process.env.ZETA_CODING_AGENT_DIR;

	afterEach(async () => {
		if (savedAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
		else process.env.ZETA_CODING_AGENT_DIR = savedAgentDir;
		refreshDirsFromEnv();
		await rm(agentDir, { recursive: true, force: true });
	});

	async function setup(): Promise<string> {
		agentDir = await mkdtemp(join(tmpdir(), "zeta-coordinator-"));
		process.env.ZETA_CODING_AGENT_DIR = agentDir;
		refreshDirsFromEnv();
		return agentDir;
	}

	function relayEntry(sessionFile: string) {
		return {
			id: "relay",
			name: "Zeta Bot (Relay)",
			tag: "relay" as const,
			sessionFile,
			createdAt: new Date().toISOString(),
		};
	}

	test("relocates a legacy install-dir transcript and repoints the relay registry", async () => {
		const dir = await setup();
		const legacyCwd = join(dir, "install", "zeta-desktop");
		const legacyFile = join(SessionManager.getDefaultSessionDir(legacyCwd), "zeta-bot.jsonl");
		await writeFile(legacyFile, "transcript-v1\n");
		const config = await WebConfig.load();
		await config.upsertBotSession(relayEntry(legacyFile));

		const workspace = join(dir, "default-workspace");
		const resolved = await resolveCoordinatorFile(workspace, legacyCwd, config);
		const target = join(SessionManager.getDefaultSessionDir(workspace), "zeta-bot.jsonl");

		expect(resolved).toBe(target);
		expect(await readFile(target, "utf8")).toBe("transcript-v1\n");
		expect(fs.existsSync(legacyFile)).toBe(false);
		expect(config.getBotSession("relay")?.sessionFile).toBe(target);
		// The registry write persisted to web.yml, not just the live instance.
		expect((await WebConfig.load()).getBotSession("relay")?.sessionFile).toBe(target);
	});

	test("is idempotent once the default-workspace transcript exists", async () => {
		const dir = await setup();
		const legacyCwd = join(dir, "install", "zeta-desktop");
		const workspace = join(dir, "default-workspace");
		const target = join(SessionManager.getDefaultSessionDir(workspace), "zeta-bot.jsonl");
		await writeFile(target, "transcript-v2\n");
		const legacyFile = join(SessionManager.getDefaultSessionDir(legacyCwd), "zeta-bot.jsonl");
		await writeFile(legacyFile, "stale-legacy\n");
		const config = await WebConfig.load();
		await config.upsertBotSession(relayEntry(legacyFile));

		expect(await resolveCoordinatorFile(workspace, legacyCwd, config)).toBe(target);
		// The pre-existing default-workspace copy wins; the legacy file is left alone.
		expect(await readFile(target, "utf8")).toBe("transcript-v2\n");
		expect(fs.existsSync(legacyFile)).toBe(true);
	});

	test("fresh install without a legacy transcript resolves to the default workspace", async () => {
		const dir = await setup();
		const legacyCwd = join(dir, "install", "zeta-desktop");
		const workspace = join(dir, "default-workspace");
		const target = join(SessionManager.getDefaultSessionDir(workspace), "zeta-bot.jsonl");
		const config = await WebConfig.load();

		expect(await resolveCoordinatorFile(workspace, legacyCwd, config)).toBe(target);
		expect(fs.existsSync(target)).toBe(false);
	});

	test("legacy cwd equal to the default workspace is a no-op", async () => {
		const dir = await setup();
		const workspace = join(dir, "default-workspace");
		const config = await WebConfig.load();

		expect(await resolveCoordinatorFile(workspace, workspace, config)).toBe(
			join(SessionManager.getDefaultSessionDir(workspace), "zeta-bot.jsonl"),
		);
	});

	test("defaultCoordinatorWorkspace is ~/.zeta/workspace under the real home", () => {
		const home = process.env.HOME ?? process.env.USERPROFILE;
		if (!home) return; // unreachable on supported platforms
		expect(defaultCoordinatorWorkspace().replaceAll("\\", "/")).toBe(
			join(home, ".zeta", "workspace").replaceAll("\\", "/"),
		);
	});
});

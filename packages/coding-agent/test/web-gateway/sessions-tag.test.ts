/**
 * Gateway session-listing contract: default-space bot sessions (relay/bot/
 * draft) are tagged from the web.yml registry so the web UI can hide or label
 * them; ordinary sessions carry no tag. Exercised through the real
 * `listAllSessionsWeb` against a temp agent dir.
 */

import { afterEach, describe, expect, test, vi } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { WebConfig } from "../../src/config/web-config";
import { invalidateSessionListCache, listAllSessionsWeb } from "../../src/server/web-gateway/sessions";
import { SessionManager } from "../../src/session/session-manager";

const ENV_KEYS = ["ZETA_CODING_AGENT_DIR", "OMP_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"];

describe("gateway session tag mapping", () => {
	let agentDir: string;
	const cleanups: Array<() => Promise<void>> = [];
	const savedEnv = new Map<string, string | undefined>();

	afterEach(async () => {
		vi.restoreAllMocks();
		invalidateSessionListCache();
		for (const key of ENV_KEYS) {
			const saved = savedEnv.get(key);
			if (saved === undefined) delete process.env[key];
			else process.env[key] = saved;
		}
		refreshDirsFromEnv();
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	});

	async function setup(): Promise<string> {
		agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-sessions-"));
		cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
		for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
		process.env.ZETA_CODING_AGENT_DIR = agentDir;
		process.env.OMP_CODING_AGENT_DIR = agentDir;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		refreshDirsFromEnv();
		invalidateSessionListCache();
		return agentDir;
	}

	/** Write a minimal valid session file and return its path. */
	async function seedSession(cwd: string, fileName: string): Promise<string> {
		const dir = SessionManager.getDefaultSessionDir(cwd);
		await fs.mkdir(dir, { recursive: true });
		const file = join(dir, fileName);
		const header = {
			type: "session",
			version: 3,
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			cwd,
		};
		await fs.writeFile(file, `${JSON.stringify(header)}\n`, "utf8");
		return file;
	}

	test("bot-session registry tags relay/bot/draft transcripts; ordinary sessions have no tag", async () => {
		await setup();
		const cwd = await mkdtemp(join(tmpdir(), "zeta-gw-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));

		const relayFile = await seedSession(cwd, "zeta-bot.jsonl");
		const botFile = await seedSession(cwd, "project-abc123.jsonl");
		const draftFile = await seedSession(cwd, "draft-xyz789.jsonl");
		const normalFile = await seedSession(cwd, "user-session.jsonl");

		// Register the default-space sessions in web.yml (mirrors zeta-server's
		// ensureRelaySession + createBotSession persistence).
		const webConfig = await WebConfig.load();
		await webConfig.upsertBotSession({
			id: "relay",
			name: "Zeta Bot (Relay)",
			tag: "relay",
			sessionFile: relayFile,
			createdAt: new Date().toISOString(),
		});
		await webConfig.upsertBotSession({
			id: "abc123",
			name: "Project",
			tag: "bot",
			sessionFile: botFile,
			createdAt: new Date().toISOString(),
		});
		await webConfig.upsertBotSession({
			id: "xyz789",
			name: "Draft",
			tag: "draft",
			sessionFile: draftFile,
			createdAt: new Date().toISOString(),
		});

		const sessions = await listAllSessionsWeb();
		const tagByPath = new Map(sessions.map(s => [path.normalize(s.path), s.tag]));
		expect(tagByPath.get(path.normalize(relayFile))).toBe("relay");
		expect(tagByPath.get(path.normalize(botFile))).toBe("bot");
		expect(tagByPath.get(path.normalize(draftFile))).toBe("draft");
		expect(tagByPath.get(path.normalize(normalFile))).toBeUndefined();
		// Every session resolves to a stable id (web UI relies on it).
		for (const s of sessions) {
			expect(s.id).toBeTruthy();
		}
	});
});

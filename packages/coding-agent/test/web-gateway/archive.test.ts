/**
 * Gateway session archive contract: archive moves the jsonl (+ artifacts dir)
 * out of the live sessions tree so `listAllSessionsWeb` no longer returns it,
 * `handleListArchivedSessions` surfaces it, unarchive restores it verbatim,
 * and bot/draft registry entries are disposed on the way out (relay sessions
 * refuse deletion but their registry entry is still disposed on archive).
 * Exercised through the real handlers against a temp agent dir.
 */

import { afterEach, describe, expect, test, vi } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { WebConfig } from "../../src/config/web-config";
import {
	handleArchiveSession,
	handleListArchivedSessions,
	handleUnarchiveSession,
} from "../../src/server/web-gateway/archive";
import {
	disposeSessionRegistryEntry,
	invalidateSessionListCache,
	listAllSessionsWeb,
} from "../../src/server/web-gateway/sessions";
import { SessionManager } from "../../src/session/session-manager";

const ENV_KEY = "ZETA_CODING_AGENT_DIR";

describe("gateway session archive", () => {
	let agentDir: string;
	const cleanups: Array<() => Promise<void>> = [];
	const savedEnv = new Map<string, string | undefined>();

	afterEach(async () => {
		vi.restoreAllMocks();
		invalidateSessionListCache();
		const saved = savedEnv.get(ENV_KEY);
		if (saved === undefined) delete process.env[ENV_KEY];
		else process.env[ENV_KEY] = saved;
		refreshDirsFromEnv();
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	});

	async function setup(): Promise<string> {
		agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-archive-"));
		cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
		savedEnv.set(ENV_KEY, process.env[ENV_KEY]);
		process.env[ENV_KEY] = agentDir;
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

	async function listIds(): Promise<Map<string, string>> {
		const sessions = await listAllSessionsWeb();
		return new Map(sessions.map(s => [s.id, s.path]));
	}

	test("archive round-trip: hide from live list, surface in archived list, restore", async () => {
		await setup();
		const cwd = await mkdtemp(join(tmpdir(), "zeta-gw-archive-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));

		const keepFile = await seedSession(cwd, "keep-session.jsonl");
		const goneFile = await seedSession(cwd, "archived-session.jsonl");

		const before = await listIds();
		expect(before.size).toBe(2);

		const archivedId = [...before.entries()].find(([, p]) => p === goneFile)?.[0];
		expect(archivedId).toBeTruthy();

		// Archive
		const archiveRes = await handleArchiveSession(archivedId!);
		expect(archiveRes.status).toBe(200);
		const { ok, archivePath } = (await archiveRes.json()) as { ok: boolean; archivePath: string };
		expect(ok).toBe(true);
		// Destination is inside the archive root and mirrors the project dir.
		expect(archivePath).toContain(join("archive", "sessions"));
		expect(archivePath.endsWith("archived-session.jsonl")).toBe(true);

		// Live list no longer contains it; the untouched session remains.
		const afterArchive = await listIds();
		expect(afterArchive.has(archivedId!)).toBe(false);
		expect(afterArchive.size).toBe(1);
		expect([...afterArchive.values()][0]).toBe(keepFile);
		// The jsonl really left the sessions tree.
		await expect(fs.access(goneFile)).rejects.toThrow();

		// Archived list surfaces exactly the one session.
		const listRes = await handleListArchivedSessions();
		expect(listRes.status).toBe(200);
		const { sessions } = (await listRes.json()) as {
			sessions: Array<{ id: string; archivedFrom?: string; cwd: string }>;
		};
		expect(sessions).toHaveLength(1);
		expect(sessions[0].id).toBe(archivedId);
		expect(sessions[0].archivedFrom).toBe(cwd);

		// Unarchive restores it to the live tree at the same relative layout.
		const unarchiveRes = await handleUnarchiveSession(archivedId!);
		expect(unarchiveRes.status).toBe(200);
		const restored = (await unarchiveRes.json()) as { ok: boolean; path: string };
		expect(restored.ok).toBe(true);

		const afterRestore = await listIds();
		expect(afterRestore.has(archivedId!)).toBe(true);
		// Original relative layout reconstructed: same dir name, same file name.
		expect(restored.path.endsWith("archived-session.jsonl")).toBe(true);
		expect(
			await fs.access(restored.path).then(
				() => true,
				() => false,
			),
		).toBe(true);

		const listAfter = await handleListArchivedSessions();
		const { sessions: emptied } = (await listAfter.json()) as { sessions: unknown[] };
		expect(emptied).toHaveLength(0);
	});

	test("archive disposes bot registry entries; relay sessions refuse to archive like delete", async () => {
		await setup();
		const cwd = await mkdtemp(join(tmpdir(), "zeta-gw-archive-bot-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));

		const botFile = await seedSession(cwd, "bot-abc123.jsonl");
		const webConfig = await WebConfig.load();
		await webConfig.upsertBotSession({
			id: "abc123",
			name: "Project",
			tag: "bot",
			sessionFile: botFile,
			createdAt: new Date().toISOString(),
		});

		const ids = await listIds();
		const botId = [...ids.entries()].find(([, p]) => p === botFile)?.[0];
		expect(botId).toBeTruthy();

		// disposeSessionRegistryEntry contract shared with delete: bot entries go.
		expect(await disposeSessionRegistryEntry(webConfig, botFile)).toBe("disposed");
		expect(webConfig.getBotSessions().find(e => e.id === "abc123")).toBeUndefined();

		// Relay protection: disposeSessionRegistryEntry flags it; delete handler
		// maps that to HTTP 400 (archive keeps the transcript, delete would not).
		const relayFile = await seedSession(cwd, "relay-flagged.jsonl");
		await webConfig.upsertBotSession({
			id: "relay",
			name: "Zeta Bot (Relay)",
			tag: "relay",
			sessionFile: relayFile,
			createdAt: new Date().toISOString(),
		});
		expect(await disposeSessionRegistryEntry(webConfig, relayFile)).toBe("relay-protected");

		// Relay sessions refuse archive exactly like delete: the live relay
		// runtime still points at the transcript, so moving it would orphan
		// the relay. The handler surfaces this as HTTP 400. The 30s list cache
		// was filled before relayFile was seeded — force a fresh scan.
		invalidateSessionListCache();
		const relayId = [...(await listIds()).entries()].find(([, p]) => p === relayFile)?.[0];
		const relayArchive = await handleArchiveSession(relayId!);
		expect(relayArchive.status).toBe(400);
		// Transcript still in place.
		expect((await listIds()).has(relayId!)).toBe(true);
	});

	test("archiving an unknown session id 404s; unarchiving a never-archived id 404s", async () => {
		await setup();
		const missing = await handleArchiveSession("00000000-0000-0000-0000-000000000000");
		expect(missing.status).toBe(404);

		const neverArchived = await handleUnarchiveSession("00000000-0000-0000-0000-000000000000");
		expect(neverArchived.status).toBe(404);
	});
});

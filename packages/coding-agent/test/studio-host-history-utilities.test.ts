import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, setAgentDir, VERSION } from "@linxiraos/pi-utils";
import * as gcCompress from "@linxiraos/zeta/cli/gc-compress";
import { cfgGcCompressAfterDays } from "@linxiraos/zeta/cli/gc-settings";
import { Settings } from "@linxiraos/zeta/config/settings";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { closeSessionIndex } from "@linxiraos/zeta/session/session-index";
import { HistoryStorage } from "@linxiraos/zeta/session/history-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { sessionDirForCwd } from "@linxiraos/zeta/session/session-paths";
import { inspectSessionArchive, packSession, unpackSession } from "@linxiraos/zeta/session/session-transfer";
import { historyUtilitiesOps } from "@linxiraos/zeta/server/studio-host/ops/history-utilities";
import { StudioArchiveService } from "@linxiraos/zeta/server/studio-host/services/archive-service";
import { StudioSessionCompressionService } from "@linxiraos/zeta/server/studio-host/services/session-compression-service";
import { StudioSessionPortabilityService } from "@linxiraos/zeta/server/studio-host/services/session-portability-service";
import { StudioSessionTitlesService } from "@linxiraos/zeta/server/studio-host/services/session-titles-service";
import type {
	PortableExport,
	SessionImportPreview,
} from "../src/server/studio-host/protocol/contracts/session-portability";
import { makeAssistantMessage } from "./session-manager/helpers";
import { invalidateSessionListCache } from "../src/server/web-gateway/sessions";

const originalAgentDir = process.env.ZETA_CODING_AGENT_DIR;
let root: string;
let app: string;
let app2: string;

function fakeSession(
	id: string,
	manager: {
		getCwd(): string;
		getSessionDir?(): string;
		getSessionFile?(): string | undefined;
		flush?(): Promise<void>;
	},
	extra: Record<string, unknown> = {},
): AgentSession {
	return {
		sessionId: id,
		isDisposed: false,
		sessionManager: manager,
		...extra,
	} as unknown as AgentSession;
}

async function writeArchiveSession(cwd: string, id: string, title: string, prompt: string): Promise<string> {
	const at = new Date(Date.now() - 60_000).toISOString();
	const dir = sessionDirForCwd(cwd);
	await fs.mkdir(dir, { recursive: true });
	const entries = [
		{ type: "session", version: 3, id, timestamp: at, cwd, title, titleSource: "user" },
		{
			type: "message",
			id: "u1",
			parentId: null,
			timestamp: at,
			message: { role: "user", content: prompt, timestamp: Date.parse(at) },
		},
	];
	const file = path.join(dir, `${Date.parse(at)}_${id}.jsonl`);
	await fs.writeFile(file, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
	return file;
}

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-history-"));
	app = path.join(root, "app");
	app2 = path.join(root, "destination");
	await fs.mkdir(app, { recursive: true });
	await fs.mkdir(app2, { recursive: true });
	setAgentDir(path.join(root, "agent"));
});

afterEach(async () => {
	HistoryStorage.close();
	closeSessionIndex();
	await fs.rm(root, { recursive: true, force: true });
	if (originalAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else setAgentDir(originalAgentDir);
});

describe("history command validation", () => {
	const commands = historyUtilitiesOps.commands!;
	function handler(kind: keyof typeof commands) {
		return commands[kind] as unknown as (input: unknown, context: unknown) => Promise<unknown>;
	}

	test("rejects unknown fields and malformed ids before touching a session", async () => {
		await expect(
			handler("archive.sessions.list")({ sessionId: "session", scope: "workspace", extra: true }, {}),
		).rejects.toThrow("Unknown history command field");
		await expect(
			handler("session.portability.prepare")({ sessionId: "session", artifactId: "not an artifact" }, {}),
		).rejects.toThrow("Invalid artifact id");
		await expect(
			handler("maintenance.compression.apply")({ sessionId: "session", token: "nope" }, {}),
		).rejects.toThrow("Invalid transfer token");
		const queries = historyUtilitiesOps.queries as unknown as Record<
			string,
			(input: unknown, context: unknown) => Promise<unknown>
		>;
		await expect(
			queries["session.lease.read"]!({ sessionId: "session", targetSessionIds: "nope" }, {}),
		).rejects.toThrow("Invalid lease target list");
	});
});

describe("session portability state", () => {
	test("reports idle status and refuses to move the live source copy", async () => {
		const id = "portable-live";
		const host = {
			ownerId: "owner-live",
			assertCurrent() {},
			resolveTargetWorkspace: async (workspaceId: string | undefined) => ({
				workspaceId: workspaceId ?? "ws-test",
				cwd: app,
			}),
		};
		const service = new StudioSessionPortabilityService(
			fakeSession(id, { getCwd: () => app, getSessionDir: () => sessionDirForCwd(app) }),
		);
		expect(await service.execute({ kind: "session.portability.status", sessionId: id }, host)).toEqual({
			phase: "idle",
		});
		await expect(
			service.execute(
				{
					kind: "session.portability.moved",
					sessionId: id,
					targetSessionId: id,
					label: "office",
				},
				host,
			),
		).rejects.toThrow("Switch away from the source session");
	});

	test("keeps the initiating view's fence through another view's status read and blocks publish", async () => {
		const manager = await SessionManager.create(app);
		manager.appendMessage(makeAssistantMessage());
		await manager.flush();
		const id = manager.getSessionId();
		const file = manager.getSessionFile()!;
		const flushGate = Promise.withResolvers<void>();
		const flushEntered = Promise.withResolvers<void>();
		const service = new StudioSessionPortabilityService(
			fakeSession(
				id,
				{
					getCwd: () => app,
					getSessionDir: () => sessionDirForCwd(app),
					getSessionFile: () => file,
					flush: async () => {
						flushEntered.resolve();
						await flushGate.promise;
						await manager.flush();
					},
				},
				{ isStreaming: false, isCompacting: false },
			),
		);
		let viewLive = true;
		const hostA = {
			ownerId: "context-a",
			assertCurrent() {
				if (!viewLive) throw new Error("view A is no longer current");
			},
			resolveTargetWorkspace: async (workspaceId: string | undefined) => ({
				workspaceId: workspaceId ?? "ws-a",
				cwd: app,
			}),
		};
		const hostB = {
			ownerId: "context-b",
			assertCurrent() {},
			resolveTargetWorkspace: async (workspaceId: string | undefined) => ({
				workspaceId: workspaceId ?? "ws-b",
				cwd: app,
			}),
		};
		const artifacts = async (): Promise<string[]> => {
			try {
				return (await fs.readdir(file.slice(0, -".jsonl".length))).sort();
			} catch {
				return [];
			}
		};
		const before = await artifacts();
		const exporting = service.execute(
			{ kind: "session.portability.pack", sessionId: id, targetSessionId: id },
			hostA,
		);
		await flushEntered.promise;
		expect(await service.execute({ kind: "session.portability.status", sessionId: id }, hostB)).toEqual({
			phase: "exporting",
		});
		viewLive = false;
		flushGate.resolve();
		await expect(exporting).rejects.toThrow("view A is no longer current");
		expect(await artifacts()).toEqual(before);
		await manager.close();
	});

	test("another view cannot consume or cancel the preparing view's import review", async () => {
		const manager = SessionManager.create(app);
		manager.appendMessage(makeAssistantMessage());
		await manager.ensureOnDisk();
		await manager.flush();
		const id = manager.getSessionId();
		invalidateSessionListCache();
		const service = new StudioSessionPortabilityService(fakeSession(id, manager));
		const hostA = {
			ownerId: "context-a",
			assertCurrent() {},
			resolveTargetWorkspace: async () => ({ workspaceId: "ws-a", cwd: app }),
		};
		const hostB = { ...hostA, ownerId: "context-b" };
		try {
			const exported = (await service.execute(
				{ kind: "session.portability.pack", sessionId: id, targetSessionId: id },
				hostA,
			)) as PortableExport;
			const preview = (await service.execute(
				{ kind: "session.portability.prepare", sessionId: id, artifactId: exported.asset.artifactId },
				hostA,
			)) as SessionImportPreview;
			await expect(
				service.execute({ kind: "session.portability.import", sessionId: id, token: preview.token }, hostB),
			).rejects.toThrow("Import preview expired");
			await expect(
				service.execute({ kind: "session.portability.cancel", sessionId: id, token: preview.token }, hostB),
			).rejects.toThrow("Import preview expired");
			const result = (await service.execute(
				{ kind: "session.portability.import", sessionId: id, token: preview.token },
				hostA,
			)) as { sessionId: string; mode: string };
			expect(result.mode).toBe("forked");
			expect(result.sessionId).not.toBe(id);
			expect(manager.getSessionId()).toBe(id);
		} finally {
			invalidateSessionListCache();
			service.dispose();
			await manager.close();
		}
	});
});

describe("session title reads", () => {
	test("projects the live card, peeks a peer without ownership and reports a missing id", async () => {
		const live = await SessionManager.create(app);
		live.appendMessage(makeAssistantMessage());
		await live.setSessionName("🧪 FLAKY: Current title", "user");
		await live.flush();
		const liveId = live.getSessionId();

		const peer = await SessionManager.create(app);
		peer.appendMessage(makeAssistantMessage());
		await peer.setSessionName("🧪 FLAKY: Peer title", "user");
		await peer.flush();
		const peerId = peer.getSessionId();
		const peerFile = peer.getSessionFile()!;
		await peer.close();

		expect(await SessionManager.peekSessionTitle(peerFile)).toMatchObject({
			sessionId: peerId,
			title: "🧪 FLAKY: Peer title",
			source: "user",
			card: { code: "FLAKY", emoji: "🧪" },
		});

		const service = new StudioSessionTitlesService(fakeSession(liveId, live));
		const result = await service.execute({
			kind: "session.titles.inspect",
			sessionId: liveId,
			targetSessionIds: [liveId, peerId, "missing-session"],
		});
		expect(result.rows).toEqual([
			{
				sessionId: liveId,
				state: "available",
				title: "Current title",
				source: "user",
				card: { code: "FLAKY", emoji: "🧪" },
			},
			{
				sessionId: peerId,
				state: "available",
				title: "🧪 FLAKY: Peer title",
				source: "user",
				card: { code: "FLAKY", emoji: "🧪" },
			},
			{ sessionId: "missing-session", state: "missing" },
		]);
		await live.close();
	});
});

describe("archive reads", () => {
	test("lists workspace rows without transcript paths and inspects an exact id", async () => {
		const id = `archive-${crypto.randomUUID()}`;
		await writeArchiveSession(app, id, "Archive target", "What changed?");
		const service = new StudioArchiveService(fakeSession("live-archive", { getCwd: () => app }));
		const listed = (await service.execute({
			kind: "archive.sessions.list",
			sessionId: "live-archive",
			scope: "workspace",
		})) as { rows: Array<Record<string, unknown>>; truncated: boolean };
		const row = listed.rows.find(candidate => candidate.id === id);
		expect(row).toMatchObject({ id, title: "Archive target", project: path.basename(app) });
		expect(row && "file" in row).toBe(false);

		const detail = (await service.execute({
			kind: "archive.session.inspect",
			sessionId: "live-archive",
			targetSessionId: id,
		})) as { session: Record<string, unknown>; prompts: unknown[] };
		expect(detail.session).toMatchObject({ id, title: "Archive target" });
		expect(detail.session && "file" in detail.session).toBe(false);
	});
});

describe("native session transfer", () => {
	test("inspects a packed archive and preserves a collision as a fork", async () => {
		const source = await SessionManager.create(app);
		source.appendMessage(makeAssistantMessage());
		await source.setSessionName("Pack me", "user");
		await source.flush();
		const id = source.getSessionId();
		const file = source.getSessionFile()!;
		await source.close();

		const archive = path.join(root, "session.tar");
		const packed = await packSession(file, archive);
		expect(packed).toMatchObject({ id, missingBlobs: [] });

		// Simulate the destination machine: only the archive crosses.
		await fs.rm(file, { force: true });
		await fs.rm(file.slice(0, -".jsonl".length), { recursive: true, force: true });
		expect(await inspectSessionArchive(archive, app2)).toMatchObject({
			id,
			title: "Pack me",
			cwd: app,
			omp: VERSION,
			messages: 1,
			artifacts: 0,
			blobs: 0,
			conflicts: false,
		});

		const created = await unpackSession(archive, { cwd: app2, preserveExisting: true });
		expect(created).toMatchObject({ id, mode: "created" });
		expect(await inspectSessionArchive(archive, app2)).toMatchObject({ conflicts: true });

		const forked = await unpackSession(archive, { cwd: app2, preserveExisting: true });
		expect(forked.mode).toBe("forked");
		expect(forked.id).not.toBe(id);
		expect(await fs.stat(created.sessionFile)).toBeTruthy();
		expect(await fs.stat(forked.sessionFile)).toBeTruthy();
	});
});

describe("native compression review", () => {
	test("scans without stdout and applies only the reviewed identity", async () => {
		const id = `compress-${crypto.randomUUID()}`;
		const file = await writeArchiveSession(app, id, "Cold session", "x".repeat(32_000));
		const old = new Date(Date.now() - 8 * 86_400_000);
		await fs.utimes(file, old, old);
		const volume = spyOn(gcCompress, "compressMethod").mockResolvedValue("ntfs");
		const probe = spyOn(gcCompress, "compressionWorks").mockResolvedValue(true);
		const compressed: string[] = [];
		const backend = spyOn(gcCompress, "compressFilesInPlace").mockImplementation(async candidates => {
			compressed.push(...candidates.map(candidate => candidate.path));
			return { compressed: candidates.length, allocatedAfter: 0, errors: [] };
		});
		const stdout = spyOn(process.stdout, "write").mockImplementation(() => {
			throw new Error("collectGc wrote to stdout");
		});
		try {
			const settings = Settings.isolated();
			cfgGcCompressAfterDays.override(settings, 1);
			const service = new StudioSessionCompressionService(
				fakeSession("live-compression", { getCwd: () => app }, { settings }),
			);
			const scanned = await service.execute({
				kind: "maintenance.compression.scan",
				sessionId: "live-compression",
			});
			expect(scanned.phase).toBe("ready");
			expect(scanned.summary?.scanned).toBeGreaterThan(0);
			expect(scanned.summary?.files.map(candidate => candidate.sessionId)).toEqual([id]);
			if (!scanned.token) throw new Error("Missing compression review token");
			const late = await writeArchiveSession(app, `${id}-late`, "Unreviewed", "y".repeat(32_000));
			await fs.utimes(late, old, old);
			const applied = await service.execute({
				kind: "maintenance.compression.apply",
				sessionId: "live-compression",
				token: scanned.token,
			});
			expect(applied.phase).toBe("complete");
			expect(compressed).toEqual([file]);
			expect(applied.summary?.compressed).toBe(1);
			expect(service.running).toBe(false);
		} finally {
			stdout.mockRestore();
			backend.mockRestore();
			probe.mockRestore();
			volume.mockRestore();
		}
		expect(getAgentDir()).toBe(path.join(root, "agent"));
	});

	test("reads the bounded automatic compression status log", async () => {
		const settings = Settings.isolated();
		const log = path.join(getAgentDir(), "gc-auto-compress.log");
		await fs.mkdir(getAgentDir(), { recursive: true });
		await fs.writeFile(log, `compress ok\n${getAgentDir()}\n`);
		const service = new StudioSessionCompressionService(
			fakeSession("live-compression-log", { getCwd: () => app }, { settings }),
		);
		const status = await service.autoStatus();
		expect(status.enabled).toBe(false);
		expect(status.ranAt).toBeGreaterThan(0);
		expect(status.log).toContain("compress ok");
		expect(status.log).not.toContain(getAgentDir());
	});
});

/**
 * Session origin: an IM/bot/relay conversation is an ordinary transcript with
 * an optional header stamp. These tests pin the contract the Studio lists, the
 * resume picker and the gateway rely on: the stamp round-trips, a legacy
 * transcript can be stamped on open, and the personal listings leave IM rows
 * out unless asked.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildResumeDirectory } from "@linxiraos/zeta/resume/directory";
import { FileSessionStorage, MemorySessionStorage } from "@linxiraos/zeta/session/session-storage";
import { isImSession, sessionLocationLabel, type SessionOrigin } from "@linxiraos/zeta/session/session-origin";
import {
	filterSessionsForPicker,
	listSessionsForPicker,
	type SessionInfo,
} from "@linxiraos/zeta/session/session-listing";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";

const IM_ORIGIN: SessionOrigin = {
	kind: "im",
	channel: "telegram",
	chatId: "chat-7",
	botSessionId: "relay",
	workspaceAlias: "main",
	// Reserved for the multi-agent default workspace: one main agent per
	// channel/chat binding. They must round-trip even though nothing binds
	// them yet.
	agentId: "main-agent",
	bindingId: "binding-telegram-chat-7",
};

const originTests: string[] = [];
afterEach(async () => {
	await Promise.all(originTests.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	originTests.push(dir);
	return dir;
}

async function managerWithOrigin(origin?: SessionOrigin): Promise<{ manager: SessionManager; file: string }> {
	const root = await tempDir("zeta-origin-");
	const cwd = join(root, "repo");
	await mkdir(cwd, { recursive: true });
	const sessionDir = join(root, "sessions");
	const manager = SessionManager.create(
		cwd,
		sessionDir,
		new FileSessionStorage(),
		origin === undefined ? {} : { origin },
	);
	await manager.ensureOnDisk();
	const file = manager.getSessionFile();
	if (!file) throw new Error("session file not materialized");
	return { manager, file };
}

function writeListedSession(
	storage: MemorySessionStorage,
	dir: string,
	file: string,
	options: { id: string; title: string; origin?: SessionOrigin },
): void {
	storage.writeTextSync(
		`${dir}/${file}`,
		[
			JSON.stringify({
				type: "session",
				version: 3,
				id: options.id,
				cwd: "/repo",
				title: options.title,
				timestamp: "2026-06-27T00:00:00.000Z",
				...(options.origin ? { origin: options.origin } : {}),
			}),
			JSON.stringify({ type: "message", message: { role: "user", content: "hello" } }),
			JSON.stringify({ type: "message", message: { role: "assistant", content: "hi" } }),
			"",
		].join("\n"),
	);
}

describe("session origin helpers", () => {
	test("an IM stamp is recognized and labelled without a filesystem path", () => {
		expect(isImSession(IM_ORIGIN)).toBe(true);
		expect(isImSession(undefined)).toBe(false);
		// The workspace alias is the whole location an IM row shows.
		expect(sessionLocationLabel(IM_ORIGIN)).toBe("main");
		// No alias: the channel, never the cwd.
		expect(sessionLocationLabel({ kind: "im", channel: "discord" })).toBe("IM · discord");
		// Nothing known: the caller's default-workspace label.
		expect(sessionLocationLabel({ kind: "im" }, { defaultWorkspaceLabel: "默认工作区" })).toBe("默认工作区");
		// A personal session has no IM location label.
		expect(sessionLocationLabel(undefined)).toBeUndefined();
	});
});

describe("origin persistence", () => {
	test("a created session records the origin and reads it back", async () => {
		const { manager, file } = await managerWithOrigin(IM_ORIGIN);
		expect(manager.getOrigin()).toEqual(IM_ORIGIN);
		await manager.close();

		const reopened = await SessionManager.open(file);
		try {
			expect(reopened.getOrigin()).toEqual(IM_ORIGIN);
		} finally {
			await reopened.close();
		}
		// The header line itself carries it, so an older scanner sees the field.
		const raw = await readFile(file, "utf8");
		const header = JSON.parse(raw.split("\n")[1] as string) as { type: string; origin?: SessionOrigin };
		expect(header.type).toBe("session");
		expect(header.origin).toEqual(IM_ORIGIN);
	});

	test("opening a legacy transcript stamps its origin and persists it", async () => {
		const root = await tempDir("zeta-origin-legacy-");
		const file = join(root, "legacy.jsonl");
		await writeFile(
			file,
			`${JSON.stringify({
				type: "session",
				version: 3,
				id: "legacy-id",
				cwd: root,
				timestamp: "2026-06-27T00:00:00.000Z",
			})}\n${JSON.stringify({ type: "message", message: { role: "user", content: "hi" } })}\n`,
			"utf8",
		);

		const manager = await SessionManager.open(file, undefined, undefined, { origin: IM_ORIGIN });
		try {
			expect(manager.getOrigin()).toEqual(IM_ORIGIN);
		} finally {
			await manager.close();
		}

		const reopened = await SessionManager.open(file);
		try {
			expect(reopened.getOrigin()).toEqual(IM_ORIGIN);
		} finally {
			await reopened.close();
		}
	});

	test("a personal session never acquires an origin", async () => {
		const { manager, file } = await managerWithOrigin();
		expect(manager.getOrigin()).toBeUndefined();
		await manager.close();
		const reopened = await SessionManager.open(file);
		try {
			expect(reopened.getOrigin()).toBeUndefined();
		} finally {
			await reopened.close();
		}
	});
});

describe("picker visibility", () => {
	const DIR = "/sessions/project";

	function seededStorage(): MemorySessionStorage {
		const storage = new MemorySessionStorage();
		writeListedSession(storage, DIR, "personal.jsonl", { id: "personal-id", title: "Personal work" });
		writeListedSession(storage, DIR, "relay.jsonl", {
			id: "relay-id",
			title: "Zeta Bot (Relay)",
			origin: { kind: "im", botSessionId: "relay" },
		});
		writeListedSession(storage, DIR, "bot.jsonl", {
			id: "bot-id",
			title: "Project bot",
			origin: {
				kind: "im",
				channel: "wechat",
				botSessionId: "abc123",
				workspaceAlias: "web",
				agentId: "web-agent",
				bindingId: "binding-wechat-chat-9",
			},
		});
		return storage;
	}

	test("the TUI picker hides IM conversations by default", async () => {
		const listing = await listSessionsForPicker(DIR, seededStorage(), new Set());
		expect(listing.sessions.map(session => session.id)).toEqual(["personal-id"]);
	});

	test("includeIm shows the IM conversations, each with its own location", async () => {
		const listing = await listSessionsForPicker(DIR, seededStorage(), new Set(), [], { includeIm: true });
		const byId = new Map(listing.sessions.map(session => [session.id, session]));
		expect([...byId.keys()].sort()).toEqual(["bot-id", "personal-id", "relay-id"]);
		expect(byId.get("personal-id")?.origin).toBeUndefined();
		// The reserved agent/binding fields survive the header read unchanged.
		expect(byId.get("bot-id")?.origin?.agentId).toBe("web-agent");
		expect(byId.get("bot-id")?.origin?.bindingId).toBe("binding-wechat-chat-9");
		expect(sessionLocationLabel(byId.get("bot-id")!.origin!)).toBe("web");
		expect(sessionLocationLabel(byId.get("relay-id")!.origin!, { defaultWorkspaceLabel: "默认工作区" })).toBe(
			"默认工作区",
		);
	});

	test("filterSessionsForPicker applies the same rule and keeps pinned rows", () => {
		const personal: SessionInfo = {
			path: `${DIR}/personal.jsonl`,
			id: "personal-id",
			cwd: "/repo",
			created: new Date(),
			modified: new Date(),
			messageCount: 2,
			size: 1,
			firstMessage: "hi",
			allMessagesText: "hi",
		};
		const im: SessionInfo = {
			...personal,
			path: `${DIR}/relay.jsonl`,
			id: "relay-id",
			firstMessage: "",
			allMessagesText: "",
			messageCount: 0,
			title: "Zeta Bot (Relay)",
			origin: { kind: "im", botSessionId: "relay" },
		};
		expect(filterSessionsForPicker([personal, im], new Set()).map(s => s.id)).toEqual(["personal-id"]);
		expect(filterSessionsForPicker([personal, im], new Set(), { includeIm: true }).map(s => s.id)).toEqual([
			"personal-id",
			"relay-id",
		]);
		// A pin never re-introduces an IM row into the personal list.
		expect(filterSessionsForPicker([im], new Set(["relay-id"])).map(s => s.id)).toEqual([]);
		expect(filterSessionsForPicker([im], new Set(["relay-id"]), { includeIm: true }).map(s => s.id)).toEqual([
			"relay-id",
		]);
	});
});

describe("resume directory visibility", () => {
	function info(id: string, origin?: SessionOrigin): SessionInfo {
		return {
			path: `/sessions/${id}.jsonl`,
			id,
			cwd: "/repo",
			created: new Date("2026-06-27T00:00:00.000Z"),
			modified: new Date("2026-06-27T00:00:00.000Z"),
			messageCount: 2,
			size: 1,
			firstMessage: "hi",
			allMessagesText: "hi",
			...(origin ? { origin } : {}),
		};
	}

	test("/api/projects excludes IM sessions from project conversation counts", async () => {
		const options = {
			sessions: [info("personal"), info("relay", { kind: "im" as const, botSessionId: "relay" })],
			defaultWorkspace: "/repo",
			resolveProject: (cwd: string) => ({ projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false }),
		};
		const directory = await buildResumeDirectory(options);
		const conversations = directory.projects.flatMap(project =>
			project.workspaces.flatMap(workspace => workspace.conversations),
		);
		expect(conversations.map(row => row.id)).toEqual(["personal"]);

		const withIm = await buildResumeDirectory({ ...options, includeIm: true });
		const all = withIm.projects.flatMap(project => project.workspaces.flatMap(workspace => workspace.conversations));
		expect(all.map(row => row.id).sort()).toEqual(["personal", "relay"]);
	});
});

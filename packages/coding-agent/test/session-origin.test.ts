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
import { groupTeamSessions } from "@linxiraos/zeta/resume/team-groups";
import { buildResumeDirectory } from "@linxiraos/zeta/resume/directory";
import { FileSessionStorage, MemorySessionStorage } from "@linxiraos/zeta/session/session-storage";
import {
	isImSession,
	isTeamSession,
	normalizeSessionOrigin,
	sameSessionOrigin,
	sessionLocationLabel,
	teamLocationLabel,
	type SessionOrigin,
	type TeamSessionOrigin,
} from "@linxiraos/zeta/session/session-origin";
import {
	filterSessionsForPicker,
	listSessionsForPicker,
	resolveResumableSession,
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

const TEAM_ORIGIN: TeamSessionOrigin = {
	kind: "team",
	teamId: "acme",
	pmId: "acme:core",
	engineerId: "acme:core:alice",
	repoId: "acme:api",
	workspaceAlias: "core / alice / api",
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

	test("a Team stamp round-trips, trims fields, and never becomes a path label", () => {
		expect(normalizeSessionOrigin(TEAM_ORIGIN)).toEqual(TEAM_ORIGIN);
		expect(normalizeSessionOrigin({ kind: "team", teamId: " acme ", pmId: "  ", roomId: "room-1" })).toEqual({
			kind: "team",
			teamId: "acme",
			roomId: "room-1",
		});
		expect(isTeamSession(TEAM_ORIGIN)).toBe(true);
		expect(isImSession(TEAM_ORIGIN)).toBe(false);
		expect(teamLocationLabel(TEAM_ORIGIN)).toBe("core / alice / api");
		expect(teamLocationLabel({ kind: "team", teamId: "acme" })).toBe("Team · acme");
		expect(teamLocationLabel({ kind: "team", teamId: "acme" }, { defaultTeamLabel: "团队" })).toBe("团队");
		expect(teamLocationLabel(IM_ORIGIN)).toBeUndefined();
		expect(sessionLocationLabel(TEAM_ORIGIN)).toBeUndefined();
	});

	test("a malformed Team stamp reads as absent instead of hiding the session", () => {
		// Missing identity, wrong schema, and unknown kinds all stay personal.
		expect(normalizeSessionOrigin({ kind: "team" })).toBeUndefined();
		expect(normalizeSessionOrigin({ kind: "team", teamId: "   " })).toBeUndefined();
		expect(normalizeSessionOrigin({ kind: "team", teamId: 42 })).toBeUndefined();
		expect(normalizeSessionOrigin({ kind: "crew", teamId: "acme" })).toBeUndefined();
		expect(normalizeSessionOrigin(null)).toBeUndefined();
		expect(normalizeSessionOrigin("team")).toBeUndefined();
	});

	test("origin equality distinguishes team fields and kinds", () => {
		expect(sameSessionOrigin(TEAM_ORIGIN, { ...TEAM_ORIGIN })).toBe(true);
		expect(sameSessionOrigin(TEAM_ORIGIN, { ...TEAM_ORIGIN, pmId: "acme:growth" })).toBe(false);
		expect(sameSessionOrigin(TEAM_ORIGIN, { ...TEAM_ORIGIN, roomId: "room-1" })).toBe(false);
		expect(sameSessionOrigin(TEAM_ORIGIN, IM_ORIGIN)).toBe(false);
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
		writeListedSession(storage, DIR, "team.jsonl", {
			id: "team-id",
			title: "T-101: fix the parser",
			origin: TEAM_ORIGIN,
		});
		return storage;
	}

	test("the TUI picker hides IM and Team conversations by default", async () => {
		const listing = await listSessionsForPicker(DIR, seededStorage(), new Set());
		expect(listing.sessions.map(session => session.id)).toEqual(["personal-id"]);
	});

	test("includeTeam shows only the personal and Team rows; includeIm keeps its own scope", async () => {
		const teamListing = await listSessionsForPicker(DIR, seededStorage(), new Set(), [], { includeTeam: true });
		expect(teamListing.sessions.map(session => session.id).sort()).toEqual(["personal-id", "team-id"]);
		const imListing = await listSessionsForPicker(DIR, seededStorage(), new Set(), [], { includeIm: true });
		expect(imListing.sessions.map(session => session.id).sort()).toEqual(["bot-id", "personal-id", "relay-id"]);
		const both = await listSessionsForPicker(DIR, seededStorage(), new Set(), [], {
			includeIm: true,
			includeTeam: true,
		});
		expect(both.sessions.map(session => session.id).sort()).toEqual(["bot-id", "personal-id", "relay-id", "team-id"]);
		expect(teamListing.sessions.find(session => session.id === "team-id")?.origin).toEqual(TEAM_ORIGIN);
	});

	test("includeIm shows the IM conversations, each with its own location", async () => {
		const listing = await listSessionsForPicker(DIR, seededStorage(), new Set(), [], { includeIm: true });
		const byId = new Map(listing.sessions.map(session => [session.id, session]));
		expect([...byId.keys()].sort()).toEqual(["bot-id", "personal-id", "relay-id"]);
		expect(byId.get("personal-id")?.origin).toBeUndefined();
		// The reserved agent/binding fields survive the header read unchanged.
		const botOrigin = byId.get("bot-id")!.origin!;
		if (!isImSession(botOrigin)) throw new Error("expected an IM origin");
		expect(botOrigin.agentId).toBe("web-agent");
		expect(botOrigin.bindingId).toBe("binding-wechat-chat-9");
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
		const team: SessionInfo = {
			...personal,
			path: `${DIR}/team.jsonl`,
			id: "team-id",
			origin: TEAM_ORIGIN,
		};
		// A pin never re-introduces a Team row into the personal list either.
		expect(filterSessionsForPicker([team], new Set(["team-id"])).map(s => s.id)).toEqual([]);
		expect(filterSessionsForPicker([team], new Set(["team-id"]), { includeTeam: true }).map(s => s.id)).toEqual([
			"team-id",
		]);
	});

	test("explicit --resume ids bypass the default origin filter", async () => {
		const storage = seededStorage();
		const match = await resolveResumableSession("team-id", "/repo", DIR, storage);
		expect(match?.session.id).toBe("team-id");
		expect(isTeamSession(match?.session.origin)).toBe(true);
		// The same id is hidden from the picker the user is scrolling.
		const listing = await listSessionsForPicker(DIR, storage, new Set());
		expect(listing.sessions.some(session => session.id === "team-id")).toBe(false);
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

	test("resume directory hides Team sessions unless includeTeam is set", async () => {
		const options = {
			sessions: [info("personal"), info("team", TEAM_ORIGIN)],
			defaultWorkspace: "/repo",
			resolveProject: (cwd: string) => ({ projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false }),
		};
		const directory = await buildResumeDirectory(options);
		expect(directory.conversations.map(row => row.id)).toEqual(["personal"]);

		const withTeam = await buildResumeDirectory({ ...options, includeTeam: true });
		expect(withTeam.conversations.map(row => row.id).sort()).toEqual(["personal", "team"]);
	});
});

describe("team grouping", () => {
	function teamInfo(id: string, origin: SessionOrigin, modified: string): SessionInfo {
		return {
			path: `/sessions/${id}.jsonl`,
			id,
			cwd: "/team/worktree",
			created: new Date(modified),
			modified: new Date(modified),
			messageCount: 2,
			size: 1,
			firstMessage: "hi",
			allMessagesText: "hi",
			title: id,
			origin,
		};
	}

	test("groups Team → PM → engineer → repo → conversation with newest first", () => {
		const groups = groupTeamSessions([
			teamInfo("t1", { ...TEAM_ORIGIN, repoId: "acme:api" }, "2026-06-27T00:00:00.000Z"),
			teamInfo(
				"t2",
				{
					kind: "team",
					teamId: "acme",
					pmId: "acme:core",
					engineerId: "acme:core:alice",
					repoId: "acme:web",
				},
				"2026-06-28T00:00:00.000Z",
			),
			teamInfo("t3", { kind: "team", teamId: "beta" }, "2026-06-29T00:00:00.000Z"),
			// Personal and IM rows are not part of this grouping.
			{ ...teamInfo("p", IM_ORIGIN, "2026-06-29T00:00:00.000Z") },
		]);
		expect(groups.map(group => group.teamId)).toEqual(["acme", "beta"]);
		const acme = groups[0]!;
		expect(acme.pms.map(pm => pm.label)).toEqual(["core"]);
		const core = acme.pms[0]!;
		expect(core.engineers.map(engineer => engineer.label)).toEqual(["alice"]);
		const alice = core.engineers[0]!;
		expect(alice.repos.map(repo => repo.label)).toEqual(["api", "web"]);
		expect(alice.repos[0]!.conversations.map(row => row.id)).toEqual(["t1"]);
		expect(groups[1]!.pms[0]!.label).toBe("Unassigned PM");
		expect(groups[1]!.pms[0]!.engineers[0]!.label).toBe("Unassigned engineer");
		expect(groups[1]!.pms[0]!.engineers[0]!.repos[0]!.label).toBe("Unassigned repo");
	});
});

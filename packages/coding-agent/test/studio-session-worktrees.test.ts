import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { TempDir, refreshDirsFromEnv, setWorktreesDir } from "@linxiraos/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings, resetSettingsForTest } from "../src/config/settings";
import { WebConfig } from "../src/config/web-config";
import { SessionStore, setSessionStoreForTest } from "../src/server/auth/session-store";
import type { ClientEvent, CommandInput, CommandName } from "../src/server/studio-host/contract";
import { workspaceIdFor } from "../src/server/studio-host/ops/workspace-id";
import { worktreesOps } from "../src/server/studio-host/ops/worktrees";
import type {
	SessionWorktreeOperation,
	SessionWorktreeResultMap,
} from "../src/server/studio-host/protocol/contracts/session-worktrees";
import { StudioSessionWorktreesService } from "../src/server/studio-host/services/session-worktrees-service";
import { cleanupSessionWorktreesOnShutdown } from "../src/server/studio-host/services/session-worktrees-runtime";
import { StudioOperations } from "../src/server/studio-host/registry";
import { StudioHost } from "../src/server/studio-host/server";
import { AgentSessionWrapper, getRpcSession, sessions } from "../src/server/web-gateway/agents";
import { resetRemoteAccessForTests } from "../src/server/web-gateway/remote-access";
import { AgentSession } from "../src/session/agent-session";
import { AgentStorage } from "../src/session/agent-storage";
import type { AuthStorage } from "../src/session/auth-storage";
import { HistoryStorage } from "../src/session/history-storage";
import { convertToLlm } from "../src/session/messages";
import { closeSessionIndex } from "../src/session/session-index";
import { SessionManager } from "../src/session/session-manager";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";
import { makeAssistantMessage } from "./session-manager/helpers";

type WorktreeKind = SessionWorktreeOperation["kind"] & CommandName;

const origin = "http://127.0.0.1";
let root: TempDir;
let repo: string;
let profile: string;
let auth: AuthStorage;
let session: AgentSession;
let host: StudioHost;
let caller: { cookie: string; csrf: string; key: string };
let events: unknown[];
let previousEnv: Array<[string, string | undefined]>;

function git(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
	return result.stdout.toString().trim();
}

function worktreePaths(directory: string): string[] {
	const normalize = (value: string) =>
		process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
	return git(directory, "worktree", "list", "--porcelain")
		.split("\n")
		.filter(line => line.startsWith("worktree "))
		.map(line => normalize(line.slice("worktree ".length)));
}

function branchSha(directory: string, branch: string): string | null {
	const result = Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
		cwd: directory,
		stdout: "pipe",
	});
	return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

async function exists(target: string): Promise<boolean> {
	return fs.stat(target).then(
		() => true,
		() => false,
	);
}

async function answeredSession(cwd: string): Promise<string> {
	await fs.mkdir(cwd, { recursive: true });
	const manager = SessionManager.create(cwd);
	manager.appendMessage({ role: "user", content: `work in ${path.basename(cwd)}`, timestamp: 1 });
	manager.appendMessage(makeAssistantMessage());
	await manager.flush();
	const id = manager.getSessionId();
	await manager.close();
	return id;
}

function commandRequest(requestId: string, kind: string, input: unknown): Request {
	return new Request(origin + "/api/v1/command", {
		method: "POST",
		headers: {
			origin,
			cookie: caller.cookie,
			"x-studio-csrf": caller.csrf,
			"content-type": "application/json",
		},
		body: JSON.stringify({ commandName: kind, input, requestId, idempotencyKey: requestId }),
	});
}

async function command<K extends WorktreeKind>(
	kind: K,
	input: CommandInput<K>,
): Promise<{ response: Response; receipt: unknown }> {
	const requestId = crypto.randomUUID();
	const response = await host.handle(commandRequest(requestId, kind, input), "127.0.0.1");
	const receipt = events.findLast(event => {
		if (event === null || typeof event !== "object" || !("kind" in event) || event.kind !== "command.receipt") {
			return false;
		}
		const value = "receipt" in event ? event.receipt : undefined;
		return value !== null && typeof value === "object" && "requestId" in value && value.requestId === requestId;
	});
	return {
		response,
		receipt: receipt !== null && typeof receipt === "object" && "receipt" in receipt ? receipt.receipt : undefined,
	};
}

/** The Workbench envelope a completed receipt carries: `{ snapshot, result }`. */
function resultOf(receipt: unknown): unknown {
	if (receipt === null || typeof receipt !== "object" || !("status" in receipt)) {
		throw new Error(`missing command receipt: ${JSON.stringify(receipt)}`);
	}
	if (receipt.status !== "completed") throw new Error(`command failed: ${JSON.stringify(receipt)}`);
	const envelope = "result" in receipt ? receipt.result : undefined;
	if (envelope === null || typeof envelope !== "object" || !("result" in envelope)) {
		throw new Error(`command receipt has no result: ${JSON.stringify(receipt)}`);
	}
	return envelope.result;
}

async function errorMessage(response: Response): Promise<string> {
	const body: unknown = await response.json();
	if (body !== null && typeof body === "object" && "error" in body) {
		const error = body.error;
		if (typeof error === "string") return error;
		if (error !== null && typeof error === "object" && "message" in error && typeof error.message === "string") {
			return error.message;
		}
	}
	return "";
}

function createSession(cwd: string, overrides: Record<string, unknown> = {}): AgentSession {
	const settings = Settings.isolated({
		"compaction.enabled": false,
		"retry.enabled": false,
		"worktree.onStart": "ask",
		"worktree.clone": false,
		"session.worktreeScope": "directory",
		...overrides,
	});
	return new AgentSession({
		agent: new Agent({
			initialState: { model: getBundledModel("anthropic", "claude-sonnet-4-5"), systemPrompt: [], tools: [] },
			convertToLlm,
		}),
		sessionManager: SessionManager.inMemory(cwd),
		settings,
		modelRegistry: new ModelRegistry(auth, root.join("models.yml")),
	});
}

beforeEach(async () => {
	await fs.mkdir(path.resolve(import.meta.dir, "../../../temp"), { recursive: true });
	root = TempDir.createSync(path.resolve(import.meta.dir, "../../../temp/studio-session-worktrees-"));
	repo = root.join("repo");
	profile = root.join("profile");
	previousEnv = ["ZETA_CODING_AGENT_DIR", "ZETA_DEFAULT_WORKSPACE", "ZETA_WORKTREE_DIR"].map(key => [
		key,
		process.env[key],
	]);
	await fs.mkdir(repo);
	await fs.mkdir(profile);
	process.env.ZETA_CODING_AGENT_DIR = profile;
	process.env.ZETA_DEFAULT_WORKSPACE = repo;
	delete process.env.ZETA_WORKTREE_DIR;
	setWorktreesDir(root.join("wt-base"));
	refreshDirsFromEnv();
	resetSettingsForTest();
	WebConfig.resetShared();
	resetRemoteAccessForTests();
	setSessionStoreForTest(new SessionStore(root.join("cookies.json")));
	auth = createInMemoryAuthStorage();
	git(repo, "init", "-q", "-b", "main");
	git(repo, "config", "core.autocrlf", "false");
	await Bun.write(path.join(repo, "tracked.txt"), "base\n");
	git(repo, "add", ".");
	git(repo, "commit", "-q", "-m", "init");
	session = createSession(repo);
	sessions.set(session.sessionId, new AgentSessionWrapper(session, session.sessionId, null));
	host = new StudioHost(new StudioOperations([worktreesOps]));
	const bootstrap = await host.handle(new Request(origin + "/api/v1/bootstrap", { headers: { origin } }), "127.0.0.1");
	const cookie = bootstrap.headers.get("set-cookie")!.split(";")[0]!;
	const csrf = bootstrap.headers.get("x-studio-csrf")!;
	const key = cookie.slice("studio_session=".length);
	events = [];
	host.attachSocket(key, { send: value => events.push(JSON.parse(value) as ClientEvent), close() {} });
	caller = { cookie, csrf, key };
});

afterEach(async () => {
	host.dropDeviceSessions("local");
	sessions.delete(session.sessionId);
	await session.dispose();
	auth.close();
	setSessionStoreForTest(undefined);
	AgentStorage.close();
	HistoryStorage.close();
	closeSessionIndex();
	setWorktreesDir(undefined);
	for (const [key, value] of previousEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	refreshDirsFromEnv();
	resetSettingsForTest();
	WebConfig.resetShared();
	resetRemoteAccessForTests();
	await root.remove();
});

test("start policy asks once and continueHere settles the first-turn decision", async () => {
	const policy = resultOf(
		(await command("worktrees.session.startPolicy", { sessionId: session.sessionId })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.startPolicy"];
	expect(policy).toEqual({ eligible: true, policy: "ask" });

	const continued = resultOf(
		(await command("worktrees.session.continueHere", { sessionId: session.sessionId })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.continueHere"];
	expect(continued).toEqual({ continued: true });

	const settled = resultOf(
		(await command("worktrees.session.startPolicy", { sessionId: session.sessionId })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.startPolicy"];
	expect(settled.eligible).toBe(false);
	expect(settled.policy).toBe("ask");
	expect(settled.reason).toBeTruthy();

	const malformed = await command("worktrees.session.startPolicy", {
		sessionId: session.sessionId,
		unexpected: true,
	} as unknown as CommandInput<"worktrees.session.startPolicy">);
	expect(malformed.response.status).toBe(400);
	expect(await errorMessage(malformed.response)).toContain("Unknown worktree field");
});

test("create, inspect, list, open and registry persistence use real git", async () => {
	const created = resultOf(
		(
			await command("worktrees.session.create", {
				sessionId: session.sessionId,
				branch: "wt/studio-create",
				keepChanges: false,
				freshOnly: true,
			})
		).receipt,
	) as SessionWorktreeResultMap["worktrees.session.create"];
	expect(created.workspaceId).toBe(workspaceIdFor(created.cwd!));
	expect(created.worktree.branch).toBe("wt/studio-create");
	expect(created.worktree.dirty).toBe(false);
	expect(created.worktree.hasCommits).toBe(false);
	expect(created.worktree.detached).toBe(false);
	expect(created.worktree.missing).toBe(false);
	expect(created.worktree.current).toBe(false);
	expect(await exists(created.cwd!)).toBe(true);
	expect(worktreePaths(repo)).toContain(
		process.platform === "win32" ? path.resolve(created.cwd!).toLowerCase() : path.resolve(created.cwd!),
	);

	// The registry is disk state, not a second return of `git worktrees.list`.
	const registryFiles = (await fs.readdir(path.join(profile, "studio", "worktrees"))).filter(name =>
		name.endsWith(".json"),
	);
	expect(registryFiles).toHaveLength(1);

	const listed = resultOf(
		(await command("worktrees.session.list", { sessionId: session.sessionId })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.list"];
	expect(listed.truncated).toBe(false);
	expect(listed.worktrees.map(row => row.id)).toContain(created.worktree.id);

	const opened = resultOf(
		(await command("worktrees.session.open", { sessionId: session.sessionId, id: created.worktree.id })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.open"];
	expect(opened.cwd).toBe(created.cwd!);
	expect(opened.workspaceId).toBe(created.workspaceId!);

	// Native inspection sees uncommitted work and then commits.
	await Bun.write(path.join(created.cwd!, "dirty.txt"), "dirty\n");
	const dirty = resultOf(
		(await command("worktrees.session.list", { sessionId: session.sessionId })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.list"];
	expect(dirty.worktrees.find(row => row.id === created.worktree.id)?.dirty).toBe(true);
	await fs.rm(path.join(created.cwd!, "dirty.txt"));
	await Bun.write(path.join(created.cwd!, "committed.txt"), "committed\n");
	git(created.cwd!, "add", ".");
	git(created.cwd!, "commit", "-q", "-m", "worktree commit");
	const moved = resultOf(
		(await command("worktrees.session.list", { sessionId: session.sessionId })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.list"];
	expect(moved.worktrees.find(row => row.id === created.worktree.id)?.hasCommits).toBe(true);

	// A new service instance (runtime restart) reads the same registry.
	const restarted = new StudioSessionWorktreesService(session, () => !session.isDisposed);
	const persisted = (await restarted.execute({
		kind: "worktrees.session.list",
		sessionId: session.sessionId,
	})) as SessionWorktreeResultMap["worktrees.session.list"];
	expect(persisted.worktrees.map(row => row.id)).toEqual([created.worktree.id]);

	// The fresh-only create settled the decision and a prompt now requires it.
	const settled = resultOf(
		(await command("worktrees.session.startPolicy", { sessionId: session.sessionId })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.startPolicy"];
	expect(settled.eligible).toBe(false);
}, 30_000);

test("resume listing and preparation stay inside the selected scope", async () => {
	const localId = await answeredSession(repo);
	const foreignId = await answeredSession(root.join("foreign"));

	const listed = resultOf(
		(await command("worktrees.session.resume.list", { sessionId: session.sessionId })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.resume.list"];
	expect(listed.scope).toBe("directory");
	expect(listed.truncated).toBe(false);
	expect(listed.sessions.map(row => row.sessionId)).toContain(localId);
	expect(listed.sessions.map(row => row.sessionId)).not.toContain(foreignId);
	const row = listed.sessions.find(candidate => candidate.sessionId === localId)!;
	expect(row.title.length).toBeGreaterThan(0);
	expect(Number.isNaN(Date.parse(row.modifiedAt))).toBe(false);
	expect(row.currentDirectory).toBe(true);

	const prepared = resultOf(
		(
			await command("worktrees.session.resume.prepare", {
				sessionId: session.sessionId,
				targetSessionId: localId,
				scope: "directory",
			})
		).receipt,
	) as SessionWorktreeResultMap["worktrees.session.resume.prepare"];
	expect(prepared.requestedSessionId).toBe(localId);
	expect(prepared.targetSessionId).toBe(localId);
	expect(prepared.workspaceId).toBe(workspaceIdFor(repo));
	expect(path.resolve(prepared.cwd!)).toBe(path.resolve(repo));

	const foreign = await command("worktrees.session.resume.prepare", {
		sessionId: session.sessionId,
		targetSessionId: foreignId,
		scope: "directory",
	});
	expect(foreign.response.status).toBe(400);
	expect(await errorMessage(foreign.response)).toContain("outside the selected resume scope");
});

test("removal requires the prepared token, settles the preview and keeps committed branches", async () => {
	const created = resultOf(
		(
			await command("worktrees.session.create", {
				sessionId: session.sessionId,
				branch: "wt/studio-remove",
				keepChanges: false,
			})
		).receipt,
	) as SessionWorktreeResultMap["worktrees.session.create"];
	const id = created.worktree.id;
	const directory = created.cwd!;

	// Dirty worktrees cannot even be previewed.
	await Bun.write(path.join(directory, "dirty.txt"), "dirty\n");
	const dirty = await command("worktrees.session.remove.prepare", { sessionId: session.sessionId, id });
	expect(dirty.response.status).toBe(400);
	expect(await errorMessage(dirty.response)).toContain("Switch away and save all worktree changes");
	await fs.rm(path.join(directory, "dirty.txt"));

	// A wrong token consumes the preview and the worktree stays.
	const first = resultOf(
		(await command("worktrees.session.remove.prepare", { sessionId: session.sessionId, id })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.remove.prepare"];
	expect(first.keepBranch).toBe(false);
	const wrong = await command("worktrees.session.remove.apply", {
		sessionId: session.sessionId,
		token: crypto.randomUUID(),
	});
	expect(wrong.response.status).toBe(400);
	expect(await errorMessage(wrong.response)).toContain("preview expired");
	expect(await exists(directory)).toBe(true);

	// The preview's plan is settled by the native fingerprint: a late change keeps the worktree.
	const second = resultOf(
		(await command("worktrees.session.remove.prepare", { sessionId: session.sessionId, id })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.remove.prepare"];
	await Bun.write(path.join(directory, "late.txt"), "late\n");
	const kept = resultOf(
		(
			await command("worktrees.session.remove.apply", {
				sessionId: session.sessionId,
				token: second.token,
			})
		).receipt,
	) as SessionWorktreeResultMap["worktrees.session.remove.apply"];
	expect(kept.removed).toBe(false);
	expect(kept.messages.join(" ")).toContain("changed");
	expect(await exists(directory)).toBe(true);
	await fs.rm(path.join(directory, "late.txt"));

	// A token issued by another service instance is not accepted.
	const third = resultOf(
		(await command("worktrees.session.remove.prepare", { sessionId: session.sessionId, id })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.remove.prepare"];
	const foreignService = new StudioSessionWorktreesService(session, () => !session.isDisposed);
	await expect(
		foreignService.execute({
			kind: "worktrees.session.remove.apply",
			sessionId: session.sessionId,
			token: third.token,
		}),
	).rejects.toThrow("preview expired");

	// The preparing service still holds the exact token.
	const removed = resultOf(
		(
			await command("worktrees.session.remove.apply", {
				sessionId: session.sessionId,
				token: third.token,
			})
		).receipt,
	) as SessionWorktreeResultMap["worktrees.session.remove.apply"];
	expect(removed.removed).toBe(true);
	expect(await exists(directory)).toBe(false);
	expect(worktreePaths(repo)).not.toContain(
		process.platform === "win32" ? path.resolve(directory).toLowerCase() : path.resolve(directory),
	);
	expect(branchSha(repo, "wt/studio-remove")).toBeNull();
	const empty = resultOf(
		(await command("worktrees.session.list", { sessionId: session.sessionId })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.list"];
	expect(empty.worktrees).toEqual([]);

	// A branch with commits is retained when its clean worktree is removed.
	const committed = resultOf(
		(
			await command("worktrees.session.create", {
				sessionId: session.sessionId,
				branch: "wt/studio-keep",
				keepChanges: false,
			})
		).receipt,
	) as SessionWorktreeResultMap["worktrees.session.create"];
	await Bun.write(path.join(committed.cwd!, "keep.txt"), "keep\n");
	git(committed.cwd!, "add", ".");
	git(committed.cwd!, "commit", "-q", "-m", "keep branch");
	const tip = git(committed.cwd!, "rev-parse", "HEAD");
	const preview = resultOf(
		(
			await command("worktrees.session.remove.prepare", {
				sessionId: session.sessionId,
				id: committed.worktree.id,
			})
		).receipt,
	) as SessionWorktreeResultMap["worktrees.session.remove.prepare"];
	expect(preview.keepBranch).toBe(true);
	const final = resultOf(
		(
			await command("worktrees.session.remove.apply", {
				sessionId: session.sessionId,
				token: preview.token,
			})
		).receipt,
	) as SessionWorktreeResultMap["worktrees.session.remove.apply"];
	expect(final.removed).toBe(true);
	expect(branchSha(repo, "wt/studio-keep")).toBe(tip);
}, 30_000);

test("late dirty state cannot become an approved removal preview", async () => {
	const service = new StudioSessionWorktreesService(session, () => !session.isDisposed);
	const created = (await service.execute({
		kind: "worktrees.session.create",
		sessionId: session.sessionId,
		branch: "wt/late-dirty",
	})) as SessionWorktreeResultMap["worktrees.session.create"];
	const original = SessionManager.list;
	const listing = spyOn(SessionManager, "list").mockImplementation(async (...args) => {
		await Bun.write(path.join(created.cwd!, "late.txt"), "unsaved\n");
		return original.apply(SessionManager, args);
	});
	try {
		await expect(
			service.execute({
				kind: "worktrees.session.remove.prepare",
				sessionId: session.sessionId,
				id: created.worktree.id,
			}),
		).rejects.toThrow("Switch away and save all worktree changes");
		expect(await Bun.file(path.join(created.cwd!, "late.txt")).text()).toBe("unsaved\n");
		expect(branchSha(repo, "wt/late-dirty")).not.toBeNull();
	} finally {
		listing.mockRestore();
	}
});

test("a view revoked during removal leases cannot remove its worktree", async () => {
	const service = new StudioSessionWorktreesService(session, () => !session.isDisposed);
	const created = (await service.execute({
		kind: "worktrees.session.create",
		sessionId: session.sessionId,
		branch: "wt/revoked-remove",
	})) as SessionWorktreeResultMap["worktrees.session.create"];
	const preview = (await service.execute({
		kind: "worktrees.session.remove.prepare",
		sessionId: session.sessionId,
		id: created.worktree.id,
	})) as SessionWorktreeResultMap["worktrees.session.remove.prepare"];
	let live = true;
	const original = SessionManager.list;
	const listing = spyOn(SessionManager, "list").mockImplementation(async (...args) => {
		const result = await original.apply(SessionManager, args);
		live = false;
		return result;
	});
	try {
		await expect(
			service.execute(
				{ kind: "worktrees.session.remove.apply", sessionId: session.sessionId, token: preview.token },
				() => {
					if (!live) throw Error("view revoked");
				},
			),
		).rejects.toThrow("view revoked");
		expect(await exists(created.cwd!)).toBe(true);
		expect(branchSha(repo, "wt/revoked-remove")).not.toBeNull();
	} finally {
		listing.mockRestore();
	}
});

test("session binding is resident-only and onExit cleanup plans natively", async () => {
	// A saved session that the gateway has not started is not attachable here.
	const transientId = await answeredSession(repo);
	const denied = await command("worktrees.session.startPolicy", { sessionId: transientId });
	const deniedStatus =
		denied.receipt !== null && typeof denied.receipt === "object" && "status" in denied.receipt
			? denied.receipt.status
			: undefined;
	expect(deniedStatus).toBe("failed");
	expect(getRpcSession(transientId)).toBeUndefined();

	const created = resultOf(
		(
			await command("worktrees.session.create", {
				sessionId: session.sessionId,
				branch: "wt/studio-exit",
				keepChanges: false,
			})
		).receipt,
	) as SessionWorktreeResultMap["worktrees.session.create"];
	const directory = created.cwd!;
	await Bun.write(path.join(directory, "dirty.txt"), "dirty\n");

	// `ask` without a confirmation channel keeps the dirty worktree.
	const asking = createSession(directory, { "worktree.onExit": "ask" });
	const kept = await cleanupSessionWorktreesOnShutdown([asking]);
	expect(kept.join(" ")).not.toContain("Removed worktree");
	expect(await exists(directory)).toBe(true);
	const before = resultOf(
		(await command("worktrees.session.list", { sessionId: session.sessionId })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.list"];
	expect(before.worktrees.map(row => row.id)).toContain(created.worktree.id);
	await asking.dispose();

	// `remove` with the interactive confirmation removes the dirty tree and its branch.
	const removing = createSession(directory, { "worktree.onExit": "remove" });
	const removed = await cleanupSessionWorktreesOnShutdown([removing], async () => true);
	expect(removed.join(" ")).not.toContain("Kept worktree");
	expect(await exists(directory)).toBe(false);
	expect(branchSha(repo, "wt/studio-exit")).toBeNull();
	const after = resultOf(
		(await command("worktrees.session.list", { sessionId: session.sessionId })).receipt,
	) as SessionWorktreeResultMap["worktrees.session.list"];
	expect(after.worktrees).toEqual([]);
	await removing.dispose();
});

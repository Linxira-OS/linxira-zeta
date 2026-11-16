/**
 * Studio operations — `worktrees.session.*`.
 *
 * Nine operations, exactly the official Studio set: resume listing/prepare,
 * managed listing, start policy, the "stay here" decision, create, open, and
 * two-step removal. Handlers validate every untrusted field, bind the named
 * session to the live runtime (see `session-worktrees-runtime`), then delegate
 * to `StudioSessionWorktreesService`; no handler pretends that
 * `git.worktrees.list` answers a session-owned question.
 *
 * `create` / `open` / `resume.prepare` name a directory the renderer must be
 * able to open. The host returns an opaque workspace id and registers the
 * directory through the gateway's own `PUT /api/projects` route, because the
 * renderer's `workspace.open` resolves ids from that inventory; the switch to
 * the new session stays on the existing `workspace.open` + `session.create` /
 * `session.resume` routes.
 */
import type { CommandResult } from "../contract/index.js";
import { callGateway, invalid, unavailable } from "../gateway.js";
import type { OperatorStateSnapshot } from "../protocol/contracts/state.js";
import type { SessionWorktreeOperation } from "../protocol/contracts/session-worktrees.js";
import type { StudioFamily, StudioHostContext } from "../registry.js";
import { sessionWorktreesRuntime } from "../services/session-worktrees-runtime.js";
import { snapshotFor } from "./session.js";
import { workspaceIdFor } from "./workspace-id.js";

type Kind = SessionWorktreeOperation["kind"];

/** Same bounds the official contract validation applies, minus the file. */
function text(value: unknown, field: string, max: number): string {
	if (typeof value !== "string" || value === "" || value.length > max || /[\u0000-\u001f]/u.test(value)) {
		throw invalid(`Invalid ${field}`);
	}
	return value;
}

function flag(value: unknown, field: string): boolean | undefined {
	if (value !== undefined && typeof value !== "boolean") throw invalid(`Invalid ${field}`);
	return value;
}

function rejectUnknown(input: Record<string, unknown>, keys: readonly string[]): void {
	for (const key of Object.keys(input)) {
		if (!keys.includes(key)) throw invalid(`Unknown worktree field: ${key}`);
	}
}

/** Identity is a UUID for managed rows and one-time removal tokens. */
function identity(value: unknown, field: string): string {
	const result = text(value, field, 36);
	if (!/^[a-f0-9-]{36}$/u.test(result)) throw invalid(`Invalid ${field}`);
	return result;
}

function resumeScope(value: unknown): "directory" | "repo" | undefined {
	if (value === undefined || value === "directory" || value === "repo") return value;
	throw invalid("Invalid resume scope");
}

/** Narrow one untrusted command payload into the contract operation. */
function parseOperation(kind: Kind, raw: unknown): SessionWorktreeOperation {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid("Invalid worktree input");
	const input = raw as Record<string, unknown>;
	const sessionId = text(input.sessionId, "worktree session", 128);
	if (kind === "worktrees.session.resume.list") {
		rejectUnknown(input, ["sessionId", "scope"]);
		const scope = resumeScope(input.scope);
		return { kind, sessionId, ...(scope ? { scope } : {}) } as SessionWorktreeOperation;
	}
	if (kind === "worktrees.session.resume.prepare") {
		rejectUnknown(input, ["sessionId", "targetSessionId", "scope"]);
		const targetSessionId = text(input.targetSessionId, "resume session", 128);
		const scope = resumeScope(input.scope);
		return { kind, sessionId, targetSessionId, ...(scope ? { scope } : {}) } as SessionWorktreeOperation;
	}
	if (kind === "worktrees.session.create") {
		rejectUnknown(input, ["sessionId", "branch", "keepChanges", "freshOnly"]);
		let branch: string | undefined;
		if (input.branch !== undefined) {
			branch = text(input.branch, "branch name", 150);
			if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch)) throw invalid("Invalid branch name");
		}
		const keepChanges = flag(input.keepChanges, "keepChanges");
		const freshOnly = flag(input.freshOnly, "freshOnly");
		return {
			kind,
			sessionId,
			...(branch === undefined ? {} : { branch }),
			...(keepChanges === undefined ? {} : { keepChanges }),
			...(freshOnly === undefined ? {} : { freshOnly }),
		} as SessionWorktreeOperation;
	}
	if (kind === "worktrees.session.open" || kind === "worktrees.session.remove.prepare") {
		rejectUnknown(input, ["sessionId", "id"]);
		const id = identity(input.id, "worktree id");
		return { kind, sessionId, id } as SessionWorktreeOperation;
	}
	if (kind === "worktrees.session.remove.apply") {
		rejectUnknown(input, ["sessionId", "token"]);
		const token = identity(input.token, "removal token");
		return { kind, sessionId, token } as SessionWorktreeOperation;
	}
	rejectUnknown(input, ["sessionId"]);
	return { kind, sessionId } as SessionWorktreeOperation;
}

/**
 * Register the directory a worktree result names and return its opaque id.
 * The gateway's project route is the same one `workspace.open` uses, so the
 * follow-up `session.create` / `session.resume` resolves the id immediately.
 */
async function worktreeWorkspace(result: unknown): Promise<Record<string, unknown>> {
	const input = result !== null && typeof result === "object" && !Array.isArray(result) ? result : undefined;
	const cwd = input && "cwd" in input ? input.cwd : undefined;
	if (typeof cwd !== "string" || cwd === "") throw unavailable("Worktree workspace is unavailable");
	const reply = await callGateway("/api/projects", { method: "PUT", body: { path: cwd } });
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`cannot register worktree workspace: PUT /api/projects → ${reply.status}`);
	}
	return { ...(input ?? {}), workspaceId: workspaceIdFor(cwd), cwd };
}

async function execute<K extends Kind>(kind: K, raw: unknown, context: StudioHostContext): Promise<CommandResult<K>> {
	const operation = parseOperation(kind, raw);
	const runtime = await sessionWorktreesRuntime(operation.sessionId, context);
	const native = await runtime.service.execute(operation, runtime.assertCurrent);
	runtime.assertCurrent();
	let result: unknown = native;
	if (
		kind === "worktrees.session.create" ||
		kind === "worktrees.session.open" ||
		kind === "worktrees.session.resume.prepare"
	) {
		runtime.assertCurrent();
		result = await worktreeWorkspace(native);
		runtime.assertCurrent();
	}
	runtime.assertCurrent();
	const snapshot: OperatorStateSnapshot = await snapshotFor(operation.sessionId);
	runtime.assertCurrent();
	return { snapshot, result } as unknown as CommandResult<K>;
}

export const worktreesOps: StudioFamily = {
	id: "worktrees",
	commands: {
		"worktrees.session.resume.list": (input, context) => execute("worktrees.session.resume.list", input, context),
		"worktrees.session.resume.prepare": (input, context) =>
			execute("worktrees.session.resume.prepare", input, context),
		"worktrees.session.list": (input, context) => execute("worktrees.session.list", input, context),
		"worktrees.session.startPolicy": (input, context) => execute("worktrees.session.startPolicy", input, context),
		"worktrees.session.continueHere": (input, context) => execute("worktrees.session.continueHere", input, context),
		"worktrees.session.create": (input, context) => execute("worktrees.session.create", input, context),
		"worktrees.session.open": (input, context) => execute("worktrees.session.open", input, context),
		"worktrees.session.remove.prepare": (input, context) =>
			execute("worktrees.session.remove.prepare", input, context),
		"worktrees.session.remove.apply": (input, context) => execute("worktrees.session.remove.apply", input, context),
	},
};

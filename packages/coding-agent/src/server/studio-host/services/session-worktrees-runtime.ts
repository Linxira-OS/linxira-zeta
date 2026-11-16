/**
 * Live-session resolver for the Studio session-worktree operations.
 *
 * The caller names the session it drives; this module proves that exact
 * session is already resident (never starts one, never starts a second
 * manager, never substitutes the coordinator session) and keeps one worktree
 * service per AgentSession. The authenticated view is re-checked on both sides
 * of every await, including before each gateway-backed result step, so a
 * closed/replaced conversation cannot finish a worktree mutation.
 */
import * as path from "node:path";
import type { AgentSession } from "../../../session/agent-session";
import { getRpcSession } from "../../web-gateway/agents";
import { invalid, unavailable } from "../errors";
import { workspaceIdFor } from "../ops/workspace-id";
import type { StudioHostContext } from "../registry";
import { currentStudioSelection } from "../selection";
import { StudioSessionWorktreesService } from "./session-worktrees-service";

const residents = new WeakMap<AgentSession, { sessionId: string; service: StudioSessionWorktreesService }>();

/** Native identity only; per-request view liveness belongs to the resolver. */
function serviceFor(session: AgentSession): StudioSessionWorktreesService {
	const sessionId = session.sessionId;
	const current = residents.get(session);
	if (current?.sessionId === sessionId) return current.service;
	const isLive = () =>
		!session.isDisposed && session.sessionId === sessionId && getRpcSession(sessionId)?.getSession() === session;
	const service = new StudioSessionWorktreesService(session, isLive);
	residents.set(session, { sessionId, service });
	return service;
}

export interface SessionWorktreesRuntime {
	readonly service: StudioSessionWorktreesService;
	assertCurrent(): void;
}

/** Bind one named resident session and return its worktree authority. */
export async function sessionWorktreesRuntime(
	sessionId: string,
	context: StudioHostContext,
): Promise<SessionWorktreesRuntime> {
	if (sessionId.length > 512 || sessionId.includes("\0")) throw invalid("Invalid worktree session");
	const owner = context.privateOwner;
	const selection = currentStudioSelection();
	const live = () =>
		!!owner &&
		owner.isLive() &&
		owner.expiresAt > Date.now() &&
		selection === context.selection &&
		!selection?.closed &&
		(selection === undefined || selection.sessionId === sessionId);
	if (!owner || !live()) throw unavailable("Worktree operations require a live authenticated view");
	// Resident only: the named session must already be live in this process.
	const session = getRpcSession(sessionId)?.getSession();
	if (!session || session.isDisposed || !live()) throw unavailable("Worktree session is not resident");
	const workspaceId = workspaceIdFor(session.sessionManager.getCwd());
	const valid = () =>
		live() &&
		!session.isDisposed &&
		session.sessionId === sessionId &&
		getRpcSession(sessionId)?.getSession() === session &&
		(selection === undefined || selection.workspaceId === workspaceId);
	if (!valid()) throw unavailable("Worktree session changed while attaching");
	return {
		service: serviceFor(session),
		assertCurrent() {
			if (!valid()) throw unavailable("Worktree view changed");
		},
	};
}

/**
 * The official first-prompt gate. Main must compose this into the one
 * `setBeforeNextUserTurn` hook (currently owned by `attachStudioTimeTravel`)
 * so a fresh checkout cannot run a turn before it chose its worktree:
 *
 * ```ts
 * session.setBeforeNextUserTurn(async () => {
 * 	await assertSessionWorktreeStartResolved(session);
 * 	await boundary.capture("before");
 * });
 * ```
 */
export async function assertSessionWorktreeStartResolved(session: AgentSession): Promise<void> {
	if (session.isDisposed) throw unavailable("Worktree session changed");
	await serviceFor(session).ensureStartResolved();
}

/**
 * Official `worktree.onExit` cleanup for a shutdown pass.
 *
 * Call this once from the serve shutdown path, after work has been quiesced
 * and before resident sessions are disposed (the native planning reads each
 * session's cwd). Every provided session is treated as exiting, so their own
 * residency does not block leases; any other live session in the same
 * worktree still does. Sessions sharing a cwd are de-duplicated (main and its
 * subagents live in the same tree). Failures are returned as kept messages,
 * never thrown, so one bad worktree cannot abort the shutdown.
 */
export async function cleanupSessionWorktreesOnShutdown(
	sessions: readonly AgentSession[],
	confirm?: (title: string, message: string) => Promise<boolean>,
): Promise<string[]> {
	const live = sessions.filter(session => !session.isDisposed);
	if (live.length === 0) return [];
	const ignoring = new Set(live);
	const byCwd = new Map<string, AgentSession>();
	for (const session of live) {
		const cwd = session.sessionManager.getCwd();
		const key = path.resolve(process.platform === "win32" ? cwd.toLowerCase() : cwd);
		if (!byCwd.has(key)) byCwd.set(key, session);
	}
	const messages: string[] = [];
	for (const session of byCwd.values()) {
		try {
			messages.push(...(await serviceFor(session).cleanupOnShutdown({ confirm, ignoring })));
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			messages.push(`Kept worktrees for ${session.sessionManager.getCwd()}: ${detail}`);
		}
	}
	return messages;
}

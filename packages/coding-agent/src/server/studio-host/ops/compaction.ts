/**
 * Studio operations — conversation compaction and the typed native queue.
 *
 * The threshold is the durable `studio.compaction-threshold` entry read by
 * native session maintenance and context usage, so these commands change real
 * execution policy rather than a renderer preview. Queue operations address
 * prepared native message objects by stable identity and include a queued
 * compaction request at its actual yield boundary.
 *
 * `session.compaction.read` is exported as {@link readSessionCompaction} for the
 * central query map: the live query is answered above; a persisted history
 * session is read from its own file without inventing a Runtime session.
 */
import { findSessionFiles } from "../../../session/session-listing.js";
import { SessionManager } from "../../../session/session-manager.js";
import type { AgentSession } from "../../../session/agent-session.js";
import { getRpcSession } from "../../web-gateway/agents.js";
import { invalid, requiredString, unavailable } from "../gateway.js";
import type { StudioHostContext, StudioFamily } from "../registry.js";
import { currentStudioSelection } from "../selection.js";
import type { SessionCompactionRead, SessionCompactionState } from "../protocol/contracts/session-compaction.js";
import type { OperatorStateSnapshot } from "../protocol/contracts/state.js";
import { StudioSessionCompactionService } from "../services/session-compaction-service.js";
import { runtimeQueueForSession } from "../services/runtime-queue-service.js";
import { runtimeViewForSession } from "../services/runtime-view-service.js";
import { sessionWorkspaceId, snapshotFor } from "./session.js";

const MAX_SESSION_ID = 512;

function sessionIdOf(input: unknown): string {
	const sessionId = requiredString(input, "sessionId");
	if (sessionId.length > MAX_SESSION_ID || sessionId.includes("\0")) throw invalid("Invalid session id");
	return sessionId;
}

type StudioOwner = NonNullable<StudioHostContext["privateOwner"]>;
type StudioSelection = NonNullable<StudioHostContext["selection"]>;

/** A browser view is live only while its socket, credential window and context still agree. */
function assertViewLive(selection: StudioSelection | undefined, owner: StudioOwner): void {
	if (!owner.isLive() || owner.expiresAt <= Date.now() || selection?.closed)
		throw unavailable("The conversation view is not live");
}

/**
 * Synchronous mutation gate. It re-reads owner liveness, the selected session
 * and the exact native session object, so a transition during any await cannot
 * let a queued operation land in another conversation.
 */
function assertMutationContext(
	owner: StudioOwner,
	selection: StudioSelection,
	sessionId: string,
	expected?: AgentSession,
): AgentSession {
	assertViewLive(selection, owner);
	if (selection.sessionId !== sessionId) throw unavailable("The queue belongs to another session");
	const session = getRpcSession(sessionId)?.getSession();
	if (!session || session.isDisposed || session.sessionId !== sessionId)
		throw unavailable(`Session ${sessionId} is not live`);
	if (expected !== undefined && session !== expected) throw unavailable("The session changed");
	return session;
}

async function mutationView(
	input: unknown,
	context: StudioHostContext,
): Promise<{ sessionId: string; session: AgentSession; assertLive: () => void }> {
	const sessionId = sessionIdOf(input);
	const owner = context.privateOwner;
	const selection = context.selection;
	if (!owner) throw unavailable("The conversation requires a live authenticated view");
	if (!selection) throw unavailable("The conversation context is not selected");
	let session = assertMutationContext(owner, selection, sessionId);
	const workspaceId = await sessionWorkspaceId(sessionId);
	session = assertMutationContext(owner, selection, sessionId, session);
	if (workspaceId !== selection.workspaceId) throw unavailable("The session does not belong to this workspace");
	return {
		sessionId,
		session,
		assertLive: () => {
			assertMutationContext(owner, selection, sessionId, session);
		},
	};
}

/** Read a persisted conversation's threshold through its own transcript file. */
export async function readSessionCompaction(
	input: unknown,
	context: StudioHostContext,
): Promise<SessionCompactionRead> {
	const sessionId = sessionIdOf(input);
	const owner = context.privateOwner;
	if (!owner) throw unavailable("The conversation requires a live authenticated view");
	const selection = context.selection ?? currentStudioSelection();
	assertViewLive(selection, owner);
	const live = getRpcSession(sessionId)?.getSession();
	if (live && !live.isDisposed && live.sessionId === sessionId) {
		const state = new StudioSessionCompactionService(live).get();
		assertViewLive(selection, owner);
		return { sessionId, threshold: state.threshold };
	}
	if (selection !== undefined) {
		const workspaceId = await sessionWorkspaceId(sessionId);
		assertViewLive(selection, owner);
		if (workspaceId !== selection.workspaceId) throw unavailable("The session does not belong to this workspace");
	}
	const files = await findSessionFiles(sessionId);
	assertViewLive(selection, owner);
	for (const file of files) {
		const manager = await SessionManager.open(file, undefined, undefined, {
			throwIfMissing: true,
			suppressBreadcrumb: true,
		});
		assertViewLive(selection, owner);
		try {
			if (manager.getSessionId() !== sessionId) continue;
			const threshold = StudioSessionCompactionService.read(manager).threshold;
			assertViewLive(selection, owner);
			return { sessionId, threshold };
		} finally {
			await manager.close();
			assertViewLive(selection, owner);
		}
	}
	throw unavailable(`Session ${sessionId} was not found`);
}

/** Run one command against the live session and publish the shared state snapshot with its result. */
async function liveCommand<T>(
	input: unknown,
	context: StudioHostContext,
	run: (session: AgentSession, assertCurrent: () => void) => T | Promise<T>,
): Promise<{ snapshot: OperatorStateSnapshot; result: T }> {
	const view = await mutationView(input, context);
	view.assertLive();
	const result = await run(view.session, view.assertLive);
	view.assertLive();
	const snapshot = await snapshotFor(view.sessionId);
	view.assertLive();
	return { snapshot, result };
}

/**
 * Threshold commands are registered by the settings family once its central
 * protocol lists the official `session.compaction.get|set` kinds. Keeping the
 * implementations here makes the native policy the only owner; the central
 * contract remains the integration owner.
 */
export const sessionCompactionCommands = {
	"session.compaction.get": (
		input: { sessionId: string },
		context: StudioHostContext,
	): Promise<{ snapshot: OperatorStateSnapshot; result: SessionCompactionState }> =>
		liveCommand(input, context, session => new StudioSessionCompactionService(session).get()),
	"session.compaction.set": (
		input: { sessionId: string; input: string },
		context: StudioHostContext,
	): Promise<{ snapshot: OperatorStateSnapshot; result: SessionCompactionState }> =>
		liveCommand(input, context, session => new StudioSessionCompactionService(session).set(input.input)),
};

export const compactionOps: StudioFamily = {
	id: "compaction",
	commands: {
		"session.compaction.enqueue": (input, context) =>
			liveCommand(input, context, session =>
				runtimeQueueForSession(session).execute({
					kind: "session.compaction.enqueue",
					sessionId: input.sessionId,
					...(input.instructions === undefined ? {} : { instructions: input.instructions }),
				}),
			),
		"session.compaction.cancel": (input, context) =>
			liveCommand(input, context, session =>
				runtimeQueueForSession(session).execute({
					kind: "session.compaction.cancel",
					sessionId: input.sessionId,
					...(input.id === undefined ? {} : { id: input.id }),
				}),
			),
		"session.compaction.status": (input, context) =>
			liveCommand(input, context, session =>
				runtimeQueueForSession(session).execute({
					kind: "session.compaction.status",
					sessionId: input.sessionId,
				}),
			),
		"session.queue.get": (input, context) =>
			liveCommand(input, context, session =>
				runtimeQueueForSession(session).execute({
					kind: "session.queue.get",
					sessionId: input.sessionId,
				}),
			),
		"session.queue.entry.remove": (input, context) =>
			liveCommand(input, context, session =>
				runtimeQueueForSession(session).execute({
					kind: "session.queue.entry.remove",
					sessionId: input.sessionId,
					id: input.id,
					queue: input.queue,
				}),
			),
		"session.queue.restore": (input, context) =>
			liveCommand(input, context, session =>
				runtimeQueueForSession(session).execute({
					kind: "session.queue.restore",
					sessionId: input.sessionId,
					id: input.id,
					queue: input.queue,
				}),
			),
		"session.queue.promote": (input, context) =>
			liveCommand(input, context, session =>
				runtimeQueueForSession(session).execute({
					kind: "session.queue.promote",
					sessionId: input.sessionId,
					id: input.id,
					queue: input.queue,
				}),
			),
		"session.queue.edit": (input, context) =>
			liveCommand(input, context, session =>
				runtimeQueueForSession(session).execute({
					kind: "session.queue.edit",
					sessionId: input.sessionId,
					id: input.id,
					queue: input.queue,
					expectedText: input.expectedText,
					text: input.text,
				}),
			),
		"session.queue.list": (input, context) =>
			liveCommand(input, context, session => runtimeViewForSession(session).list(input.sessionId, input.offset)),
		"session.queue.takeback": (input, context) =>
			liveCommand(input, context, (session, assertCurrent) =>
				runtimeViewForSession(session).takeback(input.sessionId, input.id, assertCurrent),
			),
		"session.queue.ack": (input, context) =>
			liveCommand(input, context, (session, assertCurrent) =>
				runtimeViewForSession(session).ack(input.sessionId, input.id, assertCurrent),
			),
		"session.queue.remove": (input, context) =>
			liveCommand(input, context, (session, assertCurrent) =>
				runtimeViewForSession(session).remove(input.sessionId, input.id, assertCurrent),
			),
		"session.queue.steer": (input, context) =>
			liveCommand(input, context, (session, assertCurrent) =>
				runtimeViewForSession(session).steer(input.sessionId, input.id, assertCurrent),
			),
	},
};

import { realpath } from "node:fs/promises";
import { sameResumePath } from "../../../resume/paths.js";
import { loadSessionFile } from "../../../session/session-loader.js";
import { SessionEntryIndex } from "../../../session/session-manager.js";
import type { SessionEntry } from "../../../session/session-entries.js";
import { getRpcSession, sessions } from "../../web-gateway/agents.js";
import { resolveSessionPath } from "../../web-gateway/sessions.js";
import { sessionWorkspaceId } from "../ops/session.js";
import { resolveWorkspacePath } from "../ops/workspace.js";
import { ensureLiveSession, invalid, unavailable } from "../gateway.js";
import type { StudioHostContext } from "../registry.js";
import type { TimeTravelRestoreInput, TimeTravelRestoreResult, TimeTravelTimeline } from "../contract/time-travel.js";
import { studioTimeTravelService } from "./time-travel-boundary.js";
import { lockWorkspaceRestore } from "../../../session/workspace-restore.js";
import { timeTravelTimeline } from "./time-travel-timeline.js";

export function timeTravelView(context: StudioHostContext): () => void {
	const owner = context.privateOwner;
	const assert = () => {
		if (!owner || !owner.isLive() || owner.expiresAt <= Date.now() || context.selection?.closed)
			throw unavailable("Time Travel requires a live authenticated view");
	};
	assert();
	return assert;
}

/** Canonical inventory/session ownership is checked before any snapshot or native access. */
export async function timeTravelAccess(sessionId: string, context: StudioHostContext) {
	const view = timeTravelView(context);
	const selected = context.selection?.sessionId;
	if (selected !== undefined && selected !== sessionId) throw invalid("Time Travel belongs to another conversation");
	const workspaceId = await sessionWorkspaceId(sessionId);
	if (!workspaceId || (context.selection && context.selection.workspaceId !== workspaceId))
		throw invalid("Time Travel workspace does not own this session");
	const workspace = await realpath(await resolveWorkspacePath(workspaceId));
	const assert = () => {
		view();
		if (
			context.selection &&
			(context.selection.workspaceId !== workspaceId || context.selection.sessionId !== selected)
		)
			throw unavailable("Time Travel selection changed");
	};
	assert();
	return { workspace, assert };
}

async function entriesFor(
	sessionId: string,
	workspace: string,
): Promise<{ entries: SessionEntry[]; leafId: string | null }> {
	const session = getRpcSession(sessionId)?.getSession();
	if (session && !session.isDisposed) {
		if (session.sessionId !== sessionId || !sameResumePath(workspace, session.sessionManager.getCwd()))
			throw invalid("Time Travel session identity changed");
		return { entries: session.sessionManager.getEntries(), leafId: session.sessionManager.getLeafId() };
	}
	const file = await resolveSessionPath(sessionId);
	if (!file) throw invalid("Session is not available");
	const loaded = await loadSessionFile(file, undefined, { throwIfMissing: true });
	const header = loaded.entries[0];
	if (
		loaded.invalidHeader ||
		loaded.malformedRecords ||
		header?.type !== "session" ||
		header.id !== sessionId ||
		!sameResumePath(header.cwd, workspace)
	)
		throw invalid("Session transcript or workspace identity is invalid");
	const entries = loaded.entries.filter((entry): entry is SessionEntry => entry.type !== "session");
	const index = new SessionEntryIndex();
	index.rebuild(entries);
	return { entries, leafId: index.leafId() };
}

export async function readTimeTravelTimeline(
	input: { sessionId: string; branchLeafId?: string; cursor?: string },
	context: StudioHostContext,
): Promise<TimeTravelTimeline> {
	const access = await timeTravelAccess(input.sessionId, context);
	const source = await entriesFor(input.sessionId, access.workspace);
	const { ancestors, ...timeline } = timeTravelTimeline(input.sessionId, source.entries, source.leafId, input);
	const points = await studioTimeTravelService().list(access.workspace, input.sessionId);
	access.assert();
	return {
		...timeline,
		points: points
			.filter(point => point.phase === "restore-backup" || point.leafId === null || ancestors.has(point.leafId))
			.map(point => ({
				id: point.id,
				leafId: point.leafId,
				phase: point.phase,
				createdAt: point.createdAt,
				fileCount: point.fileCount,
				...(point.changes ? { changes: point.changes } : {}),
			})),
	};
}

export async function restoreTimeTravel(
	input: TimeTravelRestoreInput,
	context: StudioHostContext,
): Promise<TimeTravelRestoreResult> {
	if (
		!["code", "conversation", "both"].includes(input.mode) ||
		(input.leafId !== null && (typeof input.leafId !== "string" || !input.leafId))
	)
		throw invalid("Invalid Time Travel restore");
	const access = await timeTravelAccess(input.sessionId, context);
	await ensureLiveSession(input.sessionId);
	const session = getRpcSession(input.sessionId)?.getSession();
	if (!session || session.isDisposed || !sameResumePath(session.sessionManager.getCwd(), access.workspace))
		throw unavailable("Time Travel session is not resident");
	const assert = () => {
		access.assert();
		if (
			session.isDisposed ||
			session.sessionId !== input.sessionId ||
			getRpcSession(input.sessionId)?.getSession() !== session
		)
			throw unavailable("Time Travel session generation changed");
	};
	assert();
	return studioTimeTravelService().withRestore(async (store, settings) => {
		assert();
		using _workspace = lockWorkspaceRestore(access.workspace);
		const peers = [
			...new Set(
				[...sessions.values()]
					.map(wrapper => wrapper.getSession())
					.filter(peer => !peer.isDisposed && sameResumePath(peer.sessionManager.getCwd(), access.workspace)),
			),
		];
		if (!peers.includes(session)) peers.push(session);
		const fenced = <T>(index: number, action: () => Promise<T>): Promise<T> =>
			index === peers.length ? action() : peers[index]!.withWorkspaceRestore(() => fenced(index + 1, action));
		return fenced(0, async () => {
			assert();
			if (input.leafId !== null && !session.sessionManager.getEntry(input.leafId))
				throw invalid("Restore branch is unavailable");
			let backupId: string | undefined,
				codeRestored = false,
				conversationRestored = false;
			if (input.mode !== "conversation") {
				if (!input.snapshotId || !input.expectedRevision) throw invalid("Review the code restore first");
				const point = (await store.list(access.workspace, input.sessionId)).find(
					row => row.id === input.snapshotId,
				);
				if (!point || point.leafId !== input.leafId) throw invalid("Snapshot does not match this session position");
				assert();
				const result = await store.restore({
					workspace: access.workspace,
					sessionId: input.sessionId,
					snapshotId: input.snapshotId,
					expectedRevision: input.expectedRevision,
					leafId: session.sessionManager.getLeafId(),
					exclusions: settings.exclusions,
					authorize: assert,
				});
				backupId = result.backup.id;
				if (!result.restored)
					return {
						codeRestored: false,
						conversationRestored: false,
						backupId,
						error: result.error ?? "Code restore failed",
					};
				codeRestored = true;
			}
			if (input.mode !== "code") {
				try {
					assert();
					conversationRestored = await session.restoreTreeLeaf(input.leafId);
					if (!conversationRestored)
						return {
							codeRestored,
							conversationRestored,
							...(backupId ? { backupId } : {}),
							error: "Conversation restore was cancelled",
						};
				} catch (error) {
					if (!codeRestored) throw error;
					return {
						codeRestored,
						conversationRestored: false,
						...(backupId ? { backupId } : {}),
						error: "Code was restored but conversation restore failed. The before-restore backup is retained.",
					};
				}
			}
			return { codeRestored, conversationRestored, ...(backupId ? { backupId } : {}) };
		});
	});
}

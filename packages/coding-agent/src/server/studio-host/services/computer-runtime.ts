import type { AgentSession } from "../../../session/agent-session";
import { getRpcSession } from "../../web-gateway/agents";
import { ensureLiveSession, requiredString } from "../gateway.js";
import { unavailable } from "../errors.js";
import { studioPrivateResources } from "../private-resources.js";
import type { StudioHostContext } from "../registry.js";
import type { ComputerWorkspaceChange } from "../protocol/contracts/computer-workspace.js";
import { StudioComputerWorkspaceService, type ComputerWorkspaceView } from "./computer-workspace-service";
import { ownedComputerSessions } from "./computer-owned-sessions";
import { revokeComputerSessions } from "../../../tools/computer/session-runtime";
import { StudioComputerObservationService } from "./computer-observation-service";

interface Resident { sessionId: string; workspace: StudioComputerWorkspaceService; owners: Set<string> }
export interface ComputerRuntimeView { session: AgentSession; sessionId: string; workspace: StudioComputerWorkspaceService; observation: StudioComputerObservationService; view: ComputerWorkspaceView }
const residents = new WeakMap<AgentSession, Resident>();
const workspaces = new Set<StudioComputerWorkspaceService>();
const views = new Map<string, ComputerRuntimeView>();
const listeners = new Map<string, Set<(change: ComputerWorkspaceChange) => void>>();
const pending = new Set<Promise<unknown>>();
function settle(work: Promise<unknown>): void {
	pending.add(work);
	void work.catch(() => {}).finally(() => pending.delete(work));
}
export function subscribeComputerWorkspace(owner: string, listener: (change: ComputerWorkspaceChange) => void): () => void {
	const group = listeners.get(owner) ?? new Set();
	group.add(listener); listeners.set(owner, group);
	return () => { group.delete(listener); if (!group.size) listeners.delete(owner); };
}
export function releaseComputerPrivateOwner(owner: string): void {
	const current = views.get(owner);
	if (!current) return;
	views.delete(owner);
	const resident = residents.get(current.session);
	resident?.owners.delete(owner);
	settle(Promise.allSettled([current.observation.dispose(), current.workspace.releaseOwner(owner), ...(resident?.owners.size === 0 ? [revokeComputerSessions(ownedComputerSessions(current.session))] : [])]));
}
/** The caller awaits this after its last owner release on server shutdown. */
export async function settleComputerPrivateResources(): Promise<void> {
	while (pending.size) await Promise.allSettled([...pending]);
}
export async function shutdownComputerPrivateResources(): Promise<void> {
	for (const owner of [...views.keys()]) releaseComputerPrivateOwner(owner);
	await Promise.allSettled([...workspaces].map(workspace => workspace.dispose()));
	workspaces.clear();
	await settleComputerPrivateResources();
}
export async function computerRuntime(input: unknown, context: StudioHostContext): Promise<ComputerRuntimeView> {
	const sessionId = requiredString(input, "sessionId"), owner = context.privateOwner;
	const live = () => !!owner && owner.isLive() && owner.expiresAt > Date.now() && !context.selection?.closed && (context.selection === undefined || context.selection.sessionId === sessionId);
	if (!owner || !live()) throw unavailable("Computer resources require a live authenticated view");
	await ensureLiveSession(sessionId);
	const session = getRpcSession(sessionId)?.getSession();
	if (!session || session.isDisposed || !live()) throw unavailable("Computer session is not resident or the view closed");
	const paths = await studioPrivateResources();
	const valid = () => live() && !session.isDisposed && session.sessionId === sessionId && getRpcSession(sessionId)?.getSession() === session;
	if (!valid()) throw unavailable("Computer session changed while attaching");
	const previous = views.get(owner.id);
	if (previous?.session === session && previous.sessionId === sessionId && previous.view.isLive()) return previous;
	releaseComputerPrivateOwner(owner.id);
	let resident = residents.get(session);
	if (resident && resident.sessionId !== sessionId) {
		residents.delete(session);
		for (const id of [...resident.owners]) releaseComputerPrivateOwner(id);
		settle(resident.workspace.dispose());
		workspaces.delete(resident.workspace);
		resident = undefined;
	}
	if (!resident) {
		const workspace = new StudioComputerWorkspaceService(session, { directory: paths.mediaDirectory, isLive: () => !session.isDisposed && session.sessionId === sessionId && getRpcSession(sessionId)?.getSession() === session });
		workspaces.add(workspace);
		resident = { sessionId, workspace, owners: new Set() };
		residents.set(session, resident);
		const bound = resident;
		workspace.subscribe(change => {
			if (residents.get(session) !== bound || session.sessionId !== sessionId || session.isDisposed) return;
			for (const id of bound.owners) if (views.get(id)?.view.isLive()) for (const listener of listeners.get(id) ?? []) {
				try { listener(change); } catch { /* Detached consumers cannot fail native work. */ }
			}
		});
		const dispose = () => {
			if (residents.get(session) !== bound) return;
			residents.delete(session);
			workspaces.delete(bound.workspace);
			for (const id of [...bound.owners]) releaseComputerPrivateOwner(id);
			settle(bound.workspace.dispose());
		};
		session.addDisposer(dispose);
		session.registerSessionChangeCallback(dispose);
	}
	const view: ComputerWorkspaceView = { ownerId: owner.id, isLive: () => views.get(owner.id)?.view === view && valid() };
	const observation = new StudioComputerObservationService(session, paths.mediaDirectory, resident.workspace, view);
	const result: ComputerRuntimeView = { session, sessionId, workspace: resident.workspace, observation, view };
	views.set(owner.id, result); resident.owners.add(owner.id);
	return result;
}

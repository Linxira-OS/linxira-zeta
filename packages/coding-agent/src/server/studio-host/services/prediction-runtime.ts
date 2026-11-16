import type { AgentSession } from "../../../session/agent-session";
import { getRpcSession } from "../../web-gateway/agents";
import { ensureLiveSession, requiredString } from "../gateway";
import { unavailable } from "../errors";
import { studioPrivateResources } from "../private-resources";
import type { StudioHostContext } from "../registry";
import { sessionWorkspaceId } from "../ops/session";
import { StudioPredictionService, type PredictionView } from "./prediction-service";

interface Resident { sessionId: string; service: StudioPredictionService; owners: Set<string> }
const residents = new WeakMap<AgentSession, Resident>();
const liveResidents = new Set<Resident>();
const views = new Map<string, { resident: Resident; view: PredictionView }>();
export function releasePredictionPrivateOwner(owner: string): void {
	const current = views.get(owner);
	if (!current) return;
	views.delete(owner);
	current.resident.owners.delete(owner);
	current.resident.service.releaseOwner(owner);
}
/** Existing serve shutdown seam: close every channel and daemon client before exit. */
export function shutdownPredictionPrivateResources(): void {
	for (const resident of [...liveResidents]) {
		for (const owner of [...resident.owners]) releasePredictionPrivateOwner(owner);
		resident.service.dispose();
	}
	liveResidents.clear();
	views.clear();
}
/** Native residency is shared; editor channels remain exact-view owned. */
export async function predictionRuntime(input: unknown, context: StudioHostContext): Promise<{ service: StudioPredictionService; view: PredictionView; assertCurrent(): void }> {
	const sessionId = requiredString(input, "sessionId"), owner = context.privateOwner;
	if (sessionId.length > 512 || sessionId.includes("\0")) throw unavailable("Invalid prediction session");
	const live = () => !!owner && owner.isLive() && owner.expiresAt > Date.now() && !context.selection?.closed && (context.selection === undefined || context.selection.sessionId === sessionId);
	if (!owner || !live()) throw unavailable("Prediction requires a live authenticated view");
	await ensureLiveSession(sessionId);
	const session = getRpcSession(sessionId)?.getSession();
	if (!session || session.isDisposed || !live()) throw unavailable("Prediction session is not resident");
	const workspaceId = await sessionWorkspaceId(sessionId);
	const paths = await studioPrivateResources();
	const valid = () => live() && !session.isDisposed && session.sessionId === sessionId && getRpcSession(sessionId)?.getSession() === session && (context.selection === undefined || context.selection.workspaceId === workspaceId);
	if (!valid()) throw unavailable("Prediction session changed while attaching");
	let resident = residents.get(session);
	if (resident && resident.sessionId !== sessionId) {
		for (const id of [...resident.owners]) releasePredictionPrivateOwner(id);
		resident.service.dispose();
		residents.delete(session);
		resident = undefined;
	}
	if (!resident) {
		const service = new StudioPredictionService(session, paths.mediaDirectory, paths.socketDirectory, () => !session.isDisposed && session.sessionId === sessionId && getRpcSession(sessionId)?.getSession() === session);
		service.enableMessagePrediction(session);
		resident = { sessionId, service, owners: new Set() };
		residents.set(session, resident);
		liveResidents.add(resident);
		const bound = resident;
		const dispose = () => {
			if (residents.get(session) !== bound) return;
			residents.delete(session);
			liveResidents.delete(bound);
			for (const id of [...bound.owners]) releasePredictionPrivateOwner(id);
			bound.service.dispose();
		};
		const unregister = session.registerSessionChangeCallback(dispose);
		session.addDisposer(() => { unregister(); dispose(); });
	}
	let current = views.get(owner.id);
	if (current?.resident !== resident || !current.view.isLive()) {
		releasePredictionPrivateOwner(owner.id);
		const view: PredictionView = { id: owner.id, isLive: () => views.get(owner.id)?.view === view && valid() };
		current = { resident, view };
		views.set(owner.id, current);
		resident.owners.add(owner.id);
	}
	const view = current.view;
	return { service: resident.service, view, assertCurrent() { if (!view.isLive()) throw unavailable("Prediction view changed"); } };
}

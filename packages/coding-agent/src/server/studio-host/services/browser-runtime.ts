import type { AgentSession } from "../../../session/agent-session";
import { getRpcSession } from "../../web-gateway/agents";
import { ensureLiveSession, requiredString, unavailable } from "../gateway.js";
import { studioPrivateResources } from "../private-resources.js";
import type { StudioHostContext } from "../registry.js";
import { StudioBrowserObservationService } from "./browser-observation.js";
import { StudioManagedBrowserService } from "./managed-browser";
import { releaseComputerPrivateOwner } from "./computer-runtime.js";

interface ViewService { session: AgentSession; sessionId: string; browser: StudioBrowserObservationService; managed?: StudioManagedBrowserService }
const views = new Map<string, ViewService>();
const sessionOwners = new WeakMap<AgentSession, Set<string>>();
export function releaseStudioPrivateOwner(owner: string): void {
	releaseComputerPrivateOwner(owner);
	const current = views.get(owner);
	if (!current) return;
	views.delete(owner);
	sessionOwners.get(current.session)?.delete(owner);
	current.browser.dispose();
	current.managed?.dispose();
}
export async function browserRuntime(input: unknown, context: StudioHostContext): Promise<StudioBrowserObservationService> {
	const sessionId = requiredString(input, "sessionId");
	const owner = context.privateOwner;
	const live = () => !!owner && owner.isLive() && owner.expiresAt > Date.now() && !context.selection?.closed && (context.selection === undefined || context.selection.sessionId === sessionId);
	if (!live() || !owner) throw unavailable("private browser resources require a live authenticated view");
	await ensureLiveSession(sessionId);
	const session = getRpcSession(sessionId)?.getSession();
	if (!session || session.isDisposed || !live()) throw unavailable("browser session is not resident or the view closed");
	const paths = await studioPrivateResources();
	if (!live() || session.isDisposed || session.sessionId !== sessionId || getRpcSession(sessionId)?.getSession() !== session)
		throw unavailable("browser session changed while attaching");
	const previous = views.get(owner.id);
	if (previous?.session === session && previous.sessionId === sessionId) return previous.browser;
	releaseStudioPrivateOwner(owner.id);
	const browser = new StudioBrowserObservationService(session, paths.mediaDirectory, paths.socketDirectory,
		() => views.get(owner.id)?.browser === browser && live() && session.sessionId === sessionId && getRpcSession(sessionId)?.getSession() === session);
	views.set(owner.id, { session, sessionId, browser });
	let owners = sessionOwners.get(session);
	if (!owners) {
		owners = new Set();
		sessionOwners.set(session, owners);
		const owned = owners;
		const release = () => { for (const id of owned) releaseStudioPrivateOwner(id); };
		session.addDisposer(release);
		session.registerSessionChangeCallback(release);
	}
	owners.add(owner.id);
	return browser;
}

export async function managedBrowserRuntime(input: unknown, context: StudioHostContext, create = true): Promise<StudioManagedBrowserService> {
	const browser = await browserRuntime(input, context);
	const owner = context.privateOwner!;
	const view = views.get(owner.id);
	if (!view || view.browser !== browser || !browser.isViewLive()) throw unavailable("managed browser view closed");
	if (view.managed?.isLive()) return view.managed;
	if (!create) throw unavailable("prepare this view's managed browser before reading its tools");
	view.managed?.dispose();
	view.managed = new StudioManagedBrowserService(view.session, { enabled: true, directory: browser.directory, isLive: () => browser.isViewLive() });
	return view.managed;
}

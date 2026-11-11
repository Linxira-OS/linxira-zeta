/**
 * Session lifecycle for the taste layer.
 *
 * The layer is not a memory backend: it refines whatever backend is running, so it
 * hangs off the session the way the sharpshooter backend does — one `message_start`
 * subscription for extraction, one ref-counted scheduler per scope, both released
 * on dispose. `startTasteSession` is idempotent per session; a second call replaces
 * the first set of resources instead of stacking them.
 *
 * Everything is gated twice: the layer must be enabled in settings, and it never
 * starts for a child session (`taskDepth > 0`), which inherits its parent's
 * prompt instead of learning its own taste.
 */
import type { ModelRegistry } from "../config/model-registry";
import type { Settings } from "../config/settings";
import { cfgMemoryBackend } from "../memory-backend/settings";
import type { AgentSession } from "../session/agent-session";
import { maybeStartTasteExtraction } from "./extract";
import { startTasteScheduler } from "./scheduler";
import { cfgTasteEnabled } from "./settings";

interface TasteSessionResources {
	unsubscribe: () => void;
	disposeScheduler: () => void;
}

const kTasteSessionResources = Symbol("taste.sessionResources");

interface TasteAgentSession extends AgentSession {
	[kTasteSessionResources]?: TasteSessionResources;
}

/** Release extraction and scheduler subscriptions owned by this session. */
export function releaseTasteSession(session: AgentSession): void {
	const owned = session as TasteAgentSession;
	const resources = owned[kTasteSessionResources];
	if (!resources) return;
	delete owned[kTasteSessionResources];
	try {
		resources.unsubscribe();
	} finally {
		resources.disposeScheduler();
	}
}

/**
 * Start the layer for one session. Returns the disposer, and installs it on the
 * session so {@link releaseTasteSession} (called from session disposal) finds it.
 */
export function startTasteSession(options: {
	session: AgentSession;
	settings: Settings;
	modelRegistry: ModelRegistry;
	agentDir: string;
	taskDepth: number;
}): void {
	const { session, settings } = options;
	if (cfgMemoryBackend.get(settings) === "off") return;
	if (cfgTasteEnabled.get(settings) !== true) return;
	if (options.taskDepth > 0) return;

	releaseTasteSession(session);
	try {
		const disposeScheduler = startTasteScheduler({
			agentDir: options.agentDir,
			cwd: session.sessionManager.getCwd(),
			settings,
			modelRegistry: options.modelRegistry,
			sessionId: session.sessionId,
			agentId: session.getAgentId(),
			...(session.sessionManager.getMemoryNamespace()
				? { namespace: session.sessionManager.getMemoryNamespace() }
				: {}),
		});
		const unsubscribe = session.subscribe(event => {
			// `message_start` is the only event carrying the committed prompt itself,
			// and it also covers mid-turn steering messages.
			if (event.type !== "message_start" || event.message.role !== "user") return;
			maybeStartTasteExtraction({
				session,
				settings,
				modelRegistry: options.modelRegistry,
				agentDir: options.agentDir,
				message: event.message,
			});
		});
		// Backend startup can race the first turn's events; catch up when the
		// transcript already ends in a user prompt.
		if (session.messages.at(-1)?.role === "user") {
			maybeStartTasteExtraction({
				session,
				settings,
				modelRegistry: options.modelRegistry,
				agentDir: options.agentDir,
			});
		}
		(session as TasteAgentSession)[kTasteSessionResources] = { unsubscribe, disposeScheduler };
	} catch (error) {
		releaseTasteSession(session);
		throw error;
	}
}

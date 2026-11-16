import { isRecord } from "@linxiraos/pi-utils";
import { getSupportedEfforts } from "@linxiraos/pi-catalog/model-thinking";
import { isShellTrace, type ShellTrace, type ShellVizPreferences } from "@linxiraos/pi-wire";
import {
	defaultShellVizPreferences,
	readShellPresentation,
	shellVisualization,
} from "@linxiraos/pi-tui/tools/shell-viz";
import { formatModelStringWithRouting } from "../../../config/model-resolver.js";
import type { AgentSession } from "../../../session/agent-session.js";
import { isAgentViewSession, type AgentViewSession } from "../../../session/agent-session-handle.js";
import { SessionManager } from "../../../session/session-manager.js";
import { loadEntriesFromFile } from "../../../session/session-loader.js";
import { AgentRegistry, type AgentRef } from "../../../registry/agent-registry.js";
import { cfgDisplayShellVisualization } from "../../../modes/settings.js";
import { discoverAgents } from "../../../task/discovery.js";
import {
	assertPerCallModelApproved,
	parentModelGrantPattern,
	PerCallModelError,
} from "../../../task/model-approval.js";
import { cfgTaskMaxEffort, perCallModelEnabled } from "../../../task/settings.js";
import { StudioOpError } from "../errors.js";
import type {
	AgentSpawnOptions,
	RuntimeViewOperation,
	RuntimeViewResultMap,
	ShellViewSource,
} from "../protocol/contracts/runtime-views.js";

type ShellRead = Extract<RuntimeViewOperation, { kind: "shell.view.read" }>;
type ShellRelease = Extract<RuntimeViewOperation, { kind: "shell.view.release" }>;

function shellKey(operation: ShellViewSource): string {
	return JSON.stringify([operation.sessionId, operation.sourceSessionId, operation.agentId, operation.toolCallId]);
}

/** Registry-proven descendant AgentRef; never a sibling or foreign resident. */
function ownedAgentRef(session: AgentSession, agentId: string): AgentRef | undefined {
	if (session.isDisposed) return undefined;
	const registry = AgentRegistry.global();
	const refs = registry.list();
	const main =
		refs.find(ref => session.instanceKey && ref.session?.instanceKey === session.instanceKey) ??
		refs.find(ref => ref.session?.sessionManager.getSessionId() === session.sessionId);
	if (!main) return undefined;
	const candidate = registry.get(agentId);
	if (!candidate) return undefined;
	const seen = new Set<string>();
	let ref = candidate;
	for (;;) {
		if (ref.id === main.id) return candidate;
		if (seen.has(ref.id)) return undefined;
		seen.add(ref.id);
		const parent = ref.parentId ? registry.get(ref.parentId) : undefined;
		if (!parent) return undefined;
		ref = parent;
	}
}

/**
 * Native shell-trace reads for the conversation surface.
 *
 * A live tool update is read from the owning session's in-memory event map; a
 * completed or recorded command is read from that session's persisted
 * transcript. Presentation is produced by the TUI's own shell visualization
 * engine, so no shell parser or terminal manager runs in the Renderer or here.
 * The one cached value is the parsed trace of the currently open recording; a
 * different command, a live trace, or an explicit release drops it.
 */
export class StudioRuntimeUtilityService {
	#recordedShell: { key: string; trace: Promise<ShellTrace | undefined> } | undefined;

	constructor(
		readonly session: AgentSession,
		readonly visualizationEnabled: () => boolean = () => cfgDisplayShellVisualization.get(this.session.settings),
	) {}

	/**
	 * Native task-spawn options for one discovered definition.
	 *
	 * The definition list is the same one task dispatch resolves (project, user,
	 * plugin and session-local agents); the model list is filtered by the same
	 * per-call approval function the task tool uses. No session is attached or
	 * started, and no option is synthesized when the native source is absent.
	 */
	async spawnOptions(definition: string): Promise<AgentSpawnOptions> {
		const discovery = await discoverAgents(
			this.session.sessionManager.getCwd(),
			undefined,
			this.session.effectiveExtensionRoots,
		);
		const agent = [...discovery.agents, ...(this.session.getEvalToolSession()?.getSessionAgents?.() ?? [])].find(
			row => row.name === definition,
		);
		if (!agent) throw new StudioOpError("INVALID_ARGUMENT", "The selected agent definition is no longer available");
		const allowed = perCallModelEnabled(this.session.settings, "task");
		const grants = {
			settings: this.session.settings,
			agentName: agent.name,
			agentSource: agent.source,
			agentModel: agent.model,
			parentModelPattern: this.session.model ? parentModelGrantPattern(this.session.model) : undefined,
		};
		const models = allowed
			? this.session.modelRegistry
					.getAvailable("chat")
					.filter(model => {
						try {
							assertPerCallModelApproved(model, grants, this.session.modelRegistry);
							return true;
						} catch (error) {
							if (error instanceof PerCallModelError) return false;
							throw error;
						}
					})
					.map(model => ({
						selector: formatModelStringWithRouting(model),
						name: model.name,
						thinkingLevels: getSupportedEfforts(model),
					}))
			: [];
		return {
			// This Runtime registers no `task.file` setting, so task-file mode is
			// genuinely unavailable; do not fabricate a preview-enabled control.
			fileEnabled: false,
			modelSelection: allowed,
			maxEffort: cfgTaskMaxEffort.get(this.session.settings),
			models,
		};
	}

	release(operation: ShellRelease): RuntimeViewResultMap["shell.view.release"] {
		if (operation.sessionId !== this.session.sessionId)
			throw new StudioOpError("UNAVAILABLE", "The Runtime view belongs to another session");
		if (this.#recordedShell?.key === shellKey(operation)) this.#recordedShell = undefined;
		return { released: true };
	}

	async read(operation: ShellRead, assertActive?: () => void): Promise<RuntimeViewResultMap["shell.view.read"]> {
		if (operation.sessionId !== this.session.sessionId)
			throw new StudioOpError("UNAVAILABLE", "The Runtime view belongs to another session");
		assertActive?.();
		if (!this.visualizationEnabled()) return { available: false, reason: "Shell visualization is disabled." };
		const ref = operation.agentId ? ownedAgentRef(this.session, operation.agentId) : undefined;
		if (operation.agentId && !ref)
			throw new StudioOpError("UNAVAILABLE", "The shell agent is not owned by this conversation");
		const target: AgentViewSession | undefined = operation.agentId
			? ref?.session && isAgentViewSession(ref.session)
				? ref.session
				: undefined
			: this.session;
		const useLive = !operation.sourceSessionId || operation.sourceSessionId === target?.sessionManager.getSessionId();
		const messages = useLive ? (target?.messages ?? []) : [];
		const result = messages.findLast(
			message => message.role === "toolResult" && message.toolCallId === operation.toolCallId,
		);
		const update =
			useLive && target && isAgentViewSession(target)
				? target.activeToolExecutionUpdates().find(event => event.toolCallId === operation.toolCallId)
				: undefined;
		const partial: unknown = update?.partialResult;
		let details =
			isRecord(partial) && "details" in partial
				? partial["details"]
				: result?.role === "toolResult"
					? result.details
					: undefined;
		if (useLive && isRecord(details) && isRecord(details.async) && typeof details.async.jobId === "string") {
			const job = this.session.asyncJobManager?.getJob(details.async.jobId);
			if (job?.latestDetails) details = job.latestDetails;
		}
		const liveTrace = isRecord(details) ? details.trace : undefined;
		let trace: ShellTrace | undefined;
		if (isShellTrace(liveTrace)) {
			trace = liveTrace;
			this.#recordedShell = undefined;
		} else {
			const file = ref?.sessionFile ?? (useLive ? target?.sessionFile : undefined);
			if (operation.agentId && !file)
				return { available: false, reason: "The agent has no recorded execution trace." };
			if (!useLive || file) trace = await this.#readRecordedShell(operation, file ?? undefined);
			assertActive?.();
		}
		if (!trace) return { available: false, reason: "This command has no recorded execution trace." };
		const preferences: ShellVizPreferences = operation.preferences ?? defaultShellVizPreferences();
		const source = shellVisualization(trace);
		if (!source) return { available: false, reason: "This command's shell trace cannot be restored." };
		return { available: true, presentation: readShellPresentation(source, preferences, trace) };
	}

	async #readRecordedShell(operation: ShellRead, file?: string): Promise<ShellTrace | undefined> {
		const key = shellKey(operation);
		let cached = this.#recordedShell;
		if (cached?.key !== key) {
			cached = { key, trace: this.#loadRecordedShell(operation, file) };
			this.#recordedShell = cached;
		}
		try {
			const trace = await cached.trace;
			if (!trace && this.#recordedShell === cached) this.#recordedShell = undefined;
			return trace;
		} catch (error) {
			if (this.#recordedShell === cached) this.#recordedShell = undefined;
			throw error;
		}
	}

	async #loadRecordedShell(operation: ShellRead, file?: string): Promise<ShellTrace | undefined> {
		const manager = this.session.sessionManager;
		const source =
			file ??
			(await SessionManager.list(manager.getCwd(), manager.getSessionDir())).find(
				row => row.id === operation.sourceSessionId,
			)?.path;
		if (!source) throw new StudioOpError("UNAVAILABLE", "The recorded shell session is unavailable");
		const entries = await loadEntriesFromFile(source);
		const header = entries[0];
		if (
			!header ||
			header.type !== "session" ||
			(operation.sourceSessionId !== undefined && header.id !== operation.sourceSessionId)
		)
			throw new StudioOpError("UNAVAILABLE", "The recorded shell source changed");
		const entry = entries.findLast(
			row =>
				row.type === "message" &&
				row.message.role === "toolResult" &&
				row.message.toolCallId === operation.toolCallId,
		);
		const details =
			entry?.type === "message" && entry.message.role === "toolResult" ? entry.message.details : undefined;
		return isRecord(details) && isShellTrace(details.trace) ? details.trace : undefined;
	}

	dispose(): void {
		this.#recordedShell = undefined;
	}
}

const residents = new WeakMap<AgentSession, StudioRuntimeUtilityService>();

/** One recorded-trace cache per native session; it is dropped on session change/disposal. */
export function runtimeUtilityForSession(session: AgentSession): StudioRuntimeUtilityService {
	let service = residents.get(session);
	if (!service) {
		service = new StudioRuntimeUtilityService(session);
		residents.set(session, service);
		const resident = service;
		const dispose = () => {
			if (residents.get(session) !== resident) return;
			residents.delete(session);
			resident.dispose();
		};
		const unregister = session.registerSessionChangeCallback(dispose);
		session.addDisposer(() => {
			unregister();
			dispose();
		});
	}
	return service;
}

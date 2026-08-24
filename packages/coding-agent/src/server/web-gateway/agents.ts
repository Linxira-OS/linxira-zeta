/**
 * Web Gateway — live agent session RPC handlers.
 *
 * Semantic port of `web-ui/lib/rpc-manager.ts`: keeps one live
 * `AgentSessionWrapper` per persistent session id and translates between the
 * web-ui RPC protocol (commands, SSE events, extension UI dialogs) and the
 * runtime `AgentSession` API. The wrapper owns extension-UI request/response
 * correlation and synthesizes the `queue_update` / `running` events the
 * runtime does not emit natively.
 *
 * DTO contract mirrors `web-ui/lib/types.ts` and the web-ui route handlers
 * byte-compatibly: responses are `{ success, data }` / `{ error }`, and the
 * SSE streams send `data: <json>\n\n` frames.
 */

import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import type { ImageContent } from "@linxiraos/pi-ai";
import { modelsAreEqual } from "@linxiraos/pi-catalog/models";
import { logger, Snowflake } from "@linxiraos/pi-utils";
import { getAgentDir } from "@linxiraos/pi-utils/dirs";
import type { ImControlParams, ImControlResult } from "../../channels/im-control";
import { approveRemotePlan } from "../../channels/plan-approval";
import type { BashResult } from "../../exec/bash-executor";
import { getSessionSlashCommands } from "../../extensibility/extensions/get-commands-handler";
import { type ExtensionUIContext, getExtensionUISelectOptionLabel } from "../../extensibility/extensions/types";
import type { GoalModeState } from "../../goals/state";
import type { LocalProtocolOptions } from "../../internal-urls";
import type { PlanModeState } from "../../plan-mode/state";
import { createAgentSession } from "../../sdk";
import type { AgentSession, ModeId } from "../../session/agent-session";
import type { AgentSessionEvent } from "../../session/agent-session-events";
import { SessionManager } from "../../session/session-manager";
import type { ConfiguredThinkingLevel } from "../../thinking";
import type { VibeModeState } from "../../vibe/state";
import {
	addRunningSession,
	getRunningSessionIds,
	removeRunningSession,
	subscribeRunningSessions,
} from "./running-sessions";
import { cacheSessionPath, invalidateSessionListCache, resolveSessionPath } from "./sessions";

// ---------------------------------------------------------------------------
// DTO types (web-ui contract; see web-ui/lib/types.ts + useAgentSession.ts)
// ---------------------------------------------------------------------------

export interface AgentEvent {
	type: string;
	[key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

export type AgentCommand =
	| {
			type: "prompt";
			message: string;
			images?: unknown[];
			chain?: string;
			thinkingLevel?: string;
			streamingBehavior?: "steer" | "followUp";
	  }
	| { type: "steer"; text: string; images?: unknown[] }
	| { type: "follow_up"; text: string; images?: unknown[] }
	| { type: "abort" }
	| { type: "get_state" }
	| { type: "set_model"; provider: string; modelId: string }
	| { type: "fork"; entryId: string }
	| { type: "navigate_tree"; entryId: string }
	| { type: "set_thinking_level"; level: string }
	| { type: "compact" }
	| { type: "set_session_name"; name: string }
	| { type: "get_session_stats" }
	| { type: "get_last_assistant_text" }
	| { type: "set_auto_compaction"; enabled: boolean }
	| { type: "clear_queue" }
	| { type: "get_tools" }
	| { type: "get_commands" }
	| { type: "set_tools"; toolNames: string[] }
	| { type: "reload" }
	| { type: "abort_compaction" }
	| {
			type: "extension_ui_response";
			id: string;
			value?: string;
			confirmed?: boolean;
			cancelled?: boolean;
			timedOut?: boolean;
	  }
	| { type: "extension_ui_input"; id: string; data: string }
	| { type: "set_auto_retry"; enabled: boolean }
	| { type: "bash"; command: string; excludeFromContext?: boolean }
	| { type: "abort_bash" }
	| { type: "enter_plan_mode"; initialPrompt?: string }
	| { type: "plan_approve"; planFilePath: string; mode: "preserve" | "compact" | "fresh" | "cancel" }
	| { type: "mode_enter"; mode: ModeId; options?: unknown }
	| { type: "mode_exit"; mode: ModeId; options?: unknown }
	| { type: "set_model_role"; role: string };

export type ExtensionUiRequest =
	| {
			type: "extension_ui_request";
			id: string;
			method: "select";
			title: string;
			options: string[];
			timeout?: number;
			expiresAt?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "confirm";
			title: string;
			message: string;
			timeout?: number;
			expiresAt?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "input";
			title: string;
			placeholder?: string;
			timeout?: number;
			expiresAt?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "editor";
			title: string;
			prefill?: string;
			timeout?: number;
			expiresAt?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "notify";
			message: string;
			notifyType?: "info" | "warning" | "error";
	  }
	| { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText?: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setWidget";
			widgetKey: string;
			widgetLines?: string[];
			widgetPlacement?: "aboveEditor" | "belowEditor";
	  }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string }
	| { type: "extension_ui_request"; id: string; method: "custom"; closed?: boolean };

type ExtensionUiResponse = { value: string } | { confirmed: boolean } | { cancelled: true; timedOut?: boolean };

export interface AgentState {
	sessionId: string;
	sessionName: string;
	model: { provider: string; modelId: string } | null;
	systemPrompt: string;
	thinkingLevel: string;
	isStreaming: boolean;
	isPromptRunning: boolean;
	isBashRunning: boolean;
	isCompacting: boolean;
	extensionStatuses: { key: string; text: string }[];
	extensionWidgets: { key: string; lines: string[]; placement: "aboveEditor" | "belowEditor" }[];
	queuedMessages: { steering: string[]; followUp: string[] };
	planModeEnabled: boolean;
	planFilePath: string | null;
	/** Plan file body when plan mode is active (web-ui PlanApproval preview). */
	planContent?: string;
	// --- AgentState v2 (shared session state bridge) ---
	/** Active mode states, keyed by mode id (only present when active). */
	modes: { plan?: PlanModeState; goal?: GoalModeState; vibe?: VibeModeState };
	/** The session's current resolved model role (e.g. "default", "plan"), or null. */
	modelRole: string | null;
	/** Names of tools currently exposed at the top level. */
	activeToolNames: string[];
	/** Whether automatic compaction is enabled. */
	autoCompactionEnabled: boolean;
	/** Whether auto-retry is enabled. */
	autoRetryEnabled: boolean;
	/** Monotonic counter bumped whenever mode or model state changes. */
	stateVersion: number;
}

export interface ToolEntry {
	name: string;
	description: string;
	active: boolean;
}

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
}

type PendingUiResponse = {
	resolve: (response: ExtensionUiResponse) => void;
	cancel: () => void;
};

// ---------------------------------------------------------------------------
// Registry (module-level: the gateway is a long-lived Bun process)
// ---------------------------------------------------------------------------

/** Keyed by the persistent (file-header) session id. */
const sessions = new Map<string, AgentSessionWrapper>();
/** Per-start-key coalescing promise, mirroring web-ui's `globalThis.__piStartLocks`. */
const startLocks = new Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>>();
/**
 * Pending extension UI dialogs, keyed by request id → owning session id.
 *
 * Serve-hosted agents run in RPC subprocesses, so the pending dialog lives in
 * the child's memory — the gateway can only observe the `extension_ui_request`
 * frames it already relays over SSE. Recording the owner there lets
 * `/api/extension-ui/response` forward the reply to the right session's
 * command channel without the caller knowing which session asked.
 */
const uiRequestOwners = new Map<string, string>();
export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
	return sessions.get(sessionId);
}

export function getRunningRpcSessionIds(): string[] {
	return [...sessions.values()]
		.filter(wrapper => wrapper.isAlive() && wrapper.isRunning())
		.map(wrapper => wrapper.realSessionId);
}

// ---------------------------------------------------------------------------
// AgentSessionWrapper
// ---------------------------------------------------------------------------

/**
 * Wraps a live AgentSession, translating between the session API and the
 * web-ui RPC protocol. One wrapper per persistent session id; a wrapper is
 * destroyed when its session is deleted or superseded (e.g. after a fork).
 */
export class AgentSessionWrapper {
	/** Mutable: after a fork the wrapper follows the inner session's new id/file. */
	realSessionId: string;
	sessionFile: string | null;

	#inner: AgentSession;
	#destroyed = false;
	#listeners = new Set<EventListener>();
	#pendingUiRequests = new Map<string, PendingUiResponse>();
	#lastRunningEvent: "running" | "not-running" | null = null;
	#toolsDisabled = false;
	#extensionStatuses = new Map<string, string>();
	#extensionWidgets = new Map<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>();
	/** Serialized last-seen mode states, used to emit `mode_changed` diffs. */
	#lastModeStates: Record<ModeId, string> = { plan: "null", goal: "null", vibe: "null" };

	constructor(inner: AgentSession, realSessionId: string, sessionFile: string | null) {
		this.#inner = inner;
		this.realSessionId = realSessionId;
		this.sessionFile = sessionFile;

		inner.subscribe(event => this.#onInnerEvent(event));
	}

	isAlive(): boolean {
		return !this.#destroyed;
	}

	/** The underlying runtime session (channels/coordinators need the raw API). */
	getSession(): AgentSession {
		return this.#inner;
	}

	/** Streams events to a single SSE listener; returns an unsubscribe function. */
	onEvent(listener: EventListener): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	#emit(event: AgentEvent): void {
		for (const listener of this.#listeners) {
			try {
				listener(event);
			} catch (error) {
				logger.error("web-gateway: event listener failed", { error: String(error) });
			}
		}
	}

	isRunning(): boolean {
		return this.#inner.isStreaming || this.#inner.isCompacting || this.#inner.isBashRunning;
	}

	/** Emit `running`/`not-running` when the busy state flips, and mirror it to the registry. */
	updateRunningState(): void {
		const running = this.isRunning();
		const current = running ? "running" : "not-running";
		if (current === this.#lastRunningEvent) return;
		this.#lastRunningEvent = current;
		this.#emit({ type: current });
		if (running) {
			addRunningSession(this.realSessionId);
		} else {
			removeRunningSession(this.realSessionId);
		}
	}

	#emitQueuedMessages(): void {
		const queued = this.#inner.getQueuedMessages();
		this.#emit({ type: "queue_update", steering: [...queued.steering], followUp: [...queued.followUp] });
	}

	#onInnerEvent(event: AgentSessionEvent): void {
		if (event.type === "auto_compaction_end") {
			// The runtime CompactionResult has no `estimatedTokensAfter`; the
			// client reads it off the event, so synthesize it from context usage.
			this.#emit({
				type: "auto_compaction_end",
				result: event.result
					? {
							tokensBefore: event.result.tokensBefore,
							estimatedTokensAfter: this.#inner.getContextUsage()?.tokens ?? undefined,
						}
					: undefined,
			});
			queueMicrotask(() => this.updateRunningState());
			return;
		}
		if (event.type === "state_version_changed") {
			// External-state bridge: re-derive mode diffs and broadcast the new
			// version. Clients use `state_changed` to re-fetch get_state and
			// `mode_changed` to update mode banners without a full poll.
			for (const mode of ["plan", "goal", "vibe"] as const) {
				const state = this.#inner.getModeState(mode);
				const serialized = JSON.stringify(state ?? null);
				if (serialized !== this.#lastModeStates[mode]) {
					this.#lastModeStates[mode] = serialized;
					this.#emit({ type: "mode_changed", mode, state: state ?? null });
				}
			}
			this.#emit({ type: "state_changed", stateVersion: event.stateVersion });
			return;
		}
		this.#emit(event as unknown as AgentEvent);
		if (event.type === "agent_end") {
			// The queue drains as turns unwind; surface the final state and the
			// idle transition. agent_end is terminal, so drop the stale
			// not-running fallback that would otherwise double-fire.
			this.#emitQueuedMessages();
			this.#lastRunningEvent = null;
			this.updateRunningState();
		} else if (
			event.type === "message_start" ||
			event.type === "turn_start" ||
			event.type === "turn_end" ||
			event.type === "auto_compaction_start" ||
			event.type === "auto_retry_start" ||
			event.type === "auto_retry_end" ||
			event.type === "tool_execution_start" ||
			event.type === "tool_execution_end"
		) {
			// Busy-state transitions can happen without an explicit event
			// listener on every path; re-derive after a microtask so all
			// streaming listeners see the current state.
			queueMicrotask(() => this.updateRunningState());
		}
	}

	/**
	 * Keep the client's "is streaming" contract honest even though the runtime
	 * streams its own events: the runtime session's isStreaming flag tracks
	 * provider streaming, which covers the web-ui's isPromptRunning intent.
	 */
	async #getState(): Promise<AgentState> {
		const inner = this.#inner;
		const model = inner.model;
		const state = inner.agent.state;
		const queued = inner.getQueuedMessages();
		const planState = inner.getPlanModeState();
		const planEnabled = planState?.enabled === true;
		const planFilePath = planState?.planFilePath ?? null;
		let planContent: string | undefined;
		if (planEnabled && planFilePath) {
			planContent = (await inner.getPlanFileContent(planFilePath)) ?? undefined;
		}
		const modes = {
			...(inner.getPlanModeState() ? { plan: inner.getPlanModeState() } : {}),
			...(inner.getGoalModeState() ? { goal: inner.getGoalModeState() } : {}),
			...(inner.getVibeModeState() ? { vibe: inner.getVibeModeState() } : {}),
		};
		return {
			sessionId: this.realSessionId,
			sessionName: inner.sessionManager.getSessionName() ?? "",
			model: model ? { provider: model.provider, modelId: model.id } : null,
			systemPrompt: state.systemPrompt.join("\n\n"),
			thinkingLevel: state.thinkingLevel === undefined ? "" : String(state.thinkingLevel),
			isStreaming: inner.isStreaming,
			isPromptRunning: inner.isStreaming,
			isBashRunning: inner.isBashRunning,
			isCompacting: inner.isCompacting,
			extensionStatuses: [...this.#extensionStatuses].map(([key, text]) => ({ key, text })),
			extensionWidgets: [...this.#extensionWidgets].map(([key, widget]) => ({
				key,
				lines: widget.lines,
				placement: widget.placement,
			})),
			queuedMessages: { steering: [...queued.steering], followUp: [...queued.followUp] },
			planModeEnabled: planEnabled,
			planFilePath,
			planContent,
			modes,
			modelRole: this.#currentModelRole(),
			activeToolNames: inner.getActiveToolNames(),
			autoCompactionEnabled: inner.autoCompactionEnabled,
			autoRetryEnabled: inner.autoRetryEnabled,
			stateVersion: inner.getStateVersion(),
		};
	}

	/**
	 * Resolve the session's current model role: the first configured role whose
	 * resolved model matches the active model. Returns null when the active
	 * model belongs to no configured role.
	 */
	#currentModelRole(): string | null {
		const model = this.#inner.model;
		if (!model) return null;
		const roles = this.#inner.settings.getModelRoles();
		for (const role of Object.keys(roles)) {
			const resolved = this.#inner.resolveRoleModelWithThinking(role);
			if (resolved.model && modelsAreEqual(model, resolved.model)) return role;
		}
		return null;
	}

	async send(command: AgentCommand): Promise<unknown> {
		if (this.#destroyed) {
			throw new Error("Agent session is not available");
		}
		const result = await this.#processCommand(command);
		this.updateRunningState();
		return result;
	}

	async #processCommand(command: AgentCommand): Promise<unknown> {
		switch (command.type) {
			case "prompt": {
				// The runtime owns steer/followUp queueing via `streamingBehavior`;
				// the legacy `chain`/`thinkingLevel` hints have no runtime
				// PromptOptions equivalent and are ignored (the web-ui client
				// never sends them; thinkingLevel goes through set_thinking_level).
				const { message, images, streamingBehavior } = command;
				await this.#inner.prompt(message, {
					...(images?.length ? { images: images as ImageContent[] } : {}),
					...(streamingBehavior ? { streamingBehavior } : {}),
				});
				return { ok: true };
			}
			case "steer":
				await this.#inner.steer(command.text, command.images as ImageContent[] | undefined);
				this.#emitQueuedMessages();
				return { ok: true };
			case "follow_up":
				await this.#inner.followUp(command.text, command.images as ImageContent[] | undefined);
				this.#emitQueuedMessages();
				return { ok: true };
			case "abort":
				this.#inner.abort();
				return { ok: true };
			case "get_state":
				return this.#getState();
			case "set_model": {
				const models = this.#inner.getAvailableModels();
				const model = models.find(m => m.provider === command.provider && m.id === command.modelId);
				if (!model) throw new Error(`Model not found: ${command.provider}/${command.modelId}`);
				const { switched } = await this.#inner.setModel(model);
				return { ok: switched };
			}
			case "fork": {
				const result = await this.#inner.branch(command.entryId);
				if (result.cancelled) return { cancelled: true };
				// branch() switched the session manager to the new file; the
				// wrapper now lives under the NEW id (web-ui contract:
				// `inner.sessionId` is the new session after fork).
				const newSessionId = this.#inner.sessionId;
				const newFile = this.#inner.sessionFile;
				if (newSessionId && newFile) {
					sessions.delete(this.realSessionId);
					cacheSessionPath(newSessionId, newFile);
					this.#rekey(newSessionId, newFile);
				}
				invalidateSessionListCache();
				return { cancelled: false, newSessionId };
			}
			case "navigate_tree": {
				const result = await this.#inner.navigateTree(command.entryId, {});
				return { cancelled: result.cancelled };
			}
			case "set_thinking_level":
				this.#inner.setThinkingLevel(command.level as ConfiguredThinkingLevel);
				return { ok: true };
			case "compact": {
				// The runtime has no manual-compaction events; the web-ui
				// contract drives its compacting modal off them. Emit
				// compaction_end on BOTH success and failure so the front-end
				// isCompacting state can never pin to true (a start without a
				// matching end leaves the button stuck on "Compacting…").
				this.#emit({ type: "compaction_start" });
				try {
					const result = await this.#inner.compact();
					const contextUsage = this.#inner.getContextUsage();
					const payload = {
						tokensBefore: result.tokensBefore,
						estimatedTokensAfter: contextUsage?.tokens ?? undefined,
						reason: "manual",
					};
					this.#emit({
						type: "compaction_end",
						result: { tokensBefore: payload.tokensBefore, estimatedTokensAfter: payload.estimatedTokensAfter },
						reason: "manual",
					});
					return payload;
				} catch (err) {
					this.#emit({
						type: "compaction_end",
						errorMessage: err instanceof Error ? err.message : String(err),
						reason: "manual",
					});
					throw err;
				}
			}
			case "set_session_name":
				await this.#inner.setSessionName(command.name.trim(), "user");
				invalidateSessionListCache();
				return { ok: true };
			case "get_session_stats": {
				const stats = this.#inner.getSessionStats();
				return { ...stats, sessionName: this.#inner.sessionManager.getSessionName() ?? "" };
			}
			case "get_last_assistant_text":
				return { text: this.#inner.getLastAssistantText() };
			case "set_auto_compaction":
				this.#inner.setAutoCompactionEnabled(command.enabled);
				return { ok: true };
			case "clear_queue":
				this.#inner.clearQueue();
				this.#emitQueuedMessages();
				return { ok: true };
			case "get_tools": {
				const active = new Set(this.#inner.getActiveToolNames());
				return this.#inner.getAllToolInfos().map(tool => ({
					name: tool.name,
					description: tool.description,
					active: active.has(tool.name),
				}));
			}
			case "get_commands":
				return getSessionSlashCommands(this.#inner);
			case "set_tools": {
				await this.#inner.setActiveToolsByName(command.toolNames);
				this.#applyToolsDisabledHack(command.toolNames.length === 0);
				return { ok: true };
			}
			case "reload":
				await this.#inner.reload();
				this.#applyToolsDisabledHack(this.#toolsDisabled);
				return { ok: true };
			case "abort_compaction":
				this.#inner.abortCompaction();
				// Pair the compaction_start emitted by the original compact
				// command: without an end event the web-ui isCompacting flag
				// sticks and the button stays on "Compacting…".
				this.#emit({ type: "compaction_end", aborted: true, reason: "manual" });
				return { ok: true };
			case "extension_ui_response": {
				const pending = this.#pendingUiRequests.get(command.id);
				if (pending) {
					this.#pendingUiRequests.delete(command.id);
					const response: ExtensionUiResponse = command.cancelled
						? { cancelled: true, timedOut: command.timedOut }
						: command.confirmed !== undefined
							? { confirmed: command.confirmed }
							: { value: command.value ?? "" };
					pending.resolve(response);
					// Tell SSE listeners the dialog closed so web clients can
					// drop the pending question/permission card even when the
					// reply came from a different tab than the one showing it.
					this.#emit({ type: "extension_ui_resolved", id: command.id });
				}
				return { ok: true };
			}
			case "extension_ui_input":
				// Custom UI components are not supported by the web gateway; the
				// client only sends input for custom components, which never
				// appear, so acknowledging keeps the protocol well-formed.
				return { ok: true };
			case "set_auto_retry":
				this.#inner.setAutoRetryEnabled(command.enabled);
				return { ok: true };
			case "bash": {
				const result = await this.#inner.executeBash(
					command.command,
					chunk => this.#emit({ type: "bash_chunk", text: chunk }),
					{ excludeFromContext: command.excludeFromContext ?? false },
				);
				return mapBashResult(result);
			}
			case "abort_bash":
				this.#inner.abortBash();
				return { ok: true };
			case "enter_plan_mode":
				await this.#inner.enterPlanMode(command.initialPrompt);
				return { ok: true };
			case "mode_enter":
				await this.#inner.enterMode(command.mode, command.options);
				return { ok: true };
			case "mode_exit":
				await this.#inner.exitMode(command.mode, command.options);
				return { ok: true };
			case "set_model_role": {
				// Reuse the CLI role-switch semantics: resolve the role's model
				// (+ explicit thinking suffix) and apply it as a temporary model
				// selection without persisting model settings.
				const resolved = this.#inner.resolveRoleModelWithThinking(command.role);
				if (!resolved.model) throw new Error(`No model resolved for role: ${command.role}`);
				await this.#inner.setModelTemporary(
					resolved.model,
					resolved.explicitThinkingLevel ? resolved.thinkingLevel : undefined,
				);
				return { ok: true };
			}
			case "plan_approve": {
				// Remote (web-ui PlanApproval / IM @plan) plan-approval execution.
				// Mirrors interactive-mode's approvePlan branches without TUI state.
				const localProtocolOptions: LocalProtocolOptions = {
					getArtifactsDir: () => this.#inner.sessionManager.getArtifactsDir(),
					getSessionId: () => this.#inner.sessionManager.getSessionId(),
				};
				const result = await approveRemotePlan(this.#inner, command, localProtocolOptions);
				return result;
			}
			default:
				throw new Error(`Unsupported command: ${(command as { type: string }).type}`);
		}
	}

	#rekey(newSessionId: string, newFile: string): void {
		const oldId = this.realSessionId;
		// The wrapper object identity must keep working for callers holding a
		// reference; swap the registry entry and let the mutable id fields
		// follow the inner session.
		this.realSessionId = newSessionId;
		this.sessionFile = newFile;
		sessions.set(newSessionId, this);
		removeRunningSession(oldId);
		// Registry was keyed under the old id; a request for the old id must
		// reload the original file cleanly (web-ui: destroy + reload).
	}

	/** The web-ui empty-tools contract: fully disabled tools force an empty system prompt. */
	#applyToolsDisabledHack(disabled: boolean): void {
		this.#toolsDisabled = disabled;
		if (disabled) {
			this.#inner.agent.state.systemPrompt = [];
		}
	}

	/** Route an extension UI request into the SSE stream. */
	dispatchUiRequest(request: ExtensionUiRequest): void {
		this.#emit(request as unknown as AgentEvent);
	}

	/** Register a pending extension UI dialog; resolved by extension_ui_response. */
	registerUiRequest(id: string, resolve: (response: ExtensionUiResponse) => void, cancel: () => void): void {
		this.#pendingUiRequests.set(id, { resolve, cancel });
	}

	/** Resolve a pending extension UI dialog by request id. Returns false if unknown. */
	resolveUiRequest(id: string, _response: ExtensionUiResponse): boolean {
		const pending = this.#pendingUiRequests.get(id);
		if (!pending) return false;
		this.#pendingUiRequests.delete(id);
		this.#emit({ type: "extension_ui_resolved", id });
		return true;
	}

	/** Track extension status/widget state for the get_state contract. */
	trackExtensionStatus(key: string, text: string | undefined): void {
		if (text === undefined) {
			this.#extensionStatuses.delete(key);
		} else {
			this.#extensionStatuses.set(key, text);
		}
	}

	trackExtensionWidget(
		key: string,
		lines: string[] | undefined,
		placement: "aboveEditor" | "belowEditor" | undefined,
	): void {
		if (lines === undefined) {
			this.#extensionWidgets.delete(key);
		} else {
			this.#extensionWidgets.set(key, { lines, placement: placement ?? "aboveEditor" });
		}
	}

	/** Reload the runtime's current thinking level etc. into the client contract. */
	destroy(): void {
		if (this.#destroyed) return;
		for (const pending of this.#pendingUiRequests.values()) {
			try {
				pending.cancel();
			} catch {
				// best-effort cancel
			}
		}
		sessions.delete(this.realSessionId);
	}
}

function mapBashResult(result: BashResult): {
	result: "success" | "error" | "cancelled";
	output: string;
	error: string | undefined;
	exitCode: number | undefined;
} {
	return {
		result: result.cancelled ? "cancelled" : result.exitCode === 0 ? "success" : "error",
		output: result.output,
		error: result.exitCode === 0 ? undefined : `Command failed with exit code ${result.exitCode ?? "unknown"}`,
		exitCode: result.exitCode,
	};
}

/** Resolve a pending extension UI dialog without addressing a session. */
export async function handleGlobalExtensionUiResponse(req: Request): Promise<Response> {
	let body: { id?: string; value?: string; confirmed?: boolean; cancelled?: boolean; timedOut?: boolean };
	try {
		body = (await req.json()) as typeof body;
	} catch {
		return json({ error: "Invalid JSON body" }, 400);
	}
	const id = typeof body.id === "string" ? body.id : "";
	if (!id) return json({ error: "id is required" }, 400);
	const ownerSessionId = uiRequestOwners.get(id);
	if (!ownerSessionId) return json({ error: "Unknown extension UI request id" }, 404);
	uiRequestOwners.delete(id);
	// Forward through the owning session's command channel — the pending
	// dialog lives in that session's RPC subprocess, not in this process.
	const command: Record<string, unknown> = { type: "extension_ui_response", id };
	if (body.cancelled) {
		command.cancelled = true;
		command.timedOut = body.timedOut;
	} else if (body.confirmed !== undefined) {
		command.confirmed = body.confirmed;
	} else {
		command.value = body.value ?? "";
	}
	return handleAgentCommand(
		new Request("http://local/forward", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(command),
		}),
		ownerSessionId,
	);
}

// ---------------------------------------------------------------------------
// Extension UI context (port of rpc-mode's RpcExtensionUIContext, routed
// through the SSE event stream and the wrapper's pending-response map)
// ---------------------------------------------------------------------------

function requestUiDialog<T>(
	wrapper: AgentSessionWrapper,
	emit: (request: ExtensionUiRequest) => void,
	request: ExtensionUiRequest,
	parse: (response: ExtensionUiResponse) => T,
): Promise<T> {
	const id = request.id;
	const { promise, resolve } = Promise.withResolvers<T>();
	wrapper.registerUiRequest(
		id,
		response => resolve(parse(response)),
		() => resolve(parse({ cancelled: true })),
	);
	if ("timeout" in request && typeof request.timeout === "number") {
		// Client-side dialogs own the timeout UX (they respond with
		// `cancelled: true, timedOut: true`); this timer is only a safety net
		// for a dropped SSE connection so the extension's await never hangs.
		setTimeout(() => {
			wrapper.resolveUiRequest(id, { cancelled: true, timedOut: true });
		}, request.timeout);
	}
	emit(request);
	return promise;
}

/** Build the ExtensionUIContext used by all sessions (web-ui event shapes). */
export function createGatewayUiContext(
	wrapper: AgentSessionWrapper,
	emit: (request: ExtensionUiRequest) => void,
): ExtensionUIContext {
	return {
		// The gateway client owns the dialog UI and answers on cancel with
		// `cancelled: true` — treat that as user cancellation, not a timeout,
		// so the ask tool reports "cancelled by the user" instead of aborting.
		timeoutStartsOnPresentation: false,
		select(title, options, dialogOptions) {
			return sendDialog(
				"select",
				{
					title,
					options: options.map(option => getExtensionUISelectOptionLabel(option)),
					timeout: dialogOptions?.timeout,
				},
				response => ("value" in response ? response.value : undefined),
			);
		},
		confirm(title, message, dialogOptions) {
			return sendDialog("confirm", { title, message, timeout: dialogOptions?.timeout }, response =>
				"confirmed" in response ? response.confirmed : false,
			);
		},
		input(title, placeholder, dialogOptions) {
			return sendDialog("input", { title, placeholder, timeout: dialogOptions?.timeout }, response =>
				"value" in response ? response.value : undefined,
			);
		},
		editor(title, prefill, dialogOptions) {
			return sendDialog("editor", { title, prefill, timeout: dialogOptions?.timeout }, response =>
				"value" in response ? response.value : undefined,
			);
		},
		notify(message, type) {
			emit({
				type: "extension_ui_request",
				id: Snowflake.next() as string,
				method: "notify",
				message,
				notifyType: type,
			});
		},
		setStatus(key, text) {
			wrapper.trackExtensionStatus(key, text);
			emit({
				type: "extension_ui_request",
				id: Snowflake.next() as string,
				method: "setStatus",
				statusKey: key,
				...(text !== undefined ? { statusText: text } : {}),
			});
		},
		setWidget(key, content, options) {
			wrapper.trackExtensionWidget(key, Array.isArray(content) ? content : undefined, options?.placement);
			emit({
				type: "extension_ui_request",
				id: Snowflake.next() as string,
				method: "setWidget",
				widgetKey: key,
				...(Array.isArray(content) ? { widgetLines: content } : {}),
				widgetPlacement: options?.placement,
			});
		},
		setTitle(title) {
			emit({ type: "extension_ui_request", id: Snowflake.next() as string, method: "setTitle", title });
		},
		setEditorText(text) {
			emit({ type: "extension_ui_request", id: Snowflake.next() as string, method: "set_editor_text", text });
		},
		pasteToEditor(text) {
			this.setEditorText(text);
		},
		getEditorText() {
			return "";
		},
		async custom(): Promise<never> {
			throw new Error("Custom UI is not supported by the web gateway");
		},
		onTerminalInput() {
			return () => {};
		},
		setWorkingMessage() {},
		setFooter() {},
		setHeader() {},
		addAutocompleteProvider() {},
		setEditorComponent() {},
		// Intentionally no `askDialog`: its mere presence would route AskTool
		// through the rich-dialog path, whose unresolved promise resolves to
		// `undefined` and turns every ask into "cancelled by the user". Omitting
		// it makes ask.ts fall back to `ui.select`, which emits
		// `extension_ui_request(method=select)` over SSE and resolves through
		// the gateway's `extension_ui_response` route (the QuestionCard path).
		get theme(): never {
			throw new Error("Theme access is not supported by the web gateway");
		},
		getAllThemes() {
			return Promise.resolve([]);
		},
		getTheme() {
			return Promise.resolve(undefined);
		},
		setTheme() {
			return Promise.resolve({ success: false, error: "Theme switching is not supported by the web gateway" });
		},
		getToolsExpanded() {
			return false;
		},
		setToolsExpanded() {},
	};

	function sendDialog<T>(
		method: "select" | "confirm" | "input" | "editor",
		payload: Record<string, unknown>,
		parse: (response: ExtensionUiResponse) => T,
	): Promise<T> {
		const id = Snowflake.next() as string;
		const request = { type: "extension_ui_request", id, method, ...payload } as ExtensionUiRequest;
		return requestUiDialog(wrapper, emit, request, parse);
	}
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function openSessionManagerForAgent(filePath: string, cwd?: string): Promise<SessionManager> {
	return SessionManager.open(filePath, cwd, undefined, { suppressBreadcrumb: true });
}

/**
 * Get or start the live wrapper for a session. Mirrors web-ui
 * `startRpcSession`: concurrent callers sharing `key` coalesce onto one start
 * promise. `sessionFile` empty means a brand-new session rooted at `cwd`.
 * `channelHooks` wire the IM channel tools (`channel_send` / `workspace_run`)
 * into the session's ToolSession — only the coordinator session (web/desktop
 * mode) supplies them.
 */
export interface SessionChannelHooks {
	channelSend?: (opts: { text: string; to?: string; channel?: string }) => Promise<void>;
	workspaceRun?: (opts: { workspace: string; task: string }) => Promise<{ reply: string }>;
	/** Natural-language IM control (`im_control` tool) bound to this session. */
	imControl?: (params: ImControlParams) => Promise<ImControlResult>;
}

export async function startRpcSession(
	key: string,
	sessionFile: string,
	cwd?: string,
	toolNames?: string[],
	channelHooks?: SessionChannelHooks,
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
	const existingLock = startLocks.get(key);
	if (existingLock) return existingLock;

	const start = (async () => {
		let manager: SessionManager;
		if (sessionFile) {
			manager = await openSessionManagerForAgent(sessionFile, cwd);
		} else {
			manager = SessionManager.create(cwd ?? process.cwd());
		}

		const realSessionId = manager.getSessionId();
		const existing = sessions.get(realSessionId);
		if (existing?.isAlive()) {
			return { session: existing, realSessionId };
		}

		const agentDir = getAgentDir();
		const { session, setToolUIContext } = await createAgentSession({
			cwd: manager.getCwd(),
			agentDir,
			sessionManager: manager,
			channelSend: channelHooks?.channelSend,
			workspaceRun: channelHooks?.workspaceRun,
			imControl: channelHooks?.imControl,
			// Serve-hosted sessions own a real UI backend: createGatewayUiContext
			// below routes select/editor over SSE (`extension_ui_request`) and
			// resolves them via the `extension_ui_response` command. Declaring
			// hasUI here lets UI-gated tools (AskTool) register at all.
			hasUI: true,
		});

		const wrapper = new AgentSessionWrapper(session, realSessionId, sessionFile || manager.getSessionFile() || null);
		const uiContext = createGatewayUiContext(wrapper, request => wrapper.dispatchUiRequest(request));
		setToolUIContext(uiContext, true);
		sessions.set(realSessionId, wrapper);
		// New sessions have a session file on disk only after the first save,
		// but the id->path mapping is needed immediately (resolveSessionPath).
		if (sessionFile || manager.getSessionFile())
			cacheSessionPath(realSessionId, sessionFile || manager.getSessionFile()!);

		if (toolNames) {
			await session.setActiveToolsByName(toolNames);
			if (toolNames.length === 0) {
				session.agent.state.systemPrompt = [];
			}
		}
		wrapper.updateRunningState();
		return { session: wrapper, realSessionId };
	})();

	startLocks.set(key, start);
	try {
		return await start;
	} finally {
		startLocks.delete(key);
	}
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

export async function handleAgentNew(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { cwd?: string; type?: string; [key: string]: unknown };
		const { cwd, ...command } = body;
		if (!cwd || typeof cwd !== "string") {
			return json({ error: "cwd is required" }, 400);
		}
		try {
			const stat = statSync(cwd);
			if (!stat.isDirectory()) {
				return json({ error: `Not a directory: ${cwd}` }, 400);
			}
		} catch {
			return json({ error: `Directory does not exist: ${cwd}` }, 400);
		}

		const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } = command as {
			provider?: string;
			modelId?: string;
			toolNames?: string[];
			thinkingLevel?: string;
			type: string;
			[key: string]: unknown;
		};

		const tempKey = `__new__${randomUUID()}`;
		const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames);

		if (provider && modelId) {
			await session.send({ type: "set_model", provider, modelId });
		}
		if (thinkingLevel) {
			await session.send({ type: "set_thinking_level", level: thinkingLevel });
		}

		if (promptCommand.type === "ensure_session") {
			return json({ success: true, sessionId: realSessionId, data: null });
		}

		const result = await session.send(promptCommand as AgentCommand);
		return json({ success: true, sessionId: realSessionId, data: result });
	} catch (error) {
		logger.error("web-gateway: agent new failed", { error: String(error) });
		return json({ error: String(error) }, 500);
	}
}

export async function handleAgentCommand(req: Request, sessionId: string): Promise<Response> {
	try {
		const body = (await req.json()) as AgentCommand;
		const existing = sessions.get(sessionId);
		if (existing?.isAlive()) {
			const result = await existing.send(body);
			return json({ success: true, data: result });
		}

		const filePath = await resolveSessionPath(sessionId);
		if (!filePath) {
			return json({ error: "Session not found" }, 404);
		}

		const { session } = await startRpcSession(sessionId, filePath);
		const result = await session.send(body);
		return json({ success: true, data: result });
	} catch (error) {
		logger.error("web-gateway: agent command failed", { sessionId, error: String(error) });
		return json({ error: String(error) }, 500);
	}
}

export async function handleAgentState(sessionId: string): Promise<Response> {
	try {
		const session = sessions.get(sessionId);
		if (!session?.isAlive()) {
			return json({ running: false });
		}
		const state = await session.send({ type: "get_state" });
		return json({ running: true, state });
	} catch (error) {
		logger.error("web-gateway: agent state failed", { sessionId, error: String(error) });
		return json({ error: String(error) }, 500);
	}
}

export async function handleAgentEvents(_req: Request, sessionId: string): Promise<Response> {
	let session = sessions.get(sessionId);
	if (!session?.isAlive()) {
		const filePath = await resolveSessionPath(sessionId);
		if (!filePath) {
			return new Response("Session not found", { status: 404 });
		}
		try {
			({ session } = await startRpcSession(sessionId, filePath));
		} catch (error) {
			return new Response(`Failed to start agent: ${String(error)}`, { status: 500 });
		}
	}

	const stream = new ReadableStream({
		start(controller) {
			const encode = (data: unknown) => {
				controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
			};

			encode({ type: "connected", sessionId });

			const unsubscribe = session.onEvent(event => {
				if (
					event &&
					typeof event === "object" &&
					"type" in event &&
					event.type === "extension_ui_request" &&
					"id" in event &&
					typeof event.id === "string" &&
					event.id.length > 0
				) {
					uiRequestOwners.set(event.id, sessionId);
				}
				encode(event);
			});

			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(new TextEncoder().encode(":\n\n"));
				} catch {
					// controller already closed
				}
			}, 30_000);

			const cleanup = () => {
				clearInterval(heartbeat);
				unsubscribe();
				controller.close();
			};
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}

export async function handleRunningEvents(req: Request): Promise<Response> {
	const stream = new ReadableStream({
		start(controller) {
			const encode = (data: unknown) => {
				controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
			};

			const unsubscribe = subscribeRunningSessions(ids => {
				try {
					encode({ type: "running", runningSessionIds: ids });
				} catch {
					// controller already closed
				}
			});

			encode({ type: "running", runningSessionIds: getRunningSessionIds() });

			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(new TextEncoder().encode(":\n\n"));
				} catch {
					// controller already closed
				}
			}, 30_000);

			const cleanup = () => {
				clearInterval(heartbeat);
				unsubscribe();
				try {
					controller.close();
				} catch {
					// already closed
				}
			};
			req.signal?.addEventListener("abort", cleanup);
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}

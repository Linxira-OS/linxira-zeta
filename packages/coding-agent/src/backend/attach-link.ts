/**
 * TUI transport for a session owned by a running `zetacode serve` backend.
 *
 * The renderer does not change: this link mirrors the backend session into the
 * local `AgentSession` replica file (so `renderInitialMessages`, `/tree`,
 * context math and the status line all read native session state), feeds the
 * backend's SSE events through `EventController` exactly like a local turn,
 * and forwards prompts/aborts/dialog answers over the gateway RPC surface.
 *
 * The backend remains the owner: detaching closes the stream only, never the
 * backend or its session. Mirrors the collab guest's replica strategy.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentMessage } from "@linxiraos/pi-agent-core";
import type { ImageContent } from "@linxiraos/pi-ai";
import { getConfigRootDir, isRecord, logger } from "@linxiraos/pi-utils";
import { toReasoningEffort } from "@linxiraos/pi-tui/thinking";
import type { ExtensionAskDialogQuestion } from "../extensibility/extensions/types";
import type { InteractiveModeContext } from "../modes/types";
import { mintSessionId } from "../session/session-manager";
import {
	CURRENT_SESSION_VERSION,
	type SessionEntry,
	type SessionHeader,
	type SessionMessageEntry,
} from "../session/session-entries";
import { FileSessionStorage } from "../session/session-storage";
import { setSessionTerminalTitle } from "../utils/title-generator";
import { AttachWire } from "./attach-wire";
import { BackendClient, type BackendEvent, type BackendSessionDetail, type BackendSessionInfo } from "./client";
import type { ResolvedBackendTarget } from "./attach-intent";

/** Gateway plan approval modes (`plan_approve` command). */
type PlanApproveMode = "preserve" | "compact" | "fresh" | "cancel";

interface PendingDialog {
	abort: AbortController;
}

/** Runtime messages persist an ISO timestamp; unknown payloads do not. */
function messageTimestamp(message: unknown): string | undefined {
	if (message && typeof message === "object" && "timestamp" in message) {
		const timestamp = message.timestamp;
		if (typeof timestamp === "string") return timestamp;
		if (typeof timestamp === "number") return new Date(timestamp).toISOString();
	}
	return undefined;
}

export interface BackendAttachJoinOptions {
	/** Where the replica file lives (config root, never the sessions dir). */
	replicaDir?: string;
}

/**
 * Live client link for the interactive TUI. Construct once per attach; `join`
 * resolves the target, writes the replica and starts the event stream.
 */
export class BackendAttachLink {
	readonly client: BackendClient;
	#target: ResolvedBackendTarget;
	#ctx: InteractiveModeContext;
	#abort = new AbortController();
	#applyChain: Promise<void> = Promise.resolve();
	#closed = false;
	#joined = false;
	#sessionId = "";
	#knownEntryIds = new Set<string>();
	#pendingDialogs = new Map<string, PendingDialog>();
	#assistantStreamSynced = false;
	#replicaLease: (() => void) | undefined;
	#lastSeq = 0;
	#streaming = false;
	/** Protocol control plane; absent when the backend predates the WS plane. */
	#wire: AttachWire | undefined;
	/** Mirrors the replica's own model/thinking switches to the backend. */
	#unsubscribeLocal: (() => void) | undefined;
	replicaPath: string | undefined;

	constructor(ctx: InteractiveModeContext, target: ResolvedBackendTarget, options: BackendAttachJoinOptions = {}) {
		this.#ctx = ctx;
		this.#target = target;
		this.client = new BackendClient(target.backend.baseUrl);
		this.#replicaDir = options.replicaDir ?? path.join(getConfigRootDir(), "backend");
	}

	readonly #replicaDir: string;

	get sessionId(): string {
		return this.#sessionId;
	}

	get attached(): boolean {
		return this.#joined && !this.#closed;
	}

	/** Backend turn activity (drives Esc/loading decisions; the replica is idle). */
	get streaming(): boolean {
		return this.#streaming;
	}

	/** Resolve/create the backend session, mirror it, and start the event stream. */
	async join(): Promise<void> {
		if (this.#joined) return;
		if (this.#ctx.collabGuest) throw new Error("Already in a collab session; /leave first");

		const { sessionId } = await this.client.resolveSession({
			cwd: this.#ctx.sessionManager.getCwd(),
			sessionId: this.#target.sessionId,
			newSession: this.#target.newSession,
			signal: this.#abort.signal,
		});
		this.#sessionId = sessionId;
		// The control plane is the wire protocol. The REST command path stays as
		// the fallback for a backend without it, and SSE keeps mirroring either
		// way; only dialogs move to the socket, so they are not presented twice.
		try {
			this.#wire = await AttachWire.connect({
				baseUrl: this.#target.backend.baseUrl,
				sessionId,
				onDialog: event => void this.#presentUiRequest(event),
				onDialogResolved: id => {
					this.#pendingDialogs.get(id)?.abort.abort();
					this.#pendingDialogs.delete(id);
				},
				onClose: reason => {
					if (this.#closed) return;
					this.#wire = undefined;
					logger.warn("backend attach protocol link closed", { reason });
					this.#ctx.showStatus("Backend protocol link closed; using the HTTP control plane.", { dim: true });
				},
			});
		} catch (error) {
			logger.debug("backend attach: protocol link unavailable", { error: String(error) });
		}
		const detail = await this.client.getSession(sessionId, this.#abort.signal);
		await this.#activateReplica(detail);
		if (this.#closed) return;

		// The event stream auto-starts the backend session from disk and streams
		// live turn/tool/dialog frames. Started only after the snapshot so a
		// frame cannot duplicate an entry already in the replica.
		void this.#pumpEvents();
		this.#joined = true;
		this.#ctx.backendAttach = this;
		// The replica is a real session: `/model` and `/thinking` switch it. When
		// a control plane is attached, the backend owns the turn, so the same
		// switches must reach it; otherwise the UI and the run disagree.
		this.#unsubscribeLocal = this.#ctx.session.subscribe(event => {
			if (!this.#wire) return;
			if (event.type === "model_changed") {
				const model = this.#ctx.session.model;
				if (!model) return;
				void this.#wire
					.setModel(model.provider, model.id)
					.catch(error => this.#ctx.showWarning(`Backend model switch failed: ${String(error)}`));
			} else if (event.type === "thinking_level_changed" && event.thinkingLevel) {
				void this.#wire
					.setThinking(event.thinkingLevel)
					.catch(error => this.#ctx.showWarning(`Backend thinking switch failed: ${String(error)}`));
			}
		});

		setSessionTerminalTitle(
			detail.info?.name ?? detail.info?.firstMessage ?? this.#ctx.sessionManager.getSessionName(),
			detail.info?.cwd ?? this.#ctx.sessionManager.getCwd(),
		);
		this.#ctx.showStatus(`Attached to backend session ${sessionId}`, { dim: true });
	}

	/**
	 * Send user input to the backend. Enter steers a live turn (matching the
	 * TUI's streaming semantics); Ctrl+Enter queues a follow-up.
	 */
	sendPrompt(text: string, images?: ImageContent[], behavior?: "steer" | "followUp"): void {
		if (this.#closed) throw new Error("Backend attachment is closed");
		if (this.#wire) {
			const effective = behavior ?? (this.#streaming ? "steer" : undefined);
			void this.#wire.sendPrompt(text, { images, behavior: effective }).catch(error => {
				this.#ctx.showError(`Backend prompt failed: ${error instanceof Error ? error.message : String(error)}`);
			});
			return;
		}
		const payload = images && images.length > 0 ? { images } : {};
		const command = behavior
			? behavior === "steer"
				? { type: "steer", text, ...payload }
				: { type: "follow_up", text, ...payload }
			: this.#streaming
				? { type: "steer", text, ...payload }
				: { type: "prompt", message: text, ...payload };
		void this.client.send(this.#sessionId, command).catch(error => {
			this.#ctx.showError(`Backend prompt failed: ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	/** Cancel the backend's in-flight turn. */
	sendAbort(): void {
		if (this.#closed) return;
		if (this.#wire) {
			void this.#wire.abort().catch(error => {
				logger.warn("backend attach abort failed", { error: String(error) });
			});
			return;
		}
		void this.client.send(this.#sessionId, { type: "abort" }).catch(error => {
			logger.warn("backend attach abort failed", { error: String(error) });
		});
	}

	/** Stop mirroring. The backend session keeps running. */
	async detach(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#wire?.close();
		this.#wire = undefined;
		this.#unsubscribeLocal?.();
		this.#unsubscribeLocal = undefined;
		this.#abort.abort();
		for (const dialog of this.#pendingDialogs.values()) dialog.abort.abort();
		this.#pendingDialogs.clear();
		await this.#applyChain.catch(() => undefined);
		this.#replicaLease?.();
		this.#replicaLease = undefined;
		this.#ctx.backendAttach = undefined;
		this.#ctx.syncRunningSubagentBadge();
		// The replica file is a valid standalone session outside the sessions
		// dir; leave it on disk (same contract as a collab replica).
	}

	async #activateReplica(detail: BackendSessionDetail): Promise<void> {
		const now = new Date().toISOString();
		const entries: SessionEntry[] = [];
		let parentId: string | null = null;
		const messages = detail.context?.messages ?? [];
		const entryIds = detail.context?.entryIds ?? [];
		for (let index = 0; index < messages.length; index++) {
			const message = messages[index] as AgentMessage;
			const id = entryIds[index] ?? mintSessionId();
			const entry: SessionMessageEntry = {
				type: "message",
				id,
				parentId,
				timestamp: messageTimestamp(message) ?? now,
				message,
			};
			entries.push(entry);
			this.#knownEntryIds.add(id);
			parentId = id;
		}

		const snapshot = detail.context?.messages?.length ?? 0;
		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: mintSessionId(),
			timestamp: now,
			cwd: detail.info?.cwd || this.#ctx.sessionManager.getCwd(),
			client: "cli",
		};
		const replicaPath = path.join(this.#replicaDir, `${this.#sessionId}-${header.id}.jsonl`);
		await fs.mkdir(this.#replicaDir, { recursive: true });
		const storage = new FileSessionStorage();
		this.#replicaLease = storage.claimSession(header.id, replicaPath) ?? undefined;
		const body = [header, ...entries].map(entry => JSON.stringify(entry)).join("\n");
		const tempPath = `${replicaPath}.${mintSessionId()}.tmp`;
		try {
			await Bun.write(tempPath, `${body}\n`);
			await fs.rename(tempPath, replicaPath);
		} catch (error) {
			await fs.unlink(tempPath).catch(() => undefined);
			throw error;
		}
		this.replicaPath = replicaPath;

		const switched = await this.#ctx.session.switchSession(replicaPath, { keepModel: true });
		if (switched === false) throw new Error("Backend attach was cancelled while switching sessions");
		this.#applyContextState(detail);
		this.#ctx.showStatus(
			snapshot > 0
				? `Attached to backend session (${snapshot} message${snapshot === 1 ? "" : "s"})`
				: "Attached to backend session",
			{ dim: true },
		);
	}

	/** Mirror model/thinking state without writing local session entries. */
	#applyContextState(detail: BackendSessionDetail): void {
		const session = this.#ctx.session;
		const contextModel = detail.context?.model;
		if (contextModel) {
			const model = session.modelRegistry.find(contextModel.provider, contextModel.modelId);
			if (
				model &&
				(session.agent.state.model?.id !== model.id || session.agent.state.model?.provider !== model.provider)
			) {
				session.agent.setModel(model);
			}
		}
		const thinkingLevel = detail.context?.thinkingLevel;
		if (thinkingLevel) {
			session.agent.setThinkingLevel(toReasoningEffort(thinkingLevel as never));
		}
	}

	async #pumpEvents(): Promise<void> {
		try {
			for await (const event of this.client.events(this.#sessionId, {
				since: this.#lastSeq,
				signal: this.#abort.signal,
			})) {
				if (this.#closed) break;
				this.#applyChain = this.#applyChain
					.then(() => this.#applyEvent(event))
					.catch(error => {
						logger.warn("backend attach event failed", { type: event.type, error: String(error) });
					});
			}
		} catch (error) {
			if (this.#closed || this.#abort.signal.aborted) return;
			this.#ctx.showError(`Backend event stream closed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async #applyEvent(event: BackendEvent): Promise<void> {
		if (event.type === "agent_start" || event.type === "running") this.#streaming = true;
		if (event.type === "agent_end" || event.type === "not-running") this.#streaming = false;
		switch (event.type) {
			case "connected":
				return;
			case "resync":
				this.#ctx.showWarning("Backend stream fell behind; reconnecting to the live view.");
				return;
			case "session_entry": {
				const seq = typeof event.seq === "number" ? event.seq : undefined;
				if (seq !== undefined) this.#lastSeq = Math.max(this.#lastSeq, seq);
				const entry = event.entry;
				if (!isRecord(entry) || typeof entry.id !== "string") return;
				if (this.#knownEntryIds.has(entry.id)) return;
				this.#knownEntryIds.add(entry.id);
				this.#ctx.sessionManager.ingestReplicatedEntry(entry as unknown as SessionEntry);
				if (entry.type === "message" && isRecord(entry.message)) {
					// A durable backend write carries the runtime AgentMessage shape.
					const message = entry.message as unknown as SessionMessageEntry["message"];
					this.#ctx.session.agent.replaceMessages([...this.#ctx.session.messages, message]);
				}
				return;
			}
			case "extension_ui_request":
				// With a protocol link the socket delivers dialogs directly.
				if (!this.#wire) await this.#presentUiRequest(event);
				return;
			case "extension_ui_resolved": {
				if (this.#wire) return;
				const id = typeof event.id === "string" ? event.id : undefined;
				if (id) {
					this.#pendingDialogs.get(id)?.abort.abort();
					this.#pendingDialogs.delete(id);
				}
				return;
			}
			case "plan_proposed":
				await this.#presentPlanApproval(event);
				return;
			case "mode_changed":
				this.#applyModeEvent(event);
				return;
			case "state_changed":
			case "queue_update":
			case "running":
			case "not-running":
			case "connected_state":
				return;
			default:
				break;
		}

		// Turn/tool/message frames use the runtime event vocabulary; the local
		// controller is transport-agnostic once it receives them.
		if (event.type === "message_start" && isRecord(event.message) && event.message.role === "assistant") {
			this.#assistantStreamSynced = true;
		} else if (
			event.type === "message_update" &&
			isRecord(event.message) &&
			event.message.role === "assistant" &&
			!this.#assistantStreamSynced
		) {
			this.#assistantStreamSynced = true;
			await this.#ctx.eventController.dispatchSessionEvent({
				type: "message_start",
				message: event.message,
			} as never);
		}
		await this.#ctx.eventController.dispatchSessionEvent(event as never);
	}

	#applyModeEvent(event: BackendEvent): void {
		const mode = event.mode;
		if (mode !== "plan" && mode !== "goal" && mode !== "vibe") return;
		const state = event.state;
		const enabled = isRecord(state) && state.enabled === true;
		if (mode === "plan") this.#ctx.planModeEnabled = enabled;
		if (mode === "goal") this.#ctx.goalModeEnabled = enabled;
		if (mode === "vibe") this.#ctx.vibeModeEnabled = enabled;
		this.#ctx.updateEditorBorderColor();
		this.#ctx.ui.requestRender();
	}

	/** Answer a backend extension dialog through the same TUI primitives. */
	async #presentUiRequest(event: BackendEvent): Promise<void> {
		const id = typeof event.id === "string" ? event.id : undefined;
		const method = typeof event.method === "string" ? event.method : undefined;
		if (!id || !method) return;
		if (method === "cancel") {
			const targetId = typeof event.targetId === "string" ? event.targetId : undefined;
			if (targetId) {
				this.#pendingDialogs.get(targetId)?.abort.abort();
				this.#pendingDialogs.delete(targetId);
			}
			return;
		}
		if (method === "notify") {
			const notifyType = event.notifyType === "warning" || event.notifyType === "error" ? event.notifyType : "info";
			this.#ctx.showHookNotify(String(event.message ?? ""), notifyType);
			return;
		}
		if (method === "setStatus") {
			this.#ctx.setHookStatus(
				String(event.statusKey ?? ""),
				event.statusText === undefined ? undefined : String(event.statusText),
			);
			return;
		}
		if (method === "setWidget") {
			const lines = Array.isArray(event.widgetLines) ? event.widgetLines.map(String) : undefined;
			this.#ctx.setHookWidget(String(event.widgetKey ?? ""), lines ?? [], {
				placement: event.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor",
			});
			return;
		}
		if (method === "setTitle") {
			this.#ctx.showStatus(String(event.title ?? ""));
			return;
		}
		if (method === "set_editor_text") {
			this.#ctx.editor.setText(String(event.text ?? ""));
			this.#ctx.ui.requestRender();
			return;
		}
		if (method === "custom") return; // custom UI components are not part of the TUI client

		const abort = new AbortController();
		this.#pendingDialogs.set(id, { abort });
		const signal = abort.signal;
		try {
			if (method === "select") {
				const options = Array.isArray(event.options) ? event.options.map(String) : [];
				const value = await this.#ctx.showHookSelector(String(event.title ?? ""), options, { signal });
				await this.#respond(id, value === undefined ? { cancelled: true } : { value });
			} else if (method === "confirm") {
				const title = `${String(event.title ?? "")}\n${String(event.message ?? "")}`;
				const value = await this.#ctx.showHookSelector(title, ["Yes", "No"], { signal });
				await this.#respond(id, value === undefined ? { cancelled: true } : { confirmed: value === "Yes" });
			} else if (method === "input") {
				const placeholder = typeof event.placeholder === "string" ? event.placeholder : undefined;
				const value = await this.#ctx.showHookInput(String(event.title ?? ""), placeholder);
				await this.#respond(id, value === undefined ? { cancelled: true } : { value });
			} else if (method === "editor") {
				const prefill = typeof event.prefill === "string" ? event.prefill : undefined;
				const value = await this.#ctx.showHookEditor(String(event.title ?? ""), prefill, { signal });
				await this.#respond(id, value === undefined ? { cancelled: true } : { value });
			} else if (method === "ask") {
				const questions = Array.isArray(event.questions) ? (event.questions as ExtensionAskDialogQuestion[]) : [];
				const result = await this.#ctx.showAskDialog(questions, { signal });
				if (!result || result.kind !== "submit") {
					await this.#respond(id, { cancelled: true });
				} else {
					await this.#respond(id, {
						answers: result.results.map(item => ({
							id: item.id,
							selectedOptions: item.selectedOptions,
							...(item.customInput !== undefined ? { customInput: item.customInput } : {}),
							...(item.note !== undefined ? { note: item.note } : {}),
						})),
					});
				}
			} else {
				await this.#respond(id, { cancelled: true });
			}
		} catch (error) {
			logger.warn("backend attach dialog failed", { method, error: String(error) });
			await this.#respond(id, { cancelled: true }).catch(() => undefined);
		} finally {
			this.#pendingDialogs.delete(id);
		}
	}

	async #respond(id: string, body: Record<string, unknown>): Promise<void> {
		if (this.#wire) {
			this.#wire.respond(id, body);
			return;
		}
		await this.client.respondExtensionUi({ id, ...body }, this.#abort.signal);
	}

	/** Plan review over the wire: the TUI picks a mode, the backend executes it. */
	async #presentPlanApproval(event: BackendEvent): Promise<void> {
		const planFilePath = typeof event.planFilePath === "string" ? event.planFilePath : undefined;
		const title = typeof event.title === "string" && event.title ? event.title : "Plan ready";
		const options = ["Approve and execute", "Approve and compact context", "Refine plan", "Cancel"];
		const choice = await this.#ctx.showHookSelector(`${title}\n${planFilePath ?? ""}`, options);
		if (choice === undefined || choice === "Refine plan") return;
		const mode: PlanApproveMode =
			choice === "Approve and execute"
				? "preserve"
				: choice === "Approve and compact context"
					? "compact"
					: "cancel";
		if (!planFilePath) return;
		if (this.#wire) {
			await this.#wire
				.approvePlan(planFilePath, mode)
				.catch(error =>
					this.#ctx.showError(
						`Backend plan approval failed: ${error instanceof Error ? error.message : String(error)}`,
					),
				);
			return;
		}
		await this.client
			.send(this.#sessionId, { type: "plan_approve", planFilePath, mode })
			.catch(error =>
				this.#ctx.showError(
					`Backend plan approval failed: ${error instanceof Error ? error.message : String(error)}`,
				),
			);
	}

	/** Look up a session by id for addressing (`--attach-session`). */
	static async findSession(client: BackendClient, sessionId: string): Promise<BackendSessionInfo | undefined> {
		const { sessions } = await client.listSessions();
		return sessions.find(session => session.id === sessionId);
	}
}

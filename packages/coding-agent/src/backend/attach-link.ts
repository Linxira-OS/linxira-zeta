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
import type { BackendLoopState } from "../loop/continuation-controller";
import { FileSessionStorage } from "../session/session-storage";
import { setSessionTerminalTitle } from "../utils/title-generator";
import { AttachWire } from "./attach-wire";
import { workspaceBranch } from "../session/workspace-branch";
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
	/** In-flight `state_changed` refresh (coalesces bursts). */
	#stateRefresh: Promise<void> | undefined;
	/** Protocol control plane; absent when the backend predates the WS plane. */
	#wire: AttachWire | undefined;
	/** Mirrors the replica's own model/thinking switches to the backend. */
	#unsubscribeLocal: (() => void) | undefined;
	/** Last mode enablement mirrored from the replica (null before the first read). */
	#lastModes: Record<"plan" | "goal" | "vibe", boolean | null> = { plan: null, goal: null, vibe: null };
	/** Replica goal id last seen paused; a re-enable of that id is a resume. */
	#pausedGoalId: string | undefined;
	/** Backend-owned loop snapshot (`null` when off). */
	#loopState: BackendLoopState | null = null;
	/** Bumped by every pushed `loop_state`; a stale `get_state` must not clobber it. */
	#loopStateSeq = 0;
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

	/** The backend loop state last mirrored; `null` when no loop is active. */
	get loopState(): BackendLoopState | null {
		return this.#loopState;
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

		const cwd = this.#ctx.sessionManager.getCwd();
		const branch = workspaceBranch(cwd);
		const { sessionId } = await this.client.resolveSession({
			cwd,
			branch,
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
				onCommandOutput: text => {
					if (this.#closed) return;
					this.#ctx.showStatus(text, { dim: true });
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
		// A session belongs to the workspace and branch it was created on. An
		// explicit id can name another one; say so instead of silently editing a
		// transcript from a different checkout.
		const sessionBranch = detail.info?.branch ?? null;
		const sessionCwd = detail.info?.cwd ?? cwd;
		if (sessionBranch && branch && sessionBranch !== branch) {
			this.#ctx.showWarning(
				`Attached session runs on ${sessionBranch}, this workspace is on ${branch}; prompts still go to the session's ${sessionCwd}.`,
			);
		}
		await this.#activateReplica(detail);
		if (this.#closed) return;

		// The event stream auto-starts the backend session from disk and streams
		// live turn/tool/dialog frames. Started only after the snapshot so a
		// frame cannot duplicate an entry already in the replica.
		void this.#pumpEvents();
		this.#joined = true;
		this.#ctx.backendAttach = this;
		// Pick up state that is not part of the transcript snapshot (an active
		// loop, todos, the backend model) before the first frame arrives.
		this.#scheduleStateRefresh();
		// The replica is a real session: `/model` and `/thinking` switch it. When
		// a control plane is attached, the backend owns the turn, so the same
		// switches must reach it; otherwise the UI and the run disagree.
		const session = this.#ctx.session;
		this.#lastModes.plan = Boolean(session.getPlanModeState()?.enabled);
		this.#lastModes.goal = Boolean(session.getGoalModeState()?.enabled);
		this.#lastModes.vibe = Boolean(session.getVibeModeState()?.enabled);
		this.#pausedGoalId =
			session.getGoalModeState()?.goal?.status === "paused" ? session.getGoalModeState()?.goal?.id : undefined;
		this.#unsubscribeLocal = session.subscribe(event => {
			if (!this.#wire) return;
			if (event.type === "state_version_changed") {
				// Plan/goal/vibe live on the replica until the run does; every
				// transition emits this event, so diffing is lossless. The entry
				// options travel with the command: without them a goal loses its
				// objective/budget and a plan loses its file/workflow.
				const wire = this.#wire;
				const warn = (mode: string) => (error: unknown) =>
					this.#ctx.showWarning(`Backend ${mode} mode switch failed: ${String(error)}`);

				const planState = session.getPlanModeState();
				const planOn = Boolean(planState?.enabled);
				if (this.#lastModes.plan !== planOn) {
					this.#lastModes.plan = planOn;
					void (
						planOn
							? wire.enterMode("plan", {
									planFilePath: planState?.planFilePath,
									workflow: planState?.workflow,
									reentry: planState?.reentry,
									enteredBy: planState?.enteredBy,
									objective: planState?.objective,
								})
							: wire.exitMode("plan")
					).catch(warn("plan"));
				}

				const goalState = session.getGoalModeState();
				const goalOn = Boolean(goalState?.enabled);
				if (this.#lastModes.goal !== goalOn) {
					this.#lastModes.goal = goalOn;
					if (goalOn) {
						const resuming = goalState?.goal?.id !== undefined && goalState.goal.id === this.#pausedGoalId;
						this.#pausedGoalId = undefined;
						void (
							resuming
								? wire.resumeGoal()
								: wire.enterMode("goal", {
										objective: goalState?.goal?.objective,
										tokenBudget: goalState?.goal?.tokenBudget,
									})
						).catch(warn("goal"));
					} else if (goalState?.goal?.status === "paused") {
						// A paused goal keeps its state entry and stays resumable.
						this.#pausedGoalId = goalState.goal.id;
						void wire.pauseGoal().catch(warn("goal"));
					} else {
						this.#pausedGoalId = undefined;
						void wire.dropGoal().catch(warn("goal"));
					}
				}

				const vibeOn = Boolean(session.getVibeModeState()?.enabled);
				if (this.#lastModes.vibe !== vibeOn) {
					this.#lastModes.vibe = vibeOn;
					void (vibeOn ? wire.enterMode("vibe") : wire.exitMode("vibe")).catch(warn("vibe"));
				}
			}
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
		const where = sessionBranch ? ` · ${sessionBranch}` : "";
		this.#ctx.showStatus(`Attached to backend session ${sessionId}${where}`, { dim: true });
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

	/**
	 * Send a slash command to the backend for execution. Unlike {@link sendPrompt}
	 * this never steers: a builtin forwarded mid-turn must run in the backend's
	 * session, not be injected as text into the running turn.
	 */
	sendCommand(text: string, images?: ImageContent[]): void {
		if (this.#closed) throw new Error("Backend attachment is closed");
		// A forwarded builtin is not a loop body: a waiting loop must keep
		// waiting for the user's next real prompt.
		if (this.#wire) {
			void this.#wire.sendPrompt(text, { images, loopBody: false }).catch(error => {
				this.#ctx.showError(`Backend command failed: ${error instanceof Error ? error.message : String(error)}`);
			});
			return;
		}
		const payload = images && images.length > 0 ? { images } : {};
		void this.client
			.send(this.#sessionId, { type: "prompt", message: text, loopBody: false, ...payload })
			.catch(error => {
				this.#ctx.showError(`Backend command failed: ${error instanceof Error ? error.message : String(error)}`);
			});
	}

	/**
	 * Ask a side question in the backend's side context (`/btw`). Needs the
	 * protocol link: the HTTP command surface has no side-context command.
	 */
	sendBtw(question: string): void {
		if (this.#closed) return;
		if (!this.#wire) {
			this.#ctx.showError("Side questions need the backend protocol link; reconnect and retry.");
			return;
		}
		void this.#wire.btw(question).catch(error => {
			this.#ctx.showError(`/btw failed: ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	/**
	 * Messages with their backend entry ids, oldest first. `/branch` and `/tree`
	 * pick one of these and rewind the backend transcript to it.
	 */
	async userMessages(): Promise<{ entryId: string; role: string; label: string }[]> {
		const detail = await this.client.getSession(this.#sessionId, this.#abort.signal);
		const messages = detail.context?.messages ?? [];
		const entryIds = detail.context?.entryIds ?? [];
		const out: { entryId: string; role: string; label: string }[] = [];
		for (const [index, raw] of messages.entries()) {
			const entryId = entryIds[index];
			if (!entryId || !raw || typeof raw !== "object") continue;
			const message = raw as { role?: unknown; content?: unknown };
			const role = typeof message.role === "string" ? message.role : "message";
			const text = messageText(message.content).replace(/\s+/g, " ").trim();
			if (!text) continue;
			out.push({ entryId, role, label: `${role}: ${text.length > 90 ? `${text.slice(0, 87)}…` : text}` });
		}
		return out;
	}

	/** Fork the backend session at its current leaf (local `/fork`). */
	async forkSession(): Promise<string> {
		const detail = await this.client.getSession(this.#sessionId, this.#abort.signal);
		// `branch()` takes a message entry id (the same id the web-ui sends);
		// `leafId` may name a non-message tree node and is only a fallback.
		const entryId = detail.context?.entryIds?.at(-1) ?? detail.leafId;
		if (!entryId) throw new Error("Backend session has no entry to fork from");
		const result = (await this.client.send(this.#sessionId, { type: "fork", entryId })) as {
			cancelled?: boolean;
			newSessionId?: string;
		};
		if (result.cancelled || !result.newSessionId) throw new Error("Backend refused to fork this session");
		await this.reattach(result.newSessionId);
		return result.newSessionId;
	}

	/** Rewind the backend transcript to an entry (local `/branch` and `/tree`). */
	async navigateTree(entryId: string): Promise<void> {
		const result = (await this.client.send(this.#sessionId, { type: "navigate_tree", entryId })) as {
			cancelled?: boolean;
		};
		if (result.cancelled) throw new Error("Backend refused to navigate the tree");
		await this.reattach(this.#sessionId);
	}

	/** Drop the model context but keep the session id/file (local `/clear`). */
	async clearContext(): Promise<number> {
		const result = (await this.client.send(this.#sessionId, { type: "reset_context" })) as {
			cancelled?: boolean;
			dropped?: number;
		};
		if (result.cancelled) throw new Error("Wait for the current turn to finish before clearing the context");
		await this.reattach(this.#sessionId);
		return typeof result.dropped === "number" ? result.dropped : 0;
	}

	/** Delete this backend session and move to a fresh one (local `/delete yes`). */
	async deleteSession(): Promise<string> {
		const result = (await this.client.send(this.#sessionId, { type: "delete_session" })) as {
			cancelled?: boolean;
			newSessionId?: string;
		};
		if (result.cancelled || !result.newSessionId) throw new Error("Backend refused to delete this session");
		await this.reattach(result.newSessionId);
		return result.newSessionId;
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

	/**
	 * Move this client to another backend session (`/new`, `/resume <id>`). The
	 * replica is rebuilt and the event stream follows the new id; the previous
	 * backend session keeps running.
	 */
	async reattach(sessionId: string): Promise<void> {
		// A loop belongs to the transcript it was started on: switching the
		// client away must not leave the old backend session repeating prompts
		// unattended. Stop it while the socket still points at that session.
		if (this.#joined && this.#loopState?.enabled) {
			await this.toggleLoop().catch(error => {
				logger.warn("backend attach loop stop before reattach failed", { error: String(error) });
			});
		}
		if (this.#joined) await this.detach();
		this.#closed = false;
		this.#joined = false;
		this.#abort = new AbortController();
		this.#knownEntryIds.clear();
		this.#pendingDialogs.clear();
		this.#lastSeq = 0;
		this.#streaming = false;
		this.#assistantStreamSynced = false;
		this.#lastModes = { plan: null, goal: null, vibe: null };
		this.#pausedGoalId = undefined;
		this.#loopState = null;
		this.#loopStateSeq += 1;
		this.#ctx.setBackendLoopStatus(undefined);
		this.#target = { ...this.#target, sessionId, newSession: false, explicit: true };
		await this.join();
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
		this.#loopState = null;
		this.#ctx.setBackendLoopStatus(undefined);
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

		// The backend session's workspace is authoritative: a client launched from
		// another directory must adopt it (local dashboards then read the same
		// checkout the prompts edit). Without this callback switchSession throws
		// SESSION_CWD_CHANGE_REJECTED and every cross-directory attach degrades to
		// an in-process session.
		const switched = await this.#ctx.session.switchSession(replicaPath, {
			keepModel: true,
			onCwdChange: async () => true,
		});
		if (switched === false) {
			logger.warn("attach replica switch rejected", {
				target: replicaPath,
				currentCwd: this.#ctx.sessionManager.getCwd(),
				targetCwd: detail.info?.cwd,
			});
			throw new Error("Backend attach was cancelled while switching sessions");
		}
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
		// An empty backend session (created by ensure_session but without its
		// first save) reports `model: {}`; a truthiness-only check would call
		// `find(undefined, undefined)` and throw a minified `.trim` TypeError,
		// degrading the whole attach to in-process.
		const contextModel = detail.context?.model;
		const provider = contextModel?.provider;
		const modelId = contextModel?.modelId;
		if (typeof provider === "string" && provider.length > 0 && typeof modelId === "string" && modelId.length > 0) {
			const model = session.modelRegistry.find(provider, modelId);
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
				// Do not await: the plan review overlay stays up while the operator
				// decides, and holding the serialized apply chain would freeze every
				// later streamed frame (the local TUI detaches the same dispatch).
				void this.#presentPlanApproval(event);
				return;
			case "mode_changed":
				this.#applyModeEvent(event);
				return;
			case "state_changed":
				this.#scheduleStateRefresh();
				return;
			case "loop_state":
				this.#loopStateSeq += 1;
				this.#applyLoopSnapshot(event.state);
				return;
			case "command_output": {
				if (typeof event.text === "string" && event.text.length > 0)
					this.#ctx.showStatus(event.text, { dim: true });
				return;
			}
			case "running":
				this.#streaming = true;
				return;
			case "not-running":
				this.#streaming = false;
				return;
			case "queue_update":
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
		if (method === "open_url") {
			// Fire-and-forget OAuth instruction: show the URL (and the local
			// shortcut when the provider offers one); the pasted code arrives on a
			// following `input` request.
			const url = typeof event.url === "string" ? event.url : "";
			const launchUrl = typeof event.launchUrl === "string" ? event.launchUrl : undefined;
			const instructions = typeof event.instructions === "string" ? event.instructions : undefined;
			const lines = [instructions, url, launchUrl && launchUrl !== url ? `Local shortcut: ${launchUrl}` : undefined]
				.filter((line): line is string => Boolean(line))
				.join("\n");
			this.#ctx.showHookNotify(lines || "Complete sign-in in your browser.", "info");
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

	/**
	 * Plan review: render the plan itself (the same overlay a local session
	 * shows) and send the approval over the HTTP command plane, which is the
	 * only transport that implements `plan_approve`. The RPC socket has no such
	 * command — sending it there returned "Unknown command" and the operator's
	 * choice was silently dropped.
	 */
	async #presentPlanApproval(event: BackendEvent): Promise<void> {
		if (this.#closed) return;
		const planFilePath = typeof event.planFilePath === "string" ? event.planFilePath : undefined;
		const title = typeof event.title === "string" && event.title ? event.title : "Plan mode - next step";
		let planContent = "";
		try {
			const state = (await this.client.send(this.#sessionId, { type: "get_state" })) as {
				planContent?: unknown;
			};
			if (typeof state.planContent === "string") planContent = state.planContent;
		} catch (error) {
			logger.warn("backend attach plan content unavailable", { error: String(error) });
		}
		const options = ["Approve and execute", "Approve and compact context", "Refine plan", "Cancel"];
		const choice = await this.#ctx.showPlanReview(planContent, title, options, {
			helpText: "Esc cancel · edit the plan inline before approving",
		});
		if (choice === undefined || choice === "Refine plan") return;
		if (!planFilePath) {
			this.#ctx.showError("Backend did not report a plan file path; nothing to approve.");
			return;
		}
		const mode: PlanApproveMode =
			choice === "Approve and execute"
				? "preserve"
				: choice === "Approve and compact context"
					? "compact"
					: "cancel";
		try {
			await this.client.send(this.#sessionId, { type: "plan_approve", planFilePath, mode });
		} catch (error) {
			this.#ctx.showError(`Backend plan approval failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Pull the backend's derived state after `state_changed`: model, thinking,
	 * todos and the streaming flag are owned by the running session and the
	 * replica does not learn them from transcript entries alone.
	 */
	#scheduleStateRefresh(): void {
		if (this.#closed || this.#stateRefresh) return;
		this.#stateRefresh = (async () => {
			const loopSeq = this.#loopStateSeq;
			try {
				const state = (await this.client.send(this.#sessionId, { type: "get_state" })) as {
					model?: { provider?: string; modelId?: string } | null;
					thinkingLevel?: string | null;
					isStreaming?: unknown;
					todoPhases?: unknown;
					loop?: unknown;
				};
				if (this.#closed) return;
				if (typeof state.isStreaming === "boolean") this.#streaming = state.isStreaming;
				const session = this.#ctx.session;
				const modelState = state.model;
				if (modelState?.provider && modelState.modelId) {
					const model = session.modelRegistry.find(modelState.provider, modelState.modelId);
					const current = session.agent.state.model;
					if (model && (current?.id !== model.id || current?.provider !== model.provider)) {
						session.agent.setModel(model);
					}
				}
				if (typeof state.thinkingLevel === "string") {
					session.agent.setThinkingLevel(toReasoningEffort(state.thinkingLevel as never));
				}
				if (Array.isArray(state.todoPhases)) {
					session.setTodoPhases(state.todoPhases as never);
				}
				// A reconnect misses the transition events that produced the loop;
				// the snapshot is authoritative unless a pushed frame landed while
				// the request was in flight.
				if (loopSeq === this.#loopStateSeq) this.#applyLoopSnapshot(state.loop);
			} catch (error) {
				logger.debug("backend attach state refresh failed", { error: String(error) });
			} finally {
				this.#stateRefresh = undefined;
			}
		})();
	}

	/** Enter a mode on the backend (the same switch the replica mirrors). */
	async enterMode(mode: "plan" | "goal" | "vibe", options?: unknown): Promise<void> {
		if (this.#wire) {
			await this.#wire.enterMode(mode, options);
			return;
		}
		await this.client.send(this.#sessionId, {
			type: "mode_enter",
			mode,
			...(options === undefined ? {} : { options }),
		});
	}

	/** Apply `/loop <args>` on the backend, or stop the loop when one is active. */
	async toggleLoop(args = ""): Promise<void> {
		if (this.#loopState?.enabled) {
			await this.#loopCall("loop_stop", undefined);
			return;
		}
		await this.#loopCall("loop_start", { args });
	}

	async pauseLoop(): Promise<void> {
		if (!this.#loopState?.enabled) return;
		await this.#loopCall("loop_pause", undefined);
	}

	async resumeLoop(): Promise<void> {
		await this.#loopCall("loop_resume", undefined);
	}

	async #loopCall(
		type: "loop_start" | "loop_stop" | "loop_pause" | "loop_resume",
		extra: { args: string } | undefined,
	): Promise<void> {
		if (this.#wire) {
			if (type === "loop_start") return this.#wire.loopStart(extra?.args ?? "");
			if (type === "loop_pause") return this.#wire.loopPause();
			if (type === "loop_resume") return this.#wire.loopResume();
			return this.#wire.loopStop();
		}
		const response = (await this.client.send(this.#sessionId, {
			type,
			...(extra ? extra : {}),
		})) as { state?: unknown };
		this.#applyLoopSnapshot(response?.state);
	}

	/** Mirror a backend loop snapshot into the status line (no local scheduler). */
	#applyLoopSnapshot(value: unknown): void {
		const state = isRecord(value) && value.enabled === true ? (value as unknown as BackendLoopState) : null;
		this.#loopState = state;
		if (!state) {
			this.#ctx.setBackendLoopStatus(undefined);
			return;
		}
		this.#ctx.setBackendLoopStatus({
			state: state.paused ? "paused" : state.prompt ? "running" : "waiting",
			...(state.limit ? { limit: state.limit } : {}),
			...(state.condition ? { condition: state.condition } : {}),
		});
	}

	/** Review the backend's current plan and offer the approval choices. */
	async reviewPlan(): Promise<void> {
		const state = (await this.client.send(this.#sessionId, { type: "get_state" })) as {
			planContent?: unknown;
			planFilePath?: unknown;
		};
		const content = typeof state.planContent === "string" ? state.planContent : "";
		const planFilePath = typeof state.planFilePath === "string" ? state.planFilePath : undefined;
		if (!content.trim()) {
			this.#ctx.showStatus("The backend session has no plan to review.");
			return;
		}
		const options = ["Approve and execute", "Approve and compact context", "Refine plan", "Cancel"];
		const choice = await this.#ctx.showPlanReview(content, "Plan mode - next step", options, {
			helpText: "Esc cancel",
		});
		if (choice === undefined || choice === "Refine plan") return;
		if (!planFilePath) {
			this.#ctx.showError("Backend did not report a plan file path; nothing to approve.");
			return;
		}
		const mode: PlanApproveMode =
			choice === "Approve and execute"
				? "preserve"
				: choice === "Approve and compact context"
					? "compact"
					: "cancel";
		try {
			await this.client.send(this.#sessionId, { type: "plan_approve", planFilePath, mode });
		} catch (error) {
			this.#ctx.showError(`Backend plan approval failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/** OAuth providers the backend can sign into. */
	async getLoginProviders(): Promise<{ id: string; name: string; available: boolean; authenticated: boolean }[]> {
		if (!this.#wire) throw new Error("The backend has no protocol link; cannot list login providers.");
		return await this.#wire.getLoginProviders();
	}

	/** Sign in through the backend (dialogs arrive on the wire). */
	async login(providerId: string): Promise<void> {
		if (!this.#wire) throw new Error("The backend has no protocol link; cannot sign in.");
		await this.#wire.login(providerId);
	}

	async getLogoutAccounts(providerId: string): Promise<{ credentialId: number; label: string }[]> {
		if (!this.#wire) throw new Error("The backend has no protocol link; cannot list accounts.");
		return await this.#wire.getLogoutAccounts(providerId);
	}

	async logout(providerId: string, credentialId: number): Promise<void> {
		if (!this.#wire) throw new Error("The backend has no protocol link; cannot sign out.");
		await this.#wire.logout(providerId, credentialId);
	}

	/** Cancel the backend's in-flight turn. */

	/** Look up a session by id for addressing (`--attach-session`). */
	static async findSession(client: BackendClient, sessionId: string): Promise<BackendSessionInfo | undefined> {
		const { sessions } = await client.listSessions();
		return sessions.find(session => session.id === sessionId);
	}
}

/** Plain text of a transcript message content (string or text blocks). */
function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block): block is { type: string; text: string } =>
				typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text",
		)
		.map(block => block.text)
		.join("\n");
}

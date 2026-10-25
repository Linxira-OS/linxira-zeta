/**
 * Attach-side view of the wire protocol: the four things a TUI client of a
 * backend session sends, plus the dialog frames it answers.
 *
 * The TUI already mirrors the session through REST/SSE (replica, turn events);
 * this class is only the control plane, so it deliberately ignores every frame
 * the mirror consumes. Dialogs arrive here instead of through SSE once a socket
 * is attached, because the wrapper fans them out to every surface and the reply
 * is correlated by the session, not by the transport it arrived on.
 */

import type { BackendEvent } from "./client";
import { RpcSocketClient } from "./rpc-socket";

/** Gateway listener path for a backend-owned session. */
export function attachSocketUrl(baseUrl: string, sessionId: string): string {
	const url = new URL(`${baseUrl.replace(/\/+$/, "")}/api/rpc/ws`);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("sessionId", sessionId);
	return url.toString();
}

export interface AttachWireOptions {
	baseUrl: string;
	sessionId: string;
	/** A dialog the backend wants answered; the TUI presents it. */
	onDialog: (frame: BackendEvent) => void;
	/** Another surface (or a timeout) settled a dialog this client was showing. */
	onDialogResolved: (id: string) => void;
	/**
	 * Output of a builtin slash command the backend executed (compaction result,
	 * handoff summary, MCP status, …). The mirror's SSE stream does not carry
	 * this frame, so the attach client renders it itself.
	 */
	onCommandOutput?: (text: string) => void;
	/** The socket ended; the mirror keeps working through its own stream. */
	onClose?: (reason: string) => void;
}

export type AttachPlanApproval = "preserve" | "compact" | "fresh" | "cancel";

export class AttachWire {
	#client: RpcSocketClient;

	private constructor(client: RpcSocketClient) {
		this.#client = client;
	}

	static async connect(options: AttachWireOptions): Promise<AttachWire> {
		const client = await RpcSocketClient.connect({
			url: attachSocketUrl(options.baseUrl, options.sessionId),
		});
		client.onEvent(frame => {
			if (frame.type === "extension_ui_request" && typeof frame.type === "string") {
				options.onDialog({ ...frame, type: frame.type });
				return;
			}
			if (frame.type === "extension_ui_resolved" && typeof frame.id === "string") {
				options.onDialogResolved(frame.id);
				return;
			}
			if (frame.type === "command_output" && typeof frame.text === "string") {
				options.onCommandOutput?.(frame.text);
			}
		});
		client.onClose(reason => options.onClose?.(reason));
		return new AttachWire(client);
	}

	/** Submit input; the caller surfaces a failure (it owns the TUI context). */
	sendPrompt(
		text: string,
		options: { images?: unknown[]; behavior?: "steer" | "followUp"; loopBody?: boolean } = {},
	): Promise<void> {
		const command = options.behavior === "steer" ? "steer" : options.behavior === "followUp" ? "follow_up" : "prompt";
		const images = options.images && options.images.length > 0 ? { images: options.images } : {};
		const loopBody = options.loopBody === false ? { loopBody: false } : {};
		return this.#client.call(command, { message: text, ...images, ...loopBody }).then(() => undefined);
	}

	/** Start the backend's `/guided-goal` interview. */
	startGuidedGoal(message?: string, images?: unknown[]): Promise<void> {
		return this.#client
			.call("guided_goal", {
				...(message ? { message } : {}),
				...(images && images.length > 0 ? { images } : {}),
			})
			.then(() => undefined);
	}

	abort(): Promise<void> {
		return this.#client.call("abort").then(() => undefined);
	}

	removeQueuedMessage(
		message: string,
		queue: "steering" | "followUp",
	): Promise<{ removed: boolean; images?: unknown[]; imagesDropped?: true }> {
		return this.#client.call("remove_queued_message", { message, queue }) as Promise<{
			removed: boolean;
			images?: unknown[];
			imagesDropped?: true;
		}>;
	}

	abortAndRestoreQueue(): Promise<{
		steering: unknown[];
		followUp: unknown[];
		imagesDropped?: true;
		truncated?: true;
	}> {
		return this.#client.call("abort_and_restore_queue") as Promise<{
			steering: unknown[];
			followUp: unknown[];
			imagesDropped?: true;
			truncated?: true;
		}>;
	}

	loopStart(args: string): Promise<void> {
		return this.#client.call("loop_start", { args }).then(() => undefined);
	}

	loopStop(): Promise<void> {
		return this.#client.call("loop_stop").then(() => undefined);
	}

	loopPause(): Promise<void> {
		return this.#client.call("loop_pause").then(() => undefined);
	}

	loopResume(): Promise<void> {
		return this.#client.call("loop_resume").then(() => undefined);
	}

	approvePlan(planFilePath: string, mode: AttachPlanApproval): Promise<void> {
		return this.#client.call("plan_approve", { planFilePath, mode }).then(() => undefined);
	}

	/** Apply a model switch to the backend session. */
	setModel(provider: string, modelId: string): Promise<void> {
		return this.#client.call("set_model", { provider, modelId }).then(() => undefined);
	}

	/** Apply a thinking-level switch to the backend session. */
	setThinking(level: string): Promise<void> {
		return this.#client.call("set_thinking_level", { level }).then(() => undefined);
	}

	enterMode(mode: "plan" | "goal" | "vibe", options?: unknown): Promise<void> {
		return this.#client
			.call("mode_enter", options === undefined ? { mode } : { mode, options })
			.then(() => undefined);
	}

	exitMode(mode: "plan" | "goal" | "vibe", options?: unknown): Promise<void> {
		return this.#client.call("mode_exit", options === undefined ? { mode } : { mode, options }).then(() => undefined);
	}

	/** Run one `/goal` lifecycle operation on the backend session. */
	goal(
		op: "get" | "create" | "resume" | "pause" | "drop" | "budget",
		options: { objective?: string; tokenBudget?: number } = {},
	): Promise<Record<string, unknown>> {
		return this.#client.call("goal", {
			op,
			...(options.objective === undefined ? {} : { objective: options.objective }),
			...(options.tokenBudget === undefined ? {} : { token_budget: options.tokenBudget }),
		}) as Promise<Record<string, unknown>>;
	}

	/** Resume the backend's paused goal; refused when there is none. */
	resumeGoal(): Promise<void> {
		return this.#client.call("goal", { op: "resume" }).then(() => undefined);
	}

	/** Pause the backend's active goal and leave goal mode. */
	pauseGoal(): Promise<void> {
		return this.#client.call("goal", { op: "pause" }).then(() => undefined);
	}

	/** Drop the backend's goal and leave goal mode. */
	dropGoal(): Promise<void> {
		return this.#client.call("goal", { op: "drop" }).then(() => undefined);
	}

	/** Current backend session state (model, thinking, queues, todos, plan). */
	getState(): Promise<Record<string, unknown>> {
		return this.#client.call("get_state", undefined) as Promise<Record<string, unknown>>;
	}

	/** OAuth providers the backend can sign into. */
	async getLoginProviders(): Promise<{ id: string; name: string; available: boolean; authenticated: boolean }[]> {
		const result = (await this.#client.call("get_login_providers", undefined)) as {
			providers?: { id: string; name: string; available: boolean; authenticated: boolean }[];
		};
		return result.providers ?? [];
	}

	/**
	 * Sign in through the backend. Progress arrives as extension dialogs on this
	 * socket (`open_url`, `input`), so the attached TUI renders and answers them.
	 */
	login(providerId: string): Promise<void> {
		return this.#client.call("login", { providerId }).then(() => undefined);
	}

	async getLogoutAccounts(providerId: string): Promise<{ credentialId: number; label: string }[]> {
		const result = (await this.#client.call("get_logout_accounts", { providerId })) as {
			accounts?: { credentialId: number; label: string }[];
		};
		return result.accounts ?? [];
	}

	logout(providerId: string, credentialId: number): Promise<void> {
		return this.#client.call("logout", { providerId, credentialId }).then(() => undefined);
	}

	/** Rewind the backend transcript to an entry (the local `/branch`/`/tree` op). */
	navigateTree(entryId: string): Promise<void> {
		return this.#client.call("branch", { entryId }).then(() => undefined);
	}

	/** Snapshot the current session into a new one (the local `/fork` op). */
	fork(entryId?: string): Promise<void> {
		return this.#client.call("fork", entryId === undefined ? {} : { entryId }).then(() => undefined);
	}

	/** Ask a side question in the backend's side context. */
	btw(question: string): Promise<void> {
		return this.#client.call("btw", { question }).then(() => undefined);
	}

	/** Answer a dialog fanned out by the backend. */
	respond(id: string, body: Record<string, unknown>): void {
		this.#client.notify({ type: "extension_ui_response", id, ...body });
	}

	close(): void {
		this.#client.close();
	}
}

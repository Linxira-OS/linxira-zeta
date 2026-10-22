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
			}
		});
		client.onClose(reason => options.onClose?.(reason));
		return new AttachWire(client);
	}

	/** Submit input; the caller surfaces a failure (it owns the TUI context). */
	sendPrompt(text: string, options: { images?: unknown[]; behavior?: "steer" | "followUp" } = {}): Promise<void> {
		const command = options.behavior === "steer" ? "steer" : options.behavior === "followUp" ? "follow_up" : "prompt";
		const images = options.images && options.images.length > 0 ? { images: options.images } : {};
		return this.#client.call(command, { message: text, ...images }).then(() => undefined);
	}

	abort(): Promise<void> {
		return this.#client.call("abort").then(() => undefined);
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

	enterMode(mode: "plan" | "goal" | "vibe"): Promise<void> {
		return this.#client.call("mode_enter", { mode }).then(() => undefined);
	}

	exitMode(mode: "plan" | "goal" | "vibe"): Promise<void> {
		return this.#client.call("mode_exit", { mode }).then(() => undefined);
	}

	/** Answer a dialog fanned out by the backend. */
	respond(id: string, body: Record<string, unknown>): void {
		this.#client.notify({ type: "extension_ui_response", id, ...body });
	}

	close(): void {
		this.#client.close();
	}
}

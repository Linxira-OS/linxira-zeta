import { randomUUID } from "node:crypto";
import type { CompactOptions } from "../../../extensibility/extensions/types.js";
import { continuesConversation, conversationPosition } from "../../../modes/utils/conversation-position.js";
import type { AgentSession } from "../../../session/agent-session.js";
import { unavailable } from "../errors.js";
import { waitForCompactionYield, type CompactionSubmissionPort } from "./compaction-yield.js";

interface QueuedCompaction {
	id: string;
	sessionId: string;
	leafId: string | null;
	state: "queued" | "running";
	instructions?: string;
	options?: CompactOptions;
}

const owners = new Map<string, StudioQueuedCompactionService>();
export function queuedCompactionForSession(sessionId: string): StudioQueuedCompactionService | undefined {
	return owners.get(sessionId);
}

/**
 * Keeps later prepared groups outside executable queues until the native
 * compaction finishes. The request owns a conversation position, not a text
 * marker: a session switch or tree navigation makes it stale, and no later turn
 * is executed against the old transcript.
 */
export class StudioQueuedCompactionService {
	#request: QueuedCompaction | undefined;
	#work: Promise<void> | undefined;
	#submissions: CompactionSubmissionPort | undefined;
	#error: string | undefined;
	#sessionId: string;
	readonly #unsubscribe: () => void;
	#disposed = false;
	constructor(readonly session: AgentSession) {
		this.#sessionId = session.sessionManager.getSessionId();
		owners.set(this.#sessionId, this);
		this.#unsubscribe = session.registerSessionChangeCallback(() => {
			// A transcript replacement cannot run this request; release its barrier
			// without replaying held input into the new conversation. Those groups
			// stay bound to their own session id and only reappear if the operator
			// switches back to that exact transcript.
			this.cancel(false);
			this.#moveOwner(session.sessionManager.getSessionId());
		});
		session.addDisposer(() => this.dispose());
	}
	get running(): boolean {
		return this.#request !== undefined;
	}
	get error(): string | undefined {
		return this.#error;
	}
	setSubmissionPort(port: CompactionSubmissionPort): void {
		this.#submissions = port;
	}
	entry() {
		const request = this.#request;
		return request
			? {
					id: request.id,
					kind: "compaction" as const,
					queue: "followUp" as const,
					state: request.state === "running" ? ("inFlight" as const) : ("queued" as const),
					text: request.instructions ? `Compact context · ${request.instructions}` : "Compact context",
					imageCount: 0,
					editable: false,
				}
			: undefined;
	}
	enqueue(instructions?: string, options?: CompactOptions): void {
		if (this.#request) throw unavailable("A compaction is already queued");
		const request: QueuedCompaction = {
			...conversationPosition(this.session.sessionManager),
			id: randomUUID(),
			state: "queued",
			instructions,
			options,
		};
		this.#request = request;
		this.#error = undefined;
		this.session.beginStudioQueueBarrier(request.id, () => this.cancel(false, false));
		this.#work = this.#run(request);
	}
	wait(): Promise<void> {
		return this.#work ?? Promise.resolve();
	}
	cancel(restore = true, abortActive = true): void {
		const request = this.#request;
		if (!request) return;
		this.#request = undefined;
		this.session.releaseStudioQueueBarrier(
			request.id,
			restore && continuesConversation(this.session.sessionManager, request),
		);
		if (abortActive && request.state === "running") this.session.abortCompaction("Queued compaction cancelled");
	}
	async #run(request: QueuedCompaction): Promise<void> {
		const current = () => this.#request === request && continuesConversation(this.session.sessionManager, request);
		try {
			if (!(await waitForCompactionYield(this.session, current, this.#submissions))) return;
			if (this.session.isCompacting) {
				while (this.#request === request && this.session.isCompacting) await Bun.sleep(10);
				return;
			}
			request.state = "running";
			await this.session.compact(request.instructions, request.options);
		} catch (error) {
			if (this.#request === request) this.#error = error instanceof Error ? error.message : String(error);
		} finally {
			if (this.#request === request) {
				this.#request = undefined;
				this.session.releaseStudioQueueBarrier(
					request.id,
					continuesConversation(this.session.sessionManager, request),
				);
			}
		}
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.cancel(false, false);
		this.#unsubscribe();
		if (owners.get(this.#sessionId) === this) owners.delete(this.#sessionId);
	}
	#moveOwner(sessionId: string): void {
		if (owners.get(this.#sessionId) === this) owners.delete(this.#sessionId);
		this.#sessionId = sessionId;
		owners.set(sessionId, this);
	}
}

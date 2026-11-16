import type { AgentSession } from "../../../session/agent-session.js";
import type {
	RuntimeQueueEntry,
	RuntimeQueueOperation,
	RuntimeQueueResult,
} from "../protocol/contracts/runtime-queue.js";
import { invalid, unavailable } from "../errors.js";
import { StudioQueuedCompactionService } from "./queued-compaction-service.js";

const MAX_ENTRIES = 100;
const MAX_PAYLOAD_BYTES = 512_000;
const MAX_TEXT = 32_768;

/**
 * The typed queue surface over the exact native session. Queue entries come
 * from prepared message objects (never display text), a queued compaction is a
 * native maintenance request, and every mutation is rejected once the entry is
 * already delivering or no longer queued.
 */
export class StudioRuntimeQueueService {
	#disposed = false;
	constructor(
		readonly session: AgentSession,
		readonly compaction?: StudioQueuedCompactionService,
	) {}
	get(): RuntimeQueueResult {
		const messages = this.session.getQueuedMessageEntries();
		const maintenance = this.compaction?.entry();
		const native: RuntimeQueueEntry[] = [
			...messages.filter(row => row.heldFor !== "compaction"),
			...(maintenance ? [maintenance] : []),
			...messages.filter(row => row.heldFor === "compaction"),
		];
		const entries: RuntimeQueueEntry[] = [];
		let size = 0;
		for (const entry of native.slice(0, MAX_ENTRIES)) {
			const row = {
				...entry,
				text: entry.text.slice(0, MAX_TEXT),
				editable: entry.editable && entry.text.length <= MAX_TEXT,
			};
			size += Buffer.byteLength(JSON.stringify(row));
			if (size > MAX_PAYLOAD_BYTES) break;
			entries.push(row);
		}
		return {
			entries,
			total: native.length,
			truncated: entries.length !== native.length,
			...(this.compaction?.error ? { compactionError: this.compaction.error } : {}),
		};
	}
	execute(operation: RuntimeQueueOperation): RuntimeQueueResult {
		if (this.#disposed) throw unavailable("The queue service is disposed");
		if (operation.sessionId !== this.session.sessionId) throw unavailable("The queue belongs to another session");
		if (operation.kind === "session.queue.get" || operation.kind === "session.compaction.status") return this.get();
		if (operation.kind === "session.compaction.enqueue") {
			if (!this.compaction) throw unavailable("Queued compaction is unavailable");
			this.compaction.enqueue(operation.instructions);
			return this.get();
		}
		if (
			operation.kind === "session.compaction.cancel" ||
			(operation.kind === "session.queue.entry.remove" && operation.id === this.compaction?.entry()?.id)
		) {
			if (operation.id && operation.id !== this.compaction?.entry()?.id)
				throw unavailable("The queued compaction changed");
			this.compaction?.cancel();
			return this.get();
		}
		if (this.session.isCompacting) throw unavailable("Wait for compaction to finish");
		const entry = this.session
			.getQueuedMessageEntries()
			.find(entry => entry.id === operation.id && entry.queue === operation.queue);
		if (!entry || entry.state === "inFlight")
			throw unavailable("This message is already being delivered or is no longer queued. Refresh its state.");
		const changed =
			operation.kind === "session.queue.restore"
				? entry.state === "held" && this.session.restoreQueuedMessage(entry.id)
				: operation.kind === "session.queue.edit"
					? this.#edit(entry, operation.expectedText, operation.text)
					: operation.kind === "session.queue.entry.remove"
						? this.session.removeQueuedMessage({ id: entry.id }, entry.queue)
						: entry.queue === "followUp" && this.session.promoteQueuedMessage({ id: entry.id });
		if (!changed) throw unavailable("The queued message changed; refresh before editing it.");
		return this.get();
	}
	#edit(entry: RuntimeQueueEntry, expectedText: string, text: string): boolean {
		if (!text.trim() || text.length > MAX_TEXT) throw invalid("Invalid queue text");
		return this.session.editQueuedMessage(entry.id, entry.queue, expectedText, text);
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.compaction?.dispose();
	}
}

const residents = new WeakMap<AgentSession, StudioRuntimeQueueService>();

/** One queue resident per native session; its lifecycle ends with the session. */
export function runtimeQueueForSession(session: AgentSession): StudioRuntimeQueueService {
	let service = residents.get(session);
	if (!service || service.session !== session) {
		const compaction = new StudioQueuedCompactionService(session);
		service = new StudioRuntimeQueueService(session, compaction);
		residents.set(session, service);
		const resident = service;
		session.addDisposer(() => {
			if (residents.get(session) === resident) residents.delete(session);
			resident.dispose();
		});
	}
	return service;
}

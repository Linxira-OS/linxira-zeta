import { isAgentViewSession, type AgentViewSession } from "../../../session/agent-session-handle";
import { randomUUID } from "node:crypto";
import { AgentRegistry } from "../../../registry/agent-registry";
import type { AgentBtwOperation, AgentBtwState } from "../protocol/contracts/agent-btw.js";
import { StudioBtwError, StudioBtwService, type StudioBtwSessionPort, type StudioBtwSnapshot } from "./btw-service";

/** A child session may run BTW but may never promote its answer into a new branch. */
type StudioChildBtwPort = Omit<StudioBtwSessionPort, "branchFromBtw">;

/** The live parent incarnation a child BTW pool is bound to. */
export interface StudioAgentBtwParent {
	readonly sessionId: string;
	readonly instanceKey?: string;
	readonly isDisposed?: boolean;
}

/**
 * Resolve a live child whose registry ancestry proves it belongs to `parent`.
 * The parent's own root is never a child target, and foreign or dormant refs
 * never fall back to the main BTW slot.
 */
function registeredChildSession(parent: StudioAgentBtwParent, agentId: string): AgentViewSession | undefined {
	if (parent.isDisposed === true) return undefined;
	const registry = AgentRegistry.global();
	const refs = registry.list();
	const root =
		refs.find(ref => parent.instanceKey !== undefined && ref.session?.instanceKey === parent.instanceKey) ??
		refs.find(ref => ref.session?.sessionManager.getSessionId() === parent.sessionId);
	if (!root || root.id === agentId) return undefined;
	const target = registry.get(agentId);
	if (!target?.session || !isAgentViewSession(target.session) || Reflect.get(target.session, "isDisposed") === true)
		return undefined;
	const seen = new Set<string>();
	let ancestor = target.parentId;
	for (let hops = 0; ancestor && hops < 64; hops++) {
		if (ancestor === root.id) return target.session;
		if (seen.has(ancestor)) return undefined;
		seen.add(ancestor);
		ancestor = registry.get(ancestor)?.parentId;
	}
	return undefined;
}

interface Entry {
	binding: string;
	agentId: string;
	parentId: string;
	sessionId: string;
	session: StudioChildBtwPort;
	service: StudioBtwService;
	snapshot: StudioBtwSnapshot | null;
	valid: boolean;
	usedAt: number;
}

/** Services use the real child AgentSession; no additional session and no main-slot events. */
export class StudioAgentBtwService {
	#entries = new Map<string, Entry>();
	#timer: Timer | undefined;
	#disposed = false;
	constructor(
		readonly parent: StudioAgentBtwParent,
		private readonly resolveChild: (agentId: string) => StudioChildBtwPort | undefined = agentId =>
			registeredChildSession(parent, agentId),
	) {}
	get running(): boolean {
		return [...this.#entries.values()].some(entry => entry.snapshot?.status === "running");
	}
	#matches(entry: Entry): boolean {
		return (
			!this.#disposed &&
			entry.valid &&
			this.parent.isDisposed !== true &&
			this.parent.sessionId === entry.parentId &&
			Reflect.get(entry.session, "isDisposed") !== true &&
			this.resolveChild(entry.agentId) === entry.session &&
			entry.session.sessionManager.getSessionId() === entry.sessionId
		);
	}
	#assert(entry: Entry): void {
		if (!this.#matches(entry)) {
			entry.valid = false;
			entry.service.dispose();
			throw new StudioBtwError("INTERACTION_STALE", "The child agent changed or stopped; reopen its BTW panel");
		}
	}
	#entry(operation: AgentBtwOperation): Entry {
		if (this.#disposed || this.parent.isDisposed === true || operation.sessionId !== this.parent.sessionId)
			throw new StudioBtwError("INTERACTION_STALE", "Parent session changed");
		const existing = this.#entries.get(operation.agentId);
		if (operation.binding) {
			if (!existing || existing.binding !== operation.binding)
				throw new StudioBtwError("INTERACTION_STALE", "Child BTW binding expired");
			this.#assert(existing);
			existing.usedAt = Date.now();
			return existing;
		}
		if (operation.kind !== "agent.btw.read")
			throw new StudioBtwError("INTERACTION_STALE", "Read the child BTW binding first");
		if (existing && this.#matches(existing)) return existing;
		existing?.service.dispose();
		this.#entries.delete(operation.agentId);
		const session = this.resolveChild(operation.agentId);
		if (!session) throw new StudioBtwError("INTERACTION_STALE", "No live child session is available for BTW");
		if (this.#entries.size >= 32) {
			const idle = [...this.#entries.values()]
				.filter(entry => entry.snapshot?.status !== "running")
				.sort((a, b) => a.usedAt - b.usedAt)[0];
			if (!idle) throw new StudioBtwError("COMMAND_BLOCKED", "Too many active child BTW targets");
			idle.service.dispose();
			this.#entries.delete(idle.agentId);
		}
		const sessionId = session.sessionManager.getSessionId();
		const artifacts = session.sessionManager.getArtifactsDir?.() ?? null;
		const service = new StudioBtwService(
			{
				get model() {
					return session.model;
				},
				get isStreaming() {
					return session.isStreaming;
				},
				sessionManager: {
					getSessionId: () => sessionId,
					ensureOnDisk: () => session.sessionManager.ensureOnDisk(),
					getArtifactsDir: () => artifacts,
					getLeafId: () => {
						this.#assert(entry);
						return session.sessionManager.getLeafId();
					},
				},
				runEphemeralTurn: args => {
					this.#assert(entry);
					return session.runEphemeralTurn(args);
				},
				branchFromBtw: async () => {
					throw new StudioBtwError("COMMAND_BLOCKED", "Branch from the child conversation explicitly");
				},
			},
			{ historyScope: sessionId },
		);
		const entry: Entry = {
			binding: randomUUID(),
			agentId: operation.agentId,
			parentId: operation.sessionId,
			sessionId,
			session,
			service,
			snapshot: null,
			valid: true,
			usedAt: Date.now(),
		};
		service.onChange(snapshot => {
			entry.snapshot = snapshot;
		});
		this.#entries.set(operation.agentId, entry);
		this.#timer ??= setInterval(() => {
			for (const item of this.#entries.values())
				if (item.valid && !this.#matches(item)) {
					item.valid = false;
					item.service.dispose();
				}
		}, 250);
		this.#timer.unref?.();
		return entry;
	}
	async execute(operation: AgentBtwOperation, assertCurrent?: () => void): Promise<AgentBtwState> {
		const entry = this.#entry(operation);
		const assertOperation = () => {
			this.#assert(entry);
			assertCurrent?.();
		};
		assertCurrent?.();
		if (operation.kind === "agent.btw.ask") {
			if (operation.topicId)
				await entry.service.followUp(operation.topicId, operation.question, operation.images, assertOperation);
			else entry.service.ask(operation.question, operation.images, undefined, assertOperation);
		} else if (operation.kind === "agent.btw.abort") {
			assertOperation();
			entry.service.abort(operation.ephemeralId);
		}
		const history = await entry.service.historyList();
		const topicId =
			operation.kind === "agent.btw.ask"
				? entry.snapshot?.topicId
				: operation.kind === "agent.btw.read"
					? operation.topicId
					: undefined;
		// A worker may still be materializing its history on the first ask. The
		// running snapshot is already authoritative; read turns once the topic exists.
		const topicReady = operation.kind !== "agent.btw.ask" || history.topics.some(topic => topic.topicId === topicId);
		const turns = topicId && topicReady ? (await entry.service.historyRead(topicId)).turns : [];
		assertOperation();
		const snapshot = entry.snapshot;
		const result: AgentBtwState = {
			binding: entry.binding,
			agentId: entry.agentId,
			targetSessionId: entry.sessionId,
			topics: history.topics,
			turns,
			snapshot: snapshot
				? {
						ephemeralId: snapshot.ephemeralId,
						status: snapshot.status,
						text: snapshot.text,
						...(snapshot.topicId ? { topicId: snapshot.topicId } : {}),
						...(snapshot.question ? { question: snapshot.question } : {}),
						...(snapshot.turnIndex === undefined ? {} : { turnIndex: snapshot.turnIndex }),
						...(snapshot.title ? { title: snapshot.title } : {}),
						...(snapshot.error ? { error: snapshot.error } : {}),
					}
				: null,
		};
		return result;
	}
	async settle(): Promise<void> {
		await Promise.all([...this.#entries.values()].map(entry => entry.service.settle()));
	}
	dispose(): void {
		this.#disposed = true;
		clearInterval(this.#timer);
		for (const entry of this.#entries.values()) entry.service.dispose();
		this.#entries.clear();
	}
}

/**
 * AgentRegistry - Process-global registry of agents (the main session plus
 * every subagent), keyed by stable id.
 *
 * Tracks each agent's status and (when live) its AgentSession so peers can be
 * addressed by id (`agent://`, `task resume`, `history://`). Sessions are
 * registered explicitly at creation; finished agents stay registered as
 * `idle` (live) or `parked` (session disposed, ref + sessionFile retained for
 * revival) and are only removed on explicit release/teardown.
 *
 * Ids are unique in this registry. A root (top-level) session must therefore
 * not reuse `MAIN_AGENT_ID` once another root is live: {@link registerRoot}
 * keeps `MAIN_AGENT_ID` for the process's lone/first root and mints the
 * session id for every later one. Subagents keep their parent-scoped ids.
 * {@link register} refuses a duplicate instead of silently replacing the
 * previous owner, which used to hand one id to whichever session started last.
 */

import { logger } from "@linxiraos/pi-utils";
import type { AgentSession } from "../session/agent-session";
import { oneLineLabel } from "@linxiraos/pi-tui/tools/task";

import { MAIN_AGENT_ID, type AgentStatus, type AgentMetricsSummary } from "@linxiraos/pi-tui/overlays/agent-hub-types";
import { AgentAwaits } from "./agent-awaits";
export { MAIN_AGENT_ID };
export type { AgentStatus, AgentMetricsSummary };

/**
 * - `main`/`sub`: the user-facing agent tree (driving agent + task subagents).
 * - `advisor`: a passive review transcript persisted like a subagent for usage
 *   attribution and Agent Hub observability, but never a peer — hidden from
 *   agent-facing rosters (`proc://`, `history://`) and not messageable/revivable.
 */
export type AgentKind = "main" | "sub" | "advisor";

/**
 * Run lifecycle milestones, stamped as they happen and scoped to the CURRENT
 * run: they are cleared when the ref re-enters `running` for a follow-up or
 * wake turn. Launch is the ref's `createdAt`; these are the post-launch
 * boundaries the parent needs to tell a genuinely working agent from one whose
 * accepted result never terminalized.
 */
export interface AgentRunLifecycle {
	/** When the run produced its final response (an accepted terminal `yield`). */
	responseAt?: number;
	/** When the run's final result was accepted by its driver. */
	acceptedAt?: number;
	/** When the ref last left `running` for a terminal status. */
	terminalAt?: number;
}

/**
 * Run lifecycle milestones, stamped as they happen and scoped to the CURRENT
 * run: they are cleared when the ref re-enters `running` for a follow-up or
 * wake turn. Launch is the ref's `createdAt`; these are the post-launch
 * boundaries the parent needs to tell a genuinely working agent from one whose
 * accepted result never terminalized.
 */
export interface AgentRunLifecycle {
	/** When the run produced its final response (an accepted terminal `yield`). */
	responseAt?: number;
	/** When the run's final result was accepted by its driver. */
	acceptedAt?: number;
	/** When the ref last left `running` for a terminal status. */
	terminalAt?: number;
}

/** Historical identity and telemetry that remain available after the live session is disposed. */
export interface AgentHistorySummary {
	agent?: string;
	modelRole?: string;
	resolvedModel?: string;
	/** Whether the last resolved model was selected by retry fallback routing. */
	resolvedModelIsFallback?: boolean;
	metrics?: AgentMetricsSummary;
	/** Cumulative own-session assistant and model_usage cost, excluding nested task results. */
	directCost?: number;
	readOnly?: boolean;
	/** Durable task output artifact, when the executor wrote one. */
	outputPath?: string;
	/** Captured isolated-worktree patch, when patch capture succeeded. */
	patchPath?: string;
	/** Isolated branch identity, when branch-mode capture succeeded. */
	branchName?: string;
	/** Captured nested-repo patches (`<id>.nested-<n>-<path>.patch`), one per nested repository the agent changed. */
	nestedPatchPaths?: string[];
}

export interface AgentRef {
	id: string;
	displayName: string;
	kind: AgentKind;
	parentId?: string;
	status: AgentStatus;
	/**
	 * Workspace (mesh workspace id) the agent's root session belongs to. Set on
	 * root refs and inherited by their subagents; undefined for refs restored
	 * without a workspace. Used to resolve the `main` alias to the caller's own
	 * workspace main instead of whichever root registered first.
	 */
	workspaceId?: string;
	/** Null exactly when parked/aborted. */
	session: AgentSession | null;
	sessionFile: string | null;
	createdAt: number;
	lastActivity: number;
	/** Short gist of what the agent is currently doing (latest intent or tool), for the work-aware roster. Display-only. */
	activity?: string;
	/** Persisted identity and telemetry restored after the live observer is gone. */
	history?: AgentHistorySummary;
	/** Run lifecycle milestones (launch is {@link createdAt}). */
	lifecycle?: AgentRunLifecycle;
}

export type AgentRefExpectation = AgentRef | AgentSession;

/**
 * Whether messaging `ref` resumes it: a live `idle` agent, or a `parked` or
 * killed one whose transcript is on disk. Task summaries use it to tell the
 * parent to resume a stopped agent instead of redoing its work.
 */
export function isResumable(ref: AgentRef | undefined): boolean {
	if (ref?.status === "idle") return true;
	return (ref?.status === "parked" || ref?.status === "aborted") && ref.sessionFile !== null;
}

export type RegistryEvent =
	| { type: "registered"; ref: AgentRef }
	| { type: "status_changed"; ref: AgentRef }
	| { type: "metadata_changed"; ref: AgentRef }
	| { type: "removed"; ref: AgentRef };

type RegistryListener = (event: RegistryEvent) => void;

/**
 * A top-level agent: the driving session of a workspace or an explicitly
 * pinned root. Subagents always carry a parent; advisors are observability-only.
 */
export function isRootAgentRef(ref: Pick<AgentRef, "kind" | "parentId">): boolean {
	return ref.kind === "main" && ref.parentId === undefined;
}

/**
 * `agent://main` (any case) and the bare constant both name the workspace
 * main. Matching is case-insensitive so the URL form documented for users
 * resolves to the canonical `MAIN_AGENT_ID` ref without a second registry key.
 */
export function isMainAgentAlias(id: string): boolean {
	return id === MAIN_AGENT_ID || id.toLowerCase() === MAIN_AGENT_ID.toLowerCase();
}

export interface RegisterInput {
	id: string;
	displayName: string;
	kind: AgentKind;
	parentId?: string;
	/** Workspace of the agent's root session; inherited by subagents. */
	workspaceId?: string;
	session: AgentSession | null;
	sessionFile?: string | null;
	status?: AgentStatus;
	/** Last persisted task summary, when restoring a historical agent. */
	activity?: string;
	/** Original registration timestamp, when known from persisted history. */
	createdAt?: number;
	/** Last transcript activity timestamp, when known from persisted history. */
	lastActivity?: number;
	/** Persisted identity and telemetry restored after the live observer is gone. */
	history?: AgentHistorySummary;
	/** Run lifecycle milestones restored from persisted history, when known. */
	lifecycle?: AgentRunLifecycle;
}

export class AgentRegistry {
	static #global: AgentRegistry | undefined;

	static global(): AgentRegistry {
		if (!AgentRegistry.#global) {
			AgentRegistry.#global = new AgentRegistry();
		}
		return AgentRegistry.#global;
	}

	/** Reset the global registry. Test-only. */
	static resetGlobalForTests(): void {
		AgentRegistry.#global = new AgentRegistry();
	}

	readonly #refs = new Map<string, AgentRef>();
	readonly #listeners = new Set<RegistryListener>();
	/** Which of these agents are blocked until others finish. */
	readonly awaits = new AgentAwaits();

	#matchesExpected(ref: AgentRef, expected?: AgentRefExpectation): boolean {
		return expected === undefined || ref === expected || ref.session === expected;
	}

	#rejectStatusUpdate(id: string, status: AgentStatus, reason: string): false {
		logger.debug("Agent registry status update rejected", { id, status, reason });
		return false;
	}

	register(input: RegisterInput): AgentRef {
		// An id names one live owner. Silently replacing it (the old behavior)
		// handed `main` to whichever top-level session started last: the previous
		// session stayed alive but unreachable, and its self-id no longer matched
		// the ref. Callers that legitimately reuse an id unregister first or go
		// through registerIfAvailable with the ref they were authorized to revive.
		if (this.#refs.has(input.id)) {
			const owner = this.#refs.get(input.id)!;
			const parent = owner.parentId ? `, parent ${owner.parentId}` : "";
			throw new Error(
				`Agent id "${input.id}" is already registered (kind ${owner.kind}${parent}, status ${owner.status}); ` +
					"an agent id is never silently replaced.",
			);
		}
		const now = Date.now();
		const ref: AgentRef = {
			id: input.id,
			displayName: input.displayName,
			kind: input.kind,
			parentId: input.parentId,
			workspaceId: input.workspaceId,
			status: input.status ?? "running",
			session: input.session,
			sessionFile: input.sessionFile ?? null,
			createdAt: input.createdAt ?? now,
			lastActivity: input.lastActivity ?? now,
			activity: input.activity,
			history: input.history,
			lifecycle: input.lifecycle,
		};
		this.#refs.set(ref.id, ref);
		this.#emit({ type: "registered", ref });
		return ref;
	}

	/**
	 * Register a top-level session under a process-unique id.
	 *
	 * `MAIN_AGENT_ID` stays the in-process default for a lone/first root, so
	 * single-session behaviour (CLI, print mode, one serve coordinator) is
	 * unchanged. Once another root is live — or `MAIN_AGENT_ID` is still held by
	 * a parked ref — a new root registers under its session id instead. That id
	 * is stable for the transcript (reopening it keeps the id), bare (mesh
	 * addressable without a second workspace prefix), and unique per root.
	 *
	 * An explicit `id` is honored as-is: callers that pin an id (tests, revived
	 * generations) still get the duplicate check.
	 */
	registerRoot(input: Omit<RegisterInput, "id"> & { id?: string; sessionId: string }): AgentRef {
		if (input.id !== undefined) return this.register({ ...input, id: input.id });
		const lone = !this.#refs.has(MAIN_AGENT_ID) && !this.list().some(isRootAgentRef);
		const id = lone ? MAIN_AGENT_ID : input.sessionId;
		return this.register({ ...input, id });
	}

	/**
	 * Canonical root for `workspaceId`: the agent `agent://main` names for a
	 * caller in that workspace. Prefers `MAIN_AGENT_ID`, else the oldest live
	 * root of the workspace. An undefined workspace only matches refs restored
	 * without one; a legacy `MAIN_AGENT_ID` ref without a workspace still acts
	 * as the fallback main for any workspace that has no root of its own.
	 */
	workspaceMain(workspaceId: string | undefined): AgentRef | undefined {
		const roots = this.list().filter(isRootAgentRef);
		const live = roots.filter(ref => ref.status === "running" || ref.status === "idle");
		// An unqualified caller (a mesh envelope from another process, a legacy
		// session) has no workspace scope: `main` is the process's primary root.
		if (workspaceId === undefined) {
			return live.find(ref => ref.id === MAIN_AGENT_ID) ?? live.find(ref => ref.workspaceId === undefined);
		}
		const matching = live.filter(ref => ref.workspaceId === workspaceId);
		const preferred = matching.find(ref => ref.id === MAIN_AGENT_ID) ?? matching[0];
		if (preferred) return preferred;
		// Legacy refs registered before workspace scoping still act as the main
		// fallback for a workspace that has no root of its own.
		return live.find(ref => ref.id === MAIN_AGENT_ID && ref.workspaceId === undefined);
	}

	/**
	 * Resolve the `main` alias for a caller: the caller's own workspace main
	 * when it is local, else undefined (the caller must resolve it through the
	 * mesh). Non-alias ids are returned untouched by the callers.
	 */
	resolveMainAlias(requested: string, callerId: string): string | undefined {
		if (!isMainAgentAlias(requested)) return undefined;
		const caller = this.#refs.get(callerId);
		return this.workspaceMain(caller?.workspaceId)?.id;
	}

	/**
	 * Register a new id only when it is absent, or reuse the exact detached
	 * `parked` ref a revival was authorized to revive. A missing, replaced, or
	 * terminal expected ref is a failed CAS: delayed revivers must never claim an
	 * id after its prior generation disappeared or was hard-killed.
	 */
	registerIfAvailable(input: RegisterInput, expected: AgentRef | null): AgentRef | undefined {
		const current = this.#refs.get(input.id);
		if (expected === null) return current ? undefined : this.register(input);
		return current === expected && current.status === "parked" && !current.session ? current : undefined;
	}

	/**
	 * Start a fresh `parked` generation for a killed (`aborted`, detached) ref so
	 * {@link AgentLifecycleManager.ensureLive} can rebuild it from its transcript.
	 * The killed ref object is retired, not mutated, so delayed work bound to it
	 * still fails every expected-ref check. Returns undefined when `expected` is
	 * no longer this id's detached tombstone.
	 */
	reopen(id: string, expected: AgentRef): AgentRef | undefined {
		const current = this.#refs.get(id);
		if (current !== expected || current.status !== "aborted" || current.session) return undefined;
		// This is the one authorized replacement: the caller presented the exact
		// aborted tombstone it is reviving. Retire it first so the id invariant
		// (never silently replace a live owner) still holds for every other path.
		this.#refs.delete(id);
		return this.register({
			id,
			displayName: current.displayName,
			kind: current.kind,
			parentId: current.parentId,
			session: null,
			sessionFile: current.sessionFile,
			status: "parked",
			createdAt: current.createdAt,
			history: current.history,
		});
	}

	/** Attach transcript-derived identity and telemetry without changing lifecycle state. */
	setHistory(id: string, history: AgentHistorySummary, expectedSessionFile?: string): boolean {
		const ref = this.#refs.get(id);
		if (!ref || (expectedSessionFile !== undefined && ref.sessionFile !== expectedSessionFile)) return false;
		const definedHistory = Object.fromEntries(
			Object.entries(history).filter(([, value]) => value !== undefined),
		) as AgentHistorySummary;
		const previousDirectCost = ref.history?.directCost;
		const incomingDirectCost = definedHistory.directCost;
		// Both writes are cumulative snapshots of this exact transcript. A delayed
		// scan must not replace a newer park-time snapshot; unscoped updates retain
		// their normal last-write semantics.
		if (
			expectedSessionFile !== undefined &&
			typeof previousDirectCost === "number" &&
			Number.isFinite(previousDirectCost) &&
			previousDirectCost >= 0 &&
			typeof incomingDirectCost === "number" &&
			Number.isFinite(incomingDirectCost) &&
			incomingDirectCost >= 0
		) {
			definedHistory.directCost = Math.max(previousDirectCost, incomingDirectCost);
		}
		ref.history = { ...ref.history, ...definedHistory };
		this.#emit({ type: "metadata_changed", ref });
		return true;
	}

	setStatus(id: string, status: AgentStatus, expected?: AgentRefExpectation): boolean {
		const ref = this.#refs.get(id);
		if (!ref) return this.#rejectStatusUpdate(id, status, "missing-ref");
		if (!this.#matchesExpected(ref, expected)) {
			return this.#rejectStatusUpdate(id, status, "session-ownership-changed");
		}
		// `aborted` is terminal for its generation: delayed progress/revival work
		// from the killed ref must never transition it back to a live status. A
		// deliberate revival goes through `reopen`, which mints a new ref.
		if (ref.status === "aborted") {
			return status === "aborted" || this.#rejectStatusUpdate(id, status, "aborted-is-terminal");
		}
		if (ref.status === status) return true;
		const leftRunning = ref.status === "running";
		ref.status = status;
		// Activity describes current work; it is meaningless once the agent
		// leaves `running`, so drop it to avoid showing stale work in rosters.
		if (status !== "running") ref.activity = undefined;
		ref.lastActivity = Date.now();
		if (status === "running") {
			// Milestones are run-scoped. A ref reused by a follow-up or wake
			// turn must not carry the previous run's response/acceptance into
			// the new run, or a later yield-less turn would look accepted.
			ref.lifecycle = undefined;
		} else if (leftRunning) {
			ref.lifecycle = { ...ref.lifecycle, terminalAt: ref.lastActivity };
		}
		this.#emit({ type: "status_changed", ref });
		return true;
	}

	/**
	 * Record that this agent's run produced and handed over its final result,
	 * and terminalize the ref when no turn is in flight. Acceptance is the
	 * executor's run boundary: the result is settled, so a ref still `running`
	 * with nothing streaming is a missed terminal transition the parent's
	 * `wait` would otherwise keep blocking on. A ref with a genuinely
	 * streaming session (a wake turn started at the boundary) stays `running`
	 * and is surfaced by {@link staleAcceptedRuns} instead.
	 *
	 * Milestones are run-scoped: `responseAt` is the CURRENT call's response
	 * time (never a previous run's, which {@link setStatus} cleared when the
	 * ref re-entered `running`).
	 *
	 * Returns false when the id is gone, aborted, or no longer owned by
	 * `expected`; those cases must not stamp a newer generation.
	 */
	markResultAccepted(id: string, expected?: AgentRefExpectation, responseAt?: number): boolean {
		const ref = this.#refs.get(id);
		if (!ref || ref.status === "aborted" || !this.#matchesExpected(ref, expected)) return false;
		const now = Date.now();
		ref.lifecycle = {
			...ref.lifecycle,
			responseAt: responseAt ?? now,
			acceptedAt: now,
		};
		if (ref.status === "running" && ref.session?.isStreaming !== true) {
			this.setStatus(id, "idle", ref);
		} else {
			this.#emit({ type: "metadata_changed", ref });
		}
		return true;
	}

	/**
	 * Accepted-but-running refs: the run's final result was handed over but the
	 * ref never left `running`, and no turn is in flight. This is the lifecycle
	 * leak the `proc://` running-agents roster reports so the parent can cancel it
	 * instead of waiting on a run that already finished.
	 */
	staleAcceptedRuns(): AgentRef[] {
		return this.list().filter(
			ref => ref.status === "running" && ref.lifecycle?.acceptedAt !== undefined && !this.isRunning(ref),
		);
	}

	/**
	 * Record a short activity gist for the work-aware roster. Display-only and
	 * read on demand (`irc list`, peer roster), so it emits no event — keeping
	 * the per-tool-call update rate off the registry listener path (same as
	 * `attachSession`, which also bumps `lastActivity` without emitting). Only a
	 * `running` agent has current work: a heartbeat for any other status is
	 * dropped, so a late progress flush can't resurrect activity on a ref that
	 * `setStatus` just cleared. Every running heartbeat refreshes `lastActivity`
	 * — even when the gist text is unchanged — so the roster's "active … ago" and
	 * recency sort track real work, not just the last status change.
	 * The gist is normalized to one bounded line (`oneLineLabel`) so model-derived
	 * intent text can neither break the roster nor smuggle terminal escapes —
	 * every caller is safe without sanitizing at its own call site.
	 */
	setActivity(id: string, activity: string): void {
		const ref = this.#refs.get(id);
		if (!ref) return;
		if (ref.status !== "running") return;
		const gist = oneLineLabel(activity);
		ref.lastActivity = Date.now();
		if (ref.activity === gist) return;
		ref.activity = gist;
	}

	attachSession(
		id: string,
		session: AgentSession,
		sessionFile?: string | null,
		expected?: AgentRefExpectation,
	): boolean {
		const ref = this.#refs.get(id);
		// Never attach a late-created session to a hard-killed tombstone. This
		// closes the race between a parked reviver claiming the ref and finishing
		// createAgentSession after an explicit kill.
		if (!ref || ref.status === "aborted" || !this.#matchesExpected(ref, expected)) return false;
		ref.session = session;
		if (sessionFile !== undefined) {
			// A replacement transcript starts a new cumulative-cost identity.
			if (ref.sessionFile !== sessionFile && ref.history?.directCost !== undefined) {
				ref.history = { ...ref.history, directCost: undefined };
			}
			ref.sessionFile = sessionFile;
		}
		ref.lastActivity = Date.now();
		return true;
	}

	detachSession(id: string, expected?: AgentRefExpectation): boolean {
		const ref = this.#refs.get(id);
		if (!ref || !this.#matchesExpected(ref, expected)) return false;
		ref.session = null;
		return true;
	}

	unregister(id: string, expected?: AgentRefExpectation): boolean {
		const ref = this.#refs.get(id);
		if (!ref || !this.#matchesExpected(ref, expected)) return false;
		this.#refs.delete(id);
		this.#emit({ type: "removed", ref });
		return true;
	}

	get(id: string): AgentRef | undefined {
		return this.#refs.get(id);
	}

	list(): AgentRef[] {
		return [...this.#refs.values()];
	}

	/**
	 * Returns every alive agent (running | idle) except the caller. Advisor refs
	 * are observability-only transcripts, never peers, so they are excluded.
	 * Flat namespace: every other agent is visible.
	 */
	listVisibleTo(id: string): AgentRef[] {
		return this.list().filter(
			ref => ref.id !== id && ref.kind !== "advisor" && (ref.status === "running" || ref.status === "idle"),
		);
	}

	/** Whether a ref's claimed running state is corroborated by its attached live session. */
	isRunning(ref: AgentRef): boolean {
		if (ref.status !== "running") return false;
		return ref.session?.isStreaming === true;
	}

	/** Mirror a session's authoritative run-state notifications into its owned registry ref. */
	syncSessionStatus(id: string, session: AgentSession): () => void {
		const unsubscribe = session.subscribeRunState(status => {
			this.setStatus(id, status, session);
		});
		return unsubscribe;
	}

	onChange(listener: RegistryListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#emit(event: RegistryEvent): void {
		for (const listener of this.#listeners) {
			try {
				listener(event);
			} catch {
				// listeners must not break the dispatch loop
			}
		}
	}
}

const AGENT_TOMBSTONE_SUFFIX = ".tombstone";

export function getAgentTombstonePath(sessionFile: string): string {
	return `${sessionFile}${AGENT_TOMBSTONE_SUFFIX}`;
}

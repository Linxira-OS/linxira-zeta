/**
 * Web Gateway — subagent roster (read face).
 *
 * `document/web-gateway.md` owns the route table; this module owns the
 * `api/agent/[id]/subagents*` family:
 *
 * - `GET  /api/agent/:id/subagents`                       → roster snapshot
 * - `GET  /api/agent/:id/subagents/events`                → SSE (snapshot + deltas)
 * - `GET  /api/agent/:id/subagents/:subId/transcript`     → byte-paged transcript
 * - `GET  /api/agent/:id/subagents/:subId/output`         → published result
 *
 * Nothing here invents a contract: the roster re-projects the same
 * `AgentRegistry` refs + `AgentProgress` frames the TUI Agent Hub renders, the
 * SSE frames reuse the stdio RPC frame names/payloads verbatim
 * (`subagent_lifecycle` / `subagent_progress`, `modes/rpc/rpc-types.ts`), and
 * the transcript pages through `readRpcSubagentTranscript`, the RPC reader
 * itself. The gateway only adds the two transport-level frames the web needs
 * that RPC does not emit: `subagent_status` (authoritative registry row, from
 * `AgentRegistry.onChange`) and `subagent_removed` (terminal cleanup).
 *
 * ## Status vocabulary
 *
 * Two vocabularies exist upstream and both reach this DTO:
 * - `status`     — `AgentRegistry` ref status (`running|idle|parked|aborted`),
 *                  the AUTHORITATIVE row state; `aborted` is terminal.
 * - `taskStatus` — observer `AgentProgress.status`
 *                  (`pending|running|completed|failed|aborted`), display-only.
 *
 * The mapping is one-way (observer → registry) and is applied by the runtime
 * itself, never here:
 *
 * | observer `taskStatus`   | registry `status`            |
 * | ----------------------- | ---------------------------- |
 * | `pending`               | `running`                    |
 * | `running`               | `running`                    |
 * | `completed`             | `idle` (or `parked` once the session is disposed) |
 * | `failed`                | `idle` / `parked` (a failed run still left `running`) |
 * | `aborted`               | `aborted` (terminal, tombstoned) |
 *
 * Clients must render `status`; `taskStatus` only explains why a row is in
 * that state. `subagent_lifecycle` payloads carry the observer vocabulary
 * (`started|completed|failed|aborted`) and are NOT a row state on their own.
 *
 * ## Slow consumers
 *
 * Progress frames are (a) coalesced in the sink to at most one frame per
 * subagent per {@link PROGRESS_FLUSH_MS}, latest-wins, and (b) additionally
 * dropped per connection while its stream buffer is full
 * (`controller.desiredSize <= 0`); the dropped latest is retained and re-sent
 * once the buffer drains. State frames (`subagent_snapshot`,
 * `subagent_lifecycle`, `subagent_status`, `subagent_removed`) are never
 * dropped — they are small and bounded by subagent churn — so a slow client
 * converges on the truth and only loses superseded progress detail.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import { isEnoent, logger } from "@linxiraos/pi-utils";
import {
	aggregateMetrics,
	hubFallbackStatsSession,
	hubRowMetrics,
	progressMetrics,
	STATUS_ORDER,
} from "@linxiraos/pi-tui/overlays/agent-hub-projection";
import type { AgentMetricsSummary, AgentRecordLike, AgentStatus } from "@linxiraos/pi-tui/overlays/agent-hub-types";
import type { ObservableSession } from "@linxiraos/pi-tui/overlays/session-observer-registry";
import type { AgentProgress } from "@linxiraos/pi-tui/tools/task";
import { getDefault } from "../../config/settings-schema";
import { readRpcSubagentTranscript, RpcSubagentRegistry } from "../../modes/rpc/rpc-subagents";
import type { RpcSubagentFrame, RpcSubagentSnapshot } from "../../modes/rpc/rpc-types";
import { type AgentRef, AgentRegistry } from "../../registry/agent-registry";
import {
	ensurePersistedRoster,
	registerPersistedSubagents,
	sessionFileBelongsToRoot,
} from "../../registry/persisted-agents";
import type { AgentSession } from "../../session/agent-session";
import type { SubagentLifecyclePayload, SubagentProgressPayload } from "../../task";
import { cfgTaskMaxConcurrency } from "../../task/settings";
import type { EventBus } from "../../utils/event-bus";
import { type AgentSessionWrapper, sessions, startRpcSession } from "./agents";
import { resolveSessionPath } from "./sessions";

/** Coalescing window for high-frequency progress frames (one per subagent). */
export const PROGRESS_FLUSH_MS = 150;
/** Heartbeat cadence of the SSE stream, matching the other gateway SSE routes. */
const SSE_HEARTBEAT_MS = 30_000;
/** Cap on the roster rows returned by one snapshot. */
const MAX_ROSTER_ROWS = 512;
/** Roots whose persisted rows have been offered history hydration, oldest first. */
const MAX_HYDRATION_TRACKED_ROOTS = 32;
/** Trailing lines/chars of subagent output kept in the roster's progress view. */
const MAX_RECENT_OUTPUT_LINES = 5;
const MAX_RECENT_OUTPUT_CHARS = 500;
/** Depth bound for the on-disk transcript probe (nested spawn trees). */
const MAX_TRANSCRIPT_PROBE_DEPTH = 8;

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

// ---------------------------------------------------------------------------
// DTOs (web-ui mirrors these in its own lib/types.ts)
// ---------------------------------------------------------------------------

/** Roster row progress projection — a bounded subset of the runtime's `AgentProgress`. */
export interface SubagentProgressView {
	lastIntent?: string;
	currentTool?: string;
	toolCount?: number;
	requests?: number;
	tokens?: number;
	contextTokens?: number;
	contextWindow?: number;
	cost?: number;
	durationMs?: number;
	/** Trailing output lines, truncated (display only). */
	recentOutput?: string[];
}

export interface SubagentRosterEntry {
	id: string;
	displayName: string;
	kind: "sub" | "advisor";
	parentId: string | null;
	/** Depth in the session's spawn tree (0 = spawned by the session itself). */
	depth: number;
	/** Spawn ordinal within its `task` call, when a live observer frame supplied one. */
	index?: number;
	agent?: string;
	agentSource?: string;
	/** Authoritative registry status. */
	status: AgentStatus;
	/** Observer status (display only); see the module header's mapping table. */
	taskStatus?: AgentProgress["status"];
	description?: string;
	task?: string;
	assignment?: string;
	sessionFile: string | null;
	createdAt: number;
	lastActivity: number;
	detached?: boolean;
	parentToolCallId?: string;
	/** Display-only current-work gist; refreshed on snapshots, not pushed. */
	activity?: string;
	lifecycle?: { responseAt?: number; acceptedAt?: number; terminalAt?: number };
	/** Accepted-but-still-running leak the runtime flags (see `AgentRegistry.staleAcceptedRuns`). */
	staleAcceptedRun?: boolean;
	progress?: SubagentProgressView;
	/** Persisted usage summary (restored from an on-disk row, or from live observer progress). */
	metrics?: AgentMetricsSummary;
	outputPath?: string | null;
	patchPath?: string | null;
	branchName?: string | null;
	/** True when no live session is attached (a disk-restored or parked row). */
	persisted: boolean;
}

export interface SubagentRosterResponse {
	subagents: SubagentRosterEntry[];
	maxConcurrency: number;
	generatedAt: number;
}

export interface SubagentTranscriptResponse {
	subagentId: string;
	sessionFile: string;
	fromByte: number;
	nextByte: number;
	/** `true` when `fromByte` overshot the file and the page restarted at 0. */
	reset: boolean;
	entries: unknown[];
	messages: unknown[];
}

export interface SubagentOutputResponse {
	subagentId: string;
	published: boolean;
	status: AgentStatus;
	taskStatus?: AgentProgress["status"];
	/** Absolute path of the published `<id>.md`, when published. */
	outputPath?: string;
	/** Published result text; markdown. */
	content?: string;
	size?: number;
	/** Parsed `<id>.json` sidecar, only with `?json=1`. */
	sidecar?: unknown;
	message?: string;
	progress?: SubagentProgressView;
	metrics?: AgentMetricsSummary;
}

/** SSE frames emitted by `/subagents/events`. */
export type SubagentEventFrame =
	| ({ type: "subagent_snapshot" } & SubagentRosterResponse)
	| { type: "subagent_lifecycle"; payload: SubagentLifecyclePayload }
	| { type: "subagent_progress"; payload: SubagentProgressPayload }
	| { type: "subagent_status"; subagent: SubagentRosterEntry }
	| { type: "subagent_removed"; id: string };

// ---------------------------------------------------------------------------
// Session-scoped sink
// ---------------------------------------------------------------------------

type SinkListener = (frame: SubagentEventFrame) => void;

/**
 * Whether a registry ref belongs to a root session's spawn tree. Agents are
 * scoped by their transcript (`<artifactsDir>/<id>.jsonl`); a transcript-less
 * ref — a spawn whose session is not materialized yet — counts only while that
 * root's observer has seen it, since ids are not globally unique.
 */
function isInRootTree(ref: AgentRef, rootSessionFile: string | null, observed: ReadonlySet<string>): boolean {
	if (ref.kind === "main") return false;
	if (ref.sessionFile) return rootSessionFile !== null && sessionFileBelongsToRoot(ref.sessionFile, rootSessionFile);
	return observed.has(ref.id);
}

/**
 * One live session's view of its own spawn tree: the root-scoped
 * `task:subagent:*` frames plus the authoritative `AgentRegistry` refs.
 *
 * A sink is bound to exactly one root session (one gateway wrapper), so ids
 * cannot leak across roots — agent ids are only unique within a parent root's
 * artifacts tree. It is created by the gateway at session start and disposed
 * with the wrapper.
 */
export class SubagentSink {
	readonly #getRootSessionFile: () => string | null;
	readonly #rpc: RpcSubagentRegistry;
	readonly #listeners = new Set<SinkListener>();
	readonly #pendingProgress = new Map<string, SubagentProgressPayload>();
	#flushTimer: Timer | undefined;
	#unsubscribeRegistry: (() => void) | undefined;
	#disposed = false;

	constructor(bus: EventBus, getRootSessionFile: () => string | null) {
		this.#getRootSessionFile = getRootSessionFile;
		// `RpcSubagentRegistry` owns the bus subscriptions (lifecycle + progress)
		// and the pruning rules; the web surface only adds the coalescing and
		// fan-out below. Subscription level "progress" is exactly the web
		// surface: lifecycle + progress frames, without the per-message
		// `subagent_event` firehose (web clients read detail from the transcript).
		this.#rpc = new RpcSubagentRegistry(bus, frame => this.#onRpcFrame(frame));
		this.#rpc.setSubscriptionLevel("progress");
		this.#unsubscribeRegistry = AgentRegistry.global().onChange(event => {
			if (this.#disposed) return;
			if (event.type === "removed") {
				this.#broadcast({ type: "subagent_removed", id: event.ref.id });
				return;
			}
			// `buildRow` filters to this root's tree, so another session's
			// registry churn never reaches this stream.
			const row = this.buildRow(event.ref, this.#staleIds());
			if (row) this.#broadcast({ type: "subagent_status", subagent: row });
		});
	}

	get rootSessionFile(): string | null {
		return this.#getRootSessionFile();
	}

	/** Live observer snapshots, keyed by subagent id. */
	snapshots(): Map<string, RpcSubagentSnapshot> {
		const byId = new Map<string, RpcSubagentSnapshot>();
		for (const snapshot of this.#rpc.getSubagents()) byId.set(snapshot.id, snapshot);
		return byId;
	}

	/** Session file the live observer recorded for `subagentId`, if any. */
	transcriptSessionFile(subagentId: string): string | undefined {
		return this.snapshots().get(subagentId)?.sessionFile;
	}

	subscribe(listener: SinkListener): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		if (this.#flushTimer !== undefined) {
			clearInterval(this.#flushTimer);
			this.#flushTimer = undefined;
		}
		this.#unsubscribeRegistry?.();
		this.#unsubscribeRegistry = undefined;
		this.#rpc.dispose();
		this.#pendingProgress.clear();
		this.#listeners.clear();
	}

	#onRpcFrame(frame: RpcSubagentFrame): void {
		if (this.#disposed) return;
		if (frame.type === "subagent_progress") {
			// Latest-wins per subagent; flushed on the coalescing timer.
			this.#pendingProgress.set(frame.payload.progress.id, frame.payload);
			this.#flushTimer ??= setInterval(() => this.#flushProgress(), PROGRESS_FLUSH_MS);
			return;
		}
		if (frame.type === "subagent_lifecycle") {
			this.#broadcast(frame);
			if (frame.payload.status !== "started") this.#broadcast({ type: "subagent_removed", id: frame.payload.id });
		}
	}

	#flushProgress(): void {
		if (this.#pendingProgress.size === 0) {
			if (this.#flushTimer !== undefined) {
				clearInterval(this.#flushTimer);
				this.#flushTimer = undefined;
			}
			return;
		}
		const pending = [...this.#pendingProgress.values()];
		this.#pendingProgress.clear();
		for (const payload of pending) this.#broadcast({ type: "subagent_progress", payload });
	}

	#broadcast(frame: SubagentEventFrame): void {
		for (const listener of this.#listeners) {
			try {
				listener(frame);
			} catch (error) {
				logger.error("web-gateway: subagent sink listener failed", { error: String(error) });
			}
		}
	}

	#staleIds(): ReadonlySet<string> {
		return new Set(
			AgentRegistry.global()
				.staleAcceptedRuns()
				.map(ref => ref.id),
		);
	}

	/**
	 * One roster row: the registry ref is authoritative for identity/status, the
	 * live observer snapshot contributes the spawn ordinal, task text and
	 * progress, and persisted history contributes usage after a restart.
	 */
	buildRow(ref: AgentRef, staleIds?: ReadonlySet<string>): SubagentRosterEntry | undefined {
		if (ref.kind !== "sub") return undefined; // Advisors are observability-only, excluded like the TUI roster.
		const observed = this.snapshots();
		if (!isInRootTree(ref, this.#getRootSessionFile(), new Set(observed.keys()))) return undefined;
		const snapshot = observed.get(ref.id);
		const progress = snapshot?.progress;
		const metrics = rowMetricsFor(ref, progress);
		const row: SubagentRosterEntry = {
			id: ref.id,
			displayName: ref.displayName,
			kind: ref.kind,
			parentId: ref.parentId ?? null,
			depth: 0,
			status: ref.status,
			sessionFile: ref.sessionFile,
			createdAt: ref.createdAt,
			lastActivity: ref.lastActivity,
			persisted: ref.session === null,
		};
		if (snapshot) {
			row.index = snapshot.index;
			row.agent = snapshot.agent;
			row.agentSource = snapshot.agentSource;
			row.taskStatus = snapshot.status;
			if (snapshot.description !== undefined) row.description = snapshot.description;
			if (snapshot.task !== undefined) row.task = snapshot.task;
			if (snapshot.assignment !== undefined) row.assignment = snapshot.assignment;
			if (snapshot.parentToolCallId !== undefined) row.parentToolCallId = snapshot.parentToolCallId;
		}
		if (ref.activity !== undefined) row.activity = ref.activity;
		if (ref.lifecycle !== undefined) row.lifecycle = { ...ref.lifecycle };
		if (staleIds?.has(ref.id)) row.staleAcceptedRun = true;
		if (progress) row.progress = projectProgress(progress);
		if (metrics) row.metrics = metrics;
		if (ref.history) {
			row.outputPath = ref.history.outputPath ?? null;
			row.patchPath = ref.history.patchPath ?? null;
			row.branchName = ref.history.branchName ?? null;
		}
		return row;
	}
}

/**
 * Per-session fallback-read cache, keyed by the live session object: the TUI
 * Agent Hub applies the same policy (`aggregateMetrics`), so a row without live
 * observer progress (a finished agent the observer already pruned) still
 * reports the tokens/cost its own transcript accounted.
 */
const fallbackSessionMetrics = new WeakMap<object, { metrics: AgentMetricsSummary | undefined }>();

/**
 * Row usage in the TUI's precedence: live observer progress, then the
 * transcript-derived history of a persisted row, then a cached read of the live
 * session's own stats. `undefined` when nothing reported.
 */
function rowMetricsFor(ref: AgentRef, progress: AgentProgress | undefined): AgentMetricsSummary | undefined {
	if (progress) {
		// Live observer progress: exact, and it carries the context gauge (the
		// same per-row projection the TUI renders).
		return progressMetrics({
			id: ref.id,
			kind: "subagent",
			label: ref.id,
			status: "active",
			lastUpdate: Date.now(),
			progress,
		});
	}
	if (!ref.session) return ref.history?.metrics;
	// Observer progress is gone (it prunes terminal rows) but the session is
	// still attached: reuse the TUI's cached fallback read of the session's own
	// accounting. That path sums scalars, so the context gauge — meaningless
	// once the run ended — is deliberately not reported.
	const { metrics } = aggregateMetrics<AgentRecordLike>({
		rows: [ref as unknown as AgentRecordLike],
		observedById: new Map<string, ObservableSession>(),
		metricsFor: (row, observed) => hubRowMetrics(row, observed, fallbackSessionMetrics),
		fallbackStatsSession: hubFallbackStatsSession,
		sessionMetrics: fallbackSessionMetrics,
		refreshFallback: true,
	});
	if (metrics.reportedAgents === 0) return undefined;
	// Project the aggregate back onto the DTO's shape: `reportedAgents` /
	// `activeDurationAgents` are aggregation bookkeeping, not row metrics. The
	// fallback read carries no measured duration (no observer timed the run) and
	// the aggregate's duration fields describe a sum of active rows, so duration
	// is reported as unknown rather than as a misleading zero.
	return {
		tokens: metrics.tokens,
		requests: metrics.requests,
		tools: metrics.tools,
		cost: metrics.cost,
		durationMs: 0,
		durationKind: "unknown",
	};
}

/** Bounded, display-only projection of a live `AgentProgress`. */
function projectProgress(progress: AgentProgress): SubagentProgressView {
	const view: SubagentProgressView = {};
	if (progress.lastIntent !== undefined) view.lastIntent = progress.lastIntent;
	if (progress.currentTool !== undefined) view.currentTool = progress.currentTool;
	view.toolCount = progress.toolCount;
	view.requests = progress.requests;
	view.tokens = progress.tokens;
	view.cost = progress.cost;
	view.durationMs = progress.durationMs;
	if (progress.contextTokens !== undefined) view.contextTokens = progress.contextTokens;
	if (progress.contextWindow !== undefined) view.contextWindow = progress.contextWindow;
	const recent = progress.recentOutput.slice(-MAX_RECENT_OUTPUT_LINES);
	if (recent.length > 0) {
		view.recentOutput = recent.map(line =>
			line.length <= MAX_RECENT_OUTPUT_CHARS ? line : `${line.slice(0, MAX_RECENT_OUTPUT_CHARS - 1)}…`,
		);
	}
	return view;
}

// ---------------------------------------------------------------------------
// Roster projection
// ---------------------------------------------------------------------------

function compareRosterEntries(a: SubagentRosterEntry, b: SubagentRosterEntry): number {
	// Mirrors the TUI Agent Hub roster sort (`agent-hub.ts`: status, then most
	// recently active, then id) so both surfaces agree row for row.
	return (
		STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.lastActivity - a.lastActivity || a.id.localeCompare(b.id)
	);
}

function orderRoster(entries: SubagentRosterEntry[]): SubagentRosterEntry[] {
	entries.sort(compareRosterEntries);
	const bounded = entries.slice(0, MAX_ROSTER_ROWS);
	const byId = new Map(bounded.map(entry => [entry.id, entry]));
	for (const entry of bounded) {
		// Depth in this root's spawn tree; a row whose parent is outside the
		// window (or is the main session) is a root row.
		let depth = 0;
		let cursor = entry.parentId;
		const seen = new Set<string>([entry.id]);
		while (cursor && byId.has(cursor) && !seen.has(cursor)) {
			seen.add(cursor);
			depth += 1;
			cursor = byId.get(cursor)?.parentId ?? null;
		}
		entry.depth = depth;
	}
	return bounded;
}

/** Roots already offered a history hydration pass, with the persisted ids it covered. */
const hydratedPersistedIds = new Map<string, Set<string>>();

/**
 * Fill in `history.metrics` for persisted rows that have none yet, so a
 * cold-start roster reports the same usage the TUI Agent Hub shows. The roster
 * scan itself (`ensurePersistedRoster`) runs latched and cheap; the transcript
 * hydration behind it is a full read, so each persisted row triggers at most
 * one scan per process (new parked transcripts still get theirs when they first
 * appear). A failed read degrades to a row without metrics, never to a failed
 * request.
 */
async function hydratePersistedHistory(
	registry: AgentRegistry,
	rootSessionFile: string,
	sink: SubagentSink | null | undefined,
): Promise<void> {
	let covered = hydratedPersistedIds.get(rootSessionFile);
	if (!covered) {
		covered = new Set<string>();
		if (hydratedPersistedIds.size >= MAX_HYDRATION_TRACKED_ROOTS) {
			const oldest = hydratedPersistedIds.keys().next();
			if (!oldest.done) hydratedPersistedIds.delete(oldest.value);
		}
		hydratedPersistedIds.set(rootSessionFile, covered);
	}
	const pending = registry
		.list()
		.filter(
			ref =>
				ref.kind === "sub" &&
				ref.session === null &&
				ref.history?.metrics === undefined &&
				!covered.has(ref.id) &&
				(ref.sessionFile
					? sessionFileBelongsToRoot(ref.sessionFile, rootSessionFile)
					: sink?.snapshots().has(ref.id) === true),
		);
	if (pending.length === 0) return;
	for (const ref of pending) covered.add(ref.id);
	try {
		await registerPersistedSubagents(registry, rootSessionFile, { hydrateHistory: true });
	} catch (error) {
		logger.warn("web-gateway: persisted subagent history hydration failed", {
			rootSessionFile,
			error: String(error),
		});
	}
}

/**
 * Roster rows for `rootSessionFile`: every sub-kind registry ref in this
 * session's artifacts tree (live, parked and tombstoned rows alike), enriched
 * with the sink's live progress. Advisors are excluded, matching the TUI.
 */
export async function collectRoster(
	sink: SubagentSink | null | undefined,
	rootSessionFile: string | null,
): Promise<SubagentRosterEntry[]> {
	const registry = AgentRegistry.global();
	if (rootSessionFile) {
		try {
			await ensurePersistedRoster(registry, rootSessionFile);
			await hydratePersistedHistory(registry, rootSessionFile, sink);
		} catch (error) {
			// Disk failure degrades the roster to in-memory rows, never the request.
			logger.warn("web-gateway: persisted subagent roster scan failed", { error: String(error) });
		}
	}
	const staleIds = new Set(registry.staleAcceptedRuns().map(ref => ref.id));
	const observed = sink ? new Set(sink.snapshots().keys()) : new Set<string>();
	const entries: SubagentRosterEntry[] = [];
	for (const ref of registry.list()) {
		if (sink) {
			const row = sink.buildRow(ref, staleIds);
			if (row) entries.push(row);
			continue;
		}
		// Cold read (no live session): only persisted facts are available.
		if (ref.kind !== "sub") continue;
		if (!isInRootTree(ref, rootSessionFile, observed)) continue;
		const row = buildRowWithoutSink(ref, staleIds);
		if (row) entries.push(row);
	}
	return orderRoster(entries);
}

/**
 * Row build for a session with no live sink (cold roster read after a restart
 * or before the session is started). Only persisted facts are available.
 */
function buildRowWithoutSink(ref: AgentRef, staleIds?: ReadonlySet<string>): SubagentRosterEntry | undefined {
	if (ref.kind === "main" || ref.kind === "advisor") return undefined;
	const row: SubagentRosterEntry = {
		id: ref.id,
		displayName: ref.displayName,
		kind: ref.kind,
		parentId: ref.parentId ?? null,
		depth: 0,
		status: ref.status,
		sessionFile: ref.sessionFile,
		createdAt: ref.createdAt,
		lastActivity: ref.lastActivity,
		persisted: ref.session === null,
	};
	if (ref.activity !== undefined) row.activity = ref.activity;
	if (ref.lifecycle !== undefined) row.lifecycle = { ...ref.lifecycle };
	if (staleIds?.has(ref.id) === true) row.staleAcceptedRun = true;
	const metrics = rowMetricsFor(ref, undefined);
	if (metrics) row.metrics = metrics;
	if (ref.history) {
		row.outputPath = ref.history.outputPath ?? null;
		row.patchPath = ref.history.patchPath ?? null;
		row.branchName = ref.history.branchName ?? null;
	}
	return row;
}

function maxConcurrencyFor(session: AgentSession | undefined): number {
	try {
		if (session) return cfgTaskMaxConcurrency.get(session.settings);
	} catch (error) {
		logger.debug("web-gateway: maxConcurrency read failed", { error: String(error) });
	}
	return getDefault("task.maxConcurrency");
}

function snapshotResponse(entries: SubagentRosterEntry[], session: AgentSession | undefined): SubagentRosterResponse {
	return { subagents: entries, maxConcurrency: maxConcurrencyFor(session), generatedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Session lookup
// ---------------------------------------------------------------------------

interface ResolvedSession {
	wrapper: AgentSessionWrapper | undefined;
	/** File of the root session whose artifacts tree scopes this roster. */
	sessionFile: string | null;
	inner: AgentSession | undefined;
}

/**
 * Resolve the roster's root session. A live wrapper wins; otherwise the
 * persistent session is resolved on disk so the roster still serves persisted
 * (parked/aborted) rows without paying for a session start.
 */
async function resolveRosterSession(sessionId: string): Promise<ResolvedSession | null> {
	const wrapper = sessions.get(sessionId);
	if (wrapper?.isAlive()) {
		return { wrapper, sessionFile: wrapper.sessionFile, inner: wrapper.getSession() };
	}
	const filePath = await resolveSessionPath(sessionId);
	if (!filePath) return null;
	return { wrapper: undefined, sessionFile: filePath, inner: undefined };
}

// ---------------------------------------------------------------------------
// Handlers — roster
// ---------------------------------------------------------------------------

export async function handleSubagentRoster(_req: Request, sessionId: string): Promise<Response> {
	const resolved = await resolveRosterSession(sessionId);
	if (!resolved) return json({ error: `Unknown session: ${sessionId}` }, 404);
	const entries = await collectRoster(resolved.wrapper?.subagentSink, resolved.sessionFile);
	return json(snapshotResponse(entries, resolved.inner));
}

export async function handleSubagentEvents(req: Request, sessionId: string): Promise<Response> {
	let wrapper = sessions.get(sessionId);
	if (!wrapper?.isAlive()) {
		const filePath = await resolveSessionPath(sessionId);
		if (!filePath) return new Response(`Session not found: ${sessionId}`, { status: 404 });
		try {
			({ session: wrapper } = await startRpcSession(sessionId, filePath));
		} catch (error) {
			return new Response(`Failed to start agent: ${String(error)}`, { status: 500 });
		}
	}
	const sink = wrapper.subagentSink;
	const inner = wrapper.getSession();

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			const encode = (data: unknown): void => {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
			};
			// Slow-consumer policy (see module header): progress frames are
			// dropped while the connection buffer is full, keeping only the
			// latest per subagent; state frames always go out.
			const retained = new Map<string, SubagentProgressPayload>();
			const flushRetained = (): void => {
				if (retained.size === 0) return;
				if (controller.desiredSize !== null && controller.desiredSize <= 0) return;
				for (const payload of retained.values()) encode({ type: "subagent_progress", payload });
				retained.clear();
			};
			let closed = false;
			let unsubscribe: (() => void) | undefined;

			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(":\n\n"));
					flushRetained();
				} catch {
					// controller already closed
				}
			}, SSE_HEARTBEAT_MS);

			const cleanup = (): void => {
				closed = true;
				clearInterval(heartbeat);
				retained.clear();
				unsubscribe?.();
				unsubscribe = undefined;
				try {
					controller.close();
				} catch {
					// already closed
				}
			};
			req.signal?.addEventListener("abort", cleanup);

			// The snapshot is the stream's first frame, so it is written before
			// subscribing: the roster scan is async, and subscribing first would
			// let a lifecycle/progress burst overtake it. Frames landing during
			// the scan are description-only; the snapshot already carries state.
			void (async () => {
				try {
					const entries = await collectRoster(sink, wrapper.sessionFile);
					encode({ type: "subagent_snapshot", ...snapshotResponse(entries, inner) });
				} catch (error) {
					logger.error("web-gateway: subagent snapshot failed", { error: String(error) });
					encode({ type: "error", error: String(error) });
				}
				if (closed) return;
				unsubscribe = sink?.subscribe(frame => {
					try {
						if (
							frame.type === "subagent_progress" &&
							controller.desiredSize !== null &&
							controller.desiredSize <= 0
						) {
							retained.set(frame.payload.progress.id, frame.payload);
							return;
						}
						encode(frame);
						flushRetained();
					} catch {
						// controller already closed
					}
				});
			})();
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

// ---------------------------------------------------------------------------
// Handlers — transcript
// ---------------------------------------------------------------------------

/** Probe the root's artifacts tree for `<subId>.jsonl` (nested spawns included). */
async function probeTranscriptFile(rootSessionFile: string, subagentId: string): Promise<string | undefined> {
	if (!rootSessionFile.endsWith(".jsonl")) return undefined;
	const artifactRoot = rootSessionFile.slice(0, -".jsonl".length);
	const fileName = `${subagentId}.jsonl`;
	let dirs: string[] = [artifactRoot];
	for (let depth = 0; depth <= MAX_TRANSCRIPT_PROBE_DEPTH; depth++) {
		const next: string[] = [];
		for (const dir of dirs) {
			const candidate = path.join(dir, fileName);
			try {
				const stat = await fs.stat(candidate);
				if (stat.isFile()) return candidate;
			} catch {
				// missing candidate is the normal case
			}
			let entries: Dirent[];
			try {
				entries = await fs.readdir(dir, { withFileTypes: true });
			} catch (error) {
				if (!isEnoent(error)) throw error;
				continue;
			}
			for (const entry of entries) {
				if (entry.isDirectory()) next.push(path.join(dir, entry.name));
			}
		}
		dirs = next;
		if (dirs.length === 0) break;
	}
	return undefined;
}

async function resolveSubagentSessionFile(args: {
	sink: SubagentSink | null | undefined;
	rootSessionFile: string | null;
	subagentId: string;
}): Promise<string | undefined> {
	const { sink, rootSessionFile, subagentId } = args;
	const observed = sink?.transcriptSessionFile(subagentId);
	if (observed) return observed;
	const ref = AgentRegistry.global().get(subagentId);
	if (ref?.kind !== "main" && ref?.sessionFile) {
		if (rootSessionFile === null || sessionFileBelongsToRoot(ref.sessionFile, rootSessionFile))
			return ref.sessionFile;
	}
	if (rootSessionFile === null) return undefined;
	try {
		return await probeTranscriptFile(rootSessionFile, subagentId);
	} catch (error) {
		logger.warn("web-gateway: transcript probe failed", { subagentId, error: String(error) });
		return undefined;
	}
}

export async function handleSubagentTranscript(req: Request, sessionId: string, subagentId: string): Promise<Response> {
	const resolved = await resolveRosterSession(sessionId);
	if (!resolved) return json({ error: `Unknown session: ${sessionId}` }, 404);
	const rawFromByte = new URL(req.url).searchParams.get("fromByte");
	const fromByte = rawFromByte === null ? 0 : Number(rawFromByte);
	if (!Number.isFinite(fromByte)) return json({ error: "fromByte must be a finite number" }, 400);

	const sessionFile = await resolveSubagentSessionFile({
		sink: resolved.wrapper?.subagentSink,
		rootSessionFile: resolved.sessionFile,
		subagentId,
	});
	if (!sessionFile) return json({ error: `Unknown subagent: ${subagentId}` }, 404);

	const page = await readRpcSubagentTranscript(sessionFile, fromByte);
	const response: SubagentTranscriptResponse = {
		subagentId,
		sessionFile: page.sessionFile,
		fromByte: page.fromByte,
		nextByte: page.nextByte,
		reset: page.reset,
		entries: page.entries,
		messages: page.messages,
	};
	return json(response, 200);
}

// ---------------------------------------------------------------------------
// Handlers — published output
// ---------------------------------------------------------------------------

/**
 * `GET …/subagents/:subId/output` — the published `<id>.md` for a subagent that
 * finished with a durable artifact. A known subagent that has not published yet
 * answers `published: false` plus its progress view (the `agent://<id>` progress
 * semantics); an id that is neither registered in this session's tree nor on
 * disk is a 404.
 */
export async function handleSubagentOutput(req: Request, sessionId: string, subagentId: string): Promise<Response> {
	const resolved = await resolveRosterSession(sessionId);
	if (!resolved) return json({ error: `Unknown session: ${sessionId}` }, 404);
	const sink = resolved.wrapper?.subagentSink;
	const wantSidecar = new URL(req.url).searchParams.get("json") === "1";

	const sessionFile = await resolveSubagentSessionFile({
		sink,
		rootSessionFile: resolved.sessionFile,
		subagentId,
	});
	const ref = AgentRegistry.global().get(subagentId);
	if (!sessionFile && (!ref || ref.kind === "main")) {
		return json({ error: `Unknown subagent: ${subagentId}` }, 404);
	}

	const artifactBase = sessionFile ? sessionFile.slice(0, -".jsonl".length) : undefined;
	const outputPath = artifactBase ? `${artifactBase}.md` : undefined;
	const sidecarPath = artifactBase ? `${artifactBase}.json` : undefined;
	let content: string | undefined;
	if (outputPath) {
		try {
			content = await Bun.file(outputPath).text();
		} catch (error) {
			if (!isEnoent(error)) return json({ error: `Failed to read ${outputPath}: ${String(error)}` }, 500);
		}
	}

	const snapshot = sink?.snapshots().get(subagentId);
	const progress = snapshot?.progress;
	const row = ref ? (sink?.buildRow(ref) ?? buildRowWithoutSink(ref, new Set<string>())) : undefined;
	const status: AgentStatus = row?.status ?? "parked";

	if (content === undefined) {
		if (wantSidecar) return json({ error: `No published output for ${subagentId} (status: ${status})` }, 404);
		const response: SubagentOutputResponse = {
			subagentId,
			published: false,
			status,
			message: `No published output for ${subagentId} (status: ${status})`,
		};
		if (row?.taskStatus) response.taskStatus = row.taskStatus;
		if (row?.progress) response.progress = row.progress;
		else if (progress) response.progress = projectProgress(progress);
		if (row?.metrics) response.metrics = row.metrics;
		return json(response, 200);
	}

	const response: SubagentOutputResponse = {
		subagentId,
		published: true,
		status,
		outputPath,
		content,
		size: Buffer.byteLength(content, "utf-8"),
	};
	if (row?.taskStatus) response.taskStatus = row.taskStatus;
	if (wantSidecar && sidecarPath) {
		try {
			response.sidecar = JSON.parse(await Bun.file(sidecarPath).text());
		} catch (error) {
			if (!isEnoent(error)) return json({ error: `Failed to read ${sidecarPath}: ${String(error)}` }, 500);
			return json({ error: `No sidecar for ${subagentId}: ${sidecarPath}` }, 404);
		}
	}
	return json(response, 200);
}

// ---------------------------------------------------------------------------
// Wrapper lifecycle (called from `agents.ts`)
// ---------------------------------------------------------------------------

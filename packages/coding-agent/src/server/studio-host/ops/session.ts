/**
 * Studio operations — session lifecycle, the core turn commands, interactions, subagent transcripts.
 *
 * Operation → Zeta gateway route:
 *
 * | operation | gateway |
 * |---|---|
 * | `session.create` | `POST /api/agent/new` (`ensure_session`, cwd of the active/default workspace) |
 * | `session.resume` | `POST /api/agent/:id` `{type:"get_state"}` (attach a dormant thread) then `session.state` |
 * | `session.delete` | `DELETE /api/sessions/:id` |
 * | `session.archive` / `session.unarchive` | `POST /api/sessions/:id/archive` / `POST /api/sessions/:id/unarchive` |
 * | `session.fork` | `POST /api/agent/:id` `{type:"fork"}` at the last user entry |
 * | `session.state` | `GET /api/sessions/:id/state` → `OperatorStateSnapshot` |
 * | `session.tree.get` | `GET /api/sessions/:id/state` (snapshot; the tree itself is transcript items) |
 * | `session.tree.navigate` | `POST /api/agent/:id` `{type:"navigate_tree"}` |
 * | `session.tree.branch` | `POST /api/agent/:id` `{type:"fork"}` at `targetId` |
 * | `session.model.set` | `POST /api/agent/:id` `{type:"set_model"}` (+ `set_thinking_level`) |
 * | `session.thinking.set` | `POST /api/agent/:id` `{type:"set_thinking_level"}` |
 * | `core.prompt` / `core.steer` / `core.followUp` / `core.abort` / `core.continue` | `POST /api/agent/:id` |
 * | `queue.enqueue` | `POST /api/agent/:id` `{type:"follow_up"}` |
 * | `interaction.respond` | `POST /api/extension-ui/response` |
 * | `session.transcript.read` / `session.transcript.readPage` | `GET /api/sessions/:id` (context + leaf + entry timestamps) |
 * | `agent.transcript.read` / `agent.conversation.read` | `GET /api/agent/:parent/subagents/:agent/transcript` |
 * | `session.agents.list` | `GET /api/agent/:id/subagents` |
 *
 * Deliberate omissions (Zeta cannot answer them, so the capability manifest
 * does not advertise them and Studio hides the surface):
 * `session.fast.set`, `session.taskModel.set`, `session.telemetry.read`,
 * `session.handoff`, `session.prewalk.*`, `session.clearContext`,
 * `session.drop`, `agent.send|kill|revive|release|spawn`,
 * `agents.definition.*` (writes need a task-agent file route Zeta lacks;
 * `agents.definitions.get` is the disk read and lives in `ops/agents.ts`).
 *
 * The contract's session commands carry no session id: they act on the live
 * Runtime session the client is driving. This file tracks that session (the
 * gateway's coordinator session until `session.create`/fork/branch switch it)
 * and never invents one.
 */
import { serveIdentity } from "../../web-gateway/identity.js";
import type { GatewayReply } from "../gateway.js";
import {
	StudioOpError,
	callGateway,
	gatewayJson,
	invalid,
	optionalString,
	requiredString,
	segment,
	unavailable,
} from "../gateway.js";
import type { StudioFamily } from "../registry.js";
import type { ConversationTranscriptReadPage } from "../contract/conversation.js";
import type { SessionId } from "../contract/ids.js";
import type { ContinueTurnOutcome, SessionTreeCommandOutcome } from "../contract/operations.js";
import type { ConfigWriteResult } from "../contract/read-models.js";
import type {
	AgentStatus,
	AgentTranscriptMessage,
	AgentTranscriptPage,
	StudioAgentSnapshot,
	StudioAgentUsage,
} from "../protocol/contracts/agents-jobs.js";
import type { ApprovalMode } from "../protocol/contracts/commands.js";
import type {
	ConversationContentBlock,
	ConversationItem,
	ConversationTranscriptPage,
	JsonValue,
} from "../protocol/contracts/conversation.js";
import { CONVERSATION_LIMITS } from "../protocol/contracts/conversation.js";
import type { AgentId, OpaqueCursor, RuntimeEpoch, RuntimeId, StateVersion } from "../protocol/contracts/ids.js";
import type {
	GoalState,
	LoopState,
	OperatorStateSnapshot,
	PlanState,
	SessionModelState,
	SessionThinkingLevel,
	SessionThinkingSelector,
} from "../protocol/contracts/state.js";
import { SESSION_THINKING_LEVELS } from "../protocol/contracts/state.js";
import { truncateUtf8, utf8ByteLength } from "../protocol/conversation-text.js";

/**
 * The host authority epoch; the same constant `bootstrap.ts` publishes. Zeta
 * has one runtime per serve process, so every snapshot and transcript page
 * shares it.
 */
const RUNTIME_EPOCH = 1 as RuntimeEpoch;

/**
 * How long a turn-opening command waits for the gateway's answer before it
 * assumes the runtime accepted a long turn. The gateway settles `prompt` (and
 * the synthetic branch of `continue`) only when the *turn* ends, so awaiting it
 * would hold the command receipt for minutes; a short lease surfaces immediate
 * failures while the live session state still reports the running turn.
 */
const TURN_DISPATCH_LEASE_MS = 1500;

// ---------------------------------------------------------------------------
// Untrusted JSON narrowing (gateway answers are payloads, never trusted types)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | undefined {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

function isoFromMilliseconds(value: number | undefined): string | undefined {
	if (value === undefined || value <= 0) return undefined;
	return new Date(value).toISOString();
}

function millisecondsFromIso(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function errorSuffix(body: unknown): string {
	if (!isRecord(body)) return "";
	const error = stringField(body, "error");
	return error === undefined ? "" : `: ${error}`;
}

/** The gateway's own `describe` is private; mutations need the same sentence. */
function confirmMutation(reply: GatewayReply, method: string, path: string, notFound: string): boolean {
	if (reply.status === 404) throw invalid(notFound);
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`${method} ${path} → ${reply.status}${errorSuffix(reply.body)}`);
	}
	return isRecord(reply.body) && reply.body.ok === true;
}

// ---------------------------------------------------------------------------
// The live session the Studio client is driving
// ---------------------------------------------------------------------------

/**
 * Session the sessionless `session.*` / `core.*` commands act on. Zeta has one
 * live Runtime session per conversation the client opened; the coordinator
 * session (`/api/agent/current`) is the fallback until one is created.
 */
let activeSessionId: string | undefined;

/**
 * Workspace the client's sessions live in, remembered from the last
 * `session.create` (a brand-new session has no persisted header to read it
 * from).
 */
let sessionCwd: string | undefined;

/**
 * The session the sessionless `session.*` / `core.*` commands act on. Zeta has
 * one live Runtime session per conversation the client opened; the coordinator
 * session (`/api/agent/current`) is the fallback until one is created.
 *
 * Exported so sibling families (`operator.invoke`) address the same session
 * instead of keeping a second copy of this rule.
 */
export async function currentSessionId(): Promise<string> {
	if (activeSessionId !== undefined) return activeSessionId;
	const reply = await callGateway("/api/agent/current");
	if (reply.status === 404) throw unavailable("no live session; start one with session.create");
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`GET /api/agent/current → ${reply.status}${errorSuffix(reply.body)}`);
	}
	const sessionId = isRecord(reply.body) ? stringField(reply.body, "sessionId") : undefined;
	if (sessionId === undefined || sessionId === "") {
		throw unavailable("the gateway did not report a current session");
	}
	return sessionId;
}

// ---------------------------------------------------------------------------
// Operator snapshot from the gateway's live agent state
// ---------------------------------------------------------------------------

interface GoalSnapshot {
	readonly status: string;
	readonly objective?: string;
	readonly tokenBudget?: number;
	readonly tokensUsed?: number;
}

interface LoopSnapshot {
	readonly enabled: boolean;
	readonly paused: boolean;
	readonly prompt?: string;
	readonly condition?: { readonly command: string; readonly until: boolean };
}

interface LiveAgentState {
	readonly sessionId: string;
	readonly sessionName?: string;
	readonly model?: { readonly provider: string; readonly modelId: string };
	readonly thinkingLevel?: string;
	readonly isStreaming: boolean;
	readonly isCompacting: boolean;
	readonly planModeEnabled: boolean;
	readonly stateVersion: number;
	readonly steeringCount: number;
	readonly followUpCount: number;
	readonly planContent?: string;
	readonly goal?: GoalSnapshot;
	readonly vibe: boolean;
	readonly loop?: LoopSnapshot;
}

function parseGoal(value: unknown): GoalSnapshot | undefined {
	if (!isRecord(value)) return undefined;
	const status = stringField(value, "status");
	if (status === undefined) return undefined;
	return {
		status,
		...(stringField(value, "objective") === undefined ? {} : { objective: stringField(value, "objective") }),
		...(numberField(value, "tokenBudget") === undefined ? {} : { tokenBudget: numberField(value, "tokenBudget") }),
		...(numberField(value, "tokensUsed") === undefined ? {} : { tokensUsed: numberField(value, "tokensUsed") }),
	};
}

function parseLoop(value: unknown): LoopSnapshot | undefined {
	if (!isRecord(value)) return undefined;
	const enabled = booleanField(value, "enabled");
	if (enabled === undefined) return undefined;
	const conditionRecord = isRecord(value.condition) ? value.condition : undefined;
	const command = conditionRecord === undefined ? undefined : stringField(conditionRecord, "command");
	const until = conditionRecord === undefined ? undefined : booleanField(conditionRecord, "until");
	const prompt = stringField(value, "prompt");
	return {
		enabled,
		paused: booleanField(value, "paused") === true,
		...(prompt === undefined || prompt === "" ? {} : { prompt }),
		...(command === undefined || until === undefined ? {} : { condition: { command, until } }),
	};
}

/** Narrow `AgentState` (the gateway's `state` payload) to the fields we project. */
function parseAgentState(value: unknown): LiveAgentState {
	if (!isRecord(value)) throw unavailable("the gateway returned no agent state");
	const sessionId = stringField(value, "sessionId");
	const isStreaming = booleanField(value, "isStreaming");
	const isCompacting = booleanField(value, "isCompacting");
	const planModeEnabled = booleanField(value, "planModeEnabled");
	const stateVersion = numberField(value, "stateVersion");
	if (
		sessionId === undefined ||
		isStreaming === undefined ||
		isCompacting === undefined ||
		planModeEnabled === undefined ||
		stateVersion === undefined
	) {
		throw unavailable("the gateway returned an incomplete agent state");
	}

	const modelRecord = isRecord(value.model) ? value.model : undefined;
	const provider = modelRecord === undefined ? undefined : stringField(modelRecord, "provider");
	const modelId = modelRecord === undefined ? undefined : stringField(modelRecord, "modelId");
	const queued = isRecord(value.queuedMessages) ? value.queuedMessages : undefined;
	const modes = isRecord(value.modes) ? value.modes : undefined;
	const goalRecord = modes === undefined ? undefined : modes.goal;
	const goal =
		isRecord(goalRecord) && booleanField(goalRecord, "enabled") === true ? parseGoal(goalRecord.goal) : undefined;
	const vibeRecord = modes === undefined ? undefined : modes.vibe;
	const vibe = isRecord(vibeRecord) && booleanField(vibeRecord, "enabled") === true;
	const loop = parseLoop(value.loop);
	const sessionName = nonEmptyString(stringField(value, "sessionName"));
	const thinkingLevel = nonEmptyString(stringField(value, "thinkingLevel"));
	const planContent = stringField(value, "planContent");

	return {
		sessionId,
		...(sessionName === undefined ? {} : { sessionName }),
		...(provider === undefined || modelId === undefined ? {} : { model: { provider, modelId } }),
		...(thinkingLevel === undefined ? {} : { thinkingLevel }),
		isStreaming,
		isCompacting,
		planModeEnabled,
		stateVersion,
		steeringCount: queued === undefined ? 0 : stringArray(queued.steering).length,
		followUpCount: queued === undefined ? 0 : stringArray(queued.followUp).length,
		...(planContent === undefined ? {} : { planContent }),
		...(goal === undefined ? {} : { goal }),
		vibe,
		...(loop === undefined ? {} : { loop }),
	};
}

function sessionModelState(
	model: { readonly provider: string; readonly modelId: string },
	thinkingLevel: string | undefined,
): SessionModelState {
	const thinking =
		thinkingLevel !== undefined && (SESSION_THINKING_LEVELS as readonly string[]).includes(thinkingLevel)
			? (thinkingLevel as SessionThinkingLevel)
			: undefined;
	const configured =
		thinking !== undefined ? thinking : thinkingLevel === "auto" ? ("auto" as SessionThinkingSelector) : undefined;
	return {
		selector: `${model.provider}/${model.modelId}`,
		provider: model.provider,
		id: model.modelId,
		...(thinking === undefined ? {} : { thinking }),
		...(configured === undefined ? {} : { configuredThinking: configured }),
	};
}

function goalState(goal: GoalSnapshot): GoalState | undefined {
	const status =
		goal.status === "active"
			? ("active" as const)
			: goal.status === "paused"
				? ("paused" as const)
				: goal.status === "complete"
					? ("complete" as const)
					: undefined;
	if (status === undefined) return undefined;
	return {
		status,
		...(goal.objective === undefined ? {} : { objective: goal.objective }),
		...(goal.tokenBudget === undefined ? {} : { tokenBudget: goal.tokenBudget }),
		...(goal.tokensUsed === undefined ? {} : { tokensUsed: goal.tokensUsed }),
	};
}

function loopState(loop: LoopSnapshot): LoopState | undefined {
	if (!loop.enabled) return undefined;
	return {
		status: loop.paused ? "paused" : "running",
		...(loop.prompt === undefined ? {} : { prompt: loop.prompt }),
		...(loop.condition === undefined ? {} : { condition: loop.condition }),
	};
}

/** Identity of this serve process as the Studio runtime. Stable per process, no PID. */
let runtimeIdentity: RuntimeId | undefined;
function runtimeId(): RuntimeId {
	runtimeIdentity ??= `zeta:${serveIdentity().startedAt}` as RuntimeId;
	return runtimeIdentity;
}

function buildSnapshot(
	state: LiveAgentState,
	approvalMode: ApprovalMode,
	agents: readonly StudioAgentSnapshot[],
): OperatorStateSnapshot {
	const model = state.model === undefined ? undefined : sessionModelState(state.model, state.thinkingLevel);
	const goal = state.goal === undefined ? undefined : goalState(state.goal);
	const loop = state.loop === undefined ? undefined : loopState(state.loop);
	const plan: PlanState = state.planModeEnabled
		? { status: "active", ...(state.planContent === undefined ? {} : { body: state.planContent }) }
		: { status: "off" };
	return {
		runtimeId: runtimeId(),
		runtimeEpoch: RUNTIME_EPOCH,
		stateVersion: state.stateVersion as StateVersion,
		sessionId: state.sessionId as SessionId,
		workerResidency: "active",
		...(state.sessionName === undefined ? {} : { sessionTitle: state.sessionName }),
		isStreaming: state.isStreaming,
		isCompacting: state.isCompacting,
		activeMode: state.planModeEnabled ? "plan" : state.vibe ? "vibe" : goal === undefined ? "normal" : "goal",
		approvalMode,
		plan,
		...(goal === undefined ? {} : { goal }),
		...(loop === undefined ? {} : { loop }),
		...(model === undefined ? {} : { model }),
		pendingMessages: state.steeringCount + state.followUpCount,
		// Zeta keeps no Studio command ledger; nothing is tracked as in flight.
		activeCommandIds: [],
		agentsRevision: 0,
		jobsRevision: 0,
		agents: [...agents],
		// The gateway exposes no job surface (jobs are C-class in the spec).
		jobs: [],
	};
}

/** `tools.approvalMode` is the only approval authority Zeta exposes. */
async function readApprovalMode(): Promise<ApprovalMode> {
	const body = await gatewayJson<unknown>("/api/settings");
	const settings = isRecord(body) && Array.isArray(body.settings) ? body.settings : undefined;
	if (settings === undefined) throw unavailable("the gateway returned no settings payload");
	for (const entry of settings) {
		if (!isRecord(entry) || entry.path !== "tools.approvalMode") continue;
		const value = entry.value;
		if (value === "always-ask" || value === "always-ask-cached" || value === "write" || value === "yolo")
			return value;
		throw unavailable(`the gateway reported an unknown approval mode: ${String(value)}`);
	}
	throw unavailable("the gateway does not expose tools.approvalMode");
}

async function readLiveState(sessionId: string): Promise<LiveAgentState> {
	const body = await gatewayJson<unknown>(`/api/sessions/${segment(sessionId)}/state`);
	if (!isRecord(body) || body.running !== true) throw unavailable(`session ${sessionId} is not live`);
	return parseAgentState(body.state);
}

async function snapshotFor(sessionId: string): Promise<OperatorStateSnapshot> {
	const [state, approvalMode, agents] = await Promise.all([
		readLiveState(sessionId),
		readApprovalMode(),
		readSessionAgents(sessionId),
	]);
	return buildSnapshot(state, approvalMode, agents);
}

// ---------------------------------------------------------------------------
// Subagent roster → public agent snapshots
// ---------------------------------------------------------------------------

const ROSTER_STATUSES: readonly AgentStatus[] = [
	"starting",
	"running",
	"idle",
	"parked",
	"reviving",
	"aborted",
	"failed",
	"released",
];

function agentUsage(value: unknown): StudioAgentUsage | undefined {
	if (!isRecord(value)) return undefined;
	const tokens = numberField(value, "tokens");
	const requests = numberField(value, "requests");
	const tools = numberField(value, "tools");
	const cost = numberField(value, "cost");
	const durationMs = numberField(value, "durationMs");
	if (
		tokens === undefined ||
		requests === undefined ||
		tools === undefined ||
		cost === undefined ||
		durationMs === undefined
	) {
		return undefined;
	}
	const contextTokens = numberField(value, "contextTokens");
	const contextWindow = numberField(value, "contextWindow");
	const durationKind = stringField(value, "durationKind");
	return {
		tokens,
		requests,
		tools,
		cost,
		durationMs,
		...(contextTokens === undefined ? {} : { contextTokens }),
		...(contextWindow === undefined ? {} : { contextWindow }),
		...(durationKind === undefined ? {} : { durationKind }),
	};
}

/**
 * Project one roster row. Rows that lack an identity, a display name, a status
 * or a timestamp are dropped instead of filled in; `generation` and
 * `unreadCount` are the roster's untracked structural fields (Zeta exposes no
 * generation counter and no unread bookkeeping for subagents).
 */
function agentSnapshot(value: unknown): StudioAgentSnapshot | undefined {
	if (!isRecord(value)) return undefined;
	const agentId = stringField(value, "id");
	const displayName = stringField(value, "displayName");
	const kind = stringField(value, "kind");
	const status = stringField(value, "status");
	const persisted = booleanField(value, "persisted");
	const updatedAt = isoFromMilliseconds(numberField(value, "lastActivity"));
	if (
		agentId === undefined ||
		displayName === undefined ||
		kind === undefined ||
		status === undefined ||
		persisted === undefined ||
		updatedAt === undefined ||
		!(ROSTER_STATUSES as readonly string[]).includes(status)
	) {
		return undefined;
	}
	const parentAgentId = stringField(value, "parentId");
	const assignment = stringField(value, "assignment") ?? stringField(value, "task");
	const startedAt = isoFromMilliseconds(numberField(value, "createdAt"));
	const sessionFile = stringField(value, "sessionFile");
	const usage = agentUsage(value.metrics);
	const outputPath = stringField(value, "outputPath");
	const patchPath = stringField(value, "patchPath");
	const branchName = stringField(value, "branchName");
	return {
		agentId: agentId as AgentId,
		generation: 0 as StudioAgentSnapshot["generation"],
		...(parentAgentId === undefined ? {} : { parentAgentId: parentAgentId as AgentId }),
		kind,
		displayName,
		status: status as AgentStatus,
		...(assignment === undefined ? {} : { assignment }),
		...(startedAt === undefined ? {} : { startedAt }),
		updatedAt,
		hasLiveSession: persisted === false,
		hasTranscript: sessionFile !== undefined && sessionFile !== "",
		unreadCount: 0,
		activeJobIds: [],
		...(usage === undefined ? {} : { usage }),
		...(outputPath === undefined || outputPath === null ? {} : { outputPath }),
		...(patchPath === undefined || patchPath === null ? {} : { patchPath }),
		...(branchName === undefined || branchName === null ? {} : { branchName }),
	};
}

/** Roster for a session; a 404 means the gateway has no roster entry (no subagents). */
async function readSessionAgents(sessionId: string): Promise<StudioAgentSnapshot[]> {
	const reply = await callGateway(`/api/agent/${segment(sessionId)}/subagents`);
	if (reply.status === 404) return [];
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`GET /api/agent/${sessionId}/subagents → ${reply.status}${errorSuffix(reply.body)}`);
	}
	if (!isRecord(reply.body) || !Array.isArray(reply.body.subagents)) return [];
	const agents: StudioAgentSnapshot[] = [];
	for (const entry of reply.body.subagents) {
		const snapshot = agentSnapshot(entry);
		if (snapshot !== undefined) agents.push(snapshot);
	}
	return agents;
}

// ---------------------------------------------------------------------------
// Transcript projection and paging
// ---------------------------------------------------------------------------

interface TranscriptRecord {
	readonly id: string;
	/** ISO timestamp persisted on the session entry, when the gateway exposed it. */
	readonly createdAt: string | undefined;
	readonly message: unknown;
}

type CursorBinding =
	| { readonly kind: "session"; readonly sessionId: string }
	| { readonly kind: "agent"; readonly parentSessionId: string; readonly agentId: string };

function encodeCursor(binding: CursorBinding, boundary: number, revision?: string): OpaqueCursor {
	const payload =
		binding.kind === "session"
			? { v: 1, k: "older", s: binding.sessionId, b: boundary, ...(revision === undefined ? {} : { e: revision }) }
			: { v: 1, k: "older", p: binding.parentSessionId, a: binding.agentId, b: boundary };
	return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url") as OpaqueCursor;
}

interface DecodedCursor {
	readonly boundary: number;
	/** Entry id the boundary addressed (session cursors only). */
	readonly origin?: string;
}

function decodeCursor(cursor: string, binding: CursorBinding): DecodedCursor {
	let payload: unknown;
	try {
		payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
	} catch {
		throw invalid("cursor is not a Studio transcript cursor");
	}
	if (!isRecord(payload) || payload.v !== 1 || payload.k !== "older") {
		throw invalid("cursor is not a Studio transcript cursor");
	}
	const boundary = numberField(payload, "b");
	if (boundary === undefined || !Number.isInteger(boundary) || boundary < 0) {
		throw invalid("cursor is not a Studio transcript cursor");
	}
	if (binding.kind === "session") {
		if (stringField(payload, "s") !== binding.sessionId) {
			throw new StudioOpError("CURSOR_STALE", "cursor belongs to another session");
		}
	} else if (stringField(payload, "p") !== binding.parentSessionId || stringField(payload, "a") !== binding.agentId) {
		throw new StudioOpError("CURSOR_STALE", "cursor belongs to another agent transcript");
	}
	const origin = stringField(payload, "e");
	return { boundary, ...(origin === undefined ? {} : { origin }) };
}

function pageLimit(limit: number | undefined): number {
	if (limit === undefined) return CONVERSATION_LIMITS.TRANSCRIPT_LIMIT_DEFAULT;
	if (!Number.isFinite(limit)) throw invalid("limit must be a finite number");
	return Math.min(
		CONVERSATION_LIMITS.TRANSCRIPT_LIMIT_MAX,
		Math.max(CONVERSATION_LIMITS.TRANSCRIPT_LIMIT_MIN, Math.trunc(limit)),
	);
}

function pageBytes(items: readonly ConversationItem[]): number {
	let total = 0;
	for (const item of items) total += utf8ByteLength(JSON.stringify(item));
	return total;
}

interface ConversationPageParts {
	readonly items: readonly ConversationItem[];
	readonly olderCursor?: OpaqueCursor;
	readonly headCursor: OpaqueCursor;
	readonly hasMoreBefore: boolean;
}

/** Newest page first; `cursor` walks backwards through `olderCursor` only. */
function pageBackwards(
	items: readonly ConversationItem[],
	cursor: string | undefined,
	limit: number | undefined,
	binding: CursorBinding,
): ConversationPageParts {
	const size = pageLimit(limit);
	const boundary = cursor === undefined ? items.length : decodeCursor(cursor, binding).boundary;
	if (boundary > items.length) throw new StudioOpError("CURSOR_STALE", "cursor is past the transcript head");
	let start = Math.max(0, boundary - size);
	let pageItems = items.slice(start, boundary);
	while (pageItems.length > 1 && pageBytes(pageItems) > CONVERSATION_LIMITS.PAGE_MAX_BYTES) {
		pageItems = pageItems.slice(1);
		start += 1;
	}
	return {
		items: pageItems,
		headCursor: encodeCursor(binding, items.length),
		...(start > 0 ? { olderCursor: encodeCursor(binding, start) } : {}),
		hasMoreBefore: start > 0,
	};
}

function textBlock(text: string): ConversationContentBlock {
	const clipped = truncateUtf8(text, CONVERSATION_LIMITS.TEXT_BLOCK_MAX_BYTES);
	return clipped.truncated
		? { type: "text", text: clipped.text, truncated: true }
		: { type: "text", text: clipped.text };
}

function thinkingBlock(text: string): ConversationContentBlock {
	const clipped = truncateUtf8(text, CONVERSATION_LIMITS.TEXT_BLOCK_MAX_BYTES);
	return clipped.truncated
		? { type: "thinking", text: clipped.text, truncated: true }
		: { type: "thinking", text: clipped.text };
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (depth >= CONVERSATION_LIMITS.JSON_VALUE_MAX_DEPTH) return false;
	if (Array.isArray(value)) return value.every(item => isJsonValue(item, depth + 1));
	if (isRecord(value)) return Object.values(value).every(item => isJsonValue(item, depth + 1));
	return false;
}

function messageContentBlocks(content: unknown): ConversationContentBlock[] {
	if (typeof content === "string") return [textBlock(content)];
	if (!Array.isArray(content)) return [];
	const blocks: ConversationContentBlock[] = [];
	for (const block of content) {
		if (!isRecord(block)) continue;
		const type = stringField(block, "type");
		if (type === "text") {
			const text = stringField(block, "text");
			if (text !== undefined) blocks.push(textBlock(text));
			continue;
		}
		if (type === "thinking") {
			const text = stringField(block, "thinking");
			if (text !== undefined && text !== "") blocks.push(thinkingBlock(text));
			continue;
		}
		if (type === "toolCall") {
			const toolCallId = stringField(block, "toolCallId");
			const toolName = stringField(block, "toolName");
			if (toolCallId === undefined || toolName === undefined) continue;
			const args = block.input;
			blocks.push(
				isJsonValue(args)
					? { type: "toolCall", toolCallId, toolName, arguments: args }
					: { type: "toolCall", toolCallId, toolName },
			);
		}
	}
	return blocks;
}

function plainText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!isRecord(block)) continue;
		if (stringField(block, "type") !== "text") continue;
		const text = stringField(block, "text");
		if (text !== undefined) parts.push(text);
	}
	return parts.join("\n");
}

function toolResultBlock(message: Record<string, unknown>): ConversationContentBlock | undefined {
	const toolCallId = stringField(message, "toolCallId");
	if (toolCallId === undefined || toolCallId === "") return undefined;
	const toolName = stringField(message, "toolName");
	const output = plainText(message.content);
	const clipped = truncateUtf8(output, CONVERSATION_LIMITS.TEXT_BLOCK_MAX_BYTES);
	const data = message.details;
	return {
		type: "toolResult",
		toolCallId,
		...(toolName === undefined ? {} : { toolName }),
		...(output === "" ? {} : { output: clipped.text }),
		...(isJsonValue(data) ? { data } : {}),
		isError: booleanField(message, "isError") === true,
	};
}

/**
 * Project the gateway's message list onto the protocol's public items.
 *
 * Only the contract's public kinds are emitted: `user`/`assistant` messages,
 * compaction summaries (Zeta's compaction entry arrives as a `custom` message
 * with `customType: "compaction"`), and tool results attached to the assistant
 * item that called them. Other message roles (bash/python execution, custom
 * messages) have no public kind and are omitted rather than invented.
 *
 * `createdAt` comes from the persisted entry timestamp, then the message's own
 * ms timestamp, then the previous item (entries written without either inherit
 * their predecessor's instant); a record with no timestamp at all is skipped.
 */
function projectConversationItems(
	records: readonly TranscriptRecord[],
	fallbackCreatedAt: string | undefined,
): ConversationItem[] {
	const items: ConversationItem[] = [];
	let parentId: string | null = null;
	let previousCreatedAt = fallbackCreatedAt;
	let lastAssistantContent: ConversationContentBlock[] | undefined;
	for (const record of records) {
		if (!isRecord(record.message)) continue;
		const message = record.message;
		const createdAt = record.createdAt ?? isoFromMilliseconds(numberField(message, "timestamp")) ?? previousCreatedAt;
		if (createdAt === undefined) continue;
		previousCreatedAt = createdAt;
		const role = stringField(message, "role");
		if (role === "user" || role === "assistant") {
			const content = messageContentBlocks(message.content);
			items.push({ kind: "message", itemId: record.id, parentId, createdAt, role, content });
			lastAssistantContent = role === "assistant" ? content : undefined;
			parentId = record.id;
			continue;
		}
		if (role === "toolResult") {
			const block = toolResultBlock(message);
			if (block !== undefined && lastAssistantContent !== undefined) lastAssistantContent.push(block);
			continue;
		}
		if (role === "custom" && stringField(message, "customType") === "compaction") {
			const summary = truncateUtf8(plainText(message.content), CONVERSATION_LIMITS.COMPACTION_SUMMARY_MAX_BYTES);
			items.push({ kind: "compaction", itemId: record.id, parentId, createdAt, summary: summary.text });
			parentId = record.id;
			lastAssistantContent = undefined;
		}
	}
	return items;
}

/** id → persisted entry timestamp for every node the gateway's tree kept. */
function entryTimestamps(tree: unknown): Map<string, string> {
	const timestamps = new Map<string, string>();
	const stack: unknown[] = Array.isArray(tree) ? [...tree] : [];
	let visited = 0;
	while (stack.length > 0 && visited < 10_000) {
		visited += 1;
		const node = stack.pop();
		if (!isRecord(node)) continue;
		if (isRecord(node.entry)) {
			const id = stringField(node.entry, "id");
			const timestamp = stringField(node.entry, "timestamp");
			if (id !== undefined && timestamp !== undefined) timestamps.set(id, timestamp);
		}
		if (Array.isArray(node.children)) stack.push(...node.children);
	}
	return timestamps;
}

interface SessionTranscriptView {
	readonly leafId: string | null;
	/** Informational durable revision (`mtime:size:leaf`), stable within one file version. */
	readonly revision: string;
	/** Origin identity of the window coordinate space (cursor validation). */
	readonly origin: string;
	readonly total: number;
	readonly windowStart: number;
	readonly items: readonly ConversationItem[];
}

/**
 * Read the persisted session transcript. `GET /api/sessions/:id` carries the
 * same `context` the `/context` route returns plus the active leaf and the
 * entry timestamps a public page needs; `/context` alone cannot answer
 * `createdAt` or `branchLeafId` without inventing them.
 */
async function loadSessionTranscript(
	sessionId: string,
	window?: { readonly boundary?: number; readonly origin?: string; readonly limit: number },
): Promise<SessionTranscriptView> {
	const query =
		window === undefined
			? ""
			: `?window=${window.boundary ?? "tail"}&limit=${window.limit}` +
				(window.origin === undefined ? "" : `&origin=${encodeURIComponent(window.origin)}`);
	const reply = await callGateway(`/api/sessions/${segment(sessionId)}${query}`);
	if (reply.status === 409)
		throw new StudioOpError("CURSOR_STALE", "cursor refers to a different transcript revision");
	if (reply.status === 404) {
		// A just-created session has no session file until its first append; a
		// live session with no file is an empty transcript, not an error.
		await readLiveState(sessionId);
		return { leafId: null, revision: "empty", origin: "empty", total: 0, windowStart: 0, items: [] };
	}
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`GET /api/sessions/${sessionId} → ${reply.status}${errorSuffix(reply.body)}`);
	}
	const body = reply.body;
	if (!isRecord(body)) throw unavailable(`session ${sessionId} returned no payload`);
	const context = isRecord(body.context) ? body.context : undefined;
	const messages = context !== undefined && Array.isArray(context.messages) ? context.messages : undefined;
	const entryIds = context !== undefined && Array.isArray(context.entryIds) ? context.entryIds : undefined;
	if (messages === undefined || entryIds === undefined) {
		throw unavailable(`session ${sessionId} returned no transcript context`);
	}
	const info = isRecord(body.info) ? body.info : undefined;
	const created = info === undefined ? undefined : stringField(info, "created");
	const modified = info === undefined ? undefined : stringField(info, "modified");
	const leafId = stringField(body, "leafId") ?? null;
	// A windowed answer carries its own per-page timestamps; the legacy answer
	// only has the tree, so keep that path for callers without a window.
	const page = isRecord(body.page) ? body.page : undefined;
	const timestamps =
		page === undefined
			? entryTimestamps(body.tree)
			: new Map(
					Object.entries(isRecord(page.timestamps) ? page.timestamps : {}).flatMap(([id, value]) =>
						typeof value === "string" ? ([[id, value]] as const) : [],
					),
				);
	const records: TranscriptRecord[] = [];
	let earliest: string | undefined;
	for (let index = 0; index < messages.length; index += 1) {
		const id = entryIds[index];
		if (typeof id !== "string" || id === "") continue;
		earliest ??= isoFromMilliseconds(
			isRecord(messages[index]) ? numberField(messages[index], "timestamp") : undefined,
		);
		records.push({ id, createdAt: timestamps.get(id), message: messages[index] });
	}
	const fallbackCreatedAt = created ?? modified ?? earliest;
	if (fallbackCreatedAt === undefined && records.length > 0) {
		throw unavailable(`session ${sessionId} has no readable timestamps`);
	}
	const total = page === undefined ? records.length : (numberField(page, "total") ?? records.length);
	const windowStart = page === undefined ? 0 : (numberField(page, "windowStart") ?? 0);
	const origin = page === undefined ? "legacy" : (stringField(page, "origin") ?? "legacy");
	return {
		leafId,
		revision:
			page === undefined
				? `${modified ?? "unknown"}#${leafId ?? "empty"}`
				: (stringField(page, "transcriptRevision") ?? `${modified ?? "unknown"}#${leafId ?? "empty"}`),
		origin,
		total,
		windowStart,
		items: projectConversationItems(records, fallbackCreatedAt),
	};
}

interface AgentTranscriptView {
	/** `session` header id of the child transcript when the page carried it. */
	readonly childSessionId?: string;
	readonly revision: string;
	readonly items: readonly ConversationItem[];
	readonly records: readonly TranscriptRecord[];
}

async function loadAgentTranscript(parentSessionId: string, agentId: string): Promise<AgentTranscriptView> {
	const body = await gatewayJson<unknown>(
		`/api/agent/${segment(parentSessionId)}/subagents/${segment(agentId)}/transcript`,
	);
	if (!isRecord(body)) throw unavailable(`agent ${agentId} returned no transcript payload`);
	const entries = Array.isArray(body.entries) ? body.entries : undefined;
	if (entries === undefined) throw unavailable(`agent ${agentId} returned no transcript entries`);
	const records: TranscriptRecord[] = [];
	let childSessionId: string | undefined;
	for (const entry of entries) {
		if (!isRecord(entry)) continue;
		const type = stringField(entry, "type");
		if (type === "session") {
			childSessionId ??= nonEmptyString(stringField(entry, "id"));
			continue;
		}
		if (type !== "message") continue;
		const id = stringField(entry, "id");
		if (id === undefined || id === "") continue;
		records.push({ id, createdAt: stringField(entry, "timestamp"), message: entry.message });
	}
	const nextByte = numberField(body, "nextByte");
	return {
		...(childSessionId === undefined ? {} : { childSessionId }),
		revision: nextByte === undefined ? `entries:${records.length}` : `bytes:${nextByte}`,
		items: projectConversationItems(records, records[0]?.createdAt),
		records,
	};
}

/**
 * Page of the session's active branch, for `conversation.open` and
 * `session.transcript.read` alike.
 */
/** One page of a windowed session read, in the public page shape. */
function pageFromSessionWindow(
	view: SessionTranscriptView,
	binding: Extract<CursorBinding, { kind: "session" }>,
): ConversationPageParts {
	return {
		items: view.items,
		headCursor: encodeCursor(binding, view.total, view.origin),
		...(view.windowStart > 0 ? { olderCursor: encodeCursor(binding, view.windowStart, view.origin) } : {}),
		hasMoreBefore: view.windowStart > 0,
	};
}

export async function readTranscriptPage(
	sessionId: SessionId,
	cursor?: string,
	limit?: number,
): Promise<ConversationTranscriptPage> {
	const binding = { kind: "session", sessionId: String(sessionId) } as const;
	const decoded = cursor === undefined ? undefined : decodeCursor(cursor, binding);
	const view = await loadSessionTranscript(String(sessionId), {
		...(decoded?.boundary === undefined ? {} : { boundary: decoded.boundary }),
		...(decoded?.origin === undefined ? {} : { origin: decoded.origin }),
		limit: pageLimit(limit),
	});
	return {
		runtimeEpoch: RUNTIME_EPOCH,
		sessionId,
		branchLeafId: view.leafId,
		...pageFromSessionWindow(view, binding),
	};
}

/** Page of a child agent's conversation, shared with `conversation.open`. */
export async function readAgentConversationPage(
	parentSessionId: SessionId,
	agentId: AgentId,
	cursor?: string,
	limit?: number,
): Promise<ConversationTranscriptPage> {
	const view = await loadAgentTranscript(String(parentSessionId), String(agentId));
	const page = pageBackwards(view.items, cursor, limit, {
		kind: "agent",
		parentSessionId: String(parentSessionId),
		agentId: String(agentId),
	});
	return {
		runtimeEpoch: RUNTIME_EPOCH,
		sessionId: (view.childSessionId ?? String(parentSessionId)) as SessionId,
		// The subagent transcript route exposes no branch leaf for the child file.
		branchLeafId: null,
		...page,
	};
}

function agentTranscriptRole(role: string | undefined): AgentTranscriptMessage["role"] | undefined {
	if (role === "user" || role === "assistant" || role === "system" || role === "custom") return role;
	if (role === "toolResult" || role === "bashExecution") return "custom";
	return undefined;
}

function agentTranscriptMessages(records: readonly TranscriptRecord[]): AgentTranscriptMessage[] {
	const messages: AgentTranscriptMessage[] = [];
	let previousTs: number | undefined;
	for (const record of records) {
		if (!isRecord(record.message)) continue;
		const role = agentTranscriptRole(stringField(record.message, "role"));
		if (role === undefined) continue;
		const ts = millisecondsFromIso(record.createdAt) ?? numberField(record.message, "timestamp") ?? previousTs ?? 0;
		previousTs = ts;
		const text = plainText(record.message.content) || (stringField(record.message, "output") ?? "");
		messages.push({ id: record.id, role, ts, text });
	}
	return messages;
}

/** Forward page of one agent's flat transcript (oldest entry first). */
async function readAgentTranscriptPage(
	parentSessionId: string,
	agentId: string,
	cursor: string | undefined,
	limit: number | undefined,
): Promise<AgentTranscriptPage> {
	const view = await loadAgentTranscript(parentSessionId, agentId);
	const binding: CursorBinding = { kind: "agent", parentSessionId, agentId };
	const messages = agentTranscriptMessages(view.records);
	const size = pageLimit(limit);
	const offset = cursor === undefined ? 0 : decodeCursor(cursor, binding).boundary;
	if (offset > messages.length) throw new StudioOpError("CURSOR_STALE", "cursor is past the transcript end");
	const page = messages.slice(offset, offset + size);
	const end = offset + page.length;
	return {
		agentId: agentId as AgentId,
		// Zeta's roster carries no per-agent generation counter.
		generation: 0 as AgentTranscriptPage["generation"],
		cursor: encodeCursor(binding, offset),
		...(end < messages.length ? { nextCursor: encodeCursor(binding, end) } : {}),
		messages: page,
		eof: end >= messages.length,
	};
}

// ---------------------------------------------------------------------------
// Agent command dispatch
// ---------------------------------------------------------------------------

async function runAgentCommand(
	sessionId: string,
	command: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
	const body = await gatewayJson<unknown>(`/api/agent/${segment(sessionId)}`, { method: "POST", body: command });
	if (!isRecord(body)) throw unavailable("the agent command returned no payload");
	if (body.success !== true) throw unavailable("the agent command was not accepted");
	return isRecord(body.data) ? body.data : undefined;
}

async function commandSnapshot(sessionId: string, command: Record<string, unknown>): Promise<OperatorStateSnapshot> {
	await runAgentCommand(sessionId, command);
	return await snapshotFor(sessionId);
}

/**
 * Dispatch a turn-opening command. The gateway's `prompt` settles only when the
 * turn finishes, so waiting for it would hold the Studio command receipt for
 * minutes; wait a short lease instead. Immediate refusals (unknown session,
 * invalid model) still surface as a failed receipt, and the live session state
 * carries the running turn.
 */
async function dispatchTurn(sessionId: string, command: Record<string, unknown>): Promise<OperatorStateSnapshot> {
	let settled = false;
	const dispatched = runAgentCommand(sessionId, command).finally(() => {
		settled = true;
	});
	const { promise: lease, resolve } = Promise.withResolvers<"timeout">();
	const timer = setTimeout(() => resolve("timeout"), TURN_DISPATCH_LEASE_MS);
	try {
		await Promise.race([dispatched, lease]);
	} finally {
		clearTimeout(timer);
	}
	// A turn that outlived the lease keeps running; its failure is reported by
	// the live session state, not by a receipt the renderer no longer waits on.
	if (!settled) void dispatched.catch(() => undefined);
	return await snapshotFor(sessionId);
}

/** Narrow the gateway's `{started, mode}` continue result to the contract outcome. */
function continueTurnOutcome(data: Record<string, unknown> | undefined): ContinueTurnOutcome {
	const started = data === undefined ? undefined : booleanField(data, "started");
	const mode = data === undefined ? undefined : stringField(data, "mode");
	if (started === undefined || (mode !== "restored" && mode !== "continue" && mode !== "none")) {
		throw unavailable("the gateway returned no continue outcome");
	}
	return { started, mode };
}

/**
 * Dispatch the gateway's `{type:"continue"}`. `AgentSession.resume()` answers
 * immediately for "nothing to resume" and for the recovery branch, and only the
 * hidden synthetic continue stays pending for a whole turn; a command that
 * outlives the dispatch lease therefore *is* that continue, already running.
 */
async function dispatchContinue(sessionId: string): Promise<ContinueTurnOutcome> {
	const dispatched = runAgentCommand(sessionId, { type: "continue" });
	const { promise: lease, resolve } = Promise.withResolvers<"timeout">();
	const timer = setTimeout(() => resolve("timeout"), TURN_DISPATCH_LEASE_MS);
	try {
		const raced = await Promise.race([dispatched, lease]);
		if (raced === "timeout") {
			void dispatched.catch(() => undefined);
			return { started: true, mode: "continue" };
		}
		return continueTurnOutcome(raced);
	} finally {
		clearTimeout(timer);
	}
}

function imagePayloads(images: unknown): unknown[] | undefined {
	if (images === undefined) return undefined;
	if (!Array.isArray(images)) throw invalid("images must be an array");
	return images.map(image => {
		if (!isRecord(image) || image.type !== "image") throw invalid("images must be image attachments");
		const data = stringField(image, "data");
		const mimeType = stringField(image, "mimeType");
		if (data === undefined || mimeType === undefined) {
			throw invalid("image attachments need base64 data and a mimeType");
		}
		return { type: "image", source: { type: "base64", media_type: mimeType, data } };
	});
}

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

function parseModelSelector(selector: string): { provider: string; modelId: string } {
	const slash = selector.indexOf("/");
	if (slash <= 0 || slash === selector.length - 1) {
		throw invalid("selector must be a provider/model string");
	}
	return { provider: selector.slice(0, slash), modelId: selector.slice(slash + 1) };
}

function thinkingSelector(value: string): SessionThinkingSelector {
	if (!(SESSION_THINKING_LEVELS as readonly string[]).includes(value) && value !== "auto") {
		throw invalid(`unknown thinking selector: ${value}`);
	}
	return value as SessionThinkingSelector;
}

/**
 * `navigate_tree` takes only the entry id; rejecting the refine options keeps a
 * request that Zeta cannot honour from looking honoured.
 */
function rejectTreeRefineOptions(input: {
	readonly summarize?: boolean;
	readonly customInstructions?: string;
	readonly reanswer?: unknown;
}): void {
	if (input.summarize === true) throw invalid("session.tree.navigate does not support summarize here");
	if (input.customInstructions !== undefined && input.customInstructions !== "") {
		throw invalid("session.tree.navigate does not support customInstructions here");
	}
	if (input.reanswer !== undefined) throw invalid("session.tree.navigate does not support reanswer here");
}

/**
 * Workspace for a new session: the workspace this host last created a session
 * in, then the active session's persisted cwd, then the gateway's default
 * workspace.
 */
async function createCwd(): Promise<string> {
	if (sessionCwd !== undefined) return sessionCwd;
	if (activeSessionId !== undefined) {
		const reply = await callGateway(`/api/sessions/${segment(activeSessionId)}`);
		const info =
			reply.status === 200 && isRecord(reply.body) && isRecord(reply.body.info) ? reply.body.info : undefined;
		const cwd = info === undefined ? undefined : stringField(info, "cwd");
		if (cwd !== undefined && cwd !== "") return cwd;
	}
	const body = await gatewayJson<unknown>("/api/projects");
	if (!isRecord(body) || !Array.isArray(body.projects)) {
		throw unavailable("the gateway returned no project registry");
	}
	const defaultWorkspaceKey = stringField(body, "defaultWorkspaceKey");
	for (const project of body.projects) {
		if (!isRecord(project) || !Array.isArray(project.workspaces)) continue;
		for (const workspace of project.workspaces) {
			if (!isRecord(workspace)) continue;
			if (defaultWorkspaceKey !== undefined && stringField(workspace, "key") !== defaultWorkspaceKey) continue;
			const path = stringField(workspace, "path");
			if (path !== undefined && path !== "") return path;
		}
	}
	throw unavailable("the gateway reports no default workspace to start a session in");
}

/** Entry id of the last user message on the active branch (Zeta's only fork target). */
async function lastUserEntryId(sessionId: string): Promise<string> {
	const reply = await callGateway(`/api/sessions/${segment(sessionId)}/context`);
	if (reply.status === 404) throw invalid("the current session has no user message to fork from");
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`GET /api/sessions/${sessionId}/context → ${reply.status}${errorSuffix(reply.body)}`);
	}
	const body = reply.body;
	const context = isRecord(body) && isRecord(body.context) ? body.context : undefined;
	const messages = context !== undefined && Array.isArray(context.messages) ? context.messages : undefined;
	const entryIds = context !== undefined && Array.isArray(context.entryIds) ? context.entryIds : undefined;
	if (messages === undefined || entryIds === undefined) {
		throw unavailable(`session ${sessionId} returned no transcript context`);
	}
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!isRecord(message) || stringField(message, "role") !== "user") continue;
		const id = entryIds[index];
		if (typeof id === "string" && id !== "") return id;
	}
	throw invalid("the current session has no user message to fork from");
}

// ---------------------------------------------------------------------------
// Family
// ---------------------------------------------------------------------------

/**
 * `session.*` queries: the operator snapshot, the two transcript readers and
 * the persisted child-agent roster.
 */
export const sessionOps: StudioFamily = {
	id: "session",
	queries: {
		/** `GET /api/sessions/:id/state` → `OperatorStateSnapshot`. */
		"session.state": async () => snapshotFor(await currentSessionId()),

		/** `GET /api/sessions/:id` (context + leaf) → active-branch page. */
		"session.transcript.read": async input => {
			const sessionId = await currentSessionId();
			return await readTranscriptPage(sessionId as SessionId, input.cursor, input.limit);
		},

		/** Persisted page for an explicit session, optionally for one of its child agents. */
		"session.transcript.readPage": async input => {
			const sessionId = requiredString(input, "sessionId");
			const agentId = optionalString(input, "agentId");
			if (agentId !== undefined) {
				const view = await loadAgentTranscript(sessionId, agentId);
				const page = pageBackwards(view.items, input.cursor, input.limit, {
					kind: "agent",
					parentSessionId: sessionId,
					agentId,
				});
				return {
					sessionId: sessionId as SessionId,
					transcriptRevision: view.revision,
					// The subagent transcript route exposes no leaf for the child file.
					branchLeafId: null,
					...page,
				} satisfies ConversationTranscriptReadPage;
			}
			const binding = { kind: "session", sessionId } as const;
			const decoded = input.cursor === undefined ? undefined : decodeCursor(input.cursor, binding);
			const view = await loadSessionTranscript(sessionId, {
				...(decoded?.boundary === undefined ? {} : { boundary: decoded.boundary }),
				...(decoded?.origin === undefined ? {} : { origin: decoded.origin }),
				limit: pageLimit(input.limit),
			});
			return {
				sessionId: sessionId as SessionId,
				transcriptRevision: view.revision,
				branchLeafId: view.leafId,
				...pageFromSessionWindow(view, binding),
			} satisfies ConversationTranscriptReadPage;
		},

		/** One agent's flat persisted transcript under the active session. */
		"agent.transcript.read": async input => {
			const parentSessionId = await currentSessionId();
			return await readAgentTranscriptPage(
				parentSessionId,
				requiredString(input, "agentId"),
				optionalString(input, "cursor"),
				input.limit,
			);
		},

		/** One agent's public conversation page under the active session. */
		"agent.conversation.read": async input => {
			const parentSessionId = await currentSessionId();
			return await readAgentConversationPage(
				parentSessionId as SessionId,
				requiredString(input, "agentId") as AgentId,
				optionalString(input, "cursor"),
				input.limit,
			);
		},

		/** `GET /api/agent/:id/subagents` → public roster rows. */
		"session.agents.list": async input => {
			const sessionId = requiredString(input, "sessionId");
			return { sessionId: sessionId as SessionId, agents: await readSessionAgents(sessionId) };
		},
	},
	commands: {
		/** `POST /api/agent/new` (`ensure_session`) in the active/default workspace. */
		"session.create": async input => {
			if (input.noContextFiles === true) {
				throw invalid("session.create does not support noContextFiles on the Zeta host");
			}
			const cwd = await createCwd();
			const body = await gatewayJson<unknown>("/api/agent/new", {
				method: "POST",
				body: { cwd, type: "ensure_session" },
			});
			if (!isRecord(body)) throw unavailable("agent/new returned no payload");
			const sessionId = stringField(body, "sessionId");
			if (sessionId === undefined || sessionId === "") {
				throw unavailable("agent/new did not report a new session id");
			}
			sessionCwd = cwd;
			activeSessionId = sessionId;
			return await snapshotFor(sessionId);
		},

		/**
		 * `session.resume` → attach the named thread and make it the session
		 * `session.*` acts on.
		 *
		 * `POST /api/agent/:id {type:"get_state"}` is the gateway's attach path: it
		 * reuses a resident session and starts a dormant one from its transcript
		 * file, so a 404 here means the thread does not exist. `model` switches the
		 * resumed session through the same `set_model` route `session.model.set`
		 * uses. The receipt carries the runtime's own id for that thread, which is
		 * what the renderer compares against the view it opened.
		 */
		"session.resume": async input => {
			const threadId = requiredString(input, "threadId");
			await runAgentCommand(threadId, { type: "get_state" });
			const model = optionalString(input, "model");
			if (model !== undefined && model !== "") {
				const { provider, modelId } = parseModelSelector(model);
				await runAgentCommand(threadId, { type: "set_model", provider, modelId });
			}
			const snapshot = await snapshotFor(threadId);
			activeSessionId = snapshot.sessionId;
			return snapshot;
		},

		/** `DELETE /api/sessions/:id`. Zeta always moves managed artifacts with the transcript. */
		"session.delete": async input => {
			if (input.deleteManagedArtifacts === false) {
				throw invalid("session.delete cannot keep managed artifacts on the Zeta host");
			}
			const threadId = requiredString(input, "threadId");
			const path = `/api/sessions/${segment(threadId)}`;
			const applied = confirmMutation(
				await callGateway(path, { method: "DELETE" }),
				"DELETE",
				path,
				`unknown session: ${threadId}`,
			);
			if (activeSessionId === threadId) activeSessionId = undefined;
			return { applied, runtimeEffect: "immediate" satisfies ConfigWriteResult["runtimeEffect"] };
		},

		/** `POST /api/sessions/:id/archive`. */
		"session.archive": async input => {
			const threadId = requiredString(input, "threadId");
			const path = `/api/sessions/${segment(threadId)}/archive`;
			const applied = confirmMutation(
				await callGateway(path, { method: "POST" }),
				"POST",
				path,
				`unknown session: ${threadId}`,
			);
			if (activeSessionId === threadId) activeSessionId = undefined;
			return { applied, runtimeEffect: "immediate" };
		},

		/** `POST /api/sessions/:id/unarchive`. */
		"session.unarchive": async input => {
			const threadId = requiredString(input, "threadId");
			const path = `/api/sessions/${segment(threadId)}/unarchive`;
			const applied = confirmMutation(
				await callGateway(path, { method: "POST" }),
				"POST",
				path,
				`session is not archived: ${threadId}`,
			);
			return { applied, runtimeEffect: "immediate" };
		},

		/**
		 * `POST /api/agent/:id` `{type:"fork"}`. The Studio input carries no
		 * branch point; Zeta's fork branches at a user message, so the last user
		 * message on the active branch is the target. The receipt is the new
		 * session's snapshot (the runtime switched identity).
		 */
		"session.fork": async () => {
			const sessionId = await currentSessionId();
			const entryId = await lastUserEntryId(sessionId);
			const data = await runAgentCommand(sessionId, { type: "fork", entryId });
			if (data === undefined) throw unavailable("fork returned no result");
			if (data.cancelled === true) throw unavailable("the session declined the fork");
			const newSessionId = stringField(data, "newSessionId");
			if (newSessionId === undefined || newSessionId === "") {
				throw unavailable("fork completed without a new session id");
			}
			activeSessionId = newSessionId;
			return await snapshotFor(newSessionId);
		},

		/**
		 * `session.tree.get` is a state refresh in this contract (its result is
		 * `OperatorStateSnapshot`): the tree itself arrives as transcript items.
		 */
		"session.tree.get": async () => snapshotFor(await currentSessionId()),

		/** `POST /api/agent/:id` `{type:"navigate_tree"}`. */
		"session.tree.navigate": async input => {
			const targetId = requiredString(input, "targetId");
			rejectTreeRefineOptions(input);
			const sessionId = await currentSessionId();
			const data = await runAgentCommand(sessionId, { type: "navigate_tree", entryId: targetId });
			const snapshot = await snapshotFor(sessionId);
			return {
				snapshot,
				...(data !== undefined && data.cancelled === true ? { cancelled: true } : {}),
			} satisfies SessionTreeCommandOutcome;
		},

		/** `POST /api/agent/:id` `{type:"fork"}` at `targetId` (branch from that entry). */
		"session.tree.branch": async input => {
			const targetId = requiredString(input, "targetId");
			const sessionId = await currentSessionId();
			const data = await runAgentCommand(sessionId, { type: "fork", entryId: targetId });
			const cancelled = data !== undefined && data.cancelled === true;
			let nextSessionId = sessionId;
			if (!cancelled) {
				const newSessionId = data === undefined ? undefined : stringField(data, "newSessionId");
				if (newSessionId === undefined || newSessionId === "") {
					throw unavailable("branch completed without a new session id");
				}
				nextSessionId = newSessionId;
				activeSessionId = newSessionId;
			}
			return {
				snapshot: await snapshotFor(nextSessionId),
				...(cancelled ? { cancelled: true } : {}),
				sessionId: nextSessionId as SessionId,
			} satisfies SessionTreeCommandOutcome;
		},

		/** `set_model`, then `set_thinking_level` when the caller pinned a level. */
		"session.model.set": async input => {
			const selector = requiredString(input, "selector");
			const { provider, modelId } = parseModelSelector(selector);
			const sessionId = await currentSessionId();
			await runAgentCommand(sessionId, { type: "set_model", provider, modelId });
			if (input.thinking !== undefined) {
				await runAgentCommand(sessionId, {
					type: "set_thinking_level",
					level: thinkingSelector(input.thinking),
				});
			}
			return await snapshotFor(sessionId);
		},

		/** `set_thinking_level`. */
		"session.thinking.set": async input => {
			const level = thinkingSelector(requiredString(input, "level"));
			return await commandSnapshot(await currentSessionId(), { type: "set_thinking_level", level });
		},

		/** `POST /api/agent/:id` `{type:"prompt"}`. */
		"core.prompt": async input => {
			const text = requiredString(input, "text");
			const images = imagePayloads(input.images);
			return await dispatchTurn(await currentSessionId(), {
				type: "prompt",
				message: text,
				...(images === undefined ? {} : { images }),
			});
		},

		/** `POST /api/agent/:id` `{type:"steer"}`. */
		"core.steer": async input => {
			const text = requiredString(input, "text");
			const images = imagePayloads(input.images);
			return await commandSnapshot(await currentSessionId(), {
				type: "steer",
				text,
				...(images === undefined ? {} : { images }),
			});
		},

		/** `POST /api/agent/:id` `{type:"follow_up"}`. */
		"core.followUp": async input => {
			const text = requiredString(input, "text");
			const images = imagePayloads(input.images);
			return await commandSnapshot(await currentSessionId(), {
				type: "follow_up",
				text,
				...(images === undefined ? {} : { images }),
			});
		},

		/** `POST /api/agent/:id` `{type:"abort"}`. */
		"core.abort": async () => commandSnapshot(await currentSessionId(), { type: "abort" }),

		/** `POST /api/agent/:id` `{type:"continue"}` — the `.`/`c` resume path. */
		"core.continue": async () => dispatchContinue(await currentSessionId()),

		/** `queue.enqueue` is Zeta's `follow_up` queue. */
		"queue.enqueue": async input => {
			const text = requiredString(input, "text");
			return await commandSnapshot(await currentSessionId(), { type: "follow_up", text });
		},

		/**
		 * `POST /api/extension-ui/response`. The gateway addresses the pending
		 * dialog by request id and derives the owning session itself; the Studio
		 * lease generation has no Zeta counterpart, and heterogeneous values are
		 * limited to what the transport accepts (string / boolean / cancel).
		 */
		"interaction.respond": async input => {
			const interactionId = requiredString(input, "interactionId");
			if (input.decision === "cancel") {
				await gatewayJson<unknown>("/api/extension-ui/response", {
					method: "POST",
					body: { id: interactionId, cancelled: true },
				});
				return await snapshotFor(await currentSessionId());
			}
			if (input.decision !== "submit") throw invalid(`unknown interaction decision: ${String(input.decision)}`);
			const value = input.value;
			if (typeof value !== "boolean" && typeof value !== "string" && value !== undefined) {
				throw invalid("the Zeta host accepts a string or boolean interaction value");
			}
			const body: Record<string, unknown> =
				typeof value === "boolean"
					? { id: interactionId, confirmed: value }
					: { id: interactionId, value: typeof value === "string" ? value : "" };
			await gatewayJson<unknown>("/api/extension-ui/response", { method: "POST", body });
			return await snapshotFor(await currentSessionId());
		},
	},
};

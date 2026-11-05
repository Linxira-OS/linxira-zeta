/**
 * Studio operations — home, usage, statistics, conversation open, history list.
 *
 * Operation → gateway route:
 * - `history.list`      → `GET /api/sessions` and/or `GET /api/sessions/archived`
 *                         (the archived variant only when that status is asked for)
 * - `home.get`          → `buildBootstrap` authority/runtime, the session
 *                         family's `session.state` snapshot, `history.list`
 *                         (active, newest 10) and the workspace family's
 *                         `projects.list` (newest 5)
 * - `usage.get`         → `GET /api/usage` session rows aggregated into daily
 *                         token totals; per-model/hour series are stated as
 *                         unrecorded
 * - `stats.dashboard`   → `GET /api/server/identity` for the published
 *                         `statsUrl`, then a loopback `/api/status` probe of
 *                         the dashboard itself
 * - `conversation.open` → session targets read `GET /api/sessions/:id/context`
 *                         through `readTranscriptPage`; agent targets read
 *                         `GET /api/agent/:parentSessionId/subagents/:agentId/transcript`
 *                         through `readAgentConversationPage`. Both builders are
 *                         exported by the session family, so the page shape and
 *                         cursor namespace match its transcript queries exactly.
 *
 * Deliberately unimplemented: `usage.openDashboard` — no gateway route opens an
 * external URL (`/api/open` only opens project-confined directories), so the
 * command would be a fake action.
 *
 * A handler takes the contract input and returns the contract result; it
 * reaches Zeta state only through `../gateway.js` (`callGateway`,
 * `gatewayJson`, `gatewayOk`, `invalid`, `unavailable`). A name this file does
 * not export is simply not advertised in the capability manifest, so leaving
 * an operation out hides its surface in the Renderer — never answer with made
 * up data.
 */
import { createHash } from "node:crypto";
import { isRecord, stringProperty } from "@linxiraos/pi-utils";
import { STATS_DASHBOARD_HEADER, STATS_DASHBOARD_SECURITY_VERSION } from "@linxiraos/pi-stats/port-conflict";
import { buildBootstrap } from "../bootstrap.js";
import { StudioOperations } from "../registry.js";
import type { StudioFamily, StudioHostContext } from "../registry.js";
import { gatewayJson, invalid, requiredString, unavailable } from "../gateway.js";
import type {
	EnvironmentId,
	HistoryEntryId,
	HomeReadModel,
	SessionHistoryEntry,
	SessionHistoryReadModel,
	SessionHistoryStatus,
	SessionId,
	StatsDashboardReadModel,
	ThreadId,
	TokenUsageReadModel,
	WorkspaceId,
	WorkspaceListReadModel,
	WorkspaceRecord,
} from "../contract/index.js";
import type {
	AgentId,
	ConversationOpenResult,
	ConversationTarget,
	OperatorStateSnapshot,
} from "../protocol/index.js";
import { resumePathKey } from "../../../resume/paths.js";
import { readAgentConversationPage, readTranscriptPage, sessionOps } from "./session.js";
import { workspaceOps } from "./workspace.js";

/** Session listing cap the Renderer mirrors (`PROJECT_HISTORY_QUERY_MAX`). */
const HISTORY_MAX_LIMIT = 200;
/** Rows returned when a caller omits `limit`. */
const HISTORY_DEFAULT_LIMIT = 20;
/** Snippet bound for a history row's safe summary. */
const HISTORY_SUMMARY_MAX_CHARS = 280;

/** Recent threads the home page shows. */
const RECENT_THREADS_LIMIT = 10;
/** Recent workspaces the home page shows. */
const RECENT_WORKSPACES_LIMIT = 5;
/** Daily token points the home heatmap keeps. */
const USAGE_MAX_DAYS = 30;
/** Stated once, on the one usage field Zeta cannot fill. */
const USAGE_PARTIAL_REASON =
	"Zeta stores per-session totals only; per-model and per-hour token series are not recorded";

/** Probe budget for the loopback statistics dashboard. */
const STATS_PROBE_TIMEOUT_MS = 3_000;
/** Dashboard's own default deep link (see `parseHash` in `pi-stats`). */
const STATS_DEEP_LINK = "/#/overview?range=24h";

/** A live replay the host can honestly claim: it buffers no runtime events. */
const NO_LIVE_REPLAY: ConversationOpenResult["live"] = { status: "complete", watermark: 0, events: [] };

// ---------------------------------------------------------------------------
// Local narrowing helpers — gateway answers are untrusted JSON.
// ---------------------------------------------------------------------------

/** Own string-valued field, with the gateway's empty-string placeholders removed. */
function stringField(record: Record<string, unknown>, field: string): string | undefined {
	const value = stringProperty(record, field);
	return value === undefined || value === "" ? undefined : value;
}

/** A field that must parse as a date, normalized to ISO. */
function isoField(record: Record<string, unknown>, field: string): string | undefined {
	const value = stringProperty(record, field);
	if (value === undefined) return undefined;
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) return undefined;
	return new Date(parsed).toISOString();
}

// ---------------------------------------------------------------------------
// Shared identities — derived, never paths.
// ---------------------------------------------------------------------------

/**
 * Opaque workspace identity, matching `projects.list` (`ops/workspace.ts`):
 * SHA-256 over the canonical workspace key, so a `history.list` filter and the
 * workspace inventory name the same workspace without either carrying a path.
 */
function workspaceIdFor(cwd: string): WorkspaceId {
	const digest = createHash("sha256")
		.update(`zeta-workspace\u0000${resumePathKey(cwd)}`)
		.digest("hex");
	return `ws-${digest.slice(0, 16)}` as WorkspaceId;
}

/** Opaque identity of this Zeta environment (the host that owns the sessions). */
function environmentIdFor(version: string): EnvironmentId {
	const digest = createHash("sha256").update(`zeta-environment\u0000${version}`).digest("hex");
	return `env-${digest.slice(0, 16)}` as EnvironmentId;
}

// ---------------------------------------------------------------------------
// `history.list`
// ---------------------------------------------------------------------------

/** The fields of a gateway `SessionInfo` row a history entry can be built from. */
interface SessionRow {
	readonly id: string;
	readonly cwd: string;
	readonly name?: string;
	readonly created: string;
	readonly modified: string;
	readonly messageCount: number;
	readonly firstMessage?: string;
}

/** Validate one `SessionInfo` row; a row without identity or timestamps is dropped. */
function sessionRow(value: unknown): SessionRow | undefined {
	if (!isRecord(value)) return undefined;
	const id = stringField(value, "id");
	const cwd = stringField(value, "cwd");
	const created = isoField(value, "created");
	const modified = isoField(value, "modified");
	const count = value.messageCount;
	if (id === undefined || cwd === undefined || created === undefined || modified === undefined) return undefined;
	if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return undefined;
	const name = stringField(value, "name");
	const firstMessage = stringField(value, "firstMessage");
	return {
		id,
		cwd,
		created,
		modified,
		messageCount: Math.trunc(count),
		...(name === undefined ? {} : { name }),
		...(firstMessage === undefined ? {} : { firstMessage }),
	};
}

/** Validate a `{ sessions: SessionInfo[] }` listing answer. */
function sessionRows(body: unknown, route: string): readonly SessionRow[] {
	if (!isRecord(body) || !Array.isArray(body.sessions)) {
		throw unavailable(`${route} did not return a sessions array`);
	}
	const rows: SessionRow[] = [];
	for (const value of body.sessions) {
		const row = sessionRow(value);
		if (row !== undefined) rows.push(row);
	}
	return rows;
}

/** One history row, path-free by construction. */
function historyEntry(
	row: SessionRow,
	status: SessionHistoryStatus,
	environmentId: EnvironmentId,
): SessionHistoryEntry {
	const firstMessage = row.firstMessage;
	const summary =
		firstMessage === undefined || firstMessage === "(no messages)" || firstMessage === "(archived session)"
			? undefined
			: firstMessage.slice(0, HISTORY_SUMMARY_MAX_CHARS);
	return {
		historyId: row.id as HistoryEntryId,
		threadId: row.id as ThreadId,
		environmentId,
		sessionId: row.id as SessionId,
		...(row.name === undefined ? {} : { title: row.name }),
		...(summary === undefined ? {} : { summary }),
		startedAt: row.created,
		lastActiveAt: row.modified,
		messageCount: row.messageCount,
		status,
	};
}

function historyStatus(value: unknown): SessionHistoryStatus | undefined {
	if (value === undefined) return undefined;
	if (value === "active" || value === "archived") return value;
	if (value === "closed") throw invalid('Zeta sessions have no "closed" state; use "active" or "archived"');
	throw invalid("status must be active, archived or closed");
}

function historyLimit(value: unknown): number {
	if (value === undefined) return HISTORY_DEFAULT_LIMIT;
	if (typeof value !== "number" || !Number.isFinite(value)) throw invalid("limit must be a number");
	return Math.min(HISTORY_MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

interface IdentityFacts {
	readonly version: string;
	readonly statsUrl?: string;
}

/** Read the process identity the gateway publishes (`/api/server/identity`). */
async function readIdentity(): Promise<IdentityFacts> {
	const body = await gatewayJson<unknown>("/api/server/identity");
	if (!isRecord(body)) throw unavailable("/api/server/identity returned a non-object");
	const version = stringField(body, "version");
	if (version === undefined) throw unavailable("/api/server/identity is missing version");
	const statsUrl = stringField(body, "statsUrl");
	return { version, ...(statsUrl === undefined ? {} : { statsUrl }) };
}

async function listHistory(input: {
	readonly limit?: number;
	readonly status?: SessionHistoryStatus;
	readonly workspaceId?: WorkspaceId;
}): Promise<SessionHistoryReadModel> {
	if (!isRecord(input)) throw invalid("input must be an object");
	const status = historyStatus(input.status);
	const limit = historyLimit(input.limit);
	const workspaceId = input.workspaceId;
	if (workspaceId !== undefined && typeof workspaceId !== "string") throw invalid("workspaceId must be a string");

	const [activeBody, archivedBody, identity] = await Promise.all([
		status === "archived" ? Promise.resolve(undefined) : gatewayJson<unknown>("/api/sessions"),
		status === "active" ? Promise.resolve(undefined) : gatewayJson<unknown>("/api/sessions/archived"),
		readIdentity(),
	]);
	const environmentId = environmentIdFor(identity.version);

	const seen = new Set<string>();
	const entries: SessionHistoryEntry[] = [];
	const append = (rows: readonly SessionRow[], rowStatus: SessionHistoryStatus) => {
		for (const row of rows) {
			if (seen.has(row.id)) continue;
			if (workspaceId !== undefined && workspaceIdFor(row.cwd) !== workspaceId) continue;
			seen.add(row.id);
			entries.push(historyEntry(row, rowStatus, environmentId));
		}
	};
	if (activeBody !== undefined) append(sessionRows(activeBody, "/api/sessions"), "active");
	if (archivedBody !== undefined) append(sessionRows(archivedBody, "/api/sessions/archived"), "archived");

	entries.sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : a.lastActiveAt > b.lastActiveAt ? -1 : 0));
	return { entries: entries.slice(0, limit), total: entries.length };
}

// ---------------------------------------------------------------------------
// `home.get`
// ---------------------------------------------------------------------------

/**
 * Authority and runtime blocks exactly as `/api/v1/bootstrap` serves them.
 * `buildBootstrap` also builds a capability manifest, which the home model does
 * not use; the operations set is constructed here rather than at module load so
 * this module never evaluates the registry's family list while it is still
 * being imported. The pair is stable for the life of the process, so it is
 * built once.
 */
let cachedHostFacts: Pick<HomeReadModel, "authority" | "runtime"> | undefined;

function hostFacts(): Pick<HomeReadModel, "authority" | "runtime"> {
	cachedHostFacts ??= (() => {
		const bootstrap = buildBootstrap(new StudioOperations());
		return { authority: bootstrap.authority, runtime: bootstrap.runtime };
	})();
	return cachedHostFacts;
}

/** The live runtime snapshot, from the session family's own gateway mapper. */
async function readLiveSnapshot(context: StudioHostContext): Promise<OperatorStateSnapshot> {
	const handler = sessionOps.queries?.["session.state"];
	if (handler === undefined) throw unavailable("the session family does not expose a live state snapshot");
	return await handler({}, context);
}

/** Recently opened workspaces, newest first. Optional on the home model. */
async function readRecentWorkspaces(context: StudioHostContext): Promise<readonly WorkspaceRecord[] | undefined> {
	const handler = workspaceOps.queries?.["projects.list"];
	if (handler === undefined) return undefined;
	let inventory: WorkspaceListReadModel;
	try {
		inventory = await handler({}, context);
	} catch {
		// The workspace inventory is an optional home block; a listing failure
		// must not hide the required authority/runtime/snapshot facts.
		return undefined;
	}
	return [...inventory.workspaces]
		.sort((a, b) => (a.lastOpenedAt < b.lastOpenedAt ? 1 : a.lastOpenedAt > b.lastOpenedAt ? -1 : 0))
		.slice(0, RECENT_WORKSPACES_LIMIT);
}

async function homeReadModel(context: StudioHostContext): Promise<HomeReadModel> {
	const { authority, runtime } = hostFacts();
	const [snapshot, history, recentWorkspaces] = await Promise.all([
		readLiveSnapshot(context),
		listHistory({ limit: RECENT_THREADS_LIMIT, status: "active" }),
		readRecentWorkspaces(context),
	]);
	return {
		authority,
		runtime,
		snapshot,
		recentThreads: history.entries.map(entry => ({
			threadId: entry.threadId,
			...(entry.title === undefined ? {} : { title: entry.title }),
			lastActiveAt: entry.lastActiveAt,
		})),
		...(recentWorkspaces === undefined ? {} : { recentWorkspaces }),
	};
}

// ---------------------------------------------------------------------------
// `usage.get`
// ---------------------------------------------------------------------------

/** Local calendar day (`YYYY-MM-DD`) of an instant. */
function localDateKey(milliseconds: number): string {
	const date = new Date(milliseconds);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** The two `/api/usage` fields the daily series consumes. */
function usageRow(value: unknown): { readonly lastActive: string; readonly totalTokens: number } | undefined {
	if (!isRecord(value)) return undefined;
	const lastActive = isoField(value, "lastActive");
	const totalTokens = value.totalTokens;
	if (lastActive === undefined || typeof totalTokens !== "number" || !Number.isFinite(totalTokens)) return undefined;
	return { lastActive, totalTokens };
}

/**
 * Daily token totals from the gateway's per-session usage rows. A session's
 * whole lifetime total is attributed to its last-active day — the only date
 * `/api/usage` exposes. Per-model and per-hour series are not recorded by
 * Zeta, so those arrays stay empty *and* the model says why.
 */
async function tokenUsage(): Promise<TokenUsageReadModel> {
	const body = await gatewayJson<unknown>("/api/usage");
	const sessions = isRecord(body) && Array.isArray(body.sessions) ? body.sessions : undefined;
	if (sessions === undefined) throw unavailable("/api/usage did not return a sessions array");

	const tokensByDay = new Map<string, number>();
	for (const value of sessions) {
		const row = usageRow(value);
		if (row === undefined) continue;
		const key = localDateKey(Date.parse(row.lastActive));
		tokensByDay.set(key, (tokensByDay.get(key) ?? 0) + row.totalTokens);
	}
	const days = [...tokensByDay]
		.sort(([left], [right]) => left.localeCompare(right))
		.slice(-USAGE_MAX_DAYS)
		.map(([date, totalTokens]) => ({ date, totalTokens }));

	return {
		generatedAt: new Date().toISOString(),
		days,
		models: [],
		byModel: [],
		hours: [],
		unavailableReason: USAGE_PARTIAL_REASON,
	};
}

// ---------------------------------------------------------------------------
// `stats.dashboard`
// ---------------------------------------------------------------------------

/** Normalize a published dashboard URL to an HTTP(S) origin. */
function dashboardOrigin(published: string): string | undefined {
	let parsed: URL;
	try {
		parsed = new URL(published);
	} catch {
		return undefined;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
	return parsed.origin;
}

/**
 * A dashboard is "available" only when it answered with its own identity
 * header: a port that answers something else is not this dashboard.
 */
async function dashboardAnswers(origin: string): Promise<boolean> {
	try {
		const response = await fetch(`${origin}/api/status`, {
			headers: { [STATS_DASHBOARD_HEADER]: STATS_DASHBOARD_SECURITY_VERSION },
			signal: AbortSignal.timeout(STATS_PROBE_TIMEOUT_MS),
		});
		await response.body?.cancel();
		return (
			response.status === 200 && response.headers.get(STATS_DASHBOARD_HEADER) === STATS_DASHBOARD_SECURITY_VERSION
		);
	} catch {
		return false;
	}
}

async function statsDashboard(): Promise<StatsDashboardReadModel> {
	let identity: IdentityFacts;
	try {
		identity = await readIdentity();
	} catch {
		return { available: false, reason: "This server did not report a statistics dashboard URL." };
	}
	if (identity.statsUrl === undefined) {
		return { available: false, reason: "This server has not published a statistics dashboard URL." };
	}
	const origin = dashboardOrigin(identity.statsUrl);
	if (origin === undefined) {
		return { available: false, reason: "The published statistics dashboard URL is not an HTTP origin." };
	}
	if (!(await dashboardAnswers(origin))) {
		return { available: false, reason: `The statistics dashboard at ${origin} did not answer.` };
	}
	return { available: true, url: `${origin}${STATS_DEEP_LINK}` };
}

// ---------------------------------------------------------------------------
// `conversation.open`
// ---------------------------------------------------------------------------

function conversationTarget(value: unknown): ConversationTarget {
	if (!isRecord(value)) throw invalid("target must be an object");
	const kind = stringField(value, "kind");
	if (kind === "session") {
		return { kind: "session", sessionId: requiredString(value, "sessionId") as SessionId };
	}
	if (kind === "agent") {
		return {
			kind: "agent",
			parentSessionId: requiredString(value, "parentSessionId") as SessionId,
			agentId: requiredString(value, "agentId") as AgentId,
		};
	}
	throw invalid("target.kind must be session or agent");
}

async function openConversation(input: {
	readonly target: ConversationTarget;
	readonly limit?: number;
}): Promise<ConversationOpenResult> {
	if (!isRecord(input)) throw invalid("input must be an object");
	const target = conversationTarget(input.target);
	if (input.limit !== undefined && (typeof input.limit !== "number" || !Number.isFinite(input.limit))) {
		throw invalid("limit must be a number");
	}
	const limit = input.limit === undefined ? undefined : Math.trunc(input.limit);

	if (target.kind === "agent") {
		const page = await readAgentConversationPage(target.parentSessionId, target.agentId, undefined, limit);
		return {
			target: {
				kind: "agent",
				parentSessionId: target.parentSessionId,
				agentId: target.agentId,
				conversationSessionId: page.sessionId,
			},
			page,
			live: NO_LIVE_REPLAY,
		};
	}

	const page = await readTranscriptPage(target.sessionId, undefined, limit);
	return {
		target: {
			kind: "session",
			sessionId: target.sessionId,
			conversationSessionId: page.sessionId,
		},
		page,
		live: NO_LIVE_REPLAY,
	};
}

// ---------------------------------------------------------------------------
// Family
// ---------------------------------------------------------------------------

/**
 * Home, usage, statistics, conversation-open and history operations.
 *
 * `history.list` reads `/api/sessions` (+ `/archived`); `home.get` composes the
 * bootstrap authority/runtime, the session family's `session.state` snapshot,
 * active history and the workspace family's `projects.list`; `usage.get`
 * aggregates `/api/usage` session totals by last-active day; `stats.dashboard`
 * reads `/api/server/identity` then probes the published dashboard; and
 * `conversation.open` delegates to the session family's transcript-page
 * builders (`/api/sessions/:id/context` and the subagent transcript route).
 */
export const usageOps: StudioFamily = {
	id: "usage",
	queries: {
		/** Both listings are read once per request and mapped together. */
		"history.list": (input) => listHistory(input),
		/** Bootstrap facts + `session.state` + active history + workspace inventory. */
		"home.get": (_input, context) => homeReadModel(context),
		/** `/api/usage` session totals aggregated into the daily series. */
		"usage.get": () => tokenUsage(),
		"stats.dashboard": () => statsDashboard(),
		"conversation.open": (input) => openConversation(input),
	},
};

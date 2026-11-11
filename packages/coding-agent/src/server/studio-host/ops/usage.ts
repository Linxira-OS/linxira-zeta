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
 * - `usage.get`         → `GET /api/usage/daily`, the stats-database series
 *                         (~400 days of totals, the year's top five models plus
 *                         `other`, and today's per-model hours)
 * - `stats.dashboard`   → `GET /api/server/identity` for the published
 *                         `statsUrl`, then a loopback `/api/status` probe of
 *                         the dashboard itself
 * - `usage.openDashboard` → the same probed URL, handed to the system browser
 *                         (`openPath`); `serve` uses that helper for its own
 *                         URL too, so opening one is not a new capability
 * - `conversation.open` → session targets read `GET /api/sessions/:id/context`
 *                         through `readTranscriptPage`; agent targets read
 *                         `GET /api/agent/:parentSessionId/subagents/:agentId/transcript`
 *                         through `readAgentConversationPage`. Both builders are
 *                         exported by the session family, so the page shape and
 *                         cursor namespace match its transcript queries exactly.
 *
 * A handler takes the contract input and returns the contract result; it
 * reaches Zeta state only through `../gateway.js` (`callGateway`,
 * `gatewayJson`, `gatewayOk`, `invalid`, `unavailable`). A name this file does
 * not export is simply not advertised in the capability manifest, so leaving
 * an operation out hides its surface in the Renderer — never answer with made
 * up data.
 */
import { createHash } from "node:crypto";
import * as path from "node:path";
import { isRecord, stringProperty } from "@linxiraos/pi-utils";
import { STATS_DASHBOARD_HEADER, STATS_DASHBOARD_SECURITY_VERSION } from "@linxiraos/pi-stats/port-conflict";
import { buildBootstrap } from "../bootstrap.js";
import { StudioOperations } from "../registry.js";
import type { StudioFamily, StudioHostContext } from "../registry.js";
import { gatewayJson, invalid, requiredString, unavailable } from "../gateway.js";
import {
	isImSession,
	isTeamSession,
	normalizeSessionOrigin,
	type SessionOrigin,
} from "../../../session/session-origin.js";
import type {
	ConfigWriteResult,
	EnvironmentId,
	HistoryEntryId,
	HomeReadModel,
	SessionHistoryEntry,
	SessionHistoryReadModel,
	SessionHistoryStatus,
	SessionId,
	StatsDashboardReadModel,
	ThreadId,
	TokenUsageDayPoint,
	TokenUsageHourPoint,
	TokenUsageModelDayPoint,
	TokenUsageModelRef,
	TokenUsageReadModel,
	WorkspaceId,
	WorkspaceListReadModel,
	WorkspaceRecord,
} from "../contract/index.js";
import type { AgentId, ConversationOpenResult, ConversationTarget, OperatorStateSnapshot } from "../protocol/index.js";
import { openPath } from "../../../utils/open.js";
import { readAgentConversationPage, readTranscriptPage, sessionOps } from "./session.js";
import { loadResumePreferences, resumePathKey } from "../../../resume/index.js";
import { loadHiddenSessionIds } from "../../../session/session-visibility.js";
import { readWorkspaceIdentities, workspaceOps } from "./workspace.js";

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
/** Probe budget for the loopback statistics dashboard. */
const STATS_PROBE_TIMEOUT_MS = 3_000;
/**
 * Deep link into the native dashboard. `all` is the dashboard's widest range
 * (`TIME_RANGES` in `pi-stats/client/data/range.ts`), matching what the
 * upstream home card opens: the embedded page carries its own range switcher,
 * so a narrow default only made the first paint disagree with the card.
 */
const STATS_DEEP_LINK = "/#/overview?range=all";

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
	/** IM/bot/relay provenance, from the header or the web.yml tag fallback. */
	readonly origin?: SessionOrigin;
	/** Client that created the session; absent/unknown on legacy rows. */
	readonly client?: SessionClient;
	/** Client that initiated the latest durable run; absent when none was recorded. */
	readonly runClient?: SessionClient;
	/** Deterministic latest-task projection. */
	readonly taskSummary?: SessionTaskSummary;
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
	const origin = normalizeSessionOrigin(value.origin);
	const client = normalizeSessionClient(value.client);
	const runClient = normalizeSessionClient(value.runClient);
	const taskSummary = normalizeSessionTaskSummary(value.taskSummary);
	return {
		id,
		cwd,
		created,
		modified,
		messageCount: Math.trunc(count),
		...(name === undefined ? {} : { name }),
		...(firstMessage === undefined ? {} : { firstMessage }),
		...(origin === undefined ? {} : { origin }),
		...(client === undefined ? {} : { client }),
		...(runClient === undefined ? {} : { runClient }),
		...(taskSummary === undefined ? {} : { taskSummary }),
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
	workspace?: { workspaceId: WorkspaceId; workspaceName: string },
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
		...(workspace === undefined ? {} : { workspaceId: workspace.workspaceId, workspaceName: workspace.workspaceName }),
		...(row.name === undefined ? {} : { title: row.name }),
		...(summary === undefined ? {} : { summary }),
		startedAt: row.created,
		lastActiveAt: row.modified,
		messageCount: row.messageCount,
		status,
		...(row.origin === undefined ? {} : { origin: row.origin }),
		...(row.client === undefined ? {} : { client: row.client }),
		...(row.runClient === undefined ? {} : { runClient: row.runClient }),
		...(row.taskSummary === undefined ? {} : { taskSummary: row.taskSummary }),
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
	readonly includeIm?: boolean;
	readonly includeTeam?: boolean;
	/** Include conversations/folders hidden by shared visibility metadata. */
	readonly includeHidden?: boolean;
}): Promise<SessionHistoryReadModel> {
	if (!isRecord(input)) throw invalid("input must be an object");
	const status = historyStatus(input.status);
	const limit = historyLimit(input.limit);
	const workspaceId = input.workspaceId;
	if (workspaceId !== undefined && typeof workspaceId !== "string") throw invalid("workspaceId must be a string");
	if (input.includeIm !== undefined && typeof input.includeIm !== "boolean")
		throw invalid("includeIm must be a boolean");
	if (input.includeTeam !== undefined && typeof input.includeTeam !== "boolean")
		throw invalid("includeTeam must be a boolean");
	if (input.includeHidden !== undefined && typeof input.includeHidden !== "boolean")
		throw invalid("includeHidden must be a boolean");
	// IM/bot/relay and Team conversations are personal-agent surfaces too, but
	// they are not personal coding sessions: a history/home list leaves them out
	// unless asked.
	const includeIm = input.includeIm === true;
	const includeTeam = input.includeTeam === true;
	const includeHidden = input.includeHidden === true;

	const [activeBody, archivedBody, identity, hiddenSessions, preferences] = await Promise.all([
		status === "archived" ? Promise.resolve(undefined) : gatewayJson<unknown>("/api/sessions"),
		status === "active" ? Promise.resolve(undefined) : gatewayJson<unknown>("/api/sessions/archived"),
		readIdentity(),
		includeHidden ? Promise.resolve(undefined) : loadHiddenSessionIds(),
		includeHidden ? Promise.resolve(undefined) : loadResumePreferences(),
	]);
	// Shared hide metadata filters the default list; Show hidden / includeHidden
	// restores it. Hiding never touches the transcript.
	const hiddenPaths = [
		...Object.entries(preferences?.projects ?? {})
			.filter(([, preference]) => preference.hidden === true)
			.map(([key]) => key),
		...Object.entries(preferences?.workspaces ?? {})
			.filter(([, preference]) => preference.hidden === true)
			.map(([key]) => key),
	];
	const pathHidden = (cwd: string): boolean => {
		const key = resumePathKey(cwd);
		return hiddenPaths.some(root => {
			const relative = path.relative(root, key);
			return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
		});
	};
	const environmentId = environmentIdFor(identity.version);

	const activeRows = activeBody === undefined ? [] : sessionRows(activeBody, "/api/sessions");
	const archivedRows = archivedBody === undefined ? [] : sessionRows(archivedBody, "/api/sessions/archived");
	const workspaceIdentities = await readWorkspaceIdentities([...activeRows, ...archivedRows].map(row => row.cwd));
	const seen = new Set<string>();
	const entries: SessionHistoryEntry[] = [];
	const append = (rows: readonly SessionRow[], rowStatus: SessionHistoryStatus) => {
		for (const row of rows) {
			if (seen.has(row.id)) continue;
			if (!includeIm && isImSession(row.origin)) continue;
			if (!includeTeam && isTeamSession(row.origin)) continue;
			if (!includeHidden && hiddenSessions?.has(row.id)) continue;
			if (!includeHidden && hiddenPaths.length > 0 && pathHidden(row.cwd)) continue;
			const workspace = workspaceIdentities.get(resumePathKey(row.cwd));
			if (workspaceId !== undefined && workspace?.workspaceId !== workspaceId) continue;
			seen.add(row.id);
			entries.push(historyEntry(row, rowStatus, environmentId, workspace));
		}
	};
	append(activeRows, "active");
	append(archivedRows, "archived");

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
		.sort((a, b) => a.lastOpenedAt === b.lastOpenedAt ? 0 : a.lastOpenedAt === null ? 1 : b.lastOpenedAt === null ? -1 : b.lastOpenedAt.localeCompare(a.lastOpenedAt))
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
			...(entry.workspaceId === undefined ? {} : { workspaceId: entry.workspaceId }),
			...(entry.workspaceName === undefined ? {} : { workspaceName: entry.workspaceName }),
			lastActiveAt: entry.lastActiveAt,
		})),
		...(recentWorkspaces === undefined ? {} : { recentWorkspaces }),
	};
}

// ---------------------------------------------------------------------------
// `usage.get`
// ---------------------------------------------------------------------------

/** A `{ date, totalTokens }` row of `/api/usage/daily`'s daily series. */
function isUsageDayPoint(value: unknown): value is TokenUsageDayPoint {
	return isRecord(value) && typeof value.date === "string" && typeof value.totalTokens === "number";
}

/** A `{ date, model, tokens }` row of `/api/usage/daily`'s per-model series. */
function isUsageModelDayPoint(value: unknown): value is TokenUsageModelDayPoint {
	return (
		isRecord(value) &&
		typeof value.date === "string" &&
		typeof value.model === "string" &&
		typeof value.tokens === "number"
	);
}

/** A `{ hour, model, tokens }` row of `/api/usage/daily`'s hourly series. */
function isUsageHourPoint(value: unknown): value is TokenUsageHourPoint {
	return (
		isRecord(value) &&
		typeof value.hour === "number" &&
		typeof value.model === "string" &&
		typeof value.tokens === "number"
	);
}

/** The legend ids `/api/usage/daily` ranked for the card. */
function isUsageModelRef(value: unknown): value is TokenUsageModelRef {
	return isRecord(value) && typeof value.id === "string";
}

/**
 * Validate one `/api/usage/daily` answer into the contract read model.
 *
 * The route owns the aggregation; this maps its answer field for field, so a
 * renamed array fails loudly instead of rendering an empty card. Malformed
 * points are dropped — one bad row must not blank the whole heatmap — and the
 * reason arrives only when the route could not read the database at all.
 */
export function usageDailyReadModel(value: unknown): TokenUsageReadModel {
	if (!isRecord(value)) throw unavailable("/api/usage/daily did not return an object");
	for (const field of ["days", "models", "byModel", "hours"] as const) {
		if (!Array.isArray(value[field])) throw unavailable(`/api/usage/daily did not return a ${field} array`);
	}
	const unavailableReason = stringField(value, "unavailableReason");
	return {
		generatedAt: isoField(value, "generatedAt") ?? new Date().toISOString(),
		days: (value.days as unknown[]).filter(isUsageDayPoint),
		models: (value.models as unknown[]).filter(isUsageModelRef),
		byModel: (value.byModel as unknown[]).filter(isUsageModelDayPoint),
		hours: (value.hours as unknown[]).filter(isUsageHourPoint),
		...(unavailableReason === undefined ? {} : { unavailableReason }),
	};
}

/**
 * Daily and per-model series from the stats-backed gateway route.
 *
 * `GET /api/usage/daily` reads the stats database (`messages` plus the hourly
 * `message_rollup`, kept current by incremental `file_offsets` syncs) and
 * shapes it for the home card: ~400 days of totals, the year's top five models
 * plus one `other` bucket, and today's per-model hours. No session transcript
 * is re-parsed for this read.
 */
async function tokenUsage(): Promise<TokenUsageReadModel> {
	return usageDailyReadModel(await gatewayJson<unknown>("/api/usage/daily"));
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

/**
 * `usage.openDashboard` — hand the native dashboard's deep link to the user's
 * browser.
 *
 * The URL comes from {@link statsDashboard}: the same published, probed
 * endpoint the Statistics page embeds, so the external tab opens the same
 * section and range instead of a guessed port. `openPath` is this host's
 * existing "hand this URL to the OS" helper (`serve` uses it for its own URL
 * and the OAuth flow uses it for the authorize page); it is best-effort, so a
 * failed opener is logged there rather than turned into a false receipt.
 */
async function openDashboard(): Promise<ConfigWriteResult> {
	const dashboard = await statsDashboard();
	if (!dashboard.available || dashboard.url === undefined) {
		return {
			applied: false,
			runtimeEffect: "immediate",
			message: dashboard.reason ?? "The statistics dashboard is not available.",
		};
	}
	openPath(dashboard.url);
	return {
		applied: true,
		runtimeEffect: "immediate",
		message: `Opening ${dashboard.url} in the system browser.`,
	};
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
 * active history and the workspace family's `projects.list`; `usage.get` reads
 * the stats-backed `/api/usage/daily` series; `stats.dashboard` reads
 * `/api/server/identity` then probes the published dashboard;
 * `usage.openDashboard` hands that URL to the system browser; and
 * `conversation.open` delegates to the session family's transcript-page
 * builders (`/api/sessions/:id/context` and the subagent transcript route).
 */
export const usageOps: StudioFamily = {
	id: "usage",
	queries: {
		/** Both listings are read once per request and mapped together. */
		"history.list": input => listHistory(input),
		/** Bootstrap facts + `session.state` + active history + workspace inventory. */
		"home.get": (_input, context) => homeReadModel(context),
		/** Stats-database daily, per-model and hourly series. */
		"usage.get": () => tokenUsage(),
		"stats.dashboard": () => statsDashboard(),
		"conversation.open": input => openConversation(input),
	},
	commands: {
		/** Opens the probed dashboard deep link in the system browser. */
		"usage.openDashboard": () => openDashboard(),
	},
};

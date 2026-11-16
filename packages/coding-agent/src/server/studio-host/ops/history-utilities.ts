/**
 * Studio operations — session history utilities.
 *
 * Owned families: `session.titles.*`, `session.portability.*`,
 * `maintenance.compression.*` and `archive.*`. Inputs arrive as `CommandInput`
 * without a `kind`; every handler rebuilds the known operation from a closed
 * field set before a service sees it.
 *
 * Every call is bound to one live browser view: the private owner must still be
 * live and unexpired, the socket view open, the selection must name this exact
 * session and workspace, and the resident native `AgentSession` object must be
 * the same instance before and after every await. The service cache is keyed by
 * that identity, so a switched or replaced session cannot inherit another
 * conversation's pending review or compression candidates. Portability gets an
 * immutable host built from this call's captured view (owner identity, fence and
 * workspace), so an in-flight review is never re-pointed by another view's read.
 * The command result is returned with the shared snapshot, rechecked against the
 * same view.
 *
 * The portability import target is a registered workspace resolved through the
 * existing projects API. The service never receives a renderer path: the
 * destination directory comes from that registry row, and imports land through
 * native `unpackSession` with `preserveExisting` so a local copy becomes a fork.
 * Compression reviews are native `collectGc` candidate identities; apply reruns
 * the native collector with the reviewed set and the same idle/lease checks.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isRecord } from "@linxiraos/pi-utils";
import { getRpcSession } from "../../web-gateway/agents.js";
import { invalid, unavailable } from "../errors.js";
import { gatewayJson } from "../gateway.js";
import type { OperatorStateSnapshot } from "../protocol/contracts/state.js";
import type { ArchiveOperation } from "../protocol/contracts/archive.js";
import type { SessionCompressionOperation } from "../protocol/contracts/session-compression.js";
import type { SessionPortabilityOperation } from "../protocol/contracts/session-portability.js";
import type { SessionTitlesOperation } from "../protocol/contracts/session-titles.js";
import type { StudioFamily, StudioHostContext, StudioQueryHandlers } from "../registry.js";
import type { WorkbenchResultMap } from "../protocol/contracts/workbench.js";
import { currentStudioSelection } from "../selection.js";
import { StudioArchiveService } from "../services/archive-service.js";
import { StudioSessionCompressionService } from "../services/session-compression-service.js";
import {
	StudioSessionPortabilityService,
	type SessionPortabilityHost,
} from "../services/session-portability-service.js";
import { StudioSessionTitlesService } from "../services/session-titles-service.js";
import type { AgentSession } from "../../../session/agent-session.js";
import { SessionManager } from "../../../session/session-manager.js";
import { probeSessionLeases } from "../../../session/session-storage.js";
import { resolveWorkspacePath } from "./workspace.js";
import { workspaceIdFor } from "./workspace-id.js";
import { sessionWorkspaceId, snapshotFor } from "./session.js";

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const WORKSPACE_ID = /^ws-[a-f0-9]{16}$/;
const ARTIFACT_ID = /^[A-Za-z0-9_-]{1,4096}$/;
const SPECIAL_KEYS: readonly string[] = ["__proto__", "prototype", "constructor"];
const PROJECTS_ROUTE = "/api/projects";

type AutoCompressionStatusOperation = { kind: "maintenance.compression.auto.status"; sessionId: string };
type HistoryOperation =
	| SessionTitlesOperation
	| SessionPortabilityOperation
	| SessionCompressionOperation
	| ArchiveOperation
	| AutoCompressionStatusOperation;
type OperationKind = HistoryOperation["kind"];

const FIELDS: Readonly<Record<OperationKind, readonly string[]>> = {
	"session.titles.inspect": ["sessionId", "targetSessionIds"],
	"session.portability.pack": ["sessionId", "targetSessionId"],
	"session.portability.anonymize": ["sessionId", "targetSessionId"],
	"session.portability.prepare": ["sessionId", "artifactId", "targetWorkspaceId"],
	"session.portability.import": ["sessionId", "token"],
	"session.portability.cancel": ["sessionId", "token"],
	"session.portability.moved": ["sessionId", "targetSessionId", "label"],
	"session.portability.status": ["sessionId"],
	"maintenance.compression.scan": ["sessionId"],
	"maintenance.compression.apply": ["sessionId", "token"],
	"maintenance.compression.status": ["sessionId"],
	"maintenance.compression.auto.status": ["sessionId"],
	"archive.sessions.list": ["sessionId", "scope"],
	"archive.recaps.list": ["sessionId", "scope"],
	"archive.prompts.search": ["sessionId", "scope", "query"],
	"archive.session.inspect": ["sessionId", "targetSessionId"],
};

function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!isRecord(value)) throw invalid("Expected a history command object");
	for (const key of Object.keys(value)) {
		if (SPECIAL_KEYS.includes(key) || !keys.includes(key)) throw invalid("Unknown history command field");
	}
	return value;
}

function textValue(value: unknown, label: string, max: number, empty = false): string {
	if (typeof value !== "string" || value.length > max || value.includes("\0")) throw invalid(`Invalid ${label}`);
	if (!empty && value.trim() === "") throw invalid(`Invalid ${label}`);
	return value;
}

function sessionIdValue(value: unknown): string {
	const id = textValue(value, "session id", 128);
	if (!SESSION_ID.test(id)) throw invalid("Invalid session id");
	return id;
}

function tokenValue(value: unknown): string {
	const token = textValue(value, "transfer token", 36);
	if (!UUID.test(token)) throw invalid("Invalid transfer token");
	return token;
}

function scopeValue(value: unknown): "workspace" | "all" {
	if (value !== "workspace" && value !== "all") throw invalid("Invalid archive scope");
	return value;
}

function leaseTargets(value: unknown): string[] {
	if (!Array.isArray(value) || value.length > 4096) throw invalid("Invalid lease target list");
	const ids: string[] = [];
	for (const entry of value) {
		const id = sessionIdValue(entry);
		if (!ids.includes(id)) ids.push(id);
	}
	return ids;
}

/**
 * `session.lease.read` — ownership leases for this conversation's history.
 *
 * The only source is the native session-storage lease probe. Targets are
 * limited to the exact id set the live conversation's transcript bucket lists
 * (plus the live session itself); an id outside that set is reported as
 * `unknown`, never guessed free or held. Nothing opens, resumes or starts a
 * session. Two names are answered: the renderer's `session.lease.read` query
 * and the official `session.lease.inspect` capability id it gates on.
 */
async function readSessionLeases(
	input: unknown,
	context: StudioHostContext,
): Promise<{ held: string[]; unknown: string[] }> {
	const row = closed(input, ["sessionId", "targetSessionIds"]);
	const sessionId = sessionIdValue(row.sessionId);
	const targets = leaseTargets(row.targetSessionIds);
	const view = await liveView({ sessionId }, context);
	view.assertCurrent();
	if (targets.length === 0) return { held: [], unknown: [] };
	let known: ReadonlySet<string>;
	try {
		const rows = await SessionManager.list(
			view.session.sessionManager.getCwd(),
			view.session.sessionManager.getSessionDir(),
		);
		view.assertCurrent();
		known = new Set(rows.map(candidate => candidate.id));
	} catch {
		view.assertCurrent();
		throw unavailable("Session transcript storage is unavailable");
	}
	const scoped: string[] = [];
	const outside: string[] = [];
	for (const id of targets) {
		if (id === sessionId || known.has(id)) scoped.push(id);
		else outside.push(id);
	}
	const report = probeSessionLeases(scoped);
	view.assertCurrent();
	return { held: report.held, unknown: [...report.unknown, ...outside] };
}

const leaseQueries: Partial<StudioQueryHandlers> = {
	"session.lease.read": (input, context) => readSessionLeases(input, context),
	"session.lease.inspect": (input, context) => readSessionLeases(input, context),
};

function buildOperation<K extends OperationKind>(kind: K, input: unknown): Extract<HistoryOperation, { kind: K }> {
	const row = closed(input, FIELDS[kind]);
	const sessionId = sessionIdValue(row.sessionId);
	switch (kind) {
		case "session.titles.inspect": {
			if (!Array.isArray(row.targetSessionIds) || row.targetSessionIds.length > 64)
				throw invalid("Invalid title target list");
			const ids: string[] = [];
			for (const value of row.targetSessionIds) {
				const id = sessionIdValue(value);
				if (!ids.includes(id)) ids.push(id);
			}
			return { kind, sessionId, targetSessionIds: ids } as Extract<SessionTitlesOperation, { kind: K }>;
		}
		case "session.portability.pack":
		case "session.portability.anonymize":
		case "session.portability.moved": {
			const targetSessionId = sessionIdValue(row.targetSessionId);
			if (kind === "session.portability.moved") {
				const label = textValue(row.label, "move label", 256);
				if (/[\u0000-\u001f\u007f]/u.test(label)) throw invalid("Invalid move label");
				return { kind, sessionId, targetSessionId, label } as Extract<SessionPortabilityOperation, { kind: K }>;
			}
			return { kind, sessionId, targetSessionId } as Extract<SessionPortabilityOperation, { kind: K }>;
		}
		case "session.portability.prepare": {
			const artifactId = textValue(row.artifactId, "artifact id", 4096);
			if (!ARTIFACT_ID.test(artifactId)) throw invalid("Invalid artifact id");
			const targetWorkspaceId = row.targetWorkspaceId;
			if (targetWorkspaceId === undefined)
				return { kind, sessionId, artifactId } as Extract<SessionPortabilityOperation, { kind: K }>;
			const workspaceId = textValue(targetWorkspaceId, "workspace id", 64);
			if (!WORKSPACE_ID.test(workspaceId)) throw invalid("Invalid workspace id");
			return { kind, sessionId, artifactId, targetWorkspaceId: workspaceId } as Extract<
				SessionPortabilityOperation,
				{ kind: K }
			>;
		}
		case "session.portability.import":
		case "session.portability.cancel":
			return { kind, sessionId, token: tokenValue(row.token) } as Extract<SessionPortabilityOperation, { kind: K }>;
		case "session.portability.status":
			return { kind, sessionId } as Extract<SessionPortabilityOperation, { kind: K }>;
		case "maintenance.compression.scan":
		case "maintenance.compression.status":
			return { kind, sessionId } as Extract<SessionCompressionOperation, { kind: K }>;
		case "maintenance.compression.auto.status":
			return { kind, sessionId } as Extract<HistoryOperation, { kind: K }>;
		case "maintenance.compression.apply":
			return { kind, sessionId, token: tokenValue(row.token) } as Extract<SessionCompressionOperation, { kind: K }>;
		case "archive.sessions.list":
		case "archive.recaps.list":
			return { kind, sessionId, scope: scopeValue(row.scope) } as Extract<ArchiveOperation, { kind: K }>;
		case "archive.prompts.search": {
			const query = textValue(row.query, "archive query", 512, true);
			return { kind, sessionId, scope: scopeValue(row.scope), query } as Extract<ArchiveOperation, { kind: K }>;
		}
		case "archive.session.inspect":
			return { kind, sessionId, targetSessionId: sessionIdValue(row.targetSessionId) } as Extract<
				ArchiveOperation,
				{ kind: K }
			>;
	}
	throw invalid("Unsupported history command");
}

type StudioOwner = NonNullable<StudioHostContext["privateOwner"]>;
type StudioSelection = NonNullable<StudioHostContext["selection"]>;

interface LiveView {
	sessionId: string;
	/** The private view identity that authorized this invocation. */
	ownerId: string;
	session: AgentSession;
	cwd: string;
	workspaceId: string;
	assertCurrent: () => void;
}

function assertViewLive(selection: StudioSelection | undefined, owner: StudioOwner): void {
	if (!owner.isLive() || owner.expiresAt <= Date.now() || selection?.closed)
		throw unavailable("The conversation view is not live");
}

/** Synchronous identity gate: owner, socket view, selection and exact native object. */
function assertExact(
	owner: StudioOwner,
	selection: StudioSelection,
	sessionId: string,
	expected: AgentSession,
	cwd: string,
): void {
	assertViewLive(selection, owner);
	if (selection.sessionId !== sessionId) throw unavailable("The conversation changed");
	const session = getRpcSession(sessionId)?.getSession();
	if (!session || session.isDisposed || session.sessionId !== sessionId)
		throw unavailable(`Session ${sessionId} is not live`);
	if (session !== expected || path.resolve(session.sessionManager.getCwd()) !== cwd)
		throw unavailable("The session changed");
}

async function liveView(input: { sessionId: string }, context: StudioHostContext): Promise<LiveView> {
	const owner = context.privateOwner;
	const selection = context.selection ?? currentStudioSelection();
	if (!owner) throw unavailable("The conversation requires a live authenticated view");
	if (!selection) throw unavailable("The conversation context is not selected");
	assertViewLive(selection, owner);
	if (selection.sessionId !== input.sessionId) throw unavailable("This operation belongs to another session");
	const session = getRpcSession(input.sessionId)?.getSession();
	if (!session || session.isDisposed || session.sessionId !== input.sessionId)
		throw unavailable(`Session ${input.sessionId} is not live`);
	const workspaceId = await sessionWorkspaceId(input.sessionId);
	assertViewLive(selection, owner);
	const current = getRpcSession(input.sessionId)?.getSession();
	if (!current || current.isDisposed || current !== session) throw unavailable("The session changed");
	if (workspaceId !== selection.workspaceId) throw unavailable("The session does not belong to this workspace");
	const cwd = path.resolve(session.sessionManager.getCwd());
	const view: LiveView = {
		sessionId: input.sessionId,
		ownerId: owner.id,
		session,
		cwd,
		workspaceId,
		assertCurrent: () => assertExact(owner, selection, input.sessionId, session, cwd),
	};
	view.assertCurrent();
	return view;
}

interface SessionServices {
	session: AgentSession;
	cwd: string;
	titles: StudioSessionTitlesService;
	portability: StudioSessionPortabilityService;
	compression: StudioSessionCompressionService;
	archive: StudioArchiveService;
	used: number;
}

const SERVICE_LIMIT = 32;
const services = new Map<string, SessionServices>();
let serviceTick = 0;

function disposeServices(entry: SessionServices): void {
	entry.portability.dispose();
	entry.compression.dispose();
}

function servicesFor(view: LiveView): SessionServices {
	for (const [id, entry] of services) {
		if (!entry.session.isDisposed) continue;
		services.delete(id);
		disposeServices(entry);
	}
	const existing = services.get(view.sessionId);
	if (existing?.session === view.session && existing.cwd === view.cwd) {
		existing.used = ++serviceTick;
		return existing;
	}
	if (existing) {
		services.delete(view.sessionId);
		disposeServices(existing);
	}
	const entry: SessionServices = {
		session: view.session,
		cwd: view.cwd,
		titles: new StudioSessionTitlesService(view.session),
		portability: new StudioSessionPortabilityService(view.session),
		compression: new StudioSessionCompressionService(view.session),
		archive: new StudioArchiveService(view.session),
		used: ++serviceTick,
	};
	services.set(view.sessionId, entry);
	if (services.size > SERVICE_LIMIT) {
		let oldest: SessionServices | undefined;
		for (const candidate of services.values()) if (!oldest || candidate.used < oldest.used) oldest = candidate;
		if (oldest) {
			services.delete(oldest.session.sessionId);
			disposeServices(oldest);
		}
	}
	return entry;
}

/**
 * Resolve a registered workspace directory through the projects API. The
 * selected workspace uses the host's existing resolver; another selected
 * destination is looked up by opaque id in the same inventory, then canonically
 * realpathed. Nothing is registered or created here.
 */
async function resolveTargetWorkspace(
	workspaceId: string | undefined,
	selectedWorkspaceId: string,
): Promise<{ workspaceId: string; cwd: string }> {
	const wanted = workspaceId ?? selectedWorkspaceId;
	const cwd =
		wanted === selectedWorkspaceId ? await resolveWorkspacePath(wanted) : await registeredWorkspacePath(wanted);
	let resolved: string;
	try {
		resolved = await fs.realpath(cwd);
		const stat = await fs.stat(resolved);
		if (!stat.isDirectory()) throw new Error("not a directory");
	} catch {
		throw unavailable("The destination workspace is unavailable");
	}
	return { workspaceId: wanted, cwd: resolved };
}

async function registeredWorkspacePath(workspaceId: string): Promise<string> {
	const payload = await gatewayJson<unknown>(PROJECTS_ROUTE, { query: "includeHidden=true" });
	if (!isRecord(payload) || !Array.isArray(payload.projects)) throw unavailable("Workspace inventory is unavailable");
	for (const project of payload.projects) {
		if (!isRecord(project) || !Array.isArray(project.workspaces)) continue;
		for (const workspace of project.workspaces) {
			if (!isRecord(workspace)) continue;
			const key = workspace.key,
				candidate = workspace.path;
			if (typeof key !== "string" || typeof candidate !== "string" || candidate.includes("\0")) continue;
			if (workspaceIdFor(key) !== workspaceId) continue;
			if (!path.isAbsolute(candidate)) continue;
			return candidate;
		}
	}
	throw invalid(`unknown workspace: ${workspaceId}`);
}

async function execute<K extends OperationKind>(
	kind: K,
	input: unknown,
	context: StudioHostContext,
): Promise<{ snapshot: OperatorStateSnapshot; result: WorkbenchResultMap[K] }> {
	const operation = buildOperation(kind, input);
	const view = await liveView(operation, context);
	view.assertCurrent();
	const entry = servicesFor(view);
	view.assertCurrent();
	// One immutable authority per invocation: an in-flight transfer keeps this
	// view's fence even if another view reads status or replaces the cache entry.
	const portabilityHost: SessionPortabilityHost = {
		ownerId: view.ownerId,
		assertCurrent: view.assertCurrent,
		resolveTargetWorkspace: workspaceId => resolveTargetWorkspace(workspaceId, view.workspaceId),
	};
	let result: unknown;
	switch (operation.kind) {
		case "session.titles.inspect":
			result = await entry.titles.execute(operation as SessionTitlesOperation);
			break;
		case "session.portability.status":
			result = await entry.portability.execute(operation as SessionPortabilityOperation, portabilityHost);
			break;
		case "maintenance.compression.auto.status":
			result = await entry.compression.autoStatus();
			break;
		default:
			if (operation.kind.startsWith("session.portability."))
				result = await entry.portability.execute(operation as SessionPortabilityOperation, portabilityHost);
			else if (operation.kind.startsWith("maintenance.compression."))
				result = await entry.compression.execute(operation as SessionCompressionOperation);
			else result = await entry.archive.execute(operation as ArchiveOperation);
			break;
	}
	view.assertCurrent();
	const snapshot = await snapshotFor(view.sessionId);
	view.assertCurrent();
	return { snapshot, result: result as WorkbenchResultMap[K] };
}

export const historyUtilitiesOps: StudioFamily = {
	id: "history-utilities",
	queries: leaseQueries,
	commands: {
		"session.titles.inspect": (input, context) => execute("session.titles.inspect", input, context),
		"session.portability.pack": (input, context) => execute("session.portability.pack", input, context),
		"session.portability.anonymize": (input, context) => execute("session.portability.anonymize", input, context),
		"session.portability.prepare": (input, context) => execute("session.portability.prepare", input, context),
		"session.portability.import": (input, context) => execute("session.portability.import", input, context),
		"session.portability.cancel": (input, context) => execute("session.portability.cancel", input, context),
		"session.portability.moved": (input, context) => execute("session.portability.moved", input, context),
		"session.portability.status": (input, context) => execute("session.portability.status", input, context),
		"maintenance.compression.scan": (input, context) => execute("maintenance.compression.scan", input, context),
		"maintenance.compression.apply": (input, context) => execute("maintenance.compression.apply", input, context),
		"maintenance.compression.status": (input, context) => execute("maintenance.compression.status", input, context),
		"maintenance.compression.auto.status": (input, context) =>
			execute("maintenance.compression.auto.status", input, context),
		"archive.sessions.list": (input, context) => execute("archive.sessions.list", input, context),
		"archive.recaps.list": (input, context) => execute("archive.recaps.list", input, context),
		"archive.prompts.search": (input, context) => execute("archive.prompts.search", input, context),
		"archive.session.inspect": (input, context) => execute("archive.session.inspect", input, context),
	},
};

/** Test seam: drop every cached per-session service and its pending review. */
export function disposeHistoryServices(): void {
	for (const entry of services.values()) disposeServices(entry);
	services.clear();
}

/**
 * Studio IDA operations: the legacy review/commit surface and the database
 * details surface.
 *
 * Every handler resolves the requested session through the authenticated live
 * view; no dormant session is started here. The services own the native work,
 * and each command returns the Workbench receipt shape (`snapshot` + `result`).
 */
import type { AgentSession } from "../../../session/agent-session";
import type { ToolSession } from "../../../tools";
import { getRpcSession } from "../../web-gateway/agents.js";
import { invalid, unavailable } from "../gateway.js";
import { IDA_VIEWS, isIdaKind, type IdaEdit, type IdaOperation, type IdaResultMap } from "../protocol/contracts/ida.js";
import {
	isIdaOperationKind,
	type StudioIdaOperation,
	type StudioIdaResultMap,
} from "../protocol/contracts/ida-details.js";
import type { OperatorStateSnapshot } from "../protocol/index.js";
import type { StudioFamily, StudioHostContext } from "../registry.js";
import { StudioIdaDetailsService } from "../services/ida-details-service.js";
import { StudioIdaService } from "../services/ida-service.js";
import { snapshotFor, sessionWorkspaceId } from "./session.js";
import { StudioOpError } from "../errors.js";

/** Runtime view one IDA command is allowed to use. */
interface IdaHostView {
	readonly sessionId: string;
	readonly ownerId: string;
	readonly session: AgentSession;
	readonly toolSession: ToolSession;
	assert(): void;
}

function record(value: unknown, message: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid(message);
	return value as Record<string, unknown>;
}

function idaText(value: unknown, max = 4096, empty = false): void {
	if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max || value.includes("\0"))
		throw invalid("Invalid IDA text");
}

function idaNumber(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): void {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
		throw invalid("Invalid IDA number");
}

/** Validate one untrusted edit before it can become a review token. */
export function validateIdaEdit(value: unknown): asserts value is IdaEdit {
	const row = record(value, "Invalid IDA payload");
	const action = row.action;
	const fields: Record<string, readonly string[]> = {
		open: ["path"],
		save: ["dbId"],
		close: ["dbId", "save"],
		rename: ["dbId", "target", "name"],
		comment: ["dbId", "target", "text", "repeatable"],
		set_type: ["dbId", "target", "decl"],
		make_function: ["dbId", "target"],
		exec: ["dbId", "code"],
	};
	if (typeof action !== "string" || !Object.hasOwn(fields, action)) throw invalid("Invalid IDA action");
	for (const field of fields[action] ?? []) {
		const fieldValue = row[field];
		if (field === "save" || field === "repeatable") {
			if (typeof fieldValue !== "boolean") throw invalid("Invalid IDA flag");
			continue;
		}
		idaText(fieldValue, field === "code" ? 65536 : field === "text" ? 16384 : 4096, field === "text");
	}
}

/** Validate one untrusted legacy operation. */
export function validateIdaOperation(value: unknown): asserts value is IdaOperation {
	const row = record(value, "Invalid IDA payload");
	const kind = row.kind;
	if (typeof kind !== "string" || !isIdaKind(kind)) throw invalid("Invalid IDA operation");
	idaText(row.sessionId, 512);
	if (kind === "ida.prepare") validateIdaEdit(row.edit);
	else if (kind === "ida.commit") idaText(row.token, 128);
	else if (kind === "ida.view") {
		idaText(row.dbId);
		idaText(row.identity, 128);
		idaNumber(row.version);
		if (typeof row.view !== "string" || !(IDA_VIEWS as readonly string[]).includes(row.view))
			throw invalid("Invalid IDA view");
		if (row.target !== undefined) idaText(row.target);
		if (row.offset !== undefined) idaNumber(row.offset);
	}
}

/** Validate one untrusted database-details operation. */
export function validateStudioIdaOperation(value: unknown): asserts value is StudioIdaOperation {
	const row = record(value, "Invalid IDA payload");
	const kind = row.kind;
	if (typeof kind !== "string" || !isIdaOperationKind(kind)) throw invalid("Invalid IDA operation");
	idaText(row.sessionId, 512);
	if (kind === "ida.configure") {
		if (typeof row.enabled !== "boolean") throw invalid("Invalid IDA boolean");
		idaText(row.installDir, 4096, true);
		idaText(row.python, 4096, true);
	} else if (kind === "ida.open") idaText(row.path);
	else if (kind === "ida.run") {
		idaText(row.id);
		idaText(row.code, 65536);
		idaNumber(row.timeoutMs, 100, 300_000);
	} else if (kind !== "ida.status.details") idaText(row.id);
}

function ownerView(context: StudioHostContext): { id: string } {
	const owner = context.privateOwner;
	if (!owner || !owner.isLive() || owner.expiresAt <= Date.now() || context.selection?.closed === true)
		throw unavailable("IDA requires a live authenticated view");
	return { id: owner.id };
}

/**
 * Resolve the exact live session and tool context, then verify it again after
 * every async step. `getRpcSession` never starts a dormant session.
 */
async function idaView(sessionId: string, context: StudioHostContext): Promise<IdaHostView> {
	const owner = ownerView(context);
	if (context.selection !== undefined) {
		const selected = context.selection.sessionId;
		if (selected === undefined) throw unavailable("no session in this conversation context");
		if (selected !== sessionId) throw invalid("IDA session does not belong to this conversation");
	}
	const session = getRpcSession(sessionId)?.getSession();
	if (!session || session.isDisposed || session.sessionId !== sessionId)
		throw unavailable("IDA session is not resident or the view closed");
	const toolSession = session.getEvalToolSession();
	if (!toolSession) throw unavailable("Native IDA context is unavailable in this Runtime");
	const workspaceId = await sessionWorkspaceId(sessionId);
	if (!workspaceId) throw unavailable("IDA session workspace is unavailable");
	if (context.selection !== undefined && context.selection.workspaceId !== workspaceId)
		throw invalid("IDA workspace does not own this session");
	const cwd = session.sessionManager.getCwd();
	const assert = () => {
		const currentOwner = ownerView(context);
		if (currentOwner.id !== owner.id) throw unavailable("IDA view changed");
		if (context.selection !== undefined && context.selection.sessionId !== sessionId)
			throw invalid("IDA session does not belong to this conversation");
		const current = getRpcSession(sessionId)?.getSession();
		if (
			!current ||
			current !== session ||
			current.isDisposed ||
			current.sessionId !== sessionId ||
			current.getEvalToolSession() !== toolSession ||
			current.sessionManager.getCwd() !== cwd
		)
			throw unavailable("IDA session changed");
	};
	assert();
	return { sessionId, ownerId: owner.id, session, toolSession, assert };
}

const idaServices = new WeakMap<AgentSession, StudioIdaService>();
const idaDetailsServices = new WeakMap<AgentSession, StudioIdaDetailsService>();

function idaService(view: IdaHostView): StudioIdaService {
	const existing = idaServices.get(view.session);
	if (existing) return existing;
	const service = new StudioIdaService(view.session);
	idaServices.set(view.session, service);
	view.session.addDisposer(() => {
		if (idaServices.get(view.session) === service) {
			idaServices.delete(view.session);
			service.dispose();
		}
	});
	return service;
}

function idaDetailsService(view: IdaHostView): StudioIdaDetailsService {
	const existing = idaDetailsServices.get(view.session);
	if (existing) return existing;
	const service = new StudioIdaDetailsService(view.session);
	idaDetailsServices.set(view.session, service);
	view.session.addDisposer(() => {
		if (idaDetailsServices.get(view.session) === service) {
			idaDetailsServices.delete(view.session);
			service.dispose();
		}
	});
	return service;
}

function rethrowIda(error: unknown): never {
	if (error instanceof StudioOpError) throw error;
	throw unavailable(error instanceof Error ? error.message : String(error));
}

async function runLegacy<K extends IdaOperation["kind"]>(
	kind: K,
	input: Omit<Extract<IdaOperation, { kind: K }>, "kind">,
	context: StudioHostContext,
): Promise<{ snapshot: OperatorStateSnapshot; result: IdaResultMap[K] }> {
	// The handler map correlates `input` with `kind`; the validator below asserts the full shape.
	const operation = { ...input, kind } as unknown as IdaOperation;
	validateIdaOperation(operation);
	const view = await idaView(operation.sessionId, context);
	let result: unknown;
	try {
		result = await idaService(view).execute(operation, view.ownerId);
	} catch (error) {
		rethrowIda(error);
	}
	view.assert();
	const snapshot = await snapshotFor(operation.sessionId);
	view.assert();
	return { snapshot, result: result as IdaResultMap[K] };
}

async function runDetails<K extends StudioIdaOperation["kind"]>(
	kind: K,
	input: Omit<Extract<StudioIdaOperation, { kind: K }>, "kind">,
	context: StudioHostContext,
): Promise<{ snapshot: OperatorStateSnapshot; result: StudioIdaResultMap[K] }> {
	// The handler map correlates `input` with `kind`; the validator below asserts the full shape.
	const operation = { ...input, kind } as unknown as StudioIdaOperation;
	validateStudioIdaOperation(operation);
	const view = await idaView(operation.sessionId, context);
	let result: unknown;
	try {
		result = await idaDetailsService(view).execute(operation, view.ownerId);
	} catch (error) {
		rethrowIda(error);
	}
	view.assert();
	const snapshot = await snapshotFor(operation.sessionId);
	view.assert();
	return { snapshot, result: result as StudioIdaResultMap[K] };
}

export const idaOps: StudioFamily = {
	id: "ida",
	commands: {
		"ida.status": (input, context) => runLegacy("ida.status", input, context),
		"ida.view": (input, context) => runLegacy("ida.view", input, context),
		"ida.prepare": (input, context) => runLegacy("ida.prepare", input, context),
		"ida.commit": (input, context) => runLegacy("ida.commit", input, context),
		"ida.cancel": (input, context) => runLegacy("ida.cancel", input, context),
		"ida.status.details": (input, context) => runDetails("ida.status.details", input, context),
		"ida.configure": (input, context) => runDetails("ida.configure", input, context),
		"ida.open": (input, context) => runDetails("ida.open", input, context),
		"ida.save": (input, context) => runDetails("ida.save", input, context),
		"ida.close": (input, context) => runDetails("ida.close", input, context),
		"ida.run": (input, context) => runDetails("ida.run", input, context),
		"ida.database.cancel": (input, context) => runDetails("ida.database.cancel", input, context),
	},
};

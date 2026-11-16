/**
 * Studio operations — annotated sources.
 *
 * Owned operations: `annotations.capture` and `annotations.prepare` (reads).
 * The work happens in {@link StudioAnnotationService} against the caller's
 * current live `AgentSession`; no session is attached or started here, and the
 * native prompt builders never send a model request.
 *
 * The renderer supplies only source text, workspace-relative paths, notes and
 * UTF-16 selections. Every entry shape is revalidated at this boundary (the
 * same strict bundle validator the protocol advertises), then the service
 * rechecks the captured session/cwd and every source version. Results return
 * the Workbench command envelope: the current operator snapshot plus the
 * operation result.
 */
import type { AgentSession } from "../../../session/agent-session.js";
import { getRpcSession } from "../../web-gateway/agents.js";
import { invalid, unavailable } from "../errors.js";
import type { OperatorStateSnapshot } from "../protocol/index.js";
import {
	validateAnnotationBundle,
	type AnnotationBundle,
	type AnnotationCapture,
	type AnnotationOperation,
	type AnnotationResultMap,
} from "../protocol/contracts/annotations.js";
import type { StudioFamily, StudioHostContext } from "../registry.js";
import { currentStudioSelection } from "../selection.js";
import { StudioAnnotationService } from "../services/annotation-service.js";
import { snapshotFor } from "./session.js";

type PrepareInput = Omit<Extract<AnnotationOperation, { kind: "annotations.prepare" }>, "kind">;

const MAX_SOURCE_CHARS = 120_000;
const MAX_PATH_CHARS = 4096;

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("Invalid annotation object");
	const row = value as Record<string, unknown>;
	if (Object.keys(row).some(key => !keys.includes(key))) throw invalid("Unknown annotation field");
	return row;
}

function text(value: unknown, max = 512, empty = false): string {
	if (typeof value !== "string" || (!empty && !value.trim()) || value.includes("\0") || value.length > max)
		throw invalid("Invalid annotation text");
	return value;
}

function relative(value: unknown): string {
	const path = text(value, MAX_PATH_CHARS);
	if (/^(?:[A-Za-z]:|[\\/])/u.test(path) || path.split(/[\\/]/u).includes(".."))
		throw invalid("Annotation paths must be workspace-relative");
	return path;
}

function captureInput(value: unknown): AnnotationCapture {
	const row = object(value, ["source"]);
	const kind = (row.source as { kind?: unknown } | null)?.kind;
	if (kind === "file") {
		const input = object(row.source, ["kind", "path"]);
		return { kind, path: relative(input.path) };
	}
	if (kind === "diff") {
		const input = object(row.source, ["kind", "path"]);
		return { kind, ...(input.path === undefined ? {} : { path: relative(input.path) }) };
	}
	if (kind === "message" || kind === "quote") {
		const input = object(row.source, ["kind", "text", "label", "sessionId", "messageId"]);
		return {
			kind,
			text: text(input.text, MAX_SOURCE_CHARS, true),
			label: text(input.label),
			...(input.sessionId === undefined ? {} : { sessionId: text(input.sessionId) }),
			...(input.messageId === undefined ? {} : { messageId: text(input.messageId) }),
		};
	}
	throw invalid("Invalid annotation capture kind");
}

function annotationBundle(value: unknown): AnnotationBundle {
	validateAnnotationBundle(value);
	return value;
}

function prepareInput(value: unknown): PrepareInput {
	const row = object(value, ["sources", "notes", "action", "allowStale"]);
	if (row.action !== "feedback" && row.action !== "review") throw invalid("Invalid annotation action");
	if (row.allowStale !== undefined && typeof row.allowStale !== "boolean")
		throw invalid("Invalid stale-source choice");
	let bundle: AnnotationBundle;
	try {
		bundle = annotationBundle({ schemaVersion: 1, revision: 1, sources: row.sources, notes: row.notes });
	} catch (error) {
		throw invalid(error instanceof Error ? error.message : "Invalid annotation bundle");
	}
	return {
		sources: bundle.sources,
		notes: bundle.notes,
		action: row.action,
		...(row.allowStale === undefined ? {} : { allowStale: row.allowStale }),
	};
}

/** A resident session plus the liveness of the gateway wrapper that owns it. */
export interface AnnotationLiveSession {
	readonly session: AgentSession;
	isLive(): boolean;
}

/** Live-session seams; production resolves the caller's selected runtime session. */
export interface AnnotationHostDeps {
	readonly resolveSession: (sessionId: string) => AnnotationLiveSession | undefined;
	readonly snapshot: (sessionId: string) => Promise<OperatorStateSnapshot>;
}

function liveSession(sessionId: string): AnnotationLiveSession | undefined {
	const wrapper = getRpcSession(sessionId);
	if (wrapper === undefined) return undefined;
	return { session: wrapper.getSession(), isLive: () => wrapper.isAlive() };
}

const defaultDeps: AnnotationHostDeps = {
	resolveSession: liveSession,
	snapshot: snapshotFor,
};

interface AnnotationBinding {
	readonly owner: NonNullable<StudioHostContext["privateOwner"]>;
	readonly selection: NonNullable<StudioHostContext["selection"]>;
	readonly sessionId: string;
	readonly resident: AnnotationLiveSession;
}

/** One live authenticated view bound to one explicit selected runtime session. */
function requireAnnotationBinding(context: StudioHostContext, deps: AnnotationHostDeps): AnnotationBinding {
	const owner = context.privateOwner;
	if (owner === undefined || !owner.isLive() || owner.expiresAt <= Date.now())
		throw unavailable("annotations require a live authenticated view");
	const selection = context.selection;
	if (selection === undefined || selection.closed || selection.sessionId === undefined)
		throw unavailable("annotations require an explicit selected session");
	if (currentStudioSelection() !== selection) throw unavailable("annotation session changed");
	const sessionId = selection.sessionId;
	const resident = deps.resolveSession(sessionId);
	if (
		resident === undefined ||
		!resident.isLive() ||
		resident.session.isDisposed ||
		resident.session.sessionId !== sessionId
	)
		throw unavailable("annotations require the selected live session");
	return { owner, selection, sessionId, resident };
}

/** The same owner, selection and resident session must survive every await. */
function assertAnnotationBinding(binding: AnnotationBinding, deps: AnnotationHostDeps): void {
	const { owner, selection, sessionId, resident } = binding;
	if (!owner.isLive() || owner.expiresAt <= Date.now()) throw unavailable("annotation view closed");
	if (selection.closed || selection.sessionId !== sessionId) throw unavailable("annotation session changed");
	if (currentStudioSelection() !== selection) throw unavailable("annotation session changed");
	const current = deps.resolveSession(sessionId);
	if (
		current === undefined ||
		!current.isLive() ||
		!resident.isLive() ||
		current.session !== resident.session ||
		resident.session.isDisposed ||
		resident.session.sessionId !== sessionId
	)
		throw unavailable("annotation session changed");
}

async function capture(
	value: unknown,
	context: StudioHostContext,
	deps: AnnotationHostDeps,
): Promise<{ snapshot: OperatorStateSnapshot; result: AnnotationResultMap["annotations.capture"] }> {
	const binding = requireAnnotationBinding(context, deps);
	const source = captureInput(value);
	assertAnnotationBinding(binding, deps);
	const result = await new StudioAnnotationService(binding.resident.session).execute({
		kind: "annotations.capture",
		source,
	});
	assertAnnotationBinding(binding, deps);
	const snapshot = await deps.snapshot(binding.sessionId);
	assertAnnotationBinding(binding, deps);
	return { snapshot, result };
}

async function prepare(
	value: unknown,
	context: StudioHostContext,
	deps: AnnotationHostDeps,
): Promise<{ snapshot: OperatorStateSnapshot; result: AnnotationResultMap["annotations.prepare"] }> {
	const binding = requireAnnotationBinding(context, deps);
	const input = prepareInput(value);
	assertAnnotationBinding(binding, deps);
	const result = await new StudioAnnotationService(binding.resident.session).execute({
		kind: "annotations.prepare",
		...input,
	});
	assertAnnotationBinding(binding, deps);
	const snapshot = await deps.snapshot(binding.sessionId);
	assertAnnotationBinding(binding, deps);
	return { snapshot, result };
}

/** Testable family factory; production uses the live gateway and snapshot read. */
export function createAnnotationsOps(deps: AnnotationHostDeps = defaultDeps): StudioFamily {
	return {
		id: "annotations",
		commands: {
			"annotations.capture": (input, context) => capture(input, context, deps),
			"annotations.prepare": (input, context) => prepare(input, context, deps),
		},
	};
}

export const annotationsOps: StudioFamily = createAnnotationsOps();

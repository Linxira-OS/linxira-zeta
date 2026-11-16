/**
 * Studio operations — child-agent BTW and model inspection.
 *
 * Both operations resolve the live parent session through the authenticated
 * conversation selection; neither starts a session. Child BTW runs on the
 * registry-proven child AgentSession and keeps its own history scope, so the
 * main BTW slot and every sibling stay untouched. Model inspection reads a
 * live descendant's native routing, or a parked descendant's persisted
 * contract through the existing cold-read loader (no revive, no model call).
 *
 * Owned names: `agent.btw.read|ask|abort`, `agent.model.inspect`.
 */
import type { AgentSession } from "../../../session/agent-session";
import { getRpcSession } from "../../web-gateway/agents";
import { invalid, unavailable } from "../errors.js";
import type { AgentBtwOperation, AgentBtwState } from "../protocol/contracts/agent-btw.js";
import type { AgentModelInspection, AgentModelOperation } from "../protocol/contracts/agent-model.js";
import type { BtwImage } from "../protocol/contracts/runtime-upgrade.js";
import type { OperatorStateSnapshot } from "../protocol/contracts/state.js";
import type { StudioFamily, StudioHostContext } from "../registry.js";
import { currentStudioSelection } from "../selection.js";
import { StudioAgentBtwService } from "../services/agent-btw-service.js";
import { StudioAgentModelService } from "../services/agent-model-service.js";
import { StudioBtwError } from "../services/btw-service.js";
import { snapshotFor } from "./session.js";

const SESSION_ID_MAX_CHARS = 512;
const AGENT_ID_MAX_CHARS = 512;
const BINDING_MAX_CHARS = 128;
const TOPIC_ID_MAX_CHARS = 128;
const EPHEMERAL_ID_MAX_CHARS = 128;
const MAX_IMAGES = 16;
const MAX_IMAGE_DATA_CHARS = 48 * 1024 * 1024;
const BTW_IMAGE_MIME_TYPES: Readonly<Record<BtwImage["mimeType"], true>> = {
	"image/png": true,
	"image/jpeg": true,
	"image/gif": true,
	"image/webp": true,
	"image/svg+xml": true,
};
const AGENT_BTW_FIELDS = ["sessionId", "agentId", "binding", "topicId", "question", "images", "ephemeralId"] as const;
const AGENT_MODEL_FIELDS = ["sessionId", "agentId"] as const;

function operationRow(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("Operation input must be an object");
	const row = value as Record<string, unknown>;
	if (Object.keys(row).some(key => !fields.includes(key))) throw invalid("Unknown operation field");
	return row;
}

function requiredText(value: unknown, field: string, maxChars: number): string {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > maxChars || value.includes("\0"))
		throw invalid(`Invalid ${field}`);
	return value;
}

function optionalText(value: unknown, field: string, maxChars: number): string | undefined {
	if (value === undefined) return undefined;
	return requiredText(value, field, maxChars);
}

function btwImages(value: unknown): BtwImage[] {
	if (!Array.isArray(value) || value.length > MAX_IMAGES) throw invalid("Invalid child BTW images");
	return value.map(entry => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalid("Invalid child BTW image");
		const image = entry as Record<string, unknown>;
		if (Object.keys(image).some(key => !["type", "mimeType", "data"].includes(key)))
			throw invalid("Unknown child BTW image field");
		if (image.type !== "image" || !Object.hasOwn(BTW_IMAGE_MIME_TYPES, image.mimeType as string))
			throw invalid("Invalid child BTW image type");
		if (
			typeof image.data !== "string" ||
			image.data.length === 0 ||
			image.data.length > MAX_IMAGE_DATA_CHARS ||
			image.data.includes("\0")
		)
			throw invalid("Invalid child BTW image data");
		return {
			type: "image",
			mimeType: image.mimeType as BtwImage["mimeType"],
			data: image.data,
		};
	});
}

function agentBtwOperation(kind: AgentBtwOperation["kind"], value: unknown): AgentBtwOperation {
	const row = operationRow(value, AGENT_BTW_FIELDS);
	const sessionId = requiredText(row.sessionId, "sessionId", SESSION_ID_MAX_CHARS);
	const agentId = requiredText(row.agentId, "agentId", AGENT_ID_MAX_CHARS);
	const topicId = optionalText(row.topicId, "topicId", TOPIC_ID_MAX_CHARS);
	const images = row.images === undefined ? undefined : btwImages(row.images);
	if (kind === "agent.btw.ask") {
		if (row.ephemeralId !== undefined) throw invalid("Ask accepts no ephemeral id");
		const question = requiredText(row.question, "question", Number.POSITIVE_INFINITY);
		return {
			kind,
			sessionId,
			agentId,
			binding: requiredText(row.binding, "binding", BINDING_MAX_CHARS),
			question,
			...(topicId === undefined ? {} : { topicId }),
			...(images === undefined ? {} : { images }),
		};
	}
	if (kind === "agent.btw.abort") {
		if (images !== undefined || row.question !== undefined || row.topicId !== undefined)
			throw invalid("Abort accepts no question or images");
		return {
			kind,
			sessionId,
			agentId,
			binding: requiredText(row.binding, "binding", BINDING_MAX_CHARS),
			ephemeralId: requiredText(row.ephemeralId, "ephemeralId", EPHEMERAL_ID_MAX_CHARS),
		};
	}
	if (images !== undefined || row.question !== undefined || row.ephemeralId !== undefined)
		throw invalid("Read accepts no question, images, or ephemeral id");
	const binding = optionalText(row.binding, "binding", BINDING_MAX_CHARS);
	return {
		kind,
		sessionId,
		agentId,
		...(binding === undefined ? {} : { binding }),
		...(topicId === undefined ? {} : { topicId }),
	};
}

function agentModelOperation(value: unknown): AgentModelOperation {
	const row = operationRow(value, AGENT_MODEL_FIELDS);
	return {
		kind: "agent.model.inspect",
		sessionId: requiredText(row.sessionId, "sessionId", SESSION_ID_MAX_CHARS),
		agentId: requiredText(row.agentId, "agentId", AGENT_ID_MAX_CHARS),
	};
}

interface LiveAgentSession {
	readonly session: AgentSession;
	assertCurrent(): void;
}

/**
 * The live parent behind this command's selection. `getRpcSession` never
 * starts a session: an absent or disposed session is an unavailable outcome,
 * never a reason to launch one.
 */
async function liveAgentSession(sessionId: string, context: StudioHostContext): Promise<LiveAgentSession> {
	const selection = currentStudioSelection();
	if (selection?.closed) throw unavailable("Conversation context is closed");
	if (selection !== undefined && selection.sessionId !== sessionId)
		throw unavailable("Child agent details belong to another session");
	const owner = context.privateOwner;
	if (!owner || !owner.isLive() || owner.expiresAt <= Date.now())
		throw unavailable("Child agent details require the same live authenticated conversation");
	const rpc = getRpcSession(sessionId);
	const session = rpc?.getSession();
	if (
		!rpc ||
		!rpc.isAlive() ||
		!session ||
		session.isDisposed ||
		session.sessionId !== sessionId ||
		session.sessionManager.getSessionId() !== sessionId
	)
		throw unavailable("The session is not live; child agent details do not start one");
	const valid = () =>
		!selection?.closed &&
		(selection === undefined || selection.sessionId === sessionId) &&
		owner.isLive() &&
		owner.expiresAt > Date.now() &&
		!session.isDisposed &&
		session.sessionId === sessionId &&
		getRpcSession(sessionId) === rpc &&
		rpc.isAlive() &&
		rpc.getSession() === session;
	if (!valid()) throw unavailable("The session changed while child agent details were attaching");
	return {
		session,
		assertCurrent() {
			if (!valid()) throw unavailable("The session changed during child agent details");
		},
	};
}

const childBtwPools = new WeakMap<AgentSession, StudioAgentBtwService>();

/** One child-BTW pool per live parent session; native teardown aborts its turns. */
function childBtwPool(session: AgentSession): StudioAgentBtwService {
	const existing = childBtwPools.get(session);
	if (existing) return existing;
	const pool = new StudioAgentBtwService(session);
	childBtwPools.set(session, pool);
	const dispose = () => {
		if (childBtwPools.get(session) !== pool) return;
		childBtwPools.delete(session);
		pool.dispose();
	};
	const unregister = session.registerSessionChangeCallback(dispose);
	session.addDisposer(() => {
		unregister();
		dispose();
	});
	return pool;
}

function rethrowBtw(error: unknown): never {
	if (error instanceof StudioBtwError)
		throw error.code === "INVALID_ARGUMENT" ? invalid(error.message) : unavailable(error.message);
	throw error;
}

async function executeBtw(
	kind: AgentBtwOperation["kind"],
	input: unknown,
	context: StudioHostContext,
): Promise<{ snapshot: OperatorStateSnapshot; result: AgentBtwState }> {
	const operation = agentBtwOperation(kind, input);
	const live = await liveAgentSession(operation.sessionId, context);
	live.assertCurrent();
	let result: AgentBtwState;
	try {
		result = await childBtwPool(live.session).execute(operation, live.assertCurrent);
	} catch (error) {
		rethrowBtw(error);
	}
	live.assertCurrent();
	const snapshot = await snapshotFor(operation.sessionId);
	live.assertCurrent();
	return { snapshot, result };
}

async function executeModel(
	input: unknown,
	context: StudioHostContext,
): Promise<{ snapshot: OperatorStateSnapshot; result: AgentModelInspection }> {
	const operation = agentModelOperation(input);
	const live = await liveAgentSession(operation.sessionId, context);
	live.assertCurrent();
	const result = await new StudioAgentModelService(live.session).execute(operation);
	live.assertCurrent();
	const snapshot = await snapshotFor(operation.sessionId);
	live.assertCurrent();
	return { snapshot, result };
}

export const agentDetailsOps: StudioFamily = {
	id: "agent-details",
	commands: {
		"agent.btw.read": (input, context) => executeBtw("agent.btw.read", input, context),
		"agent.btw.ask": (input, context) => executeBtw("agent.btw.ask", input, context),
		"agent.btw.abort": (input, context) => executeBtw("agent.btw.abort", input, context),
		"agent.model.inspect": (input, context) => executeModel(input, context),
	},
};

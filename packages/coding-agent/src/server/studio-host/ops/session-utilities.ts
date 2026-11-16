/**
 * Studio operations — session controls, main BTW, resources and shell traces.
 *
 * Every handler binds to the authenticated conversation's selected resident
 * session. `getRpcSession` is only a lookup: an absent, disposed or replaced
 * session is an unavailable outcome, never a reason to attach, revive or start
 * one. The same owner, selection and native session object are re-checked after
 * every await that precedes a mutation or a snapshot.
 *
 * Commands:
 * - `btw.ask|abort|branch` and `btw.history.list|read|followUp` run on the
 *   reviewed {@link StudioMainBtwRuntime} single slot, with native history
 *   persistence and native branch promotion.
 * - `btw.inject` adopts an answer through native prompt admission.
 * - `session.speed|warming|budget.*` and `models.presets.*` adapt native
 *   settings/model-preset APIs; no provider turn is started.
 * - `session.tier.get|set` and `session.skills.list` read the live session.
 * - `resource.read` / `resource.local.*` read native internal URLs and the
 *   session's own artifacts directory.
 *
 * Queries (central `QueryInputMap` wiring required):
 * - `shell.view.read|release` read/release a native shell visualization.
 * - `agent.spawn.options.read` reads native task-agent/model-role options.
 */
import type { ImageContent } from "@linxiraos/pi-ai";
import type { AgentSession } from "../../../session/agent-session.js";
import { getRpcSession } from "../../web-gateway/agents.js";
import type { BtwAskOutcome, BtwBranchOutcome, PromptImageInput } from "../contract/operations.js";
import { invalid, StudioOpError, unavailable } from "../errors.js";
import type { LocalResourceOperation, LocalResourceResultMap } from "../protocol/contracts/local-resources.js";
import type { ResourceOperation } from "../protocol/contracts/resources.js";
import type {
	AgentSpawnOptions,
	RuntimeViewOperation,
	RuntimeViewResultMap,
} from "../protocol/contracts/runtime-views.js";
import { validateRuntimeViewOperation } from "../protocol/contracts/runtime-views.js";
import type {
	SessionOptionsOperation,
	SessionOptionsResultMap,
	SessionWarmingState,
	StudioSpeed,
} from "../protocol/contracts/session-options.js";
import type { SessionTier } from "../protocol/contracts/session-gui.js";
import type { OperatorStateSnapshot } from "../protocol/contracts/state.js";
import type { StudioCommandHandlers, StudioFamily, StudioHostContext } from "../registry.js";
import { currentStudioSelection, selectStudioSession } from "../selection.js";
import { mainBtwRuntime, type StudioBtwBranchResult } from "../services/main-btw-runtime.js";
import { StudioResourceService } from "../services/resource-service.js";
import { runtimeUtilityForSession } from "../services/runtime-utility-service.js";
import { StudioSessionOptionsService, StudioSessionTierService } from "../services/session-options-service.js";
import { snapshotFor } from "./session.js";

const MAX_IDENTIFIER = 512;
const MAX_IMAGE_DATA_CHARS = 48 * 1024 * 1024;
const MAX_IMAGES = 16;
const MAX_LOCAL_TEXT_BYTES = 512 * 1024;
const SPEEDS: readonly StudioSpeed[] = ["normal", "fast", "ultrafast", "slow"];
const TIERS: readonly SessionTier[] = ["standard", "slow", "priority", "ultrafast"];
const WARMING_MODES: readonly SessionWarmingState["mode"][] = ["off", "streaming", "idle"];
const IMAGE_MIME_TYPES: Readonly<Record<PromptImageInput["mimeType"], true>> = {
	"image/png": true,
	"image/jpeg": true,
	"image/gif": true,
	"image/webp": true,
	"image/svg+xml": true,
};

type Row = Record<string, unknown>;

interface LiveSession {
	readonly session: AgentSession;
	readonly sessionId: string;
	assertSelectionCurrent(): void;
	assertCurrent(): void;
}

function exact(value: unknown, fields: readonly string[], label: string): Row {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`Invalid ${label} input`);
	const row = value as Row;
	if (Object.keys(row).some(key => !fields.includes(key))) throw invalid(`Unknown ${label} field`);
	return row;
}

function identifier(value: unknown, field: string, max = MAX_IDENTIFIER): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\0"))
		throw invalid(`Invalid ${field}`);
	return value;
}

function optionalIdentifier(value: unknown, field: string, max = MAX_IDENTIFIER): string | undefined {
	return value === undefined ? undefined : identifier(value, field, max);
}

function requiredText(value: unknown, field: string, max = 4096): string {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw invalid(`Invalid ${field}`);
	return value;
}

function choice<T extends string>(value: unknown, values: readonly T[], field: string): T {
	if (typeof value !== "string" || !values.includes(value as T)) throw invalid(`Invalid ${field}`);
	return value as T;
}

function boolean(value: unknown, field: string): boolean {
	if (typeof value !== "boolean") throw invalid(`Invalid ${field}`);
	return value;
}

function pageOffset(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000)
		throw invalid("Invalid resource page");
	return value;
}

function resourceVersion(value: unknown): string {
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw invalid("Invalid resource version");
	return value;
}

function imageInputs(value: unknown): ImageContent[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_IMAGES) throw invalid("Invalid BTW images");
	return value.map(entry => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalid("Invalid BTW image");
		const image = entry as Row;
		if (Object.keys(image).some(key => !["type", "mimeType", "data"].includes(key)))
			throw invalid("Unknown BTW image field");
		if (image.type !== "image" || !Object.hasOwn(IMAGE_MIME_TYPES, image.mimeType as string))
			throw invalid("Invalid BTW image type");
		if (
			typeof image.data !== "string" ||
			image.data.length === 0 ||
			image.data.length > MAX_IMAGE_DATA_CHARS ||
			image.data.includes("\0")
		)
			throw invalid("Invalid BTW image data");
		return {
			type: "image",
			mimeType: image.mimeType as PromptImageInput["mimeType"],
			data: image.data,
		};
	});
}

/** The explicit selected session; a sessionless command never falls back to the gateway's current one. */
function selectedSessionId(context: StudioHostContext): string {
	const selection = currentStudioSelection() ?? context.selection;
	if (!selection || selection.closed || selection.sessionId === undefined)
		throw unavailable("Choose an active conversation first");
	return selection.sessionId;
}

/**
 * Exact native resident behind the selected conversation. No attach, revive or
 * lazy session start happens here: a missing wrapper or disposed object is the
 * answer.
 */
function liveSession(sessionId: string, context: StudioHostContext): LiveSession {
	const selection = currentStudioSelection() ?? context.selection;
	if (!selection || selection.closed) throw unavailable("The conversation context is closed");
	if (selection.sessionId !== sessionId) throw unavailable("The operation belongs to another session");
	const owner = context.privateOwner;
	if (!owner || !owner.isLive() || owner.expiresAt <= Date.now())
		throw unavailable("The operation requires the same live authenticated conversation");
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
		throw unavailable("The session is not live; this operation does not start one");
	const selected = () =>
		!selection.closed &&
		selection.sessionId === sessionId &&
		owner.isLive() &&
		owner.expiresAt > Date.now() &&
		(currentStudioSelection() === undefined || currentStudioSelection() === selection);
	const valid = () =>
		selected() &&
		!session.isDisposed &&
		session.sessionId === sessionId &&
		getRpcSession(sessionId) === rpc &&
		rpc.isAlive() &&
		rpc.getSession() === session;
	if (!valid()) throw unavailable("The session changed while the operation was attaching");
	return {
		session,
		sessionId,
		assertSelectionCurrent() {
			if (!selected()) throw unavailable("The conversation selection changed during the operation");
		},
		assertCurrent() {
			if (!valid()) throw unavailable("The session changed during the operation");
		},
	};
}

function activeLiveSession(context: StudioHostContext): LiveSession {
	return liveSession(selectedSessionId(context), context);
}

function rethrowBtw(error: unknown): never {
	if (error instanceof StudioOpError) throw error;
	if (error instanceof Error && "code" in error) {
		const code = error.code;
		if (code === "INVALID_ARGUMENT") throw invalid(error.message);
		if (code === "COMMAND_BLOCKED" || code === "INTERACTION_STALE" || code === "BUSY_STREAMING")
			throw unavailable(error.message);
	}
	throw error;
}

async function snapshotEnvelope<T>(
	live: LiveSession,
	result: T,
): Promise<{ snapshot: OperatorStateSnapshot; result: T }> {
	live.assertCurrent();
	const snapshot = await snapshotFor(live.sessionId);
	live.assertCurrent();
	return { snapshot, result };
}

/** Run one read/mutation against the live session and attach its post-command snapshot. */
async function liveEnvelope<T>(
	sessionId: string,
	context: StudioHostContext,
	run: (session: AgentSession, assertCurrent: () => void) => T | Promise<T>,
): Promise<{ snapshot: OperatorStateSnapshot; result: T }> {
	const live = liveSession(sessionId, context);
	live.assertCurrent();
	const result = await run(live.session, live.assertCurrent);
	return snapshotEnvelope(live, result);
}

async function executeOptions<K extends SessionOptionsOperation["kind"]>(
	service: StudioSessionOptionsService,
	operation: Extract<SessionOptionsOperation, { kind: K }>,
): Promise<SessionOptionsResultMap[K]> {
	return (await service.execute(operation)) as SessionOptionsResultMap[K];
}

function sessionIdFrom(value: unknown, fields: readonly string[], label: string): string {
	const row = exact(value, fields, label);
	return identifier(row.sessionId, "sessionId");
}

function speedSet(value: unknown): Extract<SessionOptionsOperation, { kind: "session.speed.set" }> {
	const row = exact(value, ["sessionId", "expectedModel", "speed"], "speed set");
	return {
		kind: "session.speed.set",
		sessionId: identifier(row.sessionId, "sessionId"),
		expectedModel: requiredText(row.expectedModel, "expectedModel", 4096),
		speed: choice(row.speed, SPEEDS, "speed"),
	};
}

function warmingSet(value: unknown): Extract<SessionOptionsOperation, { kind: "session.warming.set" }> {
	const row = exact(value, ["sessionId", "mode", "persist"], "warming set");
	return {
		kind: "session.warming.set",
		sessionId: identifier(row.sessionId, "sessionId"),
		mode: choice(row.mode, WARMING_MODES, "warming mode"),
		persist: boolean(row.persist, "persist"),
	};
}

function budgetValue(value: unknown, field: string): number | null {
	if (value === null) return null;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
		throw invalid(`${field} must be a positive USD amount or null`);
	return value;
}

function budgetSet(value: unknown): Extract<SessionOptionsOperation, { kind: "session.budget.set" }> {
	const row = exact(value, ["sessionId", "warnCost", "maxCost", "scope"], "budget set");
	if (row.scope !== "session" && row.scope !== "global") throw invalid("Choose a session or user budget scope");
	return {
		kind: "session.budget.set",
		sessionId: identifier(row.sessionId, "sessionId"),
		warnCost: budgetValue(row.warnCost, "warnCost"),
		maxCost: budgetValue(row.maxCost, "maxCost"),
		scope: row.scope,
	};
}

function tierSet(value: unknown): { sessionId: string; selector: string; tier: SessionTier } {
	const row = exact(value, ["sessionId", "selector", "tier"], "tier set");
	return {
		sessionId: identifier(row.sessionId, "sessionId"),
		selector: requiredText(row.selector, "selector", MAX_IDENTIFIER),
		tier: choice(row.tier, TIERS, "tier"),
	};
}

function resourceRead(value: unknown): ResourceOperation {
	const row = exact(value, ["sessionId", "uri", "offset", "version"], "resource read");
	const uri = requiredText(row.uri, "uri", 4096);
	if (!/^(local|zeta|attachment|conflict):\/\//u.test(uri)) throw invalid("Invalid resource target");
	const offset = pageOffset(row.offset);
	const version = row.version === undefined ? undefined : resourceVersion(row.version);
	if (offset !== undefined && offset > 0 && version === undefined)
		throw invalid("Further pages require a resource version");
	return {
		kind: "resource.read",
		sessionId: identifier(row.sessionId, "sessionId"),
		uri,
		...(offset === undefined ? {} : { offset }),
		...(version === undefined ? {} : { version }),
	};
}

function localResource(value: unknown, kind: LocalResourceOperation["kind"]): LocalResourceOperation {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("Invalid local resource input");
	const row = value as Row;
	if (kind === "resource.local.list") {
		exact(row, ["sessionId"], "local resource list");
		return {
			kind,
			sessionId: identifier(row.sessionId, "sessionId"),
		};
	}
	if (kind === "resource.local.open") {
		exact(row, ["sessionId", "uri"], "local resource open");
		const uri = requiredText(row.uri, "uri", 4096);
		if (!uri.startsWith("local://")) throw invalid("Choose a session-local file");
		return { kind, sessionId: identifier(row.sessionId, "sessionId"), uri };
	}
	if (kind === "resource.local.save") {
		exact(row, ["sessionId", "uri", "version", "text"], "local resource save");
		const uri = requiredText(row.uri, "uri", 4096);
		if (!uri.startsWith("local://")) throw invalid("Choose a session-local file");
		const text = row.text;
		if (typeof text !== "string" || text.includes("\0") || Buffer.byteLength(text) > MAX_LOCAL_TEXT_BYTES)
			throw invalid("Local text exceeds editor limits");
		return {
			kind,
			sessionId: identifier(row.sessionId, "sessionId"),
			uri,
			version: resourceVersion(row.version),
			text,
		};
	}
	throw invalid("Unknown local resource operation");
}

function btwAsk(value: unknown): { question: string; images: ImageContent[] } {
	const row = exact(value, ["question", "images", "command"], "BTW ask");
	return {
		question: requiredText(row.question, "question", 65_536),
		images: imageInputs(row.images),
	};
}

function btwFollowUp(value: unknown): { topicId: string; question: string; images: ImageContent[] } {
	const row = exact(value, ["topicId", "question", "images"], "BTW follow-up");
	return {
		topicId: identifier(row.topicId, "topicId", 128),
		question: requiredText(row.question, "question", 65_536),
		images: imageInputs(row.images),
	};
}

function btwHistoryRead(value: unknown): string {
	return identifier(exact(value, ["topicId"], "BTW history read").topicId, "topicId", 128);
}

function btwInject(value: unknown): { sessionId: string; injectId: string } {
	const row = exact(value, ["sessionId", "injectId"], "BTW inject");
	return {
		sessionId: identifier(row.sessionId, "sessionId"),
		injectId: identifier(row.injectId, "injectId", 128),
	};
}

function spawnOptionsRead(value: unknown): { sessionId: string; definition: string } {
	const row = exact(value, ["sessionId", "definition"], "spawn options read");
	return {
		sessionId: identifier(row.sessionId, "sessionId"),
		definition: identifier(row.definition, "definition", 128),
	};
}

function shellOperation(value: unknown, kind: "shell.view.read" | "shell.view.release"): RuntimeViewOperation {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("Invalid Runtime view input");
	const candidate = { ...(value as Row), kind };
	validateRuntimeViewOperation(candidate);
	return candidate;
}

/**
 * Runtime-feature command implemented here but not yet listed by the central
 * `runtime-features.ts` contract. It is exported separately so Main can add
 * `btw.inject` to `RuntimeFeatureOperation` without this family claiming an
 * unknown command name.
 */
export interface SessionUtilityFeatureCommandHandlers {
	"btw.inject": (
		input: { sessionId: string; injectId: string },
		context: StudioHostContext,
	) => Promise<{ snapshot: OperatorStateSnapshot; result: { sent: true } }>;
	/**
	 * Capability alias for AgentHub's `agent.spawn.options` gate, which checks
	 * that id while calling the `.read` query. It returns the same native data;
	 * no renderer invokes it directly.
	 */
	"agent.spawn.options": (
		input: { sessionId: string; definition: string },
		context: StudioHostContext,
	) => Promise<{ snapshot: OperatorStateSnapshot; result: AgentSpawnOptions }>;
}

export const sessionUtilitiesFeatureCommands: SessionUtilityFeatureCommandHandlers = {
	"btw.inject": async (input, context) => {
		const operation = btwInject(input);
		const live = liveSession(operation.sessionId, context);
		live.assertCurrent();
		let result: { sent: true };
		try {
			result = await mainBtwRuntime(live.session).inject(operation.injectId, live.assertCurrent);
		} catch (error) {
			rethrowBtw(error);
		}
		return snapshotEnvelope(live, result);
	},
	"agent.spawn.options": async (input, context) => {
		const operation = spawnOptionsRead(input);
		const live = liveSession(operation.sessionId, context);
		live.assertCurrent();
		const result = await runtimeUtilityForSession(live.session).spawnOptions(operation.definition);
		return snapshotEnvelope(live, result);
	},
};

/** Command handlers, registered once the central contract owns every name above. */
export const sessionUtilitiesCommands: Partial<StudioCommandHandlers> = {
	"btw.ask": async (input, context): Promise<BtwAskOutcome> => {
		const operation = btwAsk(input);
		const live = activeLiveSession(context);
		live.assertCurrent();
		let result: { ephemeralId: string; branchToken: string; status: "running" };
		try {
			result = mainBtwRuntime(live.session).ask(operation.question, operation.images, live.assertCurrent);
		} catch (error) {
			rethrowBtw(error);
		}
		live.assertCurrent();
		const snapshot = await snapshotFor(live.sessionId);
		live.assertCurrent();
		return { snapshot, ...result };
	},
	"btw.abort": async (input, context): Promise<OperatorStateSnapshot> => {
		const ephemeralId = identifier(exact(input, ["ephemeralId"], "BTW abort").ephemeralId, "ephemeralId", 128);
		const live = activeLiveSession(context);
		live.assertCurrent();
		try {
			mainBtwRuntime(live.session).abort(ephemeralId);
		} catch (error) {
			rethrowBtw(error);
		}
		return snapshotFor(live.sessionId);
	},
	"btw.branch": async (input, context): Promise<BtwBranchOutcome> => {
		const branchToken = identifier(exact(input, ["branchToken"], "BTW branch").branchToken, "branchToken", 128);
		const live = activeLiveSession(context);
		live.assertCurrent();
		const wrapper = getRpcSession(live.sessionId);
		if (!wrapper || wrapper.getSession() !== live.session) throw unavailable("The BTW session changed");
		let outcome: StudioBtwBranchResult;
		try {
			outcome = await wrapper.branchSession(() =>
				mainBtwRuntime(live.session).branch(branchToken, live.assertCurrent),
			);
		} catch (error) {
			rethrowBtw(error);
		}
		if (!outcome.branched) {
			live.assertCurrent();
			return { snapshot: await snapshotFor(live.sessionId), branched: false, reason: outcome.reason };
		}
		live.assertSelectionCurrent();
		if (live.session.isDisposed || getRpcSession(outcome.newSessionId)?.getSession() !== live.session)
			throw unavailable("The session changed after branching");
		selectStudioSession(outcome.newSessionId);
		const branched = liveSession(outcome.newSessionId, context);
		branched.assertCurrent();
		const snapshot = await snapshotFor(outcome.newSessionId);
		branched.assertCurrent();
		return {
			snapshot,
			branched: true,
			newSessionId: outcome.newSessionId,
			...(outcome.newLeafId === null ? {} : { newLeafId: outcome.newLeafId }),
		};
	},
	"btw.history.list": async (_input, context) => {
		const live = activeLiveSession(context);
		live.assertCurrent();
		const result = await mainBtwRuntime(live.session).historyList();
		return snapshotEnvelope(live, result);
	},
	"btw.history.read": async (input, context) => {
		const topicId = btwHistoryRead(input);
		const live = activeLiveSession(context);
		live.assertCurrent();
		const result = await mainBtwRuntime(live.session).historyRead(topicId);
		return snapshotEnvelope(live, result);
	},
	"btw.followUp": async (input, context) => {
		const operation = btwFollowUp(input);
		const live = activeLiveSession(context);
		live.assertCurrent();
		let result: { ephemeralId: string; status: "running" };
		try {
			result = await mainBtwRuntime(live.session).followUp(
				operation.topicId,
				operation.question,
				operation.images,
				live.assertCurrent,
			);
		} catch (error) {
			rethrowBtw(error);
		}
		return snapshotEnvelope(live, result);
	},
	...sessionUtilitiesFeatureCommands,
	"session.speed.get": (input, context) => {
		const sessionId = sessionIdFrom(input, ["sessionId"], "speed get");
		return liveEnvelope(sessionId, context, session => new StudioSessionOptionsService(session).speed());
	},
	"session.speed.set": (input, context) => {
		const operation = speedSet(input);
		return liveEnvelope(operation.sessionId, context, session =>
			executeOptions(new StudioSessionOptionsService(session), operation),
		);
	},
	"session.warming.get": (input, context) => {
		const sessionId = sessionIdFrom(input, ["sessionId"], "warming get");
		return liveEnvelope(sessionId, context, session => new StudioSessionOptionsService(session).warming());
	},
	"session.warming.set": (input, context) => {
		const operation = warmingSet(input);
		return liveEnvelope(operation.sessionId, context, session =>
			executeOptions(new StudioSessionOptionsService(session), operation),
		);
	},
	"session.budget.get": (input, context) => {
		const sessionId = sessionIdFrom(input, ["sessionId"], "budget get");
		return liveEnvelope(sessionId, context, session => new StudioSessionOptionsService(session).budget());
	},
	"session.budget.set": (input, context) => {
		const operation = budgetSet(input);
		return liveEnvelope(operation.sessionId, context, session =>
			executeOptions(new StudioSessionOptionsService(session), operation),
		);
	},
	"session.budget.clearOverride": (input, context) => {
		const sessionId = sessionIdFrom(input, ["sessionId"], "budget clear");
		return liveEnvelope(sessionId, context, session =>
			executeOptions(new StudioSessionOptionsService(session), {
				kind: "session.budget.clearOverride",
				sessionId,
			}),
		);
	},
	"models.presets.list": (input, context) => {
		const sessionId = sessionIdFrom(input, ["sessionId"], "preset list");
		return liveEnvelope(sessionId, context, session =>
			executeOptions(new StudioSessionOptionsService(session), {
				kind: "models.presets.list",
				sessionId,
			}),
		);
	},
	"models.presets.save": (input, context) => {
		const row = exact(input, ["sessionId", "name"], "preset save");
		const sessionId = identifier(row.sessionId, "sessionId");
		const name = identifier(row.name, "preset name", 128);
		if (!/^[a-zA-Z][\w-]*$/u.test(name)) throw invalid("Invalid preset name");
		return liveEnvelope(sessionId, context, session =>
			executeOptions(new StudioSessionOptionsService(session), {
				kind: "models.presets.save",
				sessionId,
				name,
			}),
		);
	},
	"models.presets.apply": (input, context) => {
		const row = exact(input, ["sessionId", "name"], "preset apply");
		const sessionId = identifier(row.sessionId, "sessionId");
		const name = identifier(row.name, "preset name", 128);
		if (!/^[a-zA-Z][\w-]*$/u.test(name)) throw invalid("Invalid preset name");
		return liveEnvelope(sessionId, context, session =>
			executeOptions(new StudioSessionOptionsService(session), {
				kind: "models.presets.apply",
				sessionId,
				name,
			}),
		);
	},
	"models.presets.delete": (input, context) => {
		const row = exact(input, ["sessionId", "name"], "preset delete");
		const sessionId = identifier(row.sessionId, "sessionId");
		const name = identifier(row.name, "preset name", 128);
		if (!/^[a-zA-Z][\w-]*$/u.test(name)) throw invalid("Invalid preset name");
		return liveEnvelope(sessionId, context, session =>
			executeOptions(new StudioSessionOptionsService(session), {
				kind: "models.presets.delete",
				sessionId,
				name,
			}),
		);
	},
	"session.tier.get": (input, context) => {
		const sessionId = sessionIdFrom(input, ["sessionId"], "tier get");
		return liveEnvelope(sessionId, context, session => new StudioSessionTierService(session).tier());
	},
	"session.tier.set": (input, context) => {
		const operation = tierSet(input);
		return liveEnvelope(operation.sessionId, context, session =>
			new StudioSessionTierService(session).setTier(operation.selector, operation.tier),
		);
	},
	"session.skills.list": (input, context) => {
		const sessionId = sessionIdFrom(input, ["sessionId"], "skills list");
		return liveEnvelope(sessionId, context, session => new StudioSessionTierService(session).skills());
	},
	"resource.read": (input, context) => {
		const operation = resourceRead(input);
		return liveEnvelope(operation.sessionId, context, (session, assertCurrent) => {
			const service = new StudioResourceService(session, session.getEvalToolSession());
			return service.read(operation, assertCurrent);
		});
	},
	"resource.local.list": (input, context) => {
		const operation = localResource(input, "resource.local.list");
		return liveEnvelope(operation.sessionId, context, (session, assertCurrent) => {
			const service = new StudioResourceService(session, session.getEvalToolSession());
			return service.local(operation, assertCurrent) as Promise<LocalResourceResultMap["resource.local.list"]>;
		});
	},
	"resource.local.open": (input, context) => {
		const operation = localResource(input, "resource.local.open");
		return liveEnvelope(operation.sessionId, context, (session, assertCurrent) => {
			const service = new StudioResourceService(session, session.getEvalToolSession());
			return service.local(operation, assertCurrent) as Promise<LocalResourceResultMap["resource.local.open"]>;
		});
	},
	"resource.local.save": (input, context) => {
		const operation = localResource(input, "resource.local.save");
		return liveEnvelope(operation.sessionId, context, (session, assertCurrent) => {
			const service = new StudioResourceService(session, session.getEvalToolSession());
			return service.local(operation, assertCurrent) as Promise<LocalResourceResultMap["resource.local.save"]>;
		});
	},
};

export interface SessionUtilityQueryHandlers {
	"shell.view.read": (
		input: Omit<Extract<RuntimeViewOperation, { kind: "shell.view.read" }>, "kind">,
		context: StudioHostContext,
	) => Promise<RuntimeViewResultMap["shell.view.read"]>;
	"shell.view.release": (
		input: Omit<Extract<RuntimeViewOperation, { kind: "shell.view.release" }>, "kind">,
		context: StudioHostContext,
	) => Promise<RuntimeViewResultMap["shell.view.release"]>;
	"agent.spawn.options.read": (
		input: Omit<Extract<RuntimeViewOperation, { kind: "agent.spawn.options.read" }>, "kind">,
		context: StudioHostContext,
	) => Promise<RuntimeViewResultMap["agent.spawn.options.read"]>;
}

/** Queries; the central query map must add these two names before registration. */
export const sessionUtilitiesQueries: SessionUtilityQueryHandlers = {
	"shell.view.read": async (input, context) => {
		const operation = shellOperation(input, "shell.view.read");
		if (operation.kind !== "shell.view.read") throw invalid("Invalid shell view read");
		const live = liveSession(operation.sessionId, context);
		live.assertCurrent();
		return runtimeUtilityForSession(live.session).read(operation, live.assertCurrent);
	},
	"agent.spawn.options.read": async (input, context) => {
		const operation = spawnOptionsRead(input);
		const live = liveSession(operation.sessionId, context);
		live.assertCurrent();
		const result = await runtimeUtilityForSession(live.session).spawnOptions(operation.definition);
		live.assertCurrent();
		return result;
	},
	"shell.view.release": async (input, context) => {
		const operation = shellOperation(input, "shell.view.release");
		if (operation.kind !== "shell.view.release") throw invalid("Invalid shell view release");
		const live = liveSession(operation.sessionId, context);
		live.assertCurrent();
		return runtimeUtilityForSession(live.session).release(operation);
	},
};

/**
 * Runtime utilities family. `queries` is typed by the host adapter and becomes
 * a `StudioFamily` as soon as `QueryInputMap`/`QueryResultMap` list the two
 * shell-view names; `commands` is already complete.
 */
export const sessionUtilitiesOps: Pick<StudioFamily, "id" | "commands"> & {
	readonly queries: SessionUtilityQueryHandlers;
} = {
	id: "session-utilities",
	queries: sessionUtilitiesQueries,
	commands: sessionUtilitiesCommands,
};

/** Compile-time check that the command half is a valid family slice. */
export const sessionUtilitiesCommandFamily: Pick<StudioFamily, "id" | "commands"> = {
	id: "session-utilities",
	commands: sessionUtilitiesCommands,
};

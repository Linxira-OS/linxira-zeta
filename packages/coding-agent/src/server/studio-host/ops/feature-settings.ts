import type { CommandInput } from "../contract/index.js";
import { StudioOpError, invalid, unavailable } from "../errors.js";
import {
	FEATURE_SETTING_KEYS,
	type FeatureSettingKey,
	type FeatureSettingValue,
	type FeatureSettingsResultMap,
} from "../protocol/contracts/feature-settings.js";
import type { StudioFamily, StudioHostContext } from "../registry.js";
import { currentStudioSelection } from "../selection.js";
import {
	StudioFeatureSettingsService,
	type StudioFeaturePreferencesOperation,
} from "../services/feature-settings-service.js";
import type { AgentSession } from "../../../session/agent-session";
import { getRpcSession } from "../../web-gateway/agents.js";
import type { OperatorStateSnapshot } from "../protocol/index.js";
import { snapshotFor } from "./session.js";

const MAX_IDENTIFIER = 512;

/**
 * Official keys this Runtime cannot reach. `task.file` has no registered
 * setting in Runtime 18.20.0, so a write is refused explicitly instead of
 * fabricating a default; reads only list keys that resolve to a native handle.
 */
const UNAVAILABLE_FEATURE_SETTING_KEYS = ["task.file"] as const;

function exactFields(input: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw invalid("Expected a feature settings operation");
	const row = input as Record<string, unknown>;
	if (Object.keys(row).some(key => !fields.includes(key))) throw invalid("Unknown feature settings operation field");
	return row;
}

function requireText(value: unknown, max = 1024, empty = false): string {
	if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max || /[\u0000-\u001f]/u.test(value))
		throw invalid("Invalid feature settings text");
	return value;
}

function identifier(value: unknown, field: string): string {
	if (typeof value !== "string" || !value || value.length > MAX_IDENTIFIER || value.includes("\0"))
		throw invalid(`Invalid ${field}`);
	return value;
}

function settingKey(value: unknown): FeatureSettingKey {
	if (typeof value !== "string") throw invalid("Invalid feature setting key");
	if ((UNAVAILABLE_FEATURE_SETTING_KEYS as readonly string[]).includes(value))
		throw new StudioOpError("CAPABILITY_UNAVAILABLE", `${value} has no native handle in this Runtime`);
	if (!(FEATURE_SETTING_KEYS as readonly string[]).includes(value)) throw invalid("Unknown feature setting");
	return value as FeatureSettingKey;
}

function validateFeatureSettingValue(value: unknown, depth = 0): asserts value is FeatureSettingValue {
	if (depth > 4) throw invalid("Setting nesting exceeds limit");
	if (value === null || typeof value === "boolean") return;
	if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 100_000_000) return;
	if (typeof value === "string") {
		requireText(value, 4096, true);
		return;
	}
	if (Array.isArray(value)) {
		if (value.length > 256) throw invalid("Too many setting entries");
		for (const item of value) validateFeatureSettingValue(item, depth + 1);
		return;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value);
		if (entries.length > 256) throw invalid("Too many setting entries");
		for (const [key, item] of entries) {
			requireText(key);
			if (["__proto__", "constructor", "prototype"].includes(key)) throw invalid("Invalid setting key");
			validateFeatureSettingValue(item, depth + 1);
		}
		return;
	}
	throw invalid("Invalid setting value");
}

function featureGetInput(input: unknown): { sessionId: string } {
	const row = exactFields(input, ["sessionId"]);
	return { sessionId: identifier(row.sessionId, "settings session") };
}

function featureSetInput(input: unknown): {
	sessionId: string;
	key: FeatureSettingKey;
	value: FeatureSettingValue;
	scope: "session" | "global";
} {
	const row = exactFields(input, ["sessionId", "key", "value", "scope"]);
	const sessionId = identifier(row.sessionId, "settings session");
	const key = settingKey(row.key);
	if (row.scope !== "session" && row.scope !== "global") throw invalid("Invalid settings scope");
	validateFeatureSettingValue(row.value);
	if (JSON.stringify(row.value).length > 32768) throw invalid("Setting exceeds limit");
	return { sessionId, key, value: row.value, scope: row.scope };
}

function featureClearInput(input: unknown): { sessionId: string; key: FeatureSettingKey } {
	const row = exactFields(input, ["sessionId", "key"]);
	return {
		sessionId: identifier(row.sessionId, "settings session"),
		key: settingKey(row.key),
	};
}

function compactionInput(
	input: unknown,
	confirmable: boolean,
): {
	sessionId: string;
	selector: string;
	input: string;
	confirmed?: boolean;
} {
	const fields = confirmable ? ["sessionId", "selector", "input", "confirmed"] : ["sessionId", "selector", "input"];
	const row = exactFields(input, fields);
	const sessionId = identifier(row.sessionId, "settings session");
	const selector = requireText(row.selector);
	const text = requireText(row.input, 64, true);
	if (row.confirmed !== undefined && typeof row.confirmed !== "boolean") throw invalid("Invalid confirmation");
	return { sessionId, selector, input: text, ...(row.confirmed === undefined ? {} : { confirmed: row.confirmed }) };
}

interface LiveFeatureSettingsSession {
	readonly session: AgentSession;
	readonly sessionId: string;
	assertCurrent(): void;
}

/**
 * The caller's selected native session, without attaching or starting one.
 * Every read and write is fenced against both the authenticated owner socket
 * and the exact live native session after its awaited work.
 */
function liveFeatureSession(context: StudioHostContext, sessionId?: string): LiveFeatureSettingsSession {
	const owner = context.privateOwner;
	if (!owner || !owner.isLive() || owner.expiresAt <= Date.now())
		throw unavailable("Feature settings require a live authenticated conversation");
	const selection = currentStudioSelection();
	if (!selection || selection !== context.selection || selection.closed || !selection.sessionId)
		throw unavailable("Feature settings require a live authenticated conversation");
	if (sessionId !== undefined && sessionId !== selection.sessionId)
		throw unavailable("The settings target session changed");
	const id = selection.sessionId;
	const session = getRpcSession(id)?.getSession();
	if (!session || session.isDisposed || session.sessionId !== id)
		throw unavailable("The settings session is not resident in this conversation");
	const assertCurrent = () => {
		if (
			!owner.isLive() ||
			owner.expiresAt <= Date.now() ||
			selection.closed ||
			selection.sessionId !== id ||
			session.isDisposed ||
			session.sessionId !== id ||
			getRpcSession(id)?.getSession() !== session
		)
			throw unavailable("The settings session changed");
	};
	return { session, sessionId: id, assertCurrent };
}

async function executeFeatureOperation<K extends StudioFeaturePreferencesOperation["kind"]>(
	operation: Extract<StudioFeaturePreferencesOperation, { kind: K }>,
	context: StudioHostContext,
): Promise<{ snapshot: OperatorStateSnapshot; result: FeatureSettingsResultMap[K] }> {
	const live = liveFeatureSession(context, operation.sessionId);
	live.assertCurrent();
	const result = await new StudioFeatureSettingsService(live.session).execute(operation);
	live.assertCurrent();
	const snapshot = await snapshotFor(live.sessionId);
	live.assertCurrent();
	return { snapshot, result };
}

export const featureSettingsOps: StudioFamily = {
	id: "preferences",
	commands: {
		"preferences.features.get": async (
			input: CommandInput<"preferences.features.get">,
			context: StudioHostContext,
		) => {
			const parsed = featureGetInput(input);
			return executeFeatureOperation({ ...parsed, kind: "preferences.features.get" }, context);
		},
		"preferences.features.set": async (
			input: CommandInput<"preferences.features.set">,
			context: StudioHostContext,
		) => {
			const parsed = featureSetInput(input);
			return executeFeatureOperation({ ...parsed, kind: "preferences.features.set" }, context);
		},
		"preferences.features.clearOverride": async (
			input: CommandInput<"preferences.features.clearOverride">,
			context: StudioHostContext,
		) => {
			const parsed = featureClearInput(input);
			return executeFeatureOperation({ ...parsed, kind: "preferences.features.clearOverride" }, context);
		},
		"models.compaction.preview": async (
			input: CommandInput<"models.compaction.preview">,
			context: StudioHostContext,
		) => {
			const parsed = compactionInput(input, false);
			return executeFeatureOperation({ ...parsed, kind: "models.compaction.preview" }, context);
		},
		"models.compaction.set": async (input: CommandInput<"models.compaction.set">, context: StudioHostContext) => {
			const parsed = compactionInput(input, true);
			return executeFeatureOperation({ ...parsed, kind: "models.compaction.set" }, context);
		},
	},
};

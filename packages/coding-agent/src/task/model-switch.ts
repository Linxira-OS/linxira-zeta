/**
 * Agent-driven model switching: a subagent's model is its own — chosen by its
 * agent definition or inherited from the parent — and a wake may switch it once
 * it has completed a model response.
 *
 * The config side (`retry.fallbackChains`, `retry.usageAwareFallback`) is a
 * *static* safety net: it picks the next model from a list the user wrote in
 * advance. That net is only as good as the configuration, and it silently
 * degrades to same-model retries when every configured provider is down or
 * exhausted. This module serves the other half of the split: giving the parent
 * agent the evidence and the lever to re-plan on a different model itself —
 *
 * - {@link classifySubagentFailure} labels a settled failure with a coarse,
 *   machine-readable class so the parent can tell "swap the model" from
 *   "fix the task" without parsing provider prose.
 * - {@link collectModelSwitchCandidates} lists models the *configured* session
 *   could actually run instead, so a re-dispatch does not depend on the parent
 *   guessing a valid selector.
 * - {@link ModelFailureLedger} keeps a session-scoped record of models that
 *   failed hard (usage-limit / auth / account policy) and enforces the
 *   guardrail: the harness never re-hits one of those on its own, and an
 *   explicit re-hit inside the cooldown window is refused with the remaining
 *   candidates instead of burning another round of requests. Entries clear as
 *   soon as the model is observed serving again and expire when the provider's
 *   own reset hint elapses, so a recovered model is not blocked for the rest of
 *   the session.
 *
 * Nothing here selects a model on its own initiative: candidates are advisory
 * and the ledger only refuses and records. There is deliberately no automatic
 * hopping between models — nothing switches a route on its own initiative
 * (see docs/settings.md).
 */
import type { Api, Model } from "@linxiraos/pi-ai";
import * as AIError from "@linxiraos/pi-ai/error";
import { modelsAreEqual } from "@linxiraos/pi-catalog/models";
import type { ConfiguredThinkingLevel } from "@linxiraos/pi-tui/thinking";
import { extractRetryHint } from "@linxiraos/pi-utils/fetch-retry";
import { formatModelRoleAlias } from "../config/model-roles";
import { cfgDisabledProviders } from "../config/model-settings";
import type { ModelRegistry } from "../config/model-registry";
import {
	formatModelStringWithRouting,
	resolveConfiguredModelPatterns,
	resolveModelOverride,
} from "../config/model-resolver";
import type { Settings } from "../config/settings";
import { cfgRetryFallbackChains } from "../session/settings";
import type { AgentSession } from "../session/agent-session";

/** Coarse failure category a parent agent can plan a model switch from. */
export type SubagentFailureClass =
	/** Account quota/usage exhaustion — the canonical "another model would work" failure. */
	| "usage-limit"
	/** Credential rejection for this provider/model (401/403, dead OAuth grant, missing key). */
	| "auth"
	/** Account-scoped provider policy denial that may succeed on another credential or model. */
	| "account-policy"
	/** Context/payload too large for this model — compact or shrink, not switch. */
	| "context-overflow"
	/** Transport/5xx/overload/timeout — retrying elsewhere often works. */
	| "transient"
	/** Cancelled (parent abort, user interrupt) — not a model fault. */
	| "aborted"
	/** No classifier matched. */
	| "unknown";

/**
 * Classes that mean "this route is out of service", not "this request was
 * malformed". Only these pin a model in the ledger; a transient blip must never
 * take a model out of circulation.
 */
const HARD_FAILURE_CLASSES: Readonly<Partial<Record<SubagentFailureClass, true>>> = {
	"usage-limit": true,
	auth: true,
	"account-policy": true,
};

/** Whether `failureClass` marks the model itself as unusable for now. */
export function isHardFailureClass(failureClass: SubagentFailureClass): boolean {
	return HARD_FAILURE_CLASSES[failureClass] === true;
}

/** Failure evidence a settled run leaves behind, in the order the classifier prefers it. */
export interface SubagentFailureEvidence {
	/** Raw provider/stream error text; classification falls back to its patterns. */
	message?: string;
	/** Classified error id already carried by the assistant message, when available. */
	errorId?: number;
	/** Provider API dialect, which changes how error text is read. */
	api?: Api;
}

/**
 * Classify a settled failure into one {@link SubagentFailureClass}. Uses the
 * provider error classifier (`AIError.classify`) so this agrees with the retry
 * pipeline's own reading of the same error instead of a second set of regexes.
 */
export function classifySubagentFailure(evidence: SubagentFailureEvidence | undefined): SubagentFailureClass {
	const message = evidence?.message?.trim();
	const errorId = evidence?.errorId;
	if (!message && errorId === undefined) return "unknown";
	let id = 0;
	try {
		id = AIError.classify(
			{ ...(errorId !== undefined ? { errorId } : {}), ...(message ? { message } : {}) },
			evidence?.api,
		);
	} catch {
		// Classification is best-effort diagnostics: an exotic error object must
		// never take down the run that is already reporting a failure.
		return "unknown";
	}
	const is = (flag: number) => AIError.is(id, flag as never);
	if (is(AIError.Flag.Abort) || is(AIError.Flag.UserInterrupt) || is(AIError.Flag.SilentAbort)) return "aborted";
	if (is(AIError.Flag.UsageLimit)) return "usage-limit";
	if (is(AIError.Flag.AuthFailed) || is(AIError.Flag.OAuthExpiry)) return "auth";
	if (is(AIError.Flag.AccountPolicy)) return "account-policy";
	if (is(AIError.Flag.ContextOverflow) || is(AIError.Flag.PayloadRejected)) return "context-overflow";
	if (is(AIError.Flag.Transient) || is(AIError.Flag.Timeout)) return "transient";
	return "unknown";
}

/**
 * Default re-hit cooldown for a hard failure whose error text carries no reset
 * hint. Providers block a route for 60s (post-401) to 5 minutes (usage probe)
 * before it is worth trying again; waiting the longer of those avoids spending
 * a request to learn the same thing.
 */
const DEFAULT_HARD_FAILURE_COOLDOWN_MS = 5 * 60_000;

/** Upper bound on a hint-derived cooldown, so a bogus far-future reset cannot pin a model for days. */
const MAX_HARD_FAILURE_COOLDOWN_MS = 24 * 60 * 60_000;

/** One recorded hard failure. */
export interface ExhaustedModelRecord {
	/** Normalized `<provider>/<id>` selector (thinking suffix stripped). */
	selector: string;
	failureClass: SubagentFailureClass;
	/** Agent whose run reported the failure. */
	agent?: string;
	observedAt: number;
	/** Earliest time this model may be attempted again. */
	cooldownUntilMs: number;
}

/** One applied agent-driven model switch, for the audit trail. */
export interface ModelSwitchRecord {
	source: "spawn-param" | "wake-param";
	/** Model the session would have used without the override, when it was resolvable. */
	from?: string;
	/** Model actually selected. */
	to: string;
	agent?: string;
	at: number;
}

/**
 * Strip a thinking-level suffix from a model selector so the same route is
 * recognized across levels. Only a trailing `:<word>` is removed; provider
 * ids may legitimately contain a colon (`openrouter/anthropic/claude-3:beta`,
 * `ollama/http://host:11434/llama`), and a port or url fragment is neither a
 * thinking level nor a route distinction the ledger should collapse.
 */
export function normalizeModelSelector(selector: string): string {
	const trimmed = selector.trim();
	const colon = trimmed.lastIndexOf(":");
	if (colon <= trimmed.indexOf("/") || colon === trimmed.length - 1) return trimmed.toLowerCase();
	const suffix = trimmed.slice(colon + 1);
	if (THINKING_SUFFIX_TOKENS[suffix.toLowerCase()] !== true) return trimmed.toLowerCase();
	return trimmed.slice(0, colon).toLowerCase();
}

const THINKING_SUFFIX_TOKENS: Record<string, true> = {
	off: true,
	minimal: true,
	low: true,
	medium: true,
	high: true,
	xhigh: true,
	max: true,
	auto: true,
};

/**
 * Session-scoped record of models that failed hard, plus the switch audit trail.
 *
 * The ledger is deliberately small and in-memory: it exists to stop one session
 * from re-hitting a route it just watched fail, not to persist provider health.
 */
export class ModelFailureLedger {
	readonly #now: () => number;
	readonly #exhausted = new Map<string, ExhaustedModelRecord>();
	readonly #switches: ModelSwitchRecord[] = [];

	constructor(options?: { now?: () => number }) {
		this.#now = options?.now ?? Date.now;
	}

	/** Record a settled failure. Non-hard classes are ignored (they are not a model fault). */
	noteFailure(record: {
		selector: string;
		failureClass: SubagentFailureClass;
		agent?: string;
		/** Error text used to derive the cooldown from the provider's own reset hint. */
		message?: string;
	}): ExhaustedModelRecord | undefined {
		if (!isHardFailureClass(record.failureClass)) return undefined;
		const selector = normalizeModelSelector(record.selector);
		if (!selector) return undefined;
		const observedAt = this.#now();
		const hintMs = record.message ? extractRetryHint(null, record.message) : undefined;
		const cooldownMs = Math.min(
			Math.max(DEFAULT_HARD_FAILURE_COOLDOWN_MS, hintMs ?? 0),
			MAX_HARD_FAILURE_COOLDOWN_MS,
		);
		const entry: ExhaustedModelRecord = {
			selector,
			failureClass: record.failureClass,
			...(record.agent ? { agent: record.agent } : {}),
			observedAt,
			cooldownUntilMs: observedAt + cooldownMs,
		};
		this.#exhausted.set(selector, entry);
		return entry;
	}

	/** A successful run on a selector clears its record — the model is serving again. */
	noteServed(selector: string | undefined): void {
		if (!selector) return;
		this.#exhausted.delete(normalizeModelSelector(selector));
	}

	/** The live record for a selector, or undefined when it is free to use. */
	exhaustedRecord(selector: string | undefined, now = this.#now()): ExhaustedModelRecord | undefined {
		if (!selector) return undefined;
		const entry = this.#exhausted.get(normalizeModelSelector(selector));
		if (!entry) return undefined;
		if (entry.cooldownUntilMs <= now) {
			this.#exhausted.delete(entry.selector);
			return undefined;
		}
		return entry;
	}

	/** Every unexpired record (expired ones are pruned). */
	exhausted(now = this.#now()): ExhaustedModelRecord[] {
		for (const selector of this.#exhausted.keys()) this.exhaustedRecord(selector, now);
		return [...this.#exhausted.values()];
	}

	/** Record an applied switch for audit. */
	noteSwitch(record: Omit<ModelSwitchRecord, "at">): ModelSwitchRecord {
		const entry: ModelSwitchRecord = { ...record, at: this.#now() };
		this.#switches.push(entry);
		return entry;
	}

	/** Applied switches so far. */
	get switches(): readonly ModelSwitchRecord[] {
		return this.#switches;
	}

	clear(): void {
		this.#exhausted.clear();
		this.#switches.length = 0;
	}
}

/** Cap on retained per-session ledgers; the oldest session is dropped first. */
const LEDGER_LIMIT = 64;
const ledgers = new Map<string, ModelFailureLedger>();
/** Ledger for callers with no session identity (ephemeral/eval sessions). */
const SESSIONLESS_LEDGER_KEY = "\u0000sessionless";

/** Test seam: the sessionless ledger survives between tests otherwise. */
export function resetModelFailureLedgers(): void {
	ledgers.clear();
}

/**
 * The shared ledger for one owning session, keyed by its session file so every
 * spawn driven by that session sees the same exhausted-model set. Accepts a
 * session file path directly (an `AgentSession` reaches its own through
 * `sessionManager`) or any object exposing `getSessionFile` (`ToolSession`).
 */
export function modelFailureLedgerForSession(
	session: string | null | undefined | { getSessionFile?: () => string | null | undefined },
): ModelFailureLedger {
	const sessionFile = typeof session === "string" ? session : session?.getSessionFile?.();
	const key = sessionFile?.trim() || SESSIONLESS_LEDGER_KEY;
	const existing = ledgers.get(key);
	if (existing) return existing;
	const ledger = new ModelFailureLedger();
	ledgers.set(key, ledger);
	if (ledgers.size > LEDGER_LIMIT) {
		const oldest = ledgers.keys().next().value;
		if (oldest !== undefined && oldest !== key) ledgers.delete(oldest);
	}
	return ledger;
}

/** One alternative model a parent agent could re-dispatch onto. */
export interface ModelSwitchCandidate {
	/** Selector to pass as the task `model` parameter: `provider/id`, `@role`, or `provider/*`. */
	selector: string;
	/** How the candidate was discovered, for the model-facing note. */
	source: "agent-pattern" | "fallback-chain" | "model-role" | "available";
}

/** Cap on candidates reported to the parent; more than a handful is noise. */
const MAX_SWITCH_CANDIDATES = 8;

/**
 * Models the configured session could run *instead* of the one that failed.
 *
 * Sources, in order: the agent's own remaining model patterns, the fallback
 * chain that applies to the failed run's role, the configured model roles
 * (reported as `@role`, which the task `model` parameter accepts and expands),
 * and finally any other authenticated model in the catalog. The last one
 * matters most for the case that motivated this feature: a session with no
 * roles or chains configured had nothing to offer a parent that must re-plan.
 * Provider wildcards from a chain are kept verbatim — they resolve against the
 * failing model at runtime and cannot be expanded here.
 */
export function collectModelSwitchCandidates(options: {
	settings: Settings;
	modelRegistry: ModelRegistry;
	/** The model that failed, as `<provider>/<id>[:level]`. */
	failedSelector?: string;
	/** Patterns the failed run resolved from, in priority order. */
	patterns?: readonly string[];
	/** Role the failed run's patterns came from (`@task` -> `task`), when known. */
	role?: string;
	/** The session ledger; exhausted candidates are never offered. */
	ledger?: ModelFailureLedger;
}): ModelSwitchCandidate[] {
	const { settings, modelRegistry, ledger } = options;
	const failed = options.failedSelector ? normalizeModelSelector(options.failedSelector) : undefined;
	const disabledProviders = new Set(cfgDisabledProviders.get(settings));
	const candidates: ModelSwitchCandidate[] = [];
	const seen = new Set<string>();

	const push = (selector: string, source: ModelSwitchCandidate["source"]) => {
		const trimmed = selector.trim();
		if (!trimmed || seen.has(trimmed)) return;
		const normalized = normalizeModelSelector(trimmed);
		if (failed !== undefined && normalized === failed) return;
		if (ledger?.exhaustedRecord(normalized)) return;
		seen.add(trimmed);
		candidates.push({ selector: trimmed, source });
	};

	for (const pattern of options.patterns ?? []) {
		const resolved = resolveModelOverride([pattern], modelRegistry, settings);
		if (!resolved.model || disabledProviders.has(resolved.model.provider)) continue;
		if (!modelRegistry.hasConfiguredAuth(resolved.model)) continue;
		push(formatModelStringWithRouting(resolved.model), "agent-pattern");
	}

	const chains = cfgRetryFallbackChains.get(settings);
	const chainEntries = (options.role !== undefined ? chains?.[options.role] : undefined) ?? chains?.default;
	if (Array.isArray(chainEntries)) {
		for (const entry of chainEntries) {
			if (typeof entry !== "string") continue;
			if (entry.endsWith("/*")) {
				push(entry, "fallback-chain");
				continue;
			}
			const resolved = resolveModelOverride([entry], modelRegistry, settings);
			if (!resolved.model || disabledProviders.has(resolved.model.provider)) continue;
			if (!modelRegistry.hasConfiguredAuth(resolved.model)) continue;
			push(formatModelStringWithRouting(resolved.model), "fallback-chain");
		}
	}

	for (const role of Object.keys(settings.getModelRoles())) {
		const alias = formatModelRoleAlias(role);
		const resolved = resolveModelOverride(resolveConfiguredModelPatterns(alias, settings), modelRegistry, settings);
		if (!resolved.model || disabledProviders.has(resolved.model.provider)) continue;
		if (!modelRegistry.hasConfiguredAuth(resolved.model)) continue;
		push(alias, "model-role");
	}

	for (const model of modelRegistry.getAvailable()) {
		if (disabledProviders.has(model.provider)) continue;
		if (!modelRegistry.hasConfiguredAuth(model)) continue;
		push(formatModelStringWithRouting(model), "available");
	}

	return candidates.slice(0, MAX_SWITCH_CANDIDATES);
}

/**
 * Resolve a caller-supplied `model` override (`provider/id`, `provider/id:level`,
 * or `@role`) against the session's configuration and catalog.
 */
export function resolveSubagentModelOverride(
	override: string,
	session: Pick<AgentSession, "settings" | "modelRegistry">,
): {
	model?: Model<Api>;
	thinkingLevel?: ConfiguredThinkingLevel;
	explicitThinkingLevel?: boolean;
	problem?: string;
} {
	const patterns = resolveConfiguredModelPatterns(override, session.settings);
	if (patterns.length === 0) {
		return { problem: `\`${override}\` is not a model selector or a known model role alias.` };
	}
	const resolved = resolveModelOverride(patterns, session.modelRegistry, session.settings);
	if (!resolved.model) {
		const warning = resolved.warning ? ` ${resolved.warning}` : "";
		return { problem: `No model matches \`${override}\` in this session.${warning}` };
	}
	if (!session.modelRegistry.hasConfiguredAuth(resolved.model)) {
		return { problem: `No credential is configured for ${resolved.model.provider}/${resolved.model.id}.` };
	}
	return {
		model: resolved.model,
		thinkingLevel: resolved.thinkingLevel,
		explicitThinkingLevel: resolved.explicitThinkingLevel,
	};
}

/**
 * Message for a refused re-hit on a model the session already watched fail
 * hard. Names the class, when it becomes attemptable again, and what to use
 * instead — a refusal the caller cannot act on is just an obstacle.
 */
export function formatExhaustedModelRefusal(record: ExhaustedModelRecord, candidates: readonly string[]): string {
	const seconds = Math.max(1, Math.ceil((record.cooldownUntilMs - Date.now()) / 1000));
	const primary = candidates.length > 0 ? `Use ${candidates.map(c => `\`${c}\``).join(", ")} instead, or ` : "";
	return (
		`Model \`${record.selector}\` is in cooldown after a ${record.failureClass} failure` +
		`${record.agent ? ` on agent "${record.agent}"` : ""} (${seconds}s left). ${primary}retry the same model after the cooldown expires.`
	);
}

/**
 * Whether this subagent has completed at least one model response. Its model is
 * fixed until then: there is nothing to switch before the first response, and
 * the session's own transcript is the record of that — it survives parking and
 * revival, so the capability is per-subagent and passive rather than a global
 * setting.
 */
export function hasCompletedModelResponse(session: AgentSession): boolean {
	return session.messages.some(message => message.role === "assistant");
}

/**
 * Validate an explicit model selector before the switch lands: the subagent must
 * already have completed a model response, the selector must resolve against
 * this session's catalog, a credential must be configured for it, and it must
 * not be inside a hard-failure cooldown.
 *
 * Throws rather than returning a flag because every caller treats a bad
 * selector the same way — refuse the switch — and silently running on a model
 * nobody asked for is the failure mode this whole feature exists to avoid.
 */
export function assertModelOverrideUsable(
	scope: {
		session: AgentSession;
		modelRegistry?: ModelRegistry;
		/** Ledger of the session being woken. */
		ledger: ModelFailureLedger;
	},
	selector: string,
): void {
	if (!hasCompletedModelResponse(scope.session)) {
		throw new Error(
			"Model override rejected: this subagent has not completed a model response yet. Its model becomes switchable once its first response lands.",
		);
	}
	const registry = scope.modelRegistry;
	if (!registry) {
		throw new Error("Model override rejected: this session has no model registry to resolve it against.");
	}
	const resolved = resolveSubagentModelOverride(selector, {
		settings: scope.session.settings,
		modelRegistry: registry,
	});
	if (resolved.problem) throw new Error(`Model override rejected: ${resolved.problem}`);
	const ledger = scope.ledger;
	const exhausted =
		ledger.exhaustedRecord(selector) ??
		(resolved.model ? ledger.exhaustedRecord(`${resolved.model.provider}/${resolved.model.id}`) : undefined);
	if (!exhausted) return;
	throw new Error(
		formatExhaustedModelRefusal(
			exhausted,
			collectModelSwitchCandidates({
				settings: scope.session.settings,
				modelRegistry: registry,
				failedSelector: exhausted.selector,
				ledger,
			}).map(candidate => candidate.selector),
		),
	);
}

/**
 * Apply a caller-supplied `model` to an agent session — the wake half of the
 * agent-driven switch, used by `ensureLive`/follow-up turns.
 *
 * Refuses (throws) when the selector does not resolve, when the target has no
 * configured credential, or when the target is inside its hard-failure
 * cooldown: a wake that names a route the session just watched fail is exactly
 * the automatic re-hit the ledger exists to stop, and the caller gets the
 * class, the remaining cooldown, and the alternatives instead of a silent
 * repeat. A wake that names the model the session is already on is a no-op —
 * no provider restart and no redundant transcript entry.
 */
export async function applySubagentModelOverride(
	session: AgentSession,
	override: string,
	options?: {
		source?: ModelSwitchRecord["source"];
		agent?: string;
		ledger?: ModelFailureLedger;
	},
): Promise<ModelSwitchRecord> {
	const selector = override.trim();
	const ledger = options?.ledger ?? new ModelFailureLedger();
	assertModelOverrideUsable({ session, modelRegistry: session.modelRegistry, ledger }, selector);
	const resolved = resolveSubagentModelOverride(selector, session);
	if (!resolved.model) throw new Error(`Model override rejected: \`${selector}\` could not be resolved.`);
	const target = resolved.model;
	const to = formatModelStringWithRouting(target);
	const from = session.model ? formatModelStringWithRouting(session.model) : undefined;
	const record: ModelSwitchRecord = {
		source: options?.source ?? "wake-param",
		...(from !== undefined ? { from } : {}),
		to,
		...(options?.agent !== undefined ? { agent: options.agent } : {}),
		at: Date.now(),
	};
	if (session.model && modelsAreEqual(session.model, target)) {
		ledger.noteSwitch(record);
		return record;
	}
	// `setModelTemporary` is the same seam the UI's `/model` uses: it appends a
	// durable `model_change` transcript record and emits `model_changed`, which
	// is the audit trail for an agent-driven switch.
	await session.setModelTemporary(target, resolved.thinkingLevel);
	ledger.noteSwitch(record);
	session.emitNotice(
		"info",
		`Model switched to ${to}${options?.agent ? ` for agent "${options.agent}"` : ""}` +
			`${from ? ` (was ${from})` : ""} by ${record.source === "spawn-param" ? "task spawn" : "wake"} request.`,
		"model-switch",
	);
	return record;
}

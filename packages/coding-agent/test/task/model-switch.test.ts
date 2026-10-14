/**
 * Unit coverage for the agent-driven model switch primitives: failure
 * classification, the session-scoped exhausted-model ledger, the candidate
 * list, and the wake-side override applier.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { Api, Model } from "@linxiraos/pi-ai";
import * as AIError from "@linxiraos/pi-ai/error";
import type { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import {
	applySubagentModelOverride,
	classifySubagentFailure,
	collectModelSwitchCandidates,
	formatExhaustedModelRefusal,
	ModelFailureLedger,
	modelFailureLedgerForSession,
	normalizeModelSelector,
	resetModelFailureLedgers,
} from "@linxiraos/zeta/task/model-switch";
import { getTestModel } from "../helpers/model-fixtures";

const PRIMARY = getTestModel("openai") as Model<Api>;
const SECONDARY = getTestModel("anthropic") as Model<Api>;
const PRIMARY_SELECTOR = `${PRIMARY.provider}/${PRIMARY.id}`;
const SECONDARY_SELECTOR = `${SECONDARY.provider}/${SECONDARY.id}`;

function registry(models: readonly Model<Api>[] = [PRIMARY, SECONDARY]): ModelRegistry {
	return {
		getAvailable: () => [...models],
		hasConfiguredAuth: (model: Model<Api>) =>
			models.some(entry => entry.provider === model.provider && entry.id === model.id),
	} as unknown as ModelRegistry;
}

interface SessionStubOptions {
	settings?: Settings;
	models?: readonly Model<Api>[];
	current?: Model<Api>;
	sessionFile?: string | null;
}

interface SessionStub {
	session: AgentSession;
	/** Models passed to `setModelTemporary`, in order. */
	setModelCalls: Model<Api>[];
	/** Messages passed to `emitNotice`, in order. */
	notices: string[];
}

function sessionStub(options: SessionStubOptions = {}): SessionStub {
	const settings = options.settings ?? Settings.isolated({ "task.enableModelParam": true });
	const modelRegistry = registry(options.models);
	const setModelCalls: Model<Api>[] = [];
	const notices: string[] = [];
	const session = {
		settings,
		modelRegistry,
		model: options.current ?? PRIMARY,
		setModelTemporary: async (model: Model<Api>) => {
			setModelCalls.push(model);
		},
		emitNotice: (_level: string, message: string) => {
			notices.push(message);
		},
		sessionManager: { getSessionFile: () => options.sessionFile ?? null },
	} as unknown as AgentSession;
	return { session, setModelCalls, notices };
}

afterEach(() => {
	resetModelFailureLedgers();
});

describe("classifySubagentFailure", () => {
	it("maps a quota exhaustion to usage-limit", () => {
		expect(
			classifySubagentFailure({
				message: "Usage limit reached for this account. Your limit will reset at 2026-10-15 09:00:00",
			}),
		).toBe("usage-limit");
	});

	it("maps a credential rejection to auth", () => {
		expect(classifySubagentFailure({ message: "401 Unauthorized: invalid api key provided" })).toBe("auth");
	});

	it("maps an abort-flavored error id to aborted", () => {
		expect(classifySubagentFailure({ errorId: AIError.create(AIError.Flag.Abort) })).toBe("aborted");
		expect(classifySubagentFailure({ errorId: AIError.create(AIError.Flag.UserInterrupt) })).toBe("aborted");
	});

	it("reports unknown for text no classifier claims, and for absent evidence", () => {
		expect(classifySubagentFailure({ message: "Subagent failed" })).toBe("unknown");
		expect(classifySubagentFailure(undefined)).toBe("unknown");
	});
});

describe("ModelFailureLedger", () => {
	it("pins only hard failure classes, with a default cooldown", () => {
		let now = 1_000_000;
		const ledger = new ModelFailureLedger({ now: () => now });
		expect(ledger.noteFailure({ selector: PRIMARY_SELECTOR, failureClass: "transient" })).toBeUndefined();
		expect(ledger.exhaustedRecord(PRIMARY_SELECTOR)).toBeUndefined();

		const recorded = ledger.noteFailure({ selector: PRIMARY_SELECTOR, failureClass: "usage-limit" });
		expect(recorded?.failureClass).toBe("usage-limit");
		expect(ledger.exhaustedRecord(PRIMARY_SELECTOR)?.selector).toBe(PRIMARY_SELECTOR);

		now += 5 * 60_000 - 1;
		expect(ledger.exhaustedRecord(PRIMARY_SELECTOR)).toBeDefined();
		now += 2;
		expect(ledger.exhaustedRecord(PRIMARY_SELECTOR)).toBeUndefined();
	});

	it("honors a provider reset hint longer than the default cooldown", () => {
		const ledger = new ModelFailureLedger({ now: () => 1_000 });
		const recorded = ledger.noteFailure({
			selector: PRIMARY_SELECTOR,
			failureClass: "usage-limit",
			message: "Usage limit reached. Please try again in 40 min.",
		});
		expect(recorded!.cooldownUntilMs - recorded!.observedAt).toBeGreaterThanOrEqual(40 * 60_000);
	});

	it("clears a selector once a run on it succeeds", () => {
		const ledger = new ModelFailureLedger();
		ledger.noteFailure({ selector: PRIMARY_SELECTOR, failureClass: "auth" });
		ledger.noteServed(`${PRIMARY_SELECTOR}:high`);
		expect(ledger.exhaustedRecord(PRIMARY_SELECTOR)).toBeUndefined();
	});

	it("keys ledgers by session file so sibling spawns share one set", () => {
		const first = modelFailureLedgerForSession({ getSessionFile: () => "/tmp/parent.jsonl" });
		const second = modelFailureLedgerForSession({ getSessionFile: () => "/tmp/parent.jsonl" });
		expect(first).toBe(second);
		expect(modelFailureLedgerForSession("/tmp/parent.jsonl")).toBe(first);
		expect(modelFailureLedgerForSession({ getSessionFile: () => "/tmp/other.jsonl" })).not.toBe(first);
	});
});

describe("normalizeModelSelector", () => {
	it("strips a thinking suffix but keeps provider ids that contain colons", () => {
		expect(normalizeModelSelector("anthropic/claude-sonnet-4-5:high")).toBe("anthropic/claude-sonnet-4-5");
		expect(normalizeModelSelector("ollama/http://host:11434/llama")).toBe("ollama/http://host:11434/llama");
		expect(normalizeModelSelector("OpenAI/gpt-5")).toBe("openai/gpt-5");
	});
});

describe("collectModelSwitchCandidates", () => {
	it("offers the remaining configured models and skips the failed one", () => {
		const settings = Settings.isolated({
			"task.enableModelParam": true,
			modelRoles: { smol: SECONDARY_SELECTOR },
			"retry.fallbackChains": { default: [PRIMARY_SELECTOR] },
		});
		const ledger = new ModelFailureLedger();
		const candidates = collectModelSwitchCandidates({
			settings,
			modelRegistry: registry(),
			failedSelector: PRIMARY_SELECTOR,
			patterns: [PRIMARY_SELECTOR, SECONDARY_SELECTOR],
			ledger,
		});
		const selectors = candidates.map(candidate => candidate.selector);
		expect(selectors).toContain(SECONDARY_SELECTOR);
		expect(selectors).toContain("@smol");
		expect(selectors).not.toContain(PRIMARY_SELECTOR);
	});

	it("never offers a model inside its hard-failure cooldown", () => {
		const settings = Settings.isolated({ "task.enableModelParam": true });
		const ledger = new ModelFailureLedger();
		ledger.noteFailure({ selector: SECONDARY_SELECTOR, failureClass: "usage-limit" });
		const candidates = collectModelSwitchCandidates({
			settings,
			modelRegistry: registry(),
			failedSelector: PRIMARY_SELECTOR,
			patterns: [PRIMARY_SELECTOR, SECONDARY_SELECTOR],
			ledger,
		});
		expect(candidates.map(candidate => candidate.selector)).not.toContain(SECONDARY_SELECTOR);
	});
});

describe("applySubagentModelOverride", () => {
	it("refuses to act while task.enableModelParam is off", async () => {
		const { session, setModelCalls } = sessionStub({
			settings: Settings.isolated({ "task.enableModelParam": false }),
		});
		await expect(applySubagentModelOverride(session, SECONDARY_SELECTOR)).rejects.toThrow(
			"task.enableModelParam is false",
		);
		expect(setModelCalls).toHaveLength(0);
	});

	it("switches the session and records the audit trail", async () => {
		const ledger = new ModelFailureLedger();
		const { session, setModelCalls, notices } = sessionStub({ sessionFile: "/tmp/wake.jsonl" });
		const record = await applySubagentModelOverride(session, SECONDARY_SELECTOR, { ledger, agent: "task" });
		expect(record.from).toBe(PRIMARY_SELECTOR);
		expect(record.to).toBe(SECONDARY_SELECTOR);
		expect(record.source).toBe("wake-param");
		expect(setModelCalls).toHaveLength(1);
		expect(setModelCalls[0]).toBe(SECONDARY);
		expect(ledger.switches).toEqual([{ ...record, agent: "task", at: ledger.switches[0]!.at }]);
		expect(notices).toHaveLength(1);
	});

	it("leaves a session already on that model alone", async () => {
		const { session, setModelCalls } = sessionStub({ current: SECONDARY });
		await applySubagentModelOverride(session, SECONDARY_SELECTOR);
		expect(setModelCalls).toHaveLength(0);
	});

	it("refuses an explicit re-hit inside the failure cooldown and names the alternatives", async () => {
		const ledger = new ModelFailureLedger();
		ledger.noteFailure({ selector: SECONDARY_SELECTOR, failureClass: "usage-limit", agent: "task" });
		const { session, setModelCalls } = sessionStub({ models: [PRIMARY, SECONDARY] });
		await expect(applySubagentModelOverride(session, SECONDARY_SELECTOR, { ledger })).rejects.toThrow(
			/in cooldown after a usage-limit failure on agent "task"/,
		);
		expect(setModelCalls).toHaveLength(0);
	});

	it("rejects a selector that resolves to nothing", async () => {
		const { session, setModelCalls } = sessionStub();
		await expect(applySubagentModelOverride(session, "openai/not-a-model")).rejects.toThrow(
			/could not be resolved|No model matches/,
		);
		expect(setModelCalls).toHaveLength(0);
	});
});

describe("formatExhaustedModelRefusal", () => {
	it("reports the remaining cooldown and the candidates to use instead", () => {
		const ledger = new ModelFailureLedger();
		const record = ledger.noteFailure({ selector: PRIMARY_SELECTOR, failureClass: "usage-limit", agent: "task" })!;
		const message = formatExhaustedModelRefusal(record, [SECONDARY_SELECTOR, "@smol"]);
		expect(message).toContain(PRIMARY_SELECTOR);
		expect(message).toContain("usage-limit");
		expect(message).toContain(SECONDARY_SELECTOR);
		expect(message).toContain("@smol");
	});
});

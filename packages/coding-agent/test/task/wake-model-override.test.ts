/**
 * The wake half of the agent-driven switch: `ensureLive(id, { model })` must
 * apply a caller-supplied model to the session it returns — whether that
 * session was already live (warm) or rebuilt through a reviver (cold) — and
 * must leave the session untouched when no model was named.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { Api, Model } from "@linxiraos/pi-ai";
import type { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentLifecycleManager } from "@linxiraos/zeta/registry/agent-lifecycle";
import { AgentRegistry } from "@linxiraos/zeta/registry/agent-registry";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { runSubagentFollowUpTurn } from "@linxiraos/zeta/task/executor";
import type { AgentDefinition } from "@linxiraos/zeta/task/types";
import { getTestModel } from "../helpers/model-fixtures";

const PRIMARY = getTestModel("openai") as Model<Api>;
const SECONDARY = getTestModel("anthropic") as Model<Api>;
const SECONDARY_SELECTOR = `${SECONDARY.provider}/${SECONDARY.id}`;

const AGENT: AgentDefinition = {
	name: "worker",
	description: "Test worker",
	systemPrompt: "Do the assigned work.",
	source: "bundled",
};

interface SessionStub {
	session: AgentSession;
	/** Models this session was switched to, in order. */
	setModelCalls: Model<Api>[];
}

function sessionStub(options: { settings?: Settings; current?: Model<Api> } = {}): SessionStub {
	const settings = options.settings ?? Settings.isolated({ "task.enableModelParam": true });
	const models = [PRIMARY, SECONDARY];
	const modelRegistry = {
		getAvailable: () => models,
		hasConfiguredAuth: () => true,
	} as unknown as ModelRegistry;
	const setModelCalls: Model<Api>[] = [];
	let current = options.current ?? PRIMARY;
	const session = {
		settings,
		modelRegistry,
		get model() {
			return current;
		},
		setModelTemporary: async (model: Model<Api>) => {
			setModelCalls.push(model);
			current = model;
		},
		emitNotice: () => {},
		sessionManager: { getSessionFile: () => null },
		dispose: async () => {},
	} as unknown as AgentSession;
	return { session, setModelCalls };
}

describe("ensureLive model override", () => {
	beforeEach(() => {
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("switches an already-live (warm) session to the requested model", async () => {
		const registry = AgentRegistry.global();
		const lifecycle = AgentLifecycleManager.global();
		const stub = sessionStub();
		registry.register({ id: "warm-Sub", displayName: "task", kind: "sub", session: stub.session, status: "idle" });
		lifecycle.adopt("warm-Sub", { idleTtlMs: 0 });

		const ensured = await lifecycle.ensureLive("warm-Sub", { model: SECONDARY_SELECTOR });

		expect(ensured).toBe(stub.session);
		expect(stub.setModelCalls).toEqual([SECONDARY]);
	});

	it("switches a cold-revived session instead of the transcript's own model", async () => {
		const registry = AgentRegistry.global();
		const lifecycle = AgentLifecycleManager.global();
		const stub = sessionStub();
		registry.register({
			id: "cold-Sub",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: "/tmp/cold-Sub.jsonl",
			status: "parked",
		});
		lifecycle.adopt("cold-Sub", { idleTtlMs: 0, revive: async () => stub.session });

		const ensured = await lifecycle.ensureLive("cold-Sub", { model: SECONDARY_SELECTOR });

		expect(ensured).toBe(stub.session);
		expect(stub.setModelCalls).toEqual([SECONDARY]);
	});

	it("leaves the session's model alone when the wake names none", async () => {
		const registry = AgentRegistry.global();
		const lifecycle = AgentLifecycleManager.global();
		const stub = sessionStub();
		registry.register({ id: "plain-Sub", displayName: "task", kind: "sub", session: stub.session, status: "idle" });
		lifecycle.adopt("plain-Sub", { idleTtlMs: 0 });

		await lifecycle.ensureLive("plain-Sub");

		expect(stub.setModelCalls).toHaveLength(0);
	});

	it("refuses the override while task.enableModelParam is off", async () => {
		const registry = AgentRegistry.global();
		const lifecycle = AgentLifecycleManager.global();
		const stub = sessionStub({ settings: Settings.isolated({ "task.enableModelParam": false }) });
		registry.register({
			id: "gated-Sub",
			displayName: "task",
			kind: "sub",
			session: stub.session,
			status: "idle",
		});
		lifecycle.adopt("gated-Sub", { idleTtlMs: 0 });

		await expect(lifecycle.ensureLive("gated-Sub", { model: SECONDARY_SELECTOR })).rejects.toThrow(
			"task.enableModelParam is false",
		);
		expect(stub.setModelCalls).toHaveLength(0);
	});

	it("reaches ensureLive from a follow-up turn's model option", async () => {
		const ensureLive = vi
			.spyOn(AgentLifecycleManager.prototype, "ensureLive")
			.mockRejectedValue(new Error("stop before dispatch"));
		await expect(
			runSubagentFollowUpTurn({ id: "follow-Sub", agent: AGENT, message: "continue", model: SECONDARY_SELECTOR }),
		).rejects.toThrow("stop before dispatch");
		expect(ensureLive.mock.calls[0]?.[1]).toEqual({ model: SECONDARY_SELECTOR });

		await expect(runSubagentFollowUpTurn({ id: "follow-Sub", agent: AGENT, message: "continue" })).rejects.toThrow(
			"stop before dispatch",
		);
		expect(ensureLive.mock.calls[1]?.[1]).toBeUndefined();
	});
});
